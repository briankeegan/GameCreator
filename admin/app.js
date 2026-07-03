// Admin room: talks directly to the shared Worker's admin-* actions from
// the browser. Runs entirely client-side — the admin token never leaves
// this device except in requests straight to your own Worker.
const CONN_KEY = "gc_admin_conn";
const DEFAULT_WORKER_URL = "https://game-creator.bramp-games.workers.dev";

const workerUrlInput = document.getElementById("workerUrlInput");
const adminTokenInput = document.getElementById("adminTokenInput");
const saveConnBtn = document.getElementById("saveConnBtn");
const connStatusEl = document.getElementById("connStatus");

const gameIdInput = document.getElementById("gameIdInput");
const gameNameInput = document.getElementById("gameNameInput");
const secretWordInput = document.getElementById("secretWordInput");
const issueNumberInput = document.getElementById("issueNumberInput");
const upsertBtn = document.getElementById("upsertBtn");
const upsertStatusEl = document.getElementById("upsertStatus");

const refreshBtn = document.getElementById("refreshBtn");
const listStatusEl = document.getElementById("listStatus");
const gamesTableBody = document.getElementById("gamesTableBody");

function loadConn() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONN_KEY) || "null");
    if (saved) {
      workerUrlInput.value = saved.workerUrl || DEFAULT_WORKER_URL;
      adminTokenInput.value = saved.adminToken || "";
      return;
    }
  } catch (e) {}
  workerUrlInput.value = DEFAULT_WORKER_URL;
}

function saveConn() {
  try {
    localStorage.setItem(
      CONN_KEY,
      JSON.stringify({ workerUrl: workerUrlInput.value.trim(), adminToken: adminTokenInput.value.trim() })
    );
  } catch (e) {}
}

function setStatus(el, msg, kind) {
  el.textContent = msg;
  el.className = "admin-status" + (kind ? " " + kind : "");
}

function callAdmin(body) {
  const workerUrl = workerUrlInput.value.trim();
  const adminToken = adminTokenInput.value.trim();
  if (!workerUrl) throw new Error("Set the Worker URL first.");
  if (!adminToken) throw new Error("Set the admin token first.");
  return fetch(workerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, adminToken }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `relay error ${res.status}`);
    return data;
  });
}

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
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => removeGame(g.game));
    tr.innerHTML = `<td>${g.game}</td><td>${g.name || ""}</td><td>#${g.issueNumber || "?"}</td>`;
    const actionTd = document.createElement("td");
    actionTd.appendChild(removeBtn);
    tr.appendChild(actionTd);
    gamesTableBody.appendChild(tr);
  }
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
  if (!confirm(`Remove chat config for "${gameId}"? This does not delete the GitHub Issue.`)) return;
  callAdmin({ action: "admin-remove", game: gameId })
    .then(() => refreshList())
    .catch((err) => setStatus(listStatusEl, err.message, "error"));
}

saveConnBtn.addEventListener("click", () => {
  saveConn();
  setStatus(connStatusEl, "Saved.", "ok");
  refreshList();
});

refreshBtn.addEventListener("click", refreshList);

upsertBtn.addEventListener("click", () => {
  const game = gameIdInput.value.trim();
  const name = gameNameInput.value.trim();
  const secretWord = secretWordInput.value.trim();
  const issueNumber = Number(issueNumberInput.value);
  if (!game || !name || !secretWord || !issueNumber) {
    setStatus(upsertStatusEl, "Fill in all four fields.", "error");
    return;
  }
  upsertBtn.disabled = true;
  setStatus(upsertStatusEl, "Saving…");
  callAdmin({ action: "admin-upsert", game, name, secretWord, issueNumber })
    .then(() => {
      setStatus(upsertStatusEl, `Saved "${game}".`, "ok");
      gameIdInput.value = "";
      gameNameInput.value = "";
      secretWordInput.value = "";
      issueNumberInput.value = "";
      refreshList();
    })
    .catch((err) => setStatus(upsertStatusEl, err.message, "error"))
    .finally(() => {
      upsertBtn.disabled = false;
    });
});

loadConn();
if (adminTokenInput.value) refreshList();
