document.addEventListener("DOMContentLoaded", async function () {
  await ensureDataLoaded();
  displayRestaurants();
  focusRestaurantFromUrl();
});

function buildGoogleDirectionsUrl(name, address) {
  // Google Maps Directions (from current location)
  const destination =
    address && address.trim()
      ? `${name} ${address}`.trim()
      : (name || "").trim();

  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", destination);
  return url.toString();
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

  // sort (giữ như cũ: rating cao lên trước)
  const list = [...appData.restaurants].sort(
    (a, b) => b.averageRating - a.averageRating,
  );

  const html = list
    .map((restaurant) => {
      const gmapsUrl = buildGoogleDirectionsUrl(
        restaurant.name || "",
        restaurant.address || "",
      );

      return `
      <div class="restaurant-item" data-restaurant-name="${escapeHtml(restaurant.name)}">
        <div style="display:flex; align-items:flex-start; gap:1rem;">
          ${
            restaurant.image
              ? `<img src="${restaurant.image}" alt="${escapeHtml(restaurant.name)}">`
              : ""
          }
          <div>
            <strong>${escapeHtml(restaurant.name)}</strong>
            <div style="color:#666; font-size:0.9rem;">
              ${escapeHtml(restaurant.address || "")}
            </div>

            <div style="color:#ffc107; font-weight:bold; margin-top:0.3rem;">
              ${"★".repeat(Math.round(restaurant.averageRating))}${"☆".repeat(
                5 - Math.round(restaurant.averageRating),
              )}
              <span style="color:#666; font-size:0.8rem;">(${restaurant.averageRating})</span>
            </div>
          </div>
        </div>

        <div class="restaurant-actions">
          <div class="restaurant-visit-count">${restaurant.visitCount} 回</div>
          <a class="gmaps-btn" href="${gmapsUrl}" target="_blank" rel="noopener">
            🧭 Google Mapsで経路
          </a>
        </div>
      </div>
    `;
    })
    .join("");

  container.innerHTML = html;
}

function focusRestaurantFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const target = params.get("restaurant");
  if (!target) return;

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
