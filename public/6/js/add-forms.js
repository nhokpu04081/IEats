// === FORM STATE MANAGEMENT ===
let selectedRating = 0;
let selectedImages = [];

// === INITIALIZATION ===
document.addEventListener("DOMContentLoaded", function () {
  initializeFormEventListeners();
});

// === EVENT LISTENERS ===
function initializeFormEventListeners() {
  const addButton = document.getElementById("addButton");
  if (addButton) addButton.addEventListener("click", () => showAddForm());

  document.querySelectorAll(".form-tab").forEach((tab) => {
    tab.addEventListener("click", function () {
      showFormTab(this.dataset.tab);
    });
  });

  document.querySelectorAll(".star").forEach((star) => {
    star.addEventListener("click", function () {
      selectRating(parseInt(this.dataset.rating));
    });
  });

  const restaurantImage = document.getElementById("restaurantImage");
  if (restaurantImage)
    restaurantImage.addEventListener("change", handleImageUpload);

  const removeImageButton = document.getElementById("removeImageButton");
  if (removeImageButton)
    removeImageButton.addEventListener("click", removeImage);

  const entryForm = document.getElementById("entryForm");
  if (entryForm) entryForm.addEventListener("submit", handleEntrySubmit);

  const wishlistForm = document.getElementById("wishlistForm");
  if (wishlistForm)
    wishlistForm.addEventListener("submit", handleWishlistSubmit);

  const parseMapButton = document.getElementById("parseMapButton");
  if (parseMapButton) parseMapButton.addEventListener("click", parseMapLink);

  const addDishButton = document.getElementById("addDishButton");
  if (addDishButton) addDishButton.addEventListener("click", addDishField);

  const cancelEntryButton = document.getElementById("cancelEntryButton");
  if (cancelEntryButton)
    cancelEntryButton.addEventListener("click", hideAddForm);

  const cancelWishlistButton = document.getElementById("cancelWishlistButton");
  if (cancelWishlistButton)
    cancelWishlistButton.addEventListener("click", hideAddForm);

  initializeDishesEvents();
}

function initializeDishesEvents() {
  document.querySelectorAll(".remove-dish-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      removeDishField(this);
    });
  });
}

// === POPUP MANAGEMENT ===
function showAddForm(defaultTab = null) {
  const overlay = document.getElementById("addFormOverlay");
  if (!overlay) return;

  overlay.classList.add("active");

  // xác định page hiện tại
  const currentPage = window.location.pathname.split("/").pop();

  // ưu tiên tab truyền vào, nếu không thì auto theo page
  let tabToOpen = "journal";
  if (defaultTab) {
    tabToOpen = defaultTab;
  } else if (currentPage === "wishlist.html") {
    tabToOpen = "wishlist";
  }

  showFormTab(tabToOpen);

  // chỉ set ngày nếu là journal
  if (tabToOpen === "journal") {
    setTimeout(() => {
      const dateField = document.getElementById("entryDate");
      if (dateField) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        dateField.value = `${yyyy}-${mm}-${dd}`;
      }
    }, 50);
  }

  resetForm();
}

function hideAddForm() {
  const overlay = document.getElementById("addFormOverlay");
  if (overlay) {
    overlay.classList.remove("active");

    const submitButton = document.querySelector(
      '#entryForm button[type="submit"]',
    );
    if (submitButton) {
      submitButton.textContent = "日記を保存";
      submitButton.classList.remove("editing");
    }

    // keep same globals
    isEditing = false;
    currentEditId = null;

    resetForm();
  }
}

function resetForm() {
  selectedRating = 0;
  selectedImage = [];

  document.querySelectorAll(".star").forEach((star) => {
    star.textContent = "☆";
    star.classList.remove("active");
  });

  const overallRating = document.getElementById("overallRating");
  if (overallRating) overallRating.value = "";

  const ratingText = document.getElementById("ratingText");
  if (ratingText) ratingText.textContent = "評価を選択してください";

  const mapButton = document.getElementById("openMapButton");
  if (mapButton) mapButton.remove();

  const imagePreview = document.getElementById("imagePreview");
  if (imagePreview) imagePreview.style.display = "none";

  const restaurantImage = document.getElementById("restaurantImage");
  if (restaurantImage) restaurantImage.value = "";

  document.getElementById("entryForm")?.reset();
  document.getElementById("wishlistForm")?.reset();

  const dishesContainer = document.getElementById("dishesContainer");
  if (dishesContainer) {
    dishesContainer.innerHTML = `
            <div class="dish-input">
                <input type="text" placeholder="料理名" class="dish-name">
                <button type="button" class="remove-dish-btn">×</button>
            </div>
        `;
    initializeDishesEvents();
  }
  renderImagesPreview();
}

// === FORM TABS ===
function showFormTab(tabName) {
  const targetTab = document.getElementById(tabName + "Tab");
  const targetTabButton = document.querySelector(
    `.form-tab[data-tab="${tabName}"]`,
  );

  // ✅ Nếu không tìm thấy tab thì fallback về journal (để khỏi bị trống)
  if (!targetTab || !targetTabButton) {
    console.warn("[showFormTab] Tab not found:", tabName);
    if (tabName !== "journal") return showFormTab("journal");
    return; // journal cũng không có thì chịu
  }

  // Chỉ remove active sau khi chắc chắn có target
  document
    .querySelectorAll(".form-tab-content")
    .forEach((tab) => tab.classList.remove("active"));
  document
    .querySelectorAll(".form-tab")
    .forEach((tab) => tab.classList.remove("active"));

  targetTab.classList.add("active");
  targetTabButton.classList.add("active");
}

// === STAR RATING ===
function selectRating(rating) {
  selectedRating = rating;
  const stars = document.querySelectorAll(".star");

  stars.forEach((star, index) => {
    if (index < rating) {
      star.textContent = "★";
      star.classList.add("active");
    } else {
      star.textContent = "☆";
      star.classList.remove("active");
    }
  });

  const overallRating = document.getElementById("overallRating");
  if (overallRating) overallRating.value = rating;

  const ratingTexts = {
    1: "悪い",
    2: "普通",
    3: "良い",
    4: "とても良い",
    5: "最高",
  };
  const ratingText = document.getElementById("ratingText");
  if (ratingText)
    ratingText.textContent = `${rating}つ星 - ${ratingTexts[rating]}`;
}

// === IMAGE HANDLING ===
function handleImageUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  let pending = files.length;

  files.forEach((file) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      selectedImages.push(e.target.result);
      pending--;
      if (pending === 0) renderImagesPreview();
    };
    reader.readAsDataURL(file);
  });
}

function renderImagesPreview() {
  const imagePreview = document.getElementById("imagePreview");
  if (!imagePreview) return;

  // nếu UI cũ có <img id="previewImage"> thì ẩn nó đi để khỏi “chỉ hiện 1 ảnh”
  const single = document.getElementById("previewImage");
  if (single) single.style.display = "none";

  imagePreview.style.display = selectedImages.length ? "block" : "none";

  imagePreview.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
      ${selectedImages
        .map(
          (src, idx) => `
        <div style="position:relative;">
          <img src="${src}" style="width:90px;height:90px;object-fit:cover;border-radius:10px;">
          <button type="button"
            style="position:absolute;top:-6px;right:-6px;width:24px;height:24px;border:none;border-radius:50%;background:#dc3545;color:#fff;cursor:pointer;"
            onclick="removeImageAt(${idx})"
            title="削除"
          >✖</button>
        </div>
      `,
        )
        .join("")}
    </div>
  `;
}

function removeImageAt(index) {
  selectedImages.splice(index, 1);
  renderImagesPreview();
}
window.removeImageAt = removeImageAt;

function removeImage() {
  selectedImages = [];
  const restaurantImage = document.getElementById("restaurantImage");
  if (restaurantImage) restaurantImage.value = "";
  renderImagesPreview();
}

// === DISH MANAGEMENT ===
function addDishField() {
  const container = document.getElementById("dishesContainer");
  if (!container) return;

  const dishDiv = document.createElement("div");
  dishDiv.className = "dish-input";
  dishDiv.innerHTML = `
        <input type="text" placeholder="料理名" class="dish-name">
        <button type="button" class="remove-dish-btn">×</button>
    `;
  container.appendChild(dishDiv);

  dishDiv
    .querySelector(".remove-dish-btn")
    .addEventListener("click", function () {
      removeDishField(this);
    });
}

function removeDishField(button) {
  const dishInputs = document.querySelectorAll(".dish-input");
  if (dishInputs.length > 1) {
    button.parentElement.remove();
  }
}

// === MAP LINK PARSING ===
function parseMapLink() {
  const link = document.getElementById("mapsLink").value;

  if (link.includes("goo.gl") || link.includes("maps.app.goo.gl")) {
    alert(
      "⚠️ このアプリはショートリンクには対応していません\n長いGoogle Mapsリンクを使用するか、手動で店舗名と住所を入力してください",
    );
    document.getElementById("mapsLink").value = "";
    document.getElementById("mapsLink").focus();
    return;
  }

  if (!link.includes("@") || !link.includes(",")) {
    alert(
      "⚠️ このリンクから座標を取得できません\n手動で店舗名と住所を入力してください",
    );
    return;
  }

  try {
    const coordRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const match = link.match(coordRegex);

    let lat = "";
    let lng = "";

    if (match) {
      lat = match[1];
      lng = match[2];

      getAddressFromOpenStreetMap(lat, lng);
    }

    let placeName = "";
    const url = new URL(link);
    const pathParts = url.pathname.split("/");

    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i] === "place" && i + 1 < pathParts.length) {
        const nextPart = pathParts[i + 1];
        const atIndex = nextPart.indexOf("@");

        if (atIndex > 0) {
          placeName = decodeURIComponent(
            nextPart.substring(0, atIndex).replace(/\+/g, " "),
          );
        } else {
          placeName = decodeURIComponent(nextPart.replace(/\+/g, " "));
        }
        break;
      }
    }

    if (placeName) {
      document.getElementById("restaurantName").value = placeName;
    }
  } catch (error) {
    console.log("Link parse error:", error);
  }
}

// === FORM SUBMISSION HANDLERS (ONLY THIS PART CHANGED TO MYSQL/API) ===
async function handleEntrySubmit(e) {
  e.preventDefault();
  await ensureDataLoaded();

  if (!appData.user) {
    alert("ログインしてください。");
    return;
  }

  if (selectedRating === 0) {
    alert("総合評価を選択してください");
    return;
  }

  const restaurantNameEl = document.getElementById("restaurantName");
  const restaurantAddressEl = document.getElementById("restaurantAddress");

  if (!restaurantNameEl || !restaurantNameEl.value.trim()) {
    alert("店舗名を入力してください");
    return;
  }
  if (!restaurantAddressEl || !restaurantAddressEl.value.trim()) {
    alert("住所を入力してください");
    return;
  }

  const dishes = [];
  document.querySelectorAll(".dish-input").forEach((input) => {
    const nameInput = input.querySelector(".dish-name");
    if (nameInput && nameInput.value.trim())
      dishes.push(nameInput.value.trim());
  });

  const tagsInput = document.getElementById("entryTags");
  const tags =
    tagsInput && tagsInput.value
      ? tagsInput.value
          .split(/[,,、]/)
          .map((tag) => tag.trim())
          .filter((tag) => tag)
      : [];

  const newEntry = {
    id: Date.now(),
    restaurantName: restaurantNameEl.value.trim(),
    restaurantAddress: restaurantAddressEl.value.trim(),
    date:
      document.getElementById("entryDate")?.value ||
      new Date().toISOString().split("T")[0],
    overallRating: selectedRating,
    content: document.getElementById("entryContent")?.value || "",
    dishes: dishes,
    tags: tags,
    images: selectedImages,
    image: selectedImages[0] || null,
  };

  try {
    if (
      typeof isEditing !== "undefined" &&
      isEditing &&
      typeof currentEditId !== "undefined" &&
      currentEditId
    ) {
      newEntry.id = currentEditId;
      if (typeof updateEntry === "function") {
        await updateEntry(newEntry); // home.js handles apiPut+refresh+timeline
      }
    } else {
      await apiPost("/entries", newEntry);
      await refreshData();
      alert("日記を保存しました！🎉");
    }
  } catch (err) {
    console.error(err);
    alert("保存に失敗しました（サーバー/DBを確認）");
  }

  hideAddForm();
  refreshCurrentPage();
}

async function handleWishlistSubmit(e) {
  e.preventDefault();
  await ensureDataLoaded();

  if (!appData.user) {
    alert("ログインしてください。");
    return;
  }

  const wishlistDish = document.getElementById("wishlistDish");
  if (!wishlistDish || !wishlistDish.value.trim()) {
    alert("料理名は必須です");
    return;
  }

  const newWishlistItem = {
    id: Date.now(),
    dish: wishlistDish.value.trim(),
    restaurant: document.getElementById("wishlistRestaurant")?.value || "",
    notes: document.getElementById("wishlistNotes")?.value || "",
    priority: document.getElementById("wishlistPriority")?.value || "medium",
    addedDate: new Date().toISOString().split("T")[0],
  };

  try {
    await apiPost("/wishlist", newWishlistItem);
    await refreshData();

    hideAddForm();
    alert("食べたいリストに追加しました！🎉");
    refreshCurrentPage();
  } catch (err) {
    console.error(err);
    alert("Wishlist追加に失敗しました");
  }
}

// LẤY ĐỊA CHỈ TỪ TỌA ĐỘ - OPENSTREETMAP (FREE)
function getAddressFromOpenStreetMap(lat, lng) {
  const restaurantAddress = document.getElementById("restaurantAddress");
  restaurantAddress.placeholder = "住所を取得中...";

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&accept-language=ja`;

  fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error("API error");
      return response.json();
    })
    .then((data) => {
      if (data.display_name) {
        restaurantAddress.value = data.display_name;
        restaurantAddress.placeholder = "";
      } else {
        restaurantAddress.value = `座標: ${lat}, ${lng}`;
        restaurantAddress.placeholder = "";
      }
    })
    .catch((error) => {
      console.log("OpenStreetMap error:", error);
      restaurantAddress.value = `座標: ${lat}, ${lng}`;
      restaurantAddress.placeholder = "";
    });
}

// === PAGE REFRESH (ADD calendar.html + refresh stats properly) ===
async function refreshCurrentPage() {
  const currentPage = window.location.pathname.split("/").pop();

  // important: data already refreshed, but just in case some page opens too fast
  await ensureDataLoaded();

  switch (currentPage) {
    case "index.html":
    case "":
      if (typeof displayTimeline === "function") displayTimeline();
      break;
    case "restaurants.html":
      if (typeof displayRestaurants === "function") displayRestaurants();
      break;
    case "wishlist.html":
      if (typeof displayWishlist === "function") displayWishlist();
      break;
    case "stats.html":
      if (typeof populateMonthSelector === "function") populateMonthSelector();
      if (typeof displayStats === "function") displayStats();
      break;
    case "categories.html":
      if (typeof displayCategories === "function") displayCategories();
      break;
    case "calendar.html":
      if (typeof window.refreshCalendar === "function")
        window.refreshCalendar();
      break;
  }
}
