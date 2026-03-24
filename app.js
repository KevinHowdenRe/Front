// -------------------------
// Minimal portal client (no framework)
// -------------------------

let token = null;

const $ = (id) => document.getElementById(id);

function setStatus(msg, isError=false) {
  $("status").innerHTML = isError ? `<span class="danger">${msg}</span>` : msg;
}

function getApiBase() {
  // Option 1: hardcoded in input
  const val = $("apiBase").value.trim().replace(/\/+$/, "");
  if (val) return val;

  // Option 2: injected config (recommended)
  // In index.html you can add: window.__APP_CONFIG__ = { API_BASE: "..." }
  const cfg = window.__APP_CONFIG__ || {};
  if (cfg.API_BASE) return String(cfg.API_BASE).trim().replace(/\/+$/, "");

  return "";
}

function getSiteId() {
  return $("siteId").value.trim();
}

function authHeaders() {
  return token ? { "Authorization": "Bearer " + token } : {};
}

async function apiFetch(path, { method="GET", headers={}, body=null } = {}) {
  const base = getApiBase();
  if (!base) throw new Error("API base manquant (champ API base).");

  const init = { method, headers: { ...headers } };
  if (body !== null) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(base + path, init);

  // Some backends may return text (e.g., on errors). Prefer json when possible.
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const data = ct.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    // normalize error
    const msg = (data && data.error) ? data.error : (typeof data === "string" ? data : `HTTP ${res.status}`);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// -------------------------
// Auth
// -------------------------
async function login() {
  const email = $("email").value.trim();
  const password = $("password").value;

  const data = await apiFetch("/api/login", {
    method: "POST",
    body: { email, password }
  });

  if (!data.ok || !data.token) throw new Error("Login failed");
  token = data.token;
  localStorage.setItem("portal_token", token);
  setStatus("✅ Logged in");
}

async function logout() {
  try {
    if (token) {
      await apiFetch("/api/logout", {
        method: "POST",
        headers: { ...authHeaders() }
      });
    }
  } catch (_) {
    // ignore
  }
  token = null;
  localStorage.removeItem("portal_token");
  $("audience").innerHTML = "";
  $("menu").innerHTML = "";
  $("frame").src = "about:blank";
  $("currentUrl").textContent = "-";
  setStatus("👋 Logged out");
}

// -------------------------
// Memberships / Audience
// -------------------------
async function loadMemberships() {
  const siteId = getSiteId();
  if (!siteId) throw new Error("site_id manquant");

  const data = await apiFetch("/api/me?site_id=" + encodeURIComponent(siteId), {
    headers: { ...authHeaders() }
  });

  const sel = $("audience");
  sel.innerHTML = "";

  (data.memberships || []).forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.audience;
    opt.textContent = m.label || m.audience;
    sel.appendChild(opt);
  });

  // select active audience if provided
  if (data.active_audience) sel.value = data.active_audience;

  if (!(data.memberships || []).length) {
    setStatus("⚠️ Aucun membership pour ce site_id", true);
  } else {
    setStatus("✅ Memberships chargés");
  }
}

async function setAudience() {
  const siteId = getSiteId();
  const audience = $("audience").value;

  if (!siteId || !audience) throw new Error("site_id ou audience manquants");

  const data = await apiFetch("/api/set-audience", {
    method: "POST",
    headers: { ...authHeaders() },
    body: { site_id: siteId, audience }
  });

  if (!data.ok) throw new Error(data.error || "set_audience_failed");

  setStatus(`✅ Audience active: ${audience}`);
}

// -------------------------
// Menu
// -------------------------
async function loadMenu() {
  const siteId = getSiteId();
  const data = await apiFetch("/api/menu?site_id=" + encodeURIComponent(siteId), {
    headers: { ...authHeaders() }
  });

  if (!data.ok) throw new Error(data.error || "menu_failed");

  const menuDiv = $("menu");
  menuDiv.innerHTML = "";

  const menu = data.menu || {};
  const sections = Object.keys(menu);

  if (!sections.length) {
    menuDiv.innerHTML = `<div class="muted">Aucune page pour cette audience.</div>`;
    return;
  }

  sections.forEach(section => {
    const h = document.createElement("div");
    h.innerHTML = `<h4 style="margin:10px 0 6px 0">${section}</h4>`;
    menuDiv.appendChild(h);

    (menu[section] || []).forEach(p => {
      const a = document.createElement("a");
      a.href = "#/" + [p.section, p.id].map(encodeURIComponent).join("/");
      a.textContent = p.title || p.id;
      a.onclick = (ev) => {
        ev.preventDefault();
        navigateTo(p.section, p.id);
      };
      menuDiv.appendChild(a);
    });
  });

  setStatus("✅ Menu chargé");
}

// -------------------------
// Routing (optional but nice): #/solutions/risk-map
// -------------------------
function navigateTo(section, pageId) {
  const hash = "#/" + [section, pageId].map(encodeURIComponent).join("/");
  location.hash = hash;
  openPage(section, pageId);
}

function parseHash() {
  const h = location.hash || "";
  if (!h.startsWith("#/")) return null;
  const parts = h.slice(2).split("/").map(decodeURIComponent).filter(Boolean);
  if (parts.length < 2) return null;
  return { section: parts[0], pageId: parts[1] };
}

// -------------------------
// Iframe page opening
// -------------------------
function openPage(section, pageId) {
  const base = getApiBase();
  const siteId = getSiteId();
  if (!token) { setStatus("⚠️ Pas de token (login d'abord)", true); return; }

  // iframe can’t send Authorization header => token in querystring
  const urlPath = `/${encodeURIComponent(siteId)}/${encodeURIComponent(section)}/${encodeURIComponent(pageId)}`;
  const src = base + urlPath + "?t=" + encodeURIComponent(token);

  $("frame").src = src;
  $("currentUrl").textContent = urlPath;
}

// -------------------------
// Boot
// -------------------------
function restoreToken() {
  const t = localStorage.getItem("portal_token");
  if (t) token = t;
}

async function boot() {
  restoreToken();

  // If you want to prefill API base from config:
  if (!$("apiBase").value.trim() && window.__APP_CONFIG__ && window.__APP_CONFIG__.API_BASE) {
    $("apiBase").value = window.__APP_CONFIG__.API_BASE;
  }

  if (token) {
    setStatus("🔁 Token restauré. Charge memberships puis menu.");
    try {
      await loadMemberships();
    } catch (e) {
      setStatus("Token invalide ou backend inaccessible. " + e.message, true);
    }
  } else {
    setStatus("🔐 Connecte-toi.");
  }

  // React to hash navigation
  window.addEventListener("hashchange", () => {
    const route = parseHash();
    if (route) openPage(route.section, route.pageId);
  });
}

// -------------------------
// UI bindings
// -------------------------
$("btnLogin").onclick = async () => {
  try {
    await login();
    await loadMemberships();
  } catch (e) {
    setStatus("Login error: " + e.message, true);
  }
};

$("btnLogout").onclick = async () => {
  await logout();
};

$("btnSetAudience").onclick = async () => {
  try {
    await setAudience();
    // After switching audience, reload menu + optionally reload current page
    await loadMenu();

    const route = parseHash();
    if (route) openPage(route.section, route.pageId);
  } catch (e) {
    setStatus("Set audience error: " + e.message, true);
  }
};

$("btnLoadMenu").onclick = async () => {
  try {
    await loadMenu();
    // If hash already points to a page, open it
    const route = parseHash();
    if (route) openPage(route.section, route.pageId);
  } catch (e) {
    setStatus("Menu error: " + e.message, true);
  }
};

// Start
boot();