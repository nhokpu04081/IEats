document.addEventListener("DOMContentLoaded", async function () {
  await ensureDataLoaded();
  displayStats();
  populateMonthSelector();
});

function displayStats(selectedMonth = null) {
  const currentDate = new Date();
  const currentMonth = currentDate.toISOString().slice(0, 7);
  const targetMonth = selectedMonth || currentMonth;

  const filteredEntries = appData.entries.filter((e) =>
    e.date.startsWith(targetMonth)
  );
  const totalEntries = filteredEntries.length;
  const restaurantNames = [
    ...new Set(filteredEntries.map((e) => e.restaurantName)),
  ];
  const totalRestaurants = restaurantNames.length;
  const avgRating =
    filteredEntries.length > 0
      ? (
          filteredEntries.reduce((sum, e) => sum + e.overallRating, 0) /
          filteredEntries.length
        ).toFixed(1)
      : "0";

  const totalEntriesEl = document.getElementById("totalEntries");
  const monthlyEntriesEl = document.getElementById("monthlyEntries");
  const totalRestaurantsEl = document.getElementById("totalRestaurants");
  const avgRatingEl = document.getElementById("avgRating");

  if (totalEntriesEl) totalEntriesEl.textContent = totalEntries;
  if (monthlyEntriesEl) monthlyEntriesEl.textContent = totalEntries;
  if (totalRestaurantsEl) totalRestaurantsEl.textContent = totalRestaurants;
  if (avgRatingEl) avgRatingEl.textContent = avgRating;
}

function populateMonthSelector() {
  const select = document.getElementById("statsMonth");
  if (!select) return;

  const months = [...new Set(appData.entries.map((e) => e.date.slice(0, 7)))]
    .sort()
    .reverse();

  if (months.length === 0) {
    select.innerHTML = '<option value="">データなし</option>';
    return;
  }

  select.innerHTML = months
    .map((m) => `<option value="${m}">${m}</option>`)
    .join("");

  const currentMonth = new Date().toISOString().slice(0, 7);
  if (months.includes(currentMonth)) select.value = currentMonth;

  select.addEventListener("change", (e) => {
    displayStats(e.target.value);
  });
}
