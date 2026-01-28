// === GLOBAL DATA MANAGEMENT ===
const API_BASE = "/api";

let appData = {
  entries: [],
  restaurants: [],
  wishlist: [],
  user: null,
  users: [],
  currentTagFilter: null,
};

// ---------- API helpers ----------
async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(`GET ${path} failed: ${res.status}`), {
      data,
    });
  return data;
}
async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(`POST ${path} failed: ${res.status}`), {
      data,
    });
  return data;
}
async function apiPut(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(`PUT ${path} failed: ${res.status}`), {
      data,
    });
  return data;
}
async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw Object.assign(new Error(`DELETE ${path} failed: ${res.status}`), {
      data,
    });
  return data;
}

// ---------- normalize server rows to match localStorage shape ----------
function normalizeEntry(e) {
  // date: "2026-01-13T..." or "2026-01-13 00:00:00" -> "2026-01-13"
  if (typeof e.date === "string") {
    if (e.date.includes("T")) e.date = e.date.split("T")[0];
    else if (e.date.includes(" ")) e.date = e.date.split(" ")[0];
  }

  // dishes/tags may come as JSON string from DB
  if (typeof e.dishes === "string") {
    try {
      e.dishes = JSON.parse(e.dishes);
    } catch {
      e.dishes = [];
    }
  }
  if (!Array.isArray(e.dishes)) e.dishes = [];

  if (typeof e.tags === "string") {
    try {
      e.tags = JSON.parse(e.tags);
    } catch {
      e.tags = [];
    }
  }
  if (!Array.isArray(e.tags)) e.tags = [];

  // rating number
  e.overallRating = Number(e.overallRating) || 0;

  // images (new): parse images_json -> e.images[]
  if (typeof e.images_json === "string" && e.images_json.trim()) {
    try {
      e.images = JSON.parse(e.images_json);
    } catch {
      e.images = [];
    }
  }
  if (!Array.isArray(e.images)) e.images = [];

  // backward-compat: nếu chỉ có image cũ thì convert sang images[]
  if (e.images.length === 0 && e.image) {
    e.images = [e.image];
  }

  // keep old field for old UI
  e.image = e.images[0] || null;

  return e;
}

// --------- derive restaurants exactly like your localStorage version ----------
function rebuildRestaurantsFromEntries() {
  const map = new Map();

  for (const e of appData.entries || []) {
    const key = (e.restaurantName || "").toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        name: e.restaurantName,
        address: e.restaurantAddress,
        visitCount: 0,
        totalRating: 0,
        averageRating: "0.0",
        image: e.image || null,
      });
    }

    const r = map.get(key);
    r.visitCount += 1;
    r.totalRating += Number(e.overallRating) || 0;
    r.averageRating = (r.totalRating / r.visitCount).toFixed(1);

    if (e.restaurantAddress && !r.address) r.address = e.restaurantAddress;
    if (e.image && !r.image) r.image = e.image;
  }

  appData.restaurants = Array.from(map.values());
}

// ---------- load data from server ----------
let __dataPromise = null;

async function loadDataFromServer() {
  const me = await apiGet("/me");
  appData.user = me.user;

  if (!appData.user) {
    appData.entries = [];
    appData.wishlist = [];
    appData.restaurants = [];
    return;
  }

  const entriesRes = await apiGet("/entries");
  appData.entries = (entriesRes.entries || []).map(normalizeEntry);

  const wishlistRes = await apiGet("/wishlist");
  appData.wishlist = wishlistRes.wishlist || [];

  rebuildRestaurantsFromEntries();
}

function ensureDataLoaded() {
  if (!__dataPromise)
    __dataPromise = loadDataFromServer().catch((e) =>
      console.error("loadDataFromServer error:", e),
    );
  return __dataPromise;
}

async function refreshData() {
  __dataPromise = null;
  await ensureDataLoaded();
}

// old names
function loadData() {
  ensureDataLoaded();
}
function saveData() {}

// Navigation function
function navigateTo(page) {
  window.location.href = `${page}.html`;
}

// Utility functions
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
function escapeHtml(unsafe) {
  return (unsafe ?? "")
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", async function () {
  await ensureDataLoaded();
  if (typeof updateUserInterface === "function") updateUserInterface();
});

// expose
window.apiGet = apiGet;
window.apiPost = apiPost;
window.apiPut = apiPut;
window.apiDelete = apiDelete;
window.ensureDataLoaded = ensureDataLoaded;
window.refreshData = refreshData;
