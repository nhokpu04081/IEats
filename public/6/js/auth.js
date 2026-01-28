// === AUTH MANAGEMENT (SERVER VERSION) ===
document.addEventListener("DOMContentLoaded", function () {
  initializeAuthEventListeners();
  bootAuth();
});

async function bootAuth() {
  await ensureDataLoaded();
  updateUserInterface();
}

function initializeAuthEventListeners() {
  const loginBtn = document.getElementById("loginBtn");
  if (loginBtn) loginBtn.addEventListener("click", showLoginModal);

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);

  const cancelLoginButton = document.getElementById("cancelLoginButton");
  if (cancelLoginButton)
    cancelLoginButton.addEventListener("click", hideLoginModal);

  const showRegisterButton = document.getElementById("showRegisterButton");
  if (showRegisterButton)
    showRegisterButton.addEventListener("click", showRegisterModal);

  const cancelRegisterButton = document.getElementById("cancelRegisterButton");
  if (cancelRegisterButton)
    cancelRegisterButton.addEventListener("click", hideRegisterModal);

  const loginForm = document.getElementById("loginForm");
  if (loginForm) loginForm.addEventListener("submit", handleLoginSubmit);

  const registerForm = document.getElementById("registerForm");
  if (registerForm)
    registerForm.addEventListener("submit", handleRegisterSubmit);
}

function showLoginModal() {
  document.getElementById("loginModal")?.classList.add("active");
}
function hideLoginModal() {
  document.getElementById("loginModal")?.classList.remove("active");
  document.getElementById("loginForm")?.reset();
}
function showRegisterModal() {
  hideLoginModal();
  document.getElementById("registerModal")?.classList.add("active");
}
function hideRegisterModal() {
  document.getElementById("registerModal")?.classList.remove("active");
  document.getElementById("registerForm")?.reset();
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("username")?.value;
  const password = document.getElementById("password")?.value;

  try {
    await apiPost("/auth/login", { username, password });
    await refreshData();
    updateUserInterface();
    hideLoginModal();
    alert("ログイン成功！");
    refreshCurrentPage();
  } catch (err) {
    console.error(err);
    alert("ログインに失敗しました（ユーザー名/メール or パスワード確認）");
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("regUsername")?.value;
  const email = document.getElementById("regEmail")?.value;
  const password = document.getElementById("regPassword")?.value;
  const confirmPassword = document.getElementById("regConfirmPassword")?.value;

  if (password !== confirmPassword) {
    alert("パスワードが一致しません。");
    return;
  }

  try {
    await apiPost("/auth/register", { username, email, password });
    await refreshData();
    updateUserInterface();
    hideRegisterModal();
    alert("アカウント登録が完了しました！");
    refreshCurrentPage();
  } catch (err) {
    console.error(err);
    if (err?.data?.error === "exists") {
      alert("ユーザー名またはメールは既に使用されています。");
      return;
    }
    alert("登録に失敗しました。");
  }
}

async function logout() {
  if (!confirm("ログアウトしますか？")) return;

  try {
    await apiPost("/auth/logout", {});
  } catch (e) {
    console.error(e);
  }

  await refreshData();
  updateUserInterface();
  alert("ログアウトしました。");
  refreshCurrentPage();
}

function updateUserInterface() {
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userGreeting = document.getElementById("userGreeting");

  if (!loginBtn || !logoutBtn || !userGreeting) return;

  if (appData.user) {
    loginBtn.style.display = "none";
    logoutBtn.style.display = "block";
    userGreeting.textContent = appData.user.username
      ? `こんにちは、${appData.user.username}さん！`
      : "ログイン中";
  } else {
    loginBtn.style.display = "block";
    logoutBtn.style.display = "none";
    userGreeting.textContent = "グルメ日記";
  }
}

// Page refresh helper
function refreshCurrentPage() {
  // các page cũ của anh tự render theo DOMContentLoaded,
  // nên reload nhẹ là chắc ăn
  location.reload();
}
