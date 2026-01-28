document.addEventListener("DOMContentLoaded", async function () {
  await ensureDataLoaded();
  displayCategories();
});

function displayCategories() {
  const container = document.getElementById("categoriesContainer");
  if (!container) return;

  const allTags = [...new Set(appData.entries.flatMap((entry) => entry.tags))];
  const restaurantsByRating = groupRestaurantsByRating();

  if (appData.restaurants.length === 0) {
    container.innerHTML = `
            <div class="empty-state">
                <div>🔖</div>
                <h3>カテゴリーがまだありません</h3>
                <p>飲食店を追加すると、評価別に分類されて表示されます</p>
            </div>
        `;
    return;
  }

  let html = '<div class="categories-grid">';
  html += `
        <div class="category-section">
            <h3>⭐ 評価別カテゴリー</h3>
            ${Object.entries(restaurantsByRating)
              .map(
                ([rating, restaurants]) => `
                <div class="rating-item">
                    <h4>${"★".repeat(parseInt(rating))}${"☆".repeat(
                  5 - parseInt(rating)
                )} 星評価 (${restaurants.length}店舗)</h4>
                    <div class="restaurant-list">
                        ${restaurants
                          .map(
                            (restaurant) => `
                            <div class="restaurant-item-small">
                                <strong>${escapeHtml(restaurant.name)}</strong>
                                <div style="font-size: 0.8rem; color: #666; margin-top: 0.2rem;">
                                    訪問: ${restaurant.visitCount}回 • 評価: ${
                              restaurant.averageRating
                            }
                                    ${
                                      getRestaurantTags(restaurant.name)
                                        .length > 0
                                        ? `• タグ: ${getRestaurantTags(
                                            restaurant.name
                                          )
                                            .map((tag) => `#${escapeHtml(tag)}`)
                                            .join(", ")}`
                                        : ""
                                    }
                                </div>
                            </div>
                        `
                          )
                          .join("")}
                    </div>
                </div>
            `
              )
              .join("")}
        </div>
    `;

  if (allTags.length > 0) {
    html += `
            <div class="category-section">
                <h3>🏷️ タグでフィルター</h3>
                <div class="tag-filters">
                    ${allTags
                      .map(
                        (tag) => `
                        <button class="tag-filter ${
                          appData.currentTagFilter === tag ? "active" : ""
                        }" 
                                onclick="filterByTag('${tag.replace(
                                  /'/g,
                                  "\\'"
                                )}')">
                            #${escapeHtml(tag)}
                        </button>
                    `
                      )
                      .join("")}
                </div>
        `;

    if (appData.currentTagFilter) {
      const filteredRestaurants = getRestaurantsByTag(appData.currentTagFilter);
      if (filteredRestaurants.length > 0) {
        html += `
                    <h4>タグ "#${escapeHtml(
                      appData.currentTagFilter
                    )}" の飲食店 (${filteredRestaurants.length}店舗)</h4>
                    <div class="restaurant-list">
                        ${filteredRestaurants
                          .map(
                            (restaurant) => `
                            <div class="restaurant-item-small">
                                <strong>${escapeHtml(restaurant.name)}</strong>
                                <div style="font-size: 0.8rem; color: #666; margin-top: 0.2rem;">
                                    評価: ${"★".repeat(
                                      Math.round(restaurant.averageRating)
                                    )}${"☆".repeat(
                              5 - Math.round(restaurant.averageRating)
                            )} (${restaurant.averageRating}) • 訪問: ${
                              restaurant.visitCount
                            }回
                                </div>
                            </div>
                        `
                          )
                          .join("")}
                    </div>
                `;
      } else {
        html += `
                    <div class="category-empty">
                        <div>🔍</div>
                        <p>タグ "#${escapeHtml(
                          appData.currentTagFilter
                        )}" に該当する飲食店はありません</p>
                    </div>
                `;
      }
    } else {
      html += `
                <div class="category-empty">
                    <div>🏷️</div>
                    <p>タグを選択すると、該当する飲食店が表示されます</p>
                </div>
            `;
    }
    html += `</div>`;
  }

  html += "</div>";
  container.innerHTML = html;
}

function groupRestaurantsByRating() {
  const ratingGroups = {};
  appData.restaurants.forEach((restaurant) => {
    const rating = Math.round(restaurant.averageRating);
    if (rating >= 1 && rating <= 5) {
      if (!ratingGroups[rating]) ratingGroups[rating] = [];
      ratingGroups[rating].push(restaurant);
    }
  });

  const sortedGroups = {};
  [5, 4, 3, 2, 1].forEach((rating) => {
    if (ratingGroups[rating]) {
      sortedGroups[rating] = ratingGroups[rating].sort(
        (a, b) => b.averageRating - a.averageRating
      );
    }
  });

  return sortedGroups;
}

function getRestaurantTags(restaurantName) {
  const tags = new Set();
  appData.entries.forEach((entry) => {
    if (entry.restaurantName === restaurantName) {
      entry.tags.forEach((tag) => tags.add(tag));
    }
  });
  return Array.from(tags);
}

function getRestaurantsByTag(tag) {
  const restaurantNames = new Set();
  appData.entries.forEach((entry) => {
    if (entry.tags.includes(tag)) restaurantNames.add(entry.restaurantName);
  });
  return appData.restaurants
    .filter((restaurant) => restaurantNames.has(restaurant.name))
    .sort((a, b) => b.averageRating - a.averageRating);
}

function filterByTag(tag) {
  appData.currentTagFilter = appData.currentTagFilter === tag ? null : tag;
  displayCategories();
}
