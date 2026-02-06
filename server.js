// server.js (Railway-ready) - IEats
const express = require("express");
const session = require("express-session");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();

// ---------- Config ----------
const API_PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret";
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "";

// ---------- Middleware ----------
app.use(express.json({ limit: "50mb" }));
app.set("trust proxy", 1);

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
const pool = mysql.createPool(process.env.MYSQL_URL);

// ---------- Helpers ----------
function requireAuth(req, res, next) {
  if (!req.session?.userId)
    return res.status(401).json({ error: "not_logged_in" });
  next();
}
function normalizeString(s) {
  return (s ?? "").toString().trim();
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

// ---------- Google Places helpers for link resolving ----------
function normalizeForMatch(s) {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .replace(
      /[\s\-–—_.,'"`~!@#$%^&*+=|:;<>?()（）［］【】\[\]\/\\]+/g,
      "",
    );
}

// Dice coefficient on bigrams (fast enough for short place names)
function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigrams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    bigrams.set(gram, (bigrams.get(gram) || 0) + 1);
  }

  let matches = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const count = bigrams.get(gram) || 0;
    if (count > 0) {
      bigrams.set(gram, count - 1);
      matches++;
    }
  }

  return (2 * matches) / ((a.length - 1) + (b.length - 1));
}

function pickBestPlaceByNameAndDistance({ targetName, originLat, originLng, places }) {
  const t = normalizeForMatch(targetName);
  let best = null;
  let bestScore = -Infinity;

  for (const p of places) {
    const name = (p?.displayName?.text || "").toString().trim();
    const pid = (p?.id || "").toString().trim();
    const plat = p?.location?.latitude;
    const plng = p?.location?.longitude;
    if (!name || !pid) continue;
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;

    const n = normalizeForMatch(name);
    const dist = haversineMeters(originLat, originLng, plat, plng);

    let sim = 0;
    if (t && n) {
      if (n === t) sim = 1;
      else if (n.includes(t) || t.includes(n)) sim = 0.92;
      else sim = diceCoefficient(t, n);
    }

    // Score: prefer name match strongly, then distance as tie-breaker
    const score = sim * 1000 - dist;
    if (score > bestScore) {
      bestScore = score;
      best = { pid, name, plat, plng, dist, address: (p?.formattedAddress || "").toString().trim() };
    }
  }

  return best;
}

// ---------- Nearby restaurants (OSM / Overpass - FREE) ----------
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];

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

async function fetchOverpassJson(query) {
  const body = `data=${encodeURIComponent(query)}`;

  let lastErr = null;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "IEats/1.0 (student project)",
        },
        body,
      });

      if (!r.ok) {
        lastErr = new Error(`Overpass status ${r.status}`);
        continue;
      }

      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Overpass failed");
}


// ---------- Nearby restaurants (Google Places API - optional) ----------
// Uses Places API (New): Nearby Search (New) - POST /v1/places:searchNearby
// Docs require FieldMask via X-Goog-FieldMask.
async function fetchGoogleNearbyPlaces({ lat, lng, radius, limit }) {
  const url = "https://places.googleapis.com/v1/places:searchNearby";

  const body = {
    // food-ish types that match IEats use-case
    includedTypes: ["restaurant", "cafe", "fast_food", "bar"],
    maxResultCount: limit,
    rankPreference: "DISTANCE",
    regionCode: "JP",
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius,
      },
    },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      // ask only what we need (to reduce payload/cost)
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.location,places.formattedAddress",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Google Places error ${r.status}: ${t}`);
  }

  return r.json();
}

// Places API (New): Place Details (New) - GET /v1/places/{placeId}
async function fetchGooglePlaceDetails(placeId) {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(
    placeId,
  )}`;

  const r = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
      // FieldMask is REQUIRED for Place Details (New)
      "X-Goog-FieldMask":
        "displayName,formattedAddress,googleMapsUri,location",
    },
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Google Place Details error ${r.status}: ${t}`);
  }
  return r.json();
}

function pickBestPlaceByNameAndDistance({ targetName, centerLat, centerLng, places }) {
  const t = normalizeForMatch(targetName);
  let best = null;
  let bestScore = -Infinity;

  for (const p of places) {
    const name = (p?.displayName?.text || "").toString().trim();
    const pid = (p?.id || "").toString().trim();
    const plat = p?.location?.latitude;
    const plng = p?.location?.longitude;
    if (!pid || !name) continue;
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;

    const n = normalizeForMatch(name);
    const dist = haversineMeters(centerLat, centerLng, plat, plng);

    // Similarity: dice on bigrams (0..1)
    const sim = t ? diceCoefficient(t, n) : 0;
    const containsBoost = t && (n.includes(t) || t.includes(n)) ? 0.2 : 0;
    const score = (sim + containsBoost) * 1000 - dist; // distance tie-break

    if (score > bestScore) {
      bestScore = score;
      best = { p, dist, score };
    }
  }
  return best?.p || null;
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
// GET /api/nearby?lat=...&lng=...&radius=150&limit=8
// Returns simple POI list (name + address + lat/lng + distance).
// Priority: Google Places (if GOOGLE_PLACES_API_KEY is set). Fallback: Overpass (free).
app.get("/api/nearby", requireAuth, async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "invalid_coords" });
    }

    const radius = Math.min(Math.max(Number(req.query.radius) || 150, 20), 1000);
    const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 20);

    // ---- 1) Google Places (recommended / most accurate) ----
    if (GOOGLE_PLACES_API_KEY) {
      const json = await fetchGoogleNearbyPlaces({ lat, lng, radius, limit });
      const arr = Array.isArray(json?.places) ? json.places : [];

      const map = new Map();
      for (const p of arr) {
        const name = (p?.displayName?.text || "").toString().trim();
        const pid = (p?.id || "").toString().trim();
        const plat = p?.location?.latitude;
        const plng = p?.location?.longitude;
        const address = (p?.formattedAddress || "").toString().trim();

        if (!name || !pid) continue;
        if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;

        const dist = haversineMeters(lat, lng, plat, plng);
        const key = pid; // stable id

        const existing = map.get(key);
        if (!existing || dist < existing.distanceMeters) {
          map.set(key, {
            placeId: pid,
            name,
            address,
            lat: plat,
            lng: plng,
            distanceMeters: dist,
          });
        }
      }

      const places = Array.from(map.values())
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, limit);

      return res.json({ ok: true, provider: "google", places });
    }

    // ---- 2) Overpass fallback (FREE) ----
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

      // coords
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
        map.set(key, {
          placeId: null,
          name,
          address: "",
          lat: plat,
          lng: plng,
          distanceMeters: dist,
        });
      }
    }

    const places = Array.from(map.values())
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, limit);

    res.json({ ok: true, provider: "overpass", places });
  } catch (e) {
    console.error("NEARBY ERROR:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Resolve Google Maps link to precise place (Google Places preferred) ----------
// POST /api/maps/resolve { name?, lat, lng }
// Returns: { ok, provider, place: { placeId, name, address, lat, lng, googleMapsUri } }
app.post("/api/maps/resolve", requireAuth, async (req, res) => {
  try {
    const targetName = normalizeString(req.body?.name);
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "invalid_coords" });
    }

    const radius = Math.min(Math.max(Number(req.body?.radius) || 120, 20), 500);
    const limit = Math.min(Math.max(Number(req.body?.limit) || 10, 1), 20);

    // ---- 1) Google Places (best accuracy) ----
    if (GOOGLE_PLACES_API_KEY) {
      const json = await fetchGoogleNearbyPlaces({ lat, lng, radius, limit });
      const arr = Array.isArray(json?.places) ? json.places : [];

      // pick best by name similarity + distance
      const best = pickBestPlaceByNameAndDistance({
        targetName,
        centerLat: lat,
        centerLng: lng,
        places: arr,
      });

      if (!best) {
        return res.status(404).json({ error: "not_found" });
      }

      // ensure address exists (some places may not include it)
      let address = (best?.formattedAddress || "").toString().trim();
      let googleMapsUri = (best?.googleMapsUri || "").toString().trim();

      if (!address || !googleMapsUri) {
        const details = await fetchGooglePlaceDetails(best.id);
        address = (details?.formattedAddress || address).toString().trim();
        googleMapsUri = (details?.googleMapsUri || googleMapsUri)
          .toString()
          .trim();
      }

      return res.json({
        ok: true,
        provider: "google",
        place: {
          placeId: best.id,
          name: (best?.displayName?.text || "").toString().trim(),
          address,
          lat: best?.location?.latitude ?? null,
          lng: best?.location?.longitude ?? null,
          googleMapsUri,
        },
      });
    }

    // ---- 2) Fallback: return coords only (client can use OSM reverse) ----
    res.json({
      ok: true,
      provider: "coords_only",
      place: { placeId: null, name: targetName, address: "", lat, lng },
    });
  } catch (e) {
    console.error("MAPS RESOLVE ERROR:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// ---------- Entries ----------
app.get("/api/entries", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    // nếu DB anh không có created_at thì bỏ created_at khỏi SELECT + ORDER BY
    const [entries] = await pool.execute(
      `SELECT id, restaurant_name, restaurant_address, visit_date, overall_rating, content, image, images_json
       FROM entries
       WHERE user_id=?
       ORDER BY visit_date DESC`,
      [userId],
    );

    if (!entries.length) return res.json({ ok: true, entries: [] });

    const entryIds = entries.map((e) => e.id);

    const [dishesRows] = await pool.query(
      `SELECT entry_id, dish FROM entry_dishes WHERE entry_id IN (${entryIds.map(() => "?").join(",")})`,
      entryIds,
    );
    const [tagsRows] = await pool.query(
      `SELECT entry_id, tag FROM entry_tags WHERE entry_id IN (${entryIds.map(() => "?").join(",")})`,
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
  try {
    const userId = req.session.userId;
    const entryId = Number(req.params.id);

    const [result] = await pool.execute(
      "DELETE FROM entries WHERE id=? AND user_id=?",
      [entryId, userId],
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ error: "not_found" });

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE ENTRY ERROR:", e);
    res.status(500).json({ error: "server_error", code: e.code });
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
  console.log(`IEats API running at http://127.0.0.1:${API_PORT}`);
});
