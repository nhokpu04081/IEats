// server.js (Railway-ready) - IEats
// One-file backend: Auth (session), Entries/Wishlist CRUD (MySQL),
// Nearby + Google Maps link resolve (Google Places API New w/ fallback)
const express = require("express");
const session = require("express-session");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();

// ---------- Config ----------
const API_PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret";
const MYSQL_URL = process.env.MYSQL_URL || "";
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// ---------- Middleware ----------
app.use(express.json({ limit: "50mb" }));
app.set("trust proxy", 1);

// Simple CORS for local dev (optional). Safe on Railway.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allow =
    origin &&
    (origin.startsWith("http://127.0.0.1") ||
      origin.startsWith("http://localhost") ||
      (process.env.FRONTEND_ORIGIN || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .includes(origin));

  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,OPTIONS",
    );
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  }),
);

// serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- DB Pool (Railway MySQL ENV) ----------
if (!MYSQL_URL) {
  console.warn(
    "[WARN] MYSQL_URL is not set. API will fail until DB is configured.",
  );
}
const pool = mysql.createPool({
  uri: MYSQL_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- Helpers ----------
function requireAuth(req, res, next) {
  if (!req.session?.userId)
    return res.status(401).json({ error: "not_logged_in" });
  next();
}

function normalizeString(s) {
  return (s ?? "").toString().trim();
}

function normalizeKey(s) {
  return normalizeString(s)
    .toLowerCase()
    .replace(/[\u3000]/g, " ")
    .replace(/[()（）【】［］「」『』"'`’]/g, "")
    .replace(/[.,、・/\\\-_\s]+/g, " ")
    .trim();
}

function toISODate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const s = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function parseImagesFromBody(body) {
  const images = Array.isArray(body?.images) ? body.images : [];
  const legacyImage = body?.image ?? null;

  const cleaned = images
    .map((x) => (typeof x === "string" ? x : null))
    .filter(Boolean);

  const coverImage = cleaned[0] || legacyImage || null;
  const imagesJson = cleaned.length ? safeJsonStringify(cleaned) : null;

  return { imagesJson, coverImage };
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function withTimeout(ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return { controller, cleanup: () => clearTimeout(t) };
}

// ---------- Overpass (FREE) ----------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];

async function fetchOverpassJson(query) {
  const body = `data=${encodeURIComponent(query)}`;
  let lastErr = null;

  for (const url of OVERPASS_ENDPOINTS) {
    const { controller, cleanup } = withTimeout(12000);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "IEats/1.0 (student project)",
        },
        body,
        signal: controller.signal,
      });
      if (!r.ok) {
        lastErr = new Error(`Overpass status ${r.status}`);
        continue;
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
    } finally {
      cleanup();
    }
  }

  throw lastErr || new Error("Overpass failed");
}

async function fetchOverpassNearby({ lat, lng, radius, limit }) {
  const q = `
[out:json][timeout:10];
(
  node(around:${radius},${lat},${lng})["name"]["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"];
  way(around:${radius},${lat},${lng})["name"]["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"];
  relation(around:${radius},${lat},${lng})["name"]["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"];
);
out center tags;
`;

  const json = await fetchOverpassJson(q);
  const elements = Array.isArray(json?.elements) ? json.elements : [];

  const map = new Map();
  for (const el of elements) {
    const name = (el?.tags?.name || "").toString().trim();
    if (!name) continue;

    let plat = null;
    let plng = null;
    if (typeof el.lat === "number" && typeof el.lon === "number") {
      plat = el.lat;
      plng = el.lon;
    } else if (
      el.center &&
      typeof el.center.lat === "number" &&
      typeof el.center.lon === "number"
    ) {
      plat = el.center.lat;
      plng = el.center.lon;
    }
    if (plat === null || plng === null) continue;

    const dist = haversineMeters(lat, lng, plat, plng);
    const key = name.toLowerCase();

    const existing = map.get(key);
    if (!existing || dist < existing.distanceMeters) {
      map.set(key, { name, lat: plat, lng: plng, distanceMeters: dist });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

// ---------- Google Places API (New) ----------
async function googlePostJson(url, body, fieldMask) {
  const { controller, cleanup } = withTimeout(10000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Google Places error ${r.status}: ${t}`);
    }
    return r.json();
  } finally {
    cleanup();
  }
}

async function googleGetJson(url, fieldMask) {
  const { controller, cleanup } = withTimeout(10000);
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": fieldMask,
      },
      signal: controller.signal,
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Google Places error ${r.status}: ${t}`);
    }
    return r.json();
  } finally {
    cleanup();
  }
}

// Nearby Search (New): POST /v1/places:searchNearby
async function fetchGoogleNearbyPlaces({ lat, lng, radius, limit }) {
  const url = "https://places.googleapis.com/v1/places:searchNearby";

  const body = {
    includedTypes: ["restaurant", "cafe", "fast_food", "bar"],
    maxResultCount: limit,
    rankPreference: "DISTANCE",
    regionCode: "JP",
    languageCode: "ja",
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius,
      },
    },
  };

  return googlePostJson(
    url,
    body,
    "places.id,places.displayName,places.location,places.formattedAddress,places.googleMapsUri",
  );
}

// Text Search (New): POST /v1/places:searchText
async function fetchGoogleTextSearch({ textQuery, lat, lng, radius, limit }) {
  const url = "https://places.googleapis.com/v1/places:searchText";

  const body = {
    textQuery,
    maxResultCount: limit,
    regionCode: "JP",
    languageCode: "ja",
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius,
      },
    },
  };

  return googlePostJson(
    url,
    body,
    "places.id,places.displayName,places.location,places.formattedAddress,places.googleMapsUri",
  );
}

async function fetchGoogleTextSearchNoBias({ textQuery, limit }) {
  const url = "https://places.googleapis.com/v1/places:searchText";
  const body = {
    textQuery,
    maxResultCount: limit,
    regionCode: "JP",
    languageCode: "ja",
  };

  return googlePostJson(
    url,
    body,
    "places.id,places.displayName,places.location,places.formattedAddress,places.googleMapsUri",
  );
}

// Place Details (New): GET /v1/places/{placeId}
async function fetchGooglePlaceDetails(placeId) {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(
    placeId,
  )}?languageCode=ja&regionCode=JP`;
  return googleGetJson(
    url,
    "id,displayName,formattedAddress,shortFormattedAddress,location,googleMapsUri",
  );
}

function scoreNameSimilarity(target, candidate) {
  const a = normalizeKey(target);
  const b = normalizeKey(candidate);
  if (!a || !b) return 0;

  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;

  const at = new Set(a.split(" ").filter(Boolean));
  const bt = new Set(b.split(" ").filter(Boolean));
  if (!at.size || !bt.size) return 0;

  let inter = 0;
  for (const t of at) if (bt.has(t)) inter += 1;

  const union = at.size + bt.size - inter;
  return union ? inter / union : 0;
}

function pickBestPlaceByNameAndDistance({
  targetName,
  centerLat,
  centerLng,
  places,
}) {
  if (!Array.isArray(places) || places.length === 0) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const p of places) {
    const name = (p?.displayName?.text || p?.displayName || "")
      .toString()
      .trim();
    const plat =
      typeof p?.location?.latitude === "number" ? p.location.latitude : null;
    const plng =
      typeof p?.location?.longitude === "number" ? p.location.longitude : null;

    const dist =
      plat !== null && plng !== null
        ? haversineMeters(centerLat, centerLng, plat, plng)
        : 9999999;

    let score;
    if (targetName) {
      const sim = scoreNameSimilarity(targetName, name); // 0..1
      score = sim * 100000 - dist;
    } else {
      score = -dist;
    }

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}

// ---------- Google Maps short-link expand + long-link parser ----------
const SHORT_GOOGLE_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);

async function expandGoogleMapsShortUrl(inputUrl) {
  const { controller, cleanup } = withTimeout(8000);
  try {
    const r = await fetch(inputUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0" },
    });
    return r.url || inputUrl;
  } finally {
    cleanup();
  }
}

function extractNameLatLngFromGoogleMapsUrl(link) {
  let name = "";
  let query = "";
  let lat = null;
  let lng = null;

  try {
    const url = new URL(link);

    // ✅ Case A: maps.google.com?q=...
    const q = url.searchParams.get("q");
    if (q) {
      query = q.replace(/\+/g, " ").trim(); // full "Name, Address..."
      if (query) name = query.split(",")[0].trim(); // lấy tên trước dấu phẩy
    }

    // ✅ Case B: /place/<NAME>
    const parts = url.pathname.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === "place" && parts[i + 1]) {
        const seg = parts[i + 1];
        const at = seg.indexOf("@");
        const raw = at > 0 ? seg.slice(0, at) : seg;
        name = decodeURIComponent(raw.replace(/\+/g, " ")).trim() || name;
        if (!query && name) query = name;
        break;
      }
    }

    // ✅ coords: prefer !3d..!4d.. then fallback @lat,lng
    let m = link.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (!m) m = link.match(/!8m2!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (!m) m = link.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);

    if (m) {
      lat = Number(m[1]);
      lng = Number(m[2]);
      if (!Number.isFinite(lat)) lat = null;
      if (!Number.isFinite(lng)) lng = null;
    }
  } catch (_) {}

  return { name, query, lat, lng };
}

// ---------- Health ----------
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    console.error("DB health error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ---------- Auth ----------
app.post("/api/auth/register", async (req, res) => {
  try {
    const username = normalizeString(req.body?.username);
    const email = normalizeString(req.body?.email);
    const password = (req.body?.password ?? "").toString();

    if (!username || !email || !password)
      return res.status(400).json({ error: "missing_fields" });

    const [exist] = await pool.execute(
      "SELECT id FROM users WHERE username=? OR email=? LIMIT 1",
      [username, email],
    );
    if (exist.length) return res.status(409).json({ error: "exists" });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      "INSERT INTO users (username, email, password_hash) VALUES (?,?,?)",
      [username, email, hash],
    );

    req.session.userId = result.insertId;
    req.session.username = username;

    res.json({ ok: true, user: { id: result.insertId, username, email } });
  } catch (e) {
    console.error("REGISTER ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const identity = normalizeString(req.body?.username);
    const password = (req.body?.password ?? "").toString();
    if (!identity || !password)
      return res.status(400).json({ error: "missing_fields" });

    const [rows] = await pool.execute(
      "SELECT id, username, email, password_hash FROM users WHERE username=? OR email=? LIMIT 1",
      [identity, identity],
    );
    if (!rows.length) return res.status(401).json({ error: "invalid" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "invalid" });

    req.session.userId = user.id;
    req.session.username = user.username;

    res.json({
      ok: true,
      user: { id: user.id, username: user.username, email: user.email },
    });
  } catch (e) {
    console.error("LOGIN ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
  }
});

app.get("/api/me", (req, res) => {
  if (!req.session?.userId) return res.json({ user: null });
  res.json({
    user: { id: req.session.userId, username: req.session.username },
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ---------- Nearby (current location) ----------
app.get("/api/nearby", requireAuth, async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "invalid_coords" });
    }

    const radius = Math.min(Math.max(Number(req.query.radius) || 150, 20), 500);
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20);

    let places = [];
    let provider = null;
    let googleError = null;

    if (GOOGLE_PLACES_API_KEY) {
      try {
        const json = await fetchGoogleNearbyPlaces({ lat, lng, radius, limit });
        const raw = Array.isArray(json?.places) ? json.places : [];
        places = raw
          .map((p) => {
            const name = (p?.displayName?.text || "").toString().trim();
            const plat =
              typeof p?.location?.latitude === "number"
                ? p.location.latitude
                : null;
            const plng =
              typeof p?.location?.longitude === "number"
                ? p.location.longitude
                : null;
            if (!name || plat === null || plng === null) return null;

            return {
              name,
              address: (p?.formattedAddress || "").toString().trim() || null,
              lat: plat,
              lng: plng,
              distanceMeters: haversineMeters(lat, lng, plat, plng),
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.distanceMeters - b.distanceMeters)
          .slice(0, limit);

        provider = "google";
      } catch (e) {
        googleError = String(e?.message || e);
        console.error("NEARBY GOOGLE ERROR:", e);
      }
    }

    if (!places.length) {
      try {
        places = await fetchOverpassNearby({ lat, lng, radius, limit });
        provider = provider || "overpass";
      } catch (e) {
        console.error("NEARBY OVERPASS ERROR:", e);
        return res.status(500).json({
          error: "server_error",
          googleError,
          overpassError: String(e?.message || e),
        });
      }
    }

    res.json({ ok: true, provider, googleError, places });
  } catch (e) {
    console.error("NEARBY ERROR:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Google Maps link resolve (supports short links) ----------
app.post("/api/maps/resolve", requireAuth, async (req, res) => {
  try {
    let link = normalizeString(req.body?.link);

    let targetName = normalizeString(req.body?.name);
    let lat = Number(req.body?.lat);
    let lng = Number(req.body?.lng);
    let extracted = null;

    if (link) {
      try {
        const u = new URL(link);
        if (SHORT_GOOGLE_HOSTS.has(u.hostname)) {
          link = await expandGoogleMapsShortUrl(link);
        }
      } catch (_) {}

      extracted = extractNameLatLngFromGoogleMapsUrl(link);
      if (!targetName && extracted.name)
        targetName = normalizeString(extracted.name);
      if (!Number.isFinite(lat) && extracted.lat !== null) lat = extracted.lat;
      if (!Number.isFinite(lng) && extracted.lng !== null) lng = extracted.lng;
    }

    // ✅ NEW: nếu không có coords (thường do short link redirect ra maps.google.com?q=...)
    // thì dùng Google Text Search (no bias) dựa trên query/name
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (!GOOGLE_PLACES_API_KEY) {
        return res.json({ ok: true, provider: "coords_only", place: null });
      }

      const textQuery = normalizeString(extracted?.query || targetName || "");
      if (!textQuery) {
        return res.json({ ok: true, provider: "coords_missing", place: null });
      }

      try {
        const json = await fetchGoogleTextSearchNoBias({ textQuery, limit: 5 });
        const places = Array.isArray(json?.places) ? json.places : [];
        if (!places.length) {
          return res.json({ ok: true, provider: "google_failed", place: null });
        }

        const best = places[0];

        let placeId = (best?.id || "").toString().trim() || null;
        let name = (best?.displayName?.text || "").toString().trim() || "";
        let address = (best?.formattedAddress || "").toString().trim() || "";
        let plat =
          typeof best?.location?.latitude === "number"
            ? best.location.latitude
            : null;
        let plng =
          typeof best?.location?.longitude === "number"
            ? best.location.longitude
            : null;
        let googleMapsUri =
          (best?.googleMapsUri || "").toString().trim() || null;

        // ensure address/uri are present via Place Details (New) when needed
        if (
          placeId &&
          (!address || !googleMapsUri || plat === null || plng === null)
        ) {
          try {
            const details = await fetchGooglePlaceDetails(placeId);
            address =
              address ||
              (details?.formattedAddress || "").toString().trim() ||
              (details?.shortFormattedAddress || "").toString().trim();
            googleMapsUri =
              googleMapsUri ||
              (details?.googleMapsUri || "").toString().trim() ||
              null;
            if (
              plat === null &&
              typeof details?.location?.latitude === "number"
            )
              plat = details.location.latitude;
            if (
              plng === null &&
              typeof details?.location?.longitude === "number"
            )
              plng = details.location.longitude;
            name =
              name ||
              (details?.displayName?.text || "").toString().trim() ||
              "";
          } catch (e) {
            console.error("MAP RESOLVE DETAILS (NOBIAS) ERROR:", e);
          }
        }

        return res.json({
          ok: true,
          provider: "google_textsearch_nobias",
          googleError: null,
          place: {
            placeId,
            name,
            address,
            lat: plat,
            lng: plng,
            googleMapsUri,
          },
        });
      } catch (e) {
        console.error("MAP RESOLVE TEXTSEARCH(NOBIAS) ERROR:", e);
        return res.json({
          ok: true,
          provider: "google_failed",
          googleError: String(e?.message || e),
          place: null,
        });
      }
    }

    const radius = Math.min(Math.max(Number(req.body?.radius) || 120, 20), 500);
    const limit = Math.min(Math.max(Number(req.body?.limit) || 10, 1), 20);

    if (!GOOGLE_PLACES_API_KEY) {
      return res.json({ ok: true, provider: "coords_only", place: null });
    }

    let googleError = null;
    let provider = null;
    let places = [];

    if (targetName) {
      try {
        const json = await fetchGoogleTextSearch({
          textQuery: targetName,
          lat,
          lng,
          radius: Math.max(radius * 6, 500),
          limit,
        });
        places = Array.isArray(json?.places) ? json.places : [];
        provider = "google_textsearch";
      } catch (e) {
        googleError = e;
        console.error("MAP RESOLVE TEXTSEARCH ERROR:", e);
      }
    }

    if (!places.length) {
      try {
        const json = await fetchGoogleNearbyPlaces({ lat, lng, radius, limit });
        places = Array.isArray(json?.places) ? json.places : [];
        provider = "google_nearby";
      } catch (e) {
        googleError = googleError || e;
        console.error("MAP RESOLVE NEARBY ERROR:", e);
      }
    }

    if (!places.length) {
      return res.json({
        ok: true,
        provider: "google_failed",
        googleError: googleError
          ? String(googleError.message || googleError)
          : null,
        place: null,
      });
    }

    const best =
      pickBestPlaceByNameAndDistance({
        targetName,
        centerLat: lat,
        centerLng: lng,
        places,
      }) || places[0];

    let placeId = (best?.id || "").toString().trim() || null;
    let name =
      (best?.displayName?.text || "").toString().trim() || targetName || "";
    let address = (best?.formattedAddress || "").toString().trim();
    let plat =
      typeof best?.location?.latitude === "number"
        ? best.location.latitude
        : null;
    let plng =
      typeof best?.location?.longitude === "number"
        ? best.location.longitude
        : null;
    let googleMapsUri = (best?.googleMapsUri || "").toString().trim() || null;

    if (
      placeId &&
      (!address || !googleMapsUri || plat === null || plng === null)
    ) {
      try {
        const details = await fetchGooglePlaceDetails(placeId);
        address =
          address ||
          (details?.formattedAddress || "").toString().trim() ||
          (details?.shortFormattedAddress || "").toString().trim();
        googleMapsUri =
          googleMapsUri ||
          (details?.googleMapsUri || "").toString().trim() ||
          null;

        if (plat === null && typeof details?.location?.latitude === "number")
          plat = details.location.latitude;
        if (plng === null && typeof details?.location?.longitude === "number")
          plng = details.location.longitude;

        name =
          name ||
          (details?.displayName?.text || "").toString().trim() ||
          targetName ||
          "";
      } catch (e) {
        console.error("MAP RESOLVE DETAILS ERROR:", e);
      }
    }

    return res.json({
      ok: true,
      provider,
      googleError: googleError
        ? String(googleError.message || googleError)
        : null,
      place: {
        placeId,
        name,
        address,
        lat: plat ?? lat,
        lng: plng ?? lng,
        googleMapsUri,
      },
    });
  } catch (e) {
    console.error("MAP RESOLVE ERROR:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Entries ----------
app.get("/api/entries", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const [entries] = await pool.execute(
      `SELECT id, restaurant_name, restaurant_address, visit_date, overall_rating, content, image, images_json
       FROM entries
       WHERE user_id=?
       ORDER BY visit_date DESC, id DESC`,
      [userId],
    );

    if (!entries.length) return res.json({ ok: true, entries: [] });

    const entryIds = entries.map((e) => e.id);

    const [dishesRows] = await pool.query(
      `SELECT entry_id, dish FROM entry_dishes WHERE entry_id IN (${entryIds
        .map(() => "?")
        .join(",")})`,
      entryIds,
    );
    const [tagsRows] = await pool.query(
      `SELECT entry_id, tag FROM entry_tags WHERE entry_id IN (${entryIds
        .map(() => "?")
        .join(",")})`,
      entryIds,
    );

    const dishesMap = new Map();
    for (const r of dishesRows) {
      if (!dishesMap.has(r.entry_id)) dishesMap.set(r.entry_id, []);
      dishesMap.get(r.entry_id).push(r.dish);
    }

    const tagsMap = new Map();
    for (const r of tagsRows) {
      if (!tagsMap.has(r.entry_id)) tagsMap.set(r.entry_id, []);
      tagsMap.get(r.entry_id).push(r.tag);
    }

    const mapped = entries.map((e) => ({
      id: e.id,
      restaurantName: e.restaurant_name,
      restaurantAddress: e.restaurant_address,
      date: e.visit_date,
      overallRating: e.overall_rating,
      content: e.content || "",
      image: e.image || null,
      images_json: e.images_json || null,
      dishes: dishesMap.get(e.id) || [],
      tags: tagsMap.get(e.id) || [],
    }));

    res.json({ ok: true, entries: mapped });
  } catch (e) {
    console.error("GET ENTRIES ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
  }
});

app.post("/api/entries", requireAuth, async (req, res) => {
  const userId = req.session.userId;

  const id = Number(req.body?.id);
  const restaurantName = normalizeString(req.body?.restaurantName);
  const restaurantAddress = normalizeString(req.body?.restaurantAddress);
  const date = toISODate(req.body?.date);
  const overallRating = Number(req.body?.overallRating);
  const content = (req.body?.content ?? "").toString();

  const dishes = Array.isArray(req.body?.dishes)
    ? req.body.dishes.map(normalizeString).filter(Boolean)
    : [];
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map(normalizeString).filter(Boolean)
    : [];

  const { imagesJson, coverImage } = parseImagesFromBody(req.body);

  if (
    !id ||
    !restaurantName ||
    !restaurantAddress ||
    !date ||
    !(overallRating >= 1 && overallRating <= 5)
  ) {
    return res.status(400).json({ error: "invalid_fields" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO entries
       (id, user_id, restaurant_name, restaurant_address, visit_date, overall_rating, content, image, images_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id,
        userId,
        restaurantName,
        restaurantAddress,
        date,
        overallRating,
        content,
        coverImage,
        imagesJson,
      ],
    );

    if (dishes.length) {
      const placeholders = dishes.map(() => "(?,?)").join(",");
      const values = [];
      for (const d of dishes) values.push(id, d);
      await conn.query(
        `INSERT INTO entry_dishes (entry_id, dish) VALUES ${placeholders}`,
        values,
      );
    }

    if (tags.length) {
      const placeholders = tags.map(() => "(?,?)").join(",");
      const values = [];
      for (const t of tags) values.push(id, t);
      await conn.query(
        `INSERT INTO entry_tags (entry_id, tag) VALUES ${placeholders}`,
        values,
      );
    }

    await conn.commit();
    res.json({ ok: true, id });
  } catch (e) {
    await conn.rollback();
    console.error("CREATE ENTRY ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
  } finally {
    conn.release();
  }
});

app.put("/api/entries/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const entryId = Number(req.params.id);

  const restaurantName = normalizeString(req.body?.restaurantName);
  const restaurantAddress = normalizeString(req.body?.restaurantAddress);
  const date = toISODate(req.body?.date);
  const overallRating = Number(req.body?.overallRating);
  const content = (req.body?.content ?? "").toString();

  const dishes = Array.isArray(req.body?.dishes)
    ? req.body.dishes.map(normalizeString).filter(Boolean)
    : [];
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.map(normalizeString).filter(Boolean)
    : [];

  const { imagesJson, coverImage } = parseImagesFromBody(req.body);

  if (
    !entryId ||
    !restaurantName ||
    !restaurantAddress ||
    !date ||
    !(overallRating >= 1 && overallRating <= 5)
  ) {
    return res.status(400).json({ error: "invalid_fields" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [own] = await conn.execute(
      "SELECT id FROM entries WHERE id=? AND user_id=? LIMIT 1",
      [entryId, userId],
    );
    if (!own.length) {
      await conn.rollback();
      return res.status(404).json({ error: "not_found" });
    }

    await conn.execute(
      `UPDATE entries
       SET restaurant_name=?, restaurant_address=?, visit_date=?, overall_rating=?, content=?, image=?, images_json=?
       WHERE id=? AND user_id=?`,
      [
        restaurantName,
        restaurantAddress,
        date,
        overallRating,
        content,
        coverImage,
        imagesJson,
        entryId,
        userId,
      ],
    );

    await conn.execute("DELETE FROM entry_dishes WHERE entry_id=?", [entryId]);
    await conn.execute("DELETE FROM entry_tags WHERE entry_id=?", [entryId]);

    if (dishes.length) {
      const placeholders = dishes.map(() => "(?,?)").join(",");
      const values = [];
      for (const d of dishes) values.push(entryId, d);
      await conn.query(
        `INSERT INTO entry_dishes (entry_id, dish) VALUES ${placeholders}`,
        values,
      );
    }

    if (tags.length) {
      const placeholders = tags.map(() => "(?,?)").join(",");
      const values = [];
      for (const t of tags) values.push(entryId, t);
      await conn.query(
        `INSERT INTO entry_tags (entry_id, tag) VALUES ${placeholders}`,
        values,
      );
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error("UPDATE ENTRY ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
  } finally {
    conn.release();
  }
});

app.delete("/api/entries/:id", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const entryId = Number(req.params.id);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [own] = await conn.execute(
      "SELECT id FROM entries WHERE id=? AND user_id=? LIMIT 1",
      [entryId, userId],
    );
    if (!own.length) {
      await conn.rollback();
      return res.status(404).json({ error: "not_found" });
    }

    await conn.execute("DELETE FROM entry_dishes WHERE entry_id=?", [entryId]);
    await conn.execute("DELETE FROM entry_tags WHERE entry_id=?", [entryId]);
    await conn.execute("DELETE FROM entries WHERE id=? AND user_id=?", [
      entryId,
      userId,
    ]);

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error("DELETE ENTRY ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
  } finally {
    conn.release();
  }
});

// ---------- Wishlist ----------
app.get("/api/wishlist", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const [rows] = await pool.execute(
      `SELECT id, dish, restaurant, notes, priority, added_date
       FROM wishlist
       WHERE user_id=?
       ORDER BY FIELD(priority,'high','medium','low'), added_date DESC`,
      [userId],
    );
    res.json({ ok: true, wishlist: rows });
  } catch (e) {
    console.error("GET WISHLIST ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
  }
});

app.post("/api/wishlist", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const id = Number(req.body?.id);
    const dish = normalizeString(req.body?.dish);
    const restaurant = normalizeString(req.body?.restaurant);
    const notes = (req.body?.notes ?? "").toString();
    const priority = normalizeString(req.body?.priority) || "medium";
    const addedDate =
      toISODate(req.body?.addedDate) || new Date().toISOString().slice(0, 10);

    if (!id || !dish) return res.status(400).json({ error: "invalid_fields" });

    await pool.execute(
      `INSERT INTO wishlist (id, user_id, dish, restaurant, notes, priority, added_date)
       VALUES (?,?,?,?,?,?,?)`,
      [id, userId, dish, restaurant, notes, priority, addedDate],
    );

    res.json({ ok: true, id });
  } catch (e) {
    console.error("ADD WISHLIST ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
  }
});

app.delete("/api/wishlist/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const id = Number(req.params.id);

    const [result] = await pool.execute(
      "DELETE FROM wishlist WHERE id=? AND user_id=?",
      [id, userId],
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "not_found" });

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE WISHLIST ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
  }
});

// ---------- Start ----------
app.listen(API_PORT, () => {
  console.log(`IEats API running on port ${API_PORT}`);
});
