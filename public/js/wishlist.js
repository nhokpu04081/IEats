document.addEventListener("DOMContentLoaded", async function () {
  await ensureDataLoaded();
  displayWishlist();
});

function displayWishlist() {
  const container = document.getElementById("wishlistContainer");
  if (!container) return;

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

  if (!appData.wishlist || appData.wishlist.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div>✨</div>
        <h3>食べたいリストが空です</h3>
        <p>「＋」から追加しましょう！</p>
      </div>
    `;
    return;
  }

  container.innerHTML = appData.wishlist
    .map(
      (item) => `
    <div class="wishlist-item">
      <div>
        <strong>${escapeHtml(item.dish)}</strong>
        ${
          item.restaurant
            ? `<div style="color:#666;font-size:0.9rem;">🏪 ${escapeHtml(
                item.restaurant
              )}</div>`
            : ""
        }
        ${
          item.notes
            ? `<div style="color:#666;font-size:0.85rem;margin-top:0.3rem;">${escapeHtml(
                item.notes
              )}</div>`
            : ""
        }
      </div>

      <button
        class="delete-wishlist-btn"
        title="削除"
        onclick="deleteWishlistItem(${item.id})"
      >✖</button>
    </div>
  `
    )
    .join("");
}

async function deleteWishlistItem(id) {
  if (!confirm("この項目を削除しますか？")) return;

  try {
    await apiDelete(`/wishlist/${id}`);
    await refreshData();
    displayWishlist();
  } catch (e) {
    console.error(e);
    alert("削除に失敗しました（サーバー/DBを確認）");
  }
}

window.displayWishlist = displayWishlist;
window.deleteWishlistItem = deleteWishlistItem;
