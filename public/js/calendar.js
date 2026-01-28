document.addEventListener("DOMContentLoaded", async function () {
  await ensureDataLoaded();

  let currentDate = new Date();
  window.__calendarCurrentDate = currentDate;

  renderCalendar(currentDate);

  document.getElementById("prevMonth").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar(currentDate);
  });

  document.getElementById("nextMonth").addEventListener("click", () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar(currentDate);
  });

  window.refreshCalendar = async function () {
    await ensureDataLoaded();
    renderCalendar(currentDate);
  };
});

function renderCalendar(date) {
  const calendarEl = document.getElementById("calendar");
  const monthYearEl = document.getElementById("currentMonth");

  const monthNames = [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ];
  monthYearEl.textContent = `${date.getFullYear()}年${
    monthNames[date.getMonth()]
  }`;

  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDay = firstDay.getDay();

  calendarEl.innerHTML = "";

  const daysOfWeek = ["日", "月", "火", "水", "木", "金", "土"];
  daysOfWeek.forEach((day) => {
    const dayHeader = document.createElement("div");
    dayHeader.className = "day-header";
    dayHeader.textContent = day;
    calendarEl.appendChild(dayHeader);
  });

  for (let i = 0; i < startingDay; i++) {
    const emptyDay = document.createElement("div");
    emptyDay.className = "calendar-day empty";
    calendarEl.appendChild(emptyDay);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayEl = document.createElement("div");
    dayEl.className = "calendar-day";

    const currentDateStr = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const hasEntry = appData.entries.some(
      (entry) => entry.date === currentDateStr
    );
    if (hasEntry) dayEl.classList.add("has-entry");

    dayEl.innerHTML = `
      <div class="day-number">${day}</div>
      ${hasEntry ? '<span class="entry-dot" title="日記あり"></span>' : ""}
    `;

    dayEl.addEventListener("click", () => {
      if (hasEntry) showDayEntries(currentDateStr);
    });

    calendarEl.appendChild(dayEl);
  }
}

function showDayEntries(dateStr) {
  const entriesContainer = document.getElementById("dayEntries");
  const dayEntries = appData.entries.filter((entry) => entry.date === dateStr);

  if (dayEntries.length === 0) {
    entriesContainer.innerHTML = "<p>この日には日記がありません。</p>";
    return;
  }

  let html = `<h3>${formatDate(dateStr)} の日記 (${dayEntries.length}件)</h3>`;

  dayEntries.forEach((entry) => {
    html += `
      <div class="calendar-entry-item">
        <strong>${escapeHtml(entry.restaurantName)}</strong>
        <div class="entry-rating">
          ${"★".repeat(entry.overallRating)}${"☆".repeat(
      5 - entry.overallRating
    )}
        </div>
        ${
          entry.image
            ? `<img src="${entry.image}" class="entry-thumbnail">`
            : ""
        }
        <button onclick="window.location.href='index.html?scrollTo=${
          entry.id
        }'" class="btn btn-primary">詳細を見る</button>
      </div>
    `;
  });

  entriesContainer.innerHTML = html;
}
