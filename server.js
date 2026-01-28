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
