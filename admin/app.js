// Admin room. Same login pattern as the Clubhouse (shared/clubhouse.js): a
// gate you unlock once, remembered on this device. Here the "secret" is the
// Worker's ADMIN_TOKEN — checked by calling admin-list, which the Worker
// rejects with 403 for a wrong token. Runs entirely client-side, straight
// to the Worker, so it works even when Claude has no network access.
const WORKER_URL = "https://game-creator.bramp-games.workers.dev";
const TOKEN_KEY = "gc_admin_token";

const gateEl = document.getElementById("gate");
const gateErrorEl = document.getElementById("gateError");
const passkeyInput = document.getElementById("passkeyInput");
const enterBtn = document.getElementById("enterBtn");
const adminMainEl = document.getElementById("adminMain");
const logoutBtn = document.getElementById("logoutBtn");
const peekBtn = document.getElementById("peekBtn");
const eyeOpen = document.getElementById("eyeOpen");
const eyeClosed = document.getElementById("eyeClosed");

const createIdInput = document.getElementById("createIdInput");
const createNameInput = document.getElementById("createNameInput");
const createTaglineInput = document.getElementById("createTaglineInput");
const createSecretInput = document.getElementById("createSecretInput");
const createBtn = document.getElementById("createBtn");
const createStatusEl = document.getElementById("createStatus");

const refreshBtn = document.getElementById("refreshBtn");
const addExistingBtn = document.getElementById("addExistingBtn");
const listStatusEl = document.getElementById("listStatus");
const gamesTableBody = document.getElementById("gamesTableBody");

let adminToken = "";

// Ported from shared/clubhouse.js's send-error component: any failure shows
// here with a Copy button, so it can be pasted back verbatim instead of
// described from memory or screenshotted. Wired to catch truly uncaught
// errors too (window error / unhandledrejection), not just the ones this
// file explicitly handles — a silent failure with nothing on screen is
// itself a bug, not an acceptable outcome.
const errorBannerEl = document.getElementById("errorBanner");
const errorBannerTextEl = document.getElementById("errorBannerText");
const errorBannerCopyBtn = document.getElementById("errorBannerCopyBtn");
const errorBannerDismissBtn = document.getElementById("errorBannerDismissBtn");

function showError(msg) {
  errorBannerTextEl.textContent = msg;
  errorBannerEl.hidden = false;
  errorBannerCopyBtn.textContent = "Copy";
}

function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    done();
  } catch (e) {}
  ta.remove();
}

errorBannerCopyBtn.addEventListener("click", () => {
  const text = errorBannerTextEl.textContent;
  const done = () => {
    errorBannerCopyBtn.textContent = "Copied!";
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
});

errorBannerDismissBtn.addEventListener("click", () => {
  errorBannerEl.hidden = true;
});

window.addEventListener("error", (e) => {
  showError(`Uncaught error: ${e.message} (${e.filename}:${e.lineno}:${e.colno})`);
});
window.addEventListener("unhandledrejection", (e) => {
  showError(`Unhandled rejection: ${(e.reason && e.reason.message) || e.reason}`);
});

function showGateError(msg) {
  gateErrorEl.textContent = msg;
  gateErrorEl.classList.add("visible");
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "admin-status" + (kind ? " " + kind : "");
  if (kind === "error") showError(msg);
}

function callAdmin(body) {
  return fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, adminToken }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) throw new Error("wrong-passkey");
    if (!res.ok) throw new Error(data.error || `relay error ${res.status}`);
    return data;
  });
}

function setPeekIcons(showing) {
  if (showing) {
    eyeOpen.setAttribute("hidden", "");
    eyeClosed.removeAttribute("hidden");
  } else {
    eyeClosed.setAttribute("hidden", "");
    eyeOpen.removeAttribute("hidden");
  }
  peekBtn.setAttribute("aria-label", showing ? "Hide passkey" : "Show passkey");
}

peekBtn.addEventListener("click", () => {
  const show = passkeyInput.type === "password";
  passkeyInput.type = show ? "text" : "password";
  setPeekIcons(show);
});

function openAdmin(token) {
  adminToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch (e) {}
  gateEl.style.display = "none";
  adminMainEl.hidden = false;
  logoutBtn.hidden = false;
  refreshList();
}

function enterAdmin(token, fromSavedLogin) {
  enterBtn.disabled = true;
  enterBtn.textContent = "Checking…";
  adminToken = token;
  callAdmin({ action: "admin-list" })
    .then((data) => {
      openAdmin(token);
      renderGames(data.games);
      setStatus(listStatusEl, `${(data.games || []).length} game(s)`, "ok");
    })
    .catch((err) => {
      if (fromSavedLogin) {
        if (err.message === "wrong-passkey") {
          try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
        }
        return;
      }
      showGateError(
        err.message === "wrong-passkey"
          ? "That's not the admin passkey."
          : "Couldn't reach the Worker. Check your internet and try again."
      );
    })
    .finally(() => {
      enterBtn.disabled = false;
      enterBtn.textContent = "Enter";
    });
}

enterBtn.addEventListener("click", () => {
  const passkey = passkeyInput.value.trim();
  gateErrorEl.classList.remove("visible");
  if (!passkey) return showGateError("Enter the admin passkey.");
  enterAdmin(passkey, false);
});

passkeyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") enterBtn.click();
});

const logoutConfirmEl = document.getElementById("logoutConfirm");
const logoutYesBtn = document.getElementById("logoutYesBtn");
const logoutNoBtn = document.getElementById("logoutNoBtn");

function doLogout() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  adminToken = "";
  logoutBtn.hidden = true;
  adminMainEl.hidden = true;
  gateEl.style.display = "flex";
  passkeyInput.value = "";
  passkeyInput.type = "password";
  setPeekIcons(false);
}

logoutBtn.addEventListener("click", () => {
  logoutConfirmEl.hidden = false;
});
logoutYesBtn.addEventListener("click", () => {
  logoutConfirmEl.hidden = true;
  doLogout();
});
logoutNoBtn.addEventListener("click", () => {
  logoutConfirmEl.hidden = true;
});
document.addEventListener("click", (e) => {
  if (logoutConfirmEl.hidden) return;
  if (e.target === logoutBtn || logoutConfirmEl.contains(e.target)) return;
  logoutConfirmEl.hidden = true;
});

function renderGames(games) {
  gamesTableBody.innerHTML = "";
  if (!games || games.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="4" class="admin-empty">No games configured yet.</td>';
    gamesTableBody.appendChild(tr);
    return;
  }
  for (const g of games) {
    const tr = document.createElement("tr");
    const prCell = g.prNumber
      ? `<a href="https://github.com/briankeegan/GameCreator/pull/${g.prNumber}" target="_blank" rel="noopener">#${g.prNumber}</a>`
      : "?";
    tr.innerHTML = `<td>${g.game}</td><td>${g.name || ""}</td><td>${prCell}</td>`;

    const fixBtn = document.createElement("button");
    fixBtn.textContent = "Fix link";
    fixBtn.addEventListener("click", () => fixThreadLink(g.game, g.prNumber));
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeGame(g.game));
    const actionTd = document.createElement("td");
    actionTd.appendChild(fixBtn);
    actionTd.appendChild(removeBtn);
    tr.appendChild(actionTd);
    gamesTableBody.appendChild(tr);
  }
}

// Repoints a game's chat at a different PR without touching its name or
// secret word (the Worker reuses whatever it already has for fields you
// don't send) — for when a thread needs to be recreated or migrated.
function fixThreadLink(gameId, currentPr) {
  const input = prompt(`PR number for "${gameId}"'s chat thread:`, currentPr || "");
  if (!input) return;
  const prNumber = Number(input);
  if (!prNumber) return setStatus(listStatusEl, "That's not a PR number.", "error");
  callAdmin({ action: "admin-upsert", game: gameId, prNumber })
    .then(() => refreshList())
    .catch((err) => setStatus(listStatusEl, err.message, "error"));
}

function refreshList() {
  setStatus(listStatusEl, "Loading…");
  callAdmin({ action: "admin-list" })
    .then((data) => {
      renderGames(data.games);
      setStatus(listStatusEl, `${(data.games || []).length} game(s)`, "ok");
    })
    .catch((err) => setStatus(listStatusEl, err.message, "error"));
}

function removeGame(gameId) {
  if (!confirm(`Remove chat config for "${gameId}"? This does not close the GitHub PR.`)) return;
  callAdmin({ action: "admin-remove", game: gameId })
    .then(() => refreshList())
    .catch((err) => setStatus(listStatusEl, err.message, "error"));
}

refreshBtn.addEventListener("click", refreshList);

// For a game whose files already exist but whose KV chat config is
// missing/empty (e.g. it got wiped) — sets up just the chat side, without
// re-scaffolding files the way "Create a new game" would.
addExistingBtn.addEventListener("click", () => {
  const game = prompt("Game id (matches its folder in games/):", "");
  if (!game) return;
  const secretWord = prompt(`Secret word for "${game}"'s chat login:`, "");
  if (!secretWord) return;
  const prInput = prompt("PR number for its chat thread (leave blank to create a new one):", "");
  const body = { action: "admin-upsert", game: game.trim(), secretWord };
  if (prInput) body.prNumber = Number(prInput);
  callAdmin(body)
    .then(() => refreshList())
    .catch((err) => setStatus(listStatusEl, err.message, "error"));
});

createBtn.addEventListener("click", () => {
  const game = createIdInput.value.trim();
  const name = createNameInput.value.trim();
  const tagline = createTaglineInput.value.trim();
  const secretWord = createSecretInput.value.trim();
  if (!game || !name || !secretWord) {
    setStatus(createStatusEl, "Game id, display name, and secret word are required.", "error");
    return;
  }
  createBtn.disabled = true;
  setStatus(createStatusEl, "Creating… (scaffolding files, listing it, setting up chat)");
  callAdmin({ action: "admin-create-game", game, name, tagline, secretWord })
    .then((data) => {
      setStatus(
        createStatusEl,
        `Created "${data.game}" — play it at ${data.path}, chat thread #${data.config.prNumber}.`,
        "ok"
      );
      createIdInput.value = "";
      createNameInput.value = "";
      createTaglineInput.value = "";
      createSecretInput.value = "";
      refreshList();
    })
    .catch((err) => setStatus(createStatusEl, err.message, "error"))
    .finally(() => {
      createBtn.disabled = false;
    });
});

(function () {
  let saved = "";
  try { saved = localStorage.getItem(TOKEN_KEY) || ""; } catch (e) {}
  if (saved) enterAdmin(saved, true);
})();
