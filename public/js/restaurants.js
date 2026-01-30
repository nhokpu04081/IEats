document.addEventListener("DOMContentLoaded", async function () {
  await ensureDataLoaded();
  displayRestaurants();
  focusRestaurantFromUrl();
});

// Lấy danh sách tag theo từng restaurantName từ entries
function getRestaurantTagsMap() {
  const map = new Map(); // name -> Set(tags)

  (appData.entries || []).forEach((entry) => {
    const name = entry.restaurantName;
    if (!name) return;

    if (!map.has(name)) map.set(name, new Set());
    const set = map.get(name);

    (entry.tags || []).forEach((t) => {
      if (t) set.add(t);
    });
  });

  return map;
}

// Lấy tất cả tag unique (để làm filter bar)
function getAllTags(tagsMap) {
  const all = new Set();
  for (const set of tagsMap.values()) {
    for (const t of set) all.add(t);
  }
  return Array.from(all);
}

function displayRestaurants() {
  const container = document.getElementById("restaurantsList");
  if (!container) return;

  // chưa login
  if (!appData.user) {
    container.innerHTML = `
      <div class="empty-state">
        <div>🔒</div>
        <h3>ログインしてください</h3>
        <p>ログイン後に表示されます</p>
      </div>
    `;
    return;
  }

  if (!appData.restaurants || appData.restaurants.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div>🏪</div>
        <h3>店舗がまだありません</h3>
        <p>行った飲食店がここに表示されます</p>
      </div>
    `;
    return;
  }

  const tagsMap = getRestaurantTagsMap();
  const allTags = getAllTags(tagsMap).sort();

  // filter
  let list = [...appData.restaurants].sort(
    (a, b) => b.averageRating - a.averageRating,
  );
  if (appData.currentTagFilter) {
    list = list.filter((r) => {
      const set = tagsMap.get(r.name);
      return set && set.has(appData.currentTagFilter);
    });
  }

  // build HTML
  let html = "";

  // Filter bar (nếu có tag)
  if (allTags.length > 0) {
    html += `
      <div style="margin: 0 0 1rem 0;">
        <div style="font-weight: 700; margin-bottom: 0.5rem;">🏷️ タグで絞り込み</div>
        <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">
          ${allTags
            .map(
              (tag) => `
            <button 
              class="tag-filter ${
                appData.currentTagFilter === tag ? "active" : ""
              }"
              style="border:1px solid #ddd; background:#fff; padding:6px 10px; border-radius:999px; cursor:pointer;"
              onclick="filterRestaurantsByTag('${tag.replace(/'/g, "\\'")}')"
            >#${escapeHtml(tag)}</button>
          `,
            )
            .join("")}
          ${
            appData.currentTagFilter
              ? `
            <button 
              style="border:1px solid #ddd; background:#fff; padding:6px 10px; border-radius:999px; cursor:pointer;"
              onclick="clearRestaurantTagFilter()"
            >クリア</button>
          `
              : ""
          }
        </div>
      </div>
    `;
  }

  // Restaurant cards
  html += list
    .map((restaurant) => {
      const tagSet = tagsMap.get(restaurant.name);
      const tags = tagSet ? Array.from(tagSet) : [];

      return `
      <div class="restaurant-item" data-restaurant-name="${escapeHtml(restaurant.name)}">
        <div style="display: flex; align-items: flex-start; gap: 1rem;">
          ${
            restaurant.image
              ? `
            <img src="${restaurant.image}" alt="${escapeHtml(restaurant.name)}">
          `
              : ""
          }
          <div>
            <strong>${escapeHtml(restaurant.name)}</strong>
            <div style="color: #666; font-size: 0.9rem;">${escapeHtml(
              restaurant.address || "",
            )}</div>
            <div style="color: #ffc107; font-weight: bold; margin-top: 0.3rem;">
              ${"★".repeat(Math.round(restaurant.averageRating))}${"☆".repeat(
                5 - Math.round(restaurant.averageRating),
              )} 
              <span style="color: #666; font-size: 0.8rem;">(${
                restaurant.averageRating
              })</span>
            </div>

            ${
              tags.length
                ? `
              <div style="margin-top: 0.5rem; display:flex; flex-wrap:wrap; gap:0.4rem;">
                ${tags
                  .map(
                    (t) => `
                  <span 
                    class="tag"
                    style="cursor:pointer;"
                    onclick="filterRestaurantsByTag('${t.replace(
                      /'/g,
                      "\\'",
                    )}')"
                    title="このタグで絞り込み"
                  >#${escapeHtml(t)}</span>
                `,
                  )
                  .join("")}
              </div>
            `
                : ""
            }
          </div>
        </div>
        <div class="restaurant-visit-count">${restaurant.visitCount} 回</div>
      </div>
    `;
    })
    .join("");

  // Nếu filter ra rỗng
  if (appData.currentTagFilter && list.length === 0) {
    html += `
      <div class="empty-state" style="margin-top: 1rem;">
        <div>🔍</div>
        <h3>#${escapeHtml(appData.currentTagFilter)} の店舗がありません</h3>
        <p>他のタグを選択してください</p>
      </div>
    `;
  }

  container.innerHTML = html;
}

// filter functions (global)
function filterRestaurantsByTag(tag) {
  appData.currentTagFilter = appData.currentTagFilter === tag ? null : tag;
  displayRestaurants();
}

function clearRestaurantTagFilter() {
  appData.currentTagFilter = null;
  displayRestaurants();
}

function focusRestaurantFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const target = params.get("restaurant");
  if (!target) return;

  // đảm bảo không bị filter tag che mất
  if (appData.currentTagFilter) {
    appData.currentTagFilter = null;
    displayRestaurants();
  }

  const cards = document.querySelectorAll(".restaurant-item");
  const card = Array.from(cards).find(
    (el) => el.dataset.restaurantName === target,
  );

  if (!card) return;

  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.classList.add("highlight");
  setTimeout(() => card.classList.remove("highlight"), 1500);
}

window.displayRestaurants = displayRestaurants;
window.filterRestaurantsByTag = filterRestaurantsByTag;
window.clearRestaurantTagFilter = clearRestaurantTagFilter;
