let isEditing = false;
let currentEditId = null;

document.addEventListener("DOMContentLoaded", async function () {
  await ensureDataLoaded();
  displayTimeline();

  // scrollTo from calendar
  const params = new URLSearchParams(location.search);
  const scrollTo = params.get("scrollTo");
  if (scrollTo) {
    setTimeout(() => {
      const card = document
        .querySelector(`[onclick="editEntry(${scrollTo})"]`)
        ?.closest(".entry-card");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
  }
});

function displayTimeline() {
  const container = document.getElementById("timeline");
  if (!container) return;

  if (!appData.user) {
    container.innerHTML = `
            <div class="empty-state">
                <div>🔒</div>
                <h3>ログインしてください</h3>
                <p>ログイン後に日記が表示されます。</p>
            </div>
        `;
    return;
  }

  if (appData.entries.length === 0) {
    container.innerHTML = `
            <div class="empty-state">
                <div>📝</div>
                <h3>日記がまだありません</h3>
                <p>最初の日記を追加してください！</p>
            </div>
        `;
    return;
  }

  container.innerHTML = appData.entries
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map(
      (entry) => `
            <div class="entry-card">
                <button class ="edit-btn" onclick="editEntry(${
                  entry.id
                })" title="日記を編集">🖋</button>
                <button class="delete-btn" onclick="deleteEntry(${
                  entry.id
                })" title="日記を削除">✖</button>
                <div class="entry-header">
                    <div class="entry-date">${formatDate(entry.date)}</div>
                </div>
                <div class="restaurant-name">
                    ${escapeHtml(entry.restaurantName)}
                    <span class="restaurant-rating">${"★".repeat(
                      entry.overallRating
                    )}${"☆".repeat(5 - entry.overallRating)}</span>
                </div>
                <div class="restaurant-address">📍 ${escapeHtml(
                  entry.restaurantAddress
                )}</div>
                ${
                  entry.images && entry.images.length
                    ? `
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
    ${entry.images
      .map(
        (src) => `
      <img src="${src}" class="entry-image" style="width:120px;height:120px;object-fit:cover;border-radius:12px;">
    `
      )
      .join("")}
  </div>
`
                    : entry.image
                    ? `
  <img src="${entry.image}" class="entry-image" alt="${escapeHtml(
                        entry.restaurantName
                      )}">
`
                    : ""
                }


                ${
                  entry.content
                    ? `<div class="entry-content">${escapeHtml(
                        entry.content
                      )}</div>`
                    : ""
                }
                ${
                  entry.dishes.length > 0
                    ? `
                    <div class="entry-dishes">
                        <strong>注文した料理:</strong>
                        ${entry.dishes
                          .map(
                            (dish) => `
                            <div class="dish-item">
                                <span>• ${escapeHtml(dish)}</span>
                            </div>
                        `
                          )
                          .join("")}
                    </div>
                `
                    : ""
                }
                ${
                  entry.tags.length > 0
                    ? `
                    <div class="entry-tags">
                        ${entry.tags
                          .map(
                            (tag) =>
                              `<span class="tag">#${escapeHtml(tag)}</span>`
                          )
                          .join("")}
                    </div>
                `
                    : ""
                }
            </div>
        `
    )
    .join("");
}

async function deleteEntry(entryId) {
  if (!confirm("この日記を削除してもよろしいですか？")) return;

  try {
    await apiDelete(`/entries/${entryId}`);
    await refreshData();
    displayTimeline();
  } catch (e) {
    console.error(e);
    alert("削除に失敗しました（サーバー/DBを確認）");
  }
}

function editEntry(entryId) {
  const entry = appData.entries.find((e) => e.id === entryId);
  if (!entry) return;

  resetForm();
  showAddForm();

  isEditing = true;
  currentEditId = entryId;

  setTimeout(() => fillEditFormData(entry), 200);
}

function fillEditFormData(entry) {
  document.getElementById("restaurantName").value = entry.restaurantName;
  document.getElementById("restaurantAddress").value = entry.restaurantAddress;
  document.getElementById("entryDate").value = entry.date;
  document.getElementById("entryContent").value = entry.content || "";
  document.getElementById("entryTags").value = entry.tags.join(", ");

  selectRating(entry.overallRating);

  const dishesContainer = document.getElementById("dishesContainer");
  dishesContainer.innerHTML = "";

  if (entry.dishes && entry.dishes.length > 0) {
    entry.dishes.forEach((dish) => {
      const dishDiv = document.createElement("div");
      dishDiv.className = "dish-input";
      dishDiv.innerHTML = `
                <input type="text" placeholder="料理名" class="dish-name" value="${escapeHtml(
                  dish
                )}">
                <button type="button" class="remove-dish-btn">✖</button>
            `;
      dishesContainer.appendChild(dishDiv);

      dishDiv
        .querySelector(".remove-dish-btn")
        .addEventListener("click", function () {
          removeDishField(this);
        });
    });
  } else {
    addDishField();
  }

  if (entry.image) {
    selectedImages = Array.isArray(entry.images)
      ? entry.images.slice()
      : entry.image
      ? [entry.image]
      : [];
    document.getElementById("imagePreview").style.display = "block";
    renderImagesPreview();
  }

  const submitButton = document.querySelector(
    '#entryForm button[type="submit"]'
  );
  if (submitButton) submitButton.textContent = "変更を保存";
}

// updateEntry: giữ nguyên API call, add-forms.js sẽ gọi hàm này khi isEditing
async function updateEntry(updatedData) {
  try {
    await apiPut(`/entries/${currentEditId}`, updatedData);
    await refreshData();
    displayTimeline();

    isEditing = false;
    currentEditId = null;

    alert("日記を更新しました！✅");
  } catch (e) {
    console.error(e);
    alert("更新に失敗しました（サーバー/DBを確認）");
  }
}
window.updateEntry = updateEntry;
