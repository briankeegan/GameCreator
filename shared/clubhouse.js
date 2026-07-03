// One Clubhouse page shared by every game. ?game=<id> picks which game's
// chat this is; the shared Worker resolves that id to a draft PR (the
// thread) and a secret word, dynamically — see worker/worker.js.
var params = new URLSearchParams(location.search);
var GAME_ID = params.get("game") || "";
var GAME_NAME = params.get("name") || GAME_ID || "this game";
var BACK_URL = params.get("back") || "../index.html";

// This repo hosts every game's chat as a standing draft PR (never an
// Issue — PR activity is what lets Claude get woken up by new messages).
var REPO = "briankeegan/GameCreator";
// The one shared relay every game's clubhouse talks to.
var WORKER_URL = "https://game-creator.bramp-games.workers.dev";

document.getElementById("gameBtn").href = BACK_URL;
document.getElementById("gameTitle").textContent = ": " + GAME_NAME;
// window.APP_VERSION comes from /version.js, stamped fresh by the deploy
// workflow on every run (404s harmlessly in local dev, where it doesn't exist).
document.getElementById("versionStamp").textContent = window.APP_VERSION ? " · " + window.APP_VERSION : "";

var gateEl = document.getElementById("gate");
var gateErrorEl = document.getElementById("gateError");
var nameInput = document.getElementById("nameInput");
var secretInput = document.getElementById("secretInput");
var enterBtn = document.getElementById("enterBtn");
var threadWrapEl = document.getElementById("threadWrap");
var threadEl = document.getElementById("thread");
var threadStatusEl = document.getElementById("threadStatus");
var messageInput = document.getElementById("messageInput");
var sendBtn = document.getElementById("sendBtn");

var visitorName = "";
var secretWord = "";
var prNumber = null;
var pollTimer = null;
var fastPollUntil = 0;
var lastRenderKey = "";
var lastPoll = 0;

function showGateError(msg) {
  gateErrorEl.textContent = msg;
  gateErrorEl.classList.add("visible");
}

function relay(payload) {
  payload.game = GAME_ID;
  return fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

var LOGIN_KEY = "clubhouse_login:" + GAME_ID;
// Scoped per game like LOGIN_KEY — this page is shared by every game, so a
// draft typed for one game must never bleed into another's composer.
var DRAFT_KEY = "clubhouse_draft:" + GAME_ID;
var logoutBtn = document.getElementById("logoutBtn");
var peekBtn = document.getElementById("peekBtn");
var eyeOpen = document.getElementById("eyeOpen");
var eyeClosed = document.getElementById("eyeClosed");

function setPeekIcons(showing) {
  if (showing) {
    eyeOpen.setAttribute("hidden", "");
    eyeClosed.removeAttribute("hidden");
  } else {
    eyeClosed.setAttribute("hidden", "");
    eyeOpen.removeAttribute("hidden");
  }
  peekBtn.setAttribute("aria-label", showing ? "Hide secret word" : "Show secret word");
}

peekBtn.addEventListener("click", function () {
  var show = secretInput.type === "password";
  secretInput.type = show ? "text" : "password";
  setPeekIcons(show);
});

function openClubhouse(name, secret) {
  visitorName = name;
  secretWord = secret;
  try {
    localStorage.setItem(LOGIN_KEY, JSON.stringify({ name: name, secret: secret }));
  } catch (e) {}
  gateEl.style.display = "none";
  threadWrapEl.classList.add("visible");
  logoutBtn.hidden = false;
  startPolling();
}

// The PR number that holds this game's thread comes from the Worker
// (backed by its dynamic KV config), not a hardcoded value here — so adding
// a game never means editing this file.
function resolveThread() {
  return relay({ action: "resolve" })
    .then(function (res) {
      if (!res.ok) throw new Error("no chat configured for this game yet");
      return res.json();
    })
    .then(function (data) {
      prNumber = data.prNumber;
    });
}

function enterClubhouse(name, secret, fromSavedLogin) {
  enterBtn.disabled = true;
  enterBtn.textContent = "Checking…";
  resolveThread()
    .then(function () {
      return relay({ action: "verify", secret: secret });
    })
    .then(function (res) {
      if (res.status === 403) throw new Error("wrong-secret");
      if (!res.ok) throw new Error("relay");
      openClubhouse(name, secret);
    })
    .catch(function (err) {
      // A saved-login failure used to fail completely silently here — the
      // gate just sat there with an empty password field and no
      // explanation. Always show what happened now, same as a fresh login
      // attempt; still clear the dead saved login so it doesn't loop.
      if (fromSavedLogin) {
        if (err.message === "wrong-secret") {
          try { localStorage.removeItem(LOGIN_KEY); } catch (e) {}
        }
        nameInput.value = name;
      }
      showGateError(
        err.message === "wrong-secret"
          ? "That's not the secret word. Try again!"
          : "Couldn't reach the clubhouse. Check your internet and try again."
      );
    })
    .finally(function () {
      enterBtn.disabled = false;
      enterBtn.textContent = "Enter the clubhouse";
    });
}

enterBtn.addEventListener("click", function () {
  var name = nameInput.value.trim();
  var secret = secretInput.value.trim();
  gateErrorEl.classList.remove("visible");
  if (!name) return showGateError("You have to sign your name!");
  if (!secret) return showGateError("You have to whisper the secret word!");
  if (!WORKER_URL) return showGateError("The clubhouse isn't wired up yet — come back soon.");
  enterClubhouse(name, secret, false);
});

var logoutConfirmEl = document.getElementById("logoutConfirm");
var logoutYesBtn = document.getElementById("logoutYesBtn");
var logoutNoBtn = document.getElementById("logoutNoBtn");

function doLogout() {
  try { localStorage.removeItem(LOGIN_KEY); } catch (e) {}
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  visitorName = "";
  secretWord = "";
  logoutBtn.hidden = true;
  threadWrapEl.classList.remove("visible");
  gateEl.style.display = "flex";
  nameInput.value = "";
  secretInput.value = "";
  secretInput.type = "password";
  setPeekIcons(false);
}

logoutBtn.addEventListener("click", function () {
  logoutConfirmEl.hidden = false;
});
logoutYesBtn.addEventListener("click", function () {
  logoutConfirmEl.hidden = true;
  doLogout();
});
logoutNoBtn.addEventListener("click", function () {
  logoutConfirmEl.hidden = true;
});
document.addEventListener("click", function (e) {
  if (logoutConfirmEl.hidden) return;
  if (e.target === logoutBtn || logoutConfirmEl.contains(e.target)) return;
  logoutConfirmEl.hidden = true;
});

(function () {
  if (!GAME_ID) {
    showGateError("No game specified — open the clubhouse from inside a game.");
    enterBtn.disabled = true;
    return;
  }
  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(LOGIN_KEY)); } catch (e) {}
  if (saved && saved.name && saved.secret && WORKER_URL) {
    enterClubhouse(saved.name, saved.secret, true);
  }
})();

// Restore whatever was mid-typing when the visitor last left this game's
// Clubhouse (navigated to the game, refreshed, closed the tab). Runs
// regardless of login state — the composer's just hidden until then.
(function () {
  var draft = null;
  try { draft = localStorage.getItem(DRAFT_KEY); } catch (e) {}
  if (draft) {
    messageInput.value = draft;
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
  }
})();

// ---- minimal Markdown rendering for message bodies ----
// Not a full CommonMark implementation — just the subset that shows up in
// design-doc-style messages: headers, bold/italic/code, fenced code blocks,
// links, tables, lists, and horizontal rules. HTML is escaped first so
// nothing a visitor (or Claude) types can inject markup.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(text) {
  var s = escapeHtml(text);
  // Pull inline code out first so its contents don't get mangled by the
  // bold/italic/link passes below, then splice it back in afterward.
  var codeSpans = [];
  s = s.replace(/`([^`]+)`/g, function (_, code) {
    codeSpans.push(code);
    return " " + (codeSpans.length - 1) + " ";
  });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/ (\d+) /g, function (_, i) {
    return "<code>" + codeSpans[Number(i)] + "</code>";
  });
  return s;
}

function renderMarkdown(text) {
  var lines = text.replace(/\r\n/g, "\n").split("\n");
  var html = [];
  var paragraphBuf = [];
  var listBuf = null;

  function flushParagraph() {
    if (paragraphBuf.length) {
      html.push("<p>" + renderInline(paragraphBuf.join(" ")) + "</p>");
      paragraphBuf = [];
    }
  }
  function flushList() {
    if (listBuf) {
      var tag = listBuf.type;
      html.push(
        "<" + tag + ">" +
          listBuf.items.map(function (it) { return "<li>" + renderInline(it) + "</li>"; }).join("") +
        "</" + tag + ">"
      );
      listBuf = null;
    }
  }

  var i = 0;
  while (i < lines.length) {
    var line = lines[i];

    var fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      var lang = fence[1];
      var codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      html.push(
        "<pre><code" + (lang ? ' class="lang-' + lang + '"' : "") + ">" +
          escapeHtml(codeLines.join("\n")) +
        "</code></pre>"
      );
      continue;
    }

    if (/^(---+|\*\*\*+)\s*$/.test(line.trim()) && line.trim().length >= 3) {
      flushParagraph();
      flushList();
      html.push("<hr>");
      i++;
      continue;
    }

    var h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushParagraph();
      flushList();
      var level = h[1].length;
      html.push("<h" + level + ">" + renderInline(h[2]) + "</h" + level + ">");
      i++;
      continue;
    }

    if (/^\|.*\|\s*$/.test(line) && lines[i + 1] && /^\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      flushParagraph();
      flushList();
      var headerCells = line.trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); });
      i += 2;
      var rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map(function (c) { return c.trim(); }));
        i++;
      }
      var t = "<table><thead><tr>" +
        headerCells.map(function (c) { return "<th>" + renderInline(c) + "</th>"; }).join("") +
        "</tr></thead>";
      if (rows.length) {
        t += "<tbody>" +
          rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + renderInline(c) + "</td>"; }).join("") + "</tr>";
          }).join("") +
          "</tbody>";
      }
      t += "</table>";
      html.push(t);
      continue;
    }

    var ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      if (!listBuf || listBuf.type !== "ul") {
        flushList();
        listBuf = { type: "ul", items: [] };
      }
      listBuf.items.push(ul[1]);
      i++;
      continue;
    }

    var ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      flushParagraph();
      if (!listBuf || listBuf.type !== "ol") {
        flushList();
        listBuf = { type: "ol", items: [] };
      }
      listBuf.items.push(ol[1]);
      i++;
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushParagraph();
      flushList();
      i++;
      continue;
    }

    flushList();
    paragraphBuf.push(line.trim());
    i++;
  }
  flushParagraph();
  flushList();
  return html.join("");
}

// Comments are chat messages only if they start with "**<name> says:**".
// Claude's replies use the name Claude; everything else renders as a
// visitor bubble. Unmarked comments (issue housekeeping) are skipped.
var MARKER = /^\*\*(.+?) says:\*\*\s*/;

function parseComments(comments) {
  var messages = [];
  for (var i = 0; i < comments.length; i++) {
    var m = comments[i].body.match(MARKER);
    if (!m) continue;
    var text = comments[i].body.slice(m[0].length);
    // Messages may end with a deploy-version stamp like [v0.57] — pull it
    // out of the text and show it in the byline instead.
    var version = null;
    var vm = text.match(/\s*\[(v[\d.]+)\]\s*$/);
    if (vm) {
      version = vm[1];
      text = text.slice(0, vm.index);
    }
    messages.push({
      who: m[1],
      fromClaude: m[1].toLowerCase() === "claude",
      text: text,
      version: version,
      when: comments[i].created_at,
    });
  }
  return messages;
}

function friendlyTime(iso) {
  var d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function renderMessages(messages) {
  var key = JSON.stringify(messages.map(function (m) { return [m.who, m.when]; }));
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  threadEl.innerHTML = "";
  if (messages.length === 0) {
    var empty = document.createElement("div");
    empty.className = "thread-status";
    empty.textContent = "No messages yet — you get to write the very first one!";
    threadEl.appendChild(empty);
  }
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var bubble = document.createElement("div");
    bubble.className = "bubble " + (msg.fromClaude ? "claude" : "visitor");
    var who = document.createElement("span");
    who.className = "who";
    who.textContent =
      msg.who + (msg.version ? " · " + msg.version : "") + " · " + friendlyTime(msg.when);
    bubble.appendChild(who);
    var body = document.createElement("div");
    body.className = "msg-body";
    body.innerHTML = renderMarkdown(msg.text);
    bubble.appendChild(body);
    threadEl.appendChild(bubble);
  }

  var thinking = document.createElement("div");
  thinking.className = "thinking";
  thinking.id = "thinkingNote";
  thinking.textContent = "Claude is thinking… replies can take a little while.";
  threadEl.appendChild(thinking);
  if (messages.length && !messages[messages.length - 1].fromClaude) {
    thinking.classList.add("visible");
  }

  threadEl.scrollTop = threadEl.scrollHeight;
}

function fetchThread() {
  var url = "https://api.github.com/repos/" + REPO + "/issues/" + prNumber +
    "/comments?per_page=100&sort=created&direction=asc";
  var all = [];
  function fetchPage(pageUrl) {
    // no-store: without this the browser can serve a stale cached copy of
    // this GitHub API response, so a page reload wouldn't reliably show a
    // comment added moments ago — same bug class as games.json earlier.
    return fetch(pageUrl, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("github");
        var next = null;
        var link = res.headers.get("Link") || "";
        var m = link.match(/<([^>]+)>;\s*rel="next"/);
        if (m) next = m[1];
        return res.json().then(function (page) {
          all = all.concat(page);
          return next ? fetchPage(next) : all;
        });
      });
  }
  return fetchPage(url);
}

function refreshThread() {
  if (!prNumber) return;
  fetchThread()
    .then(function (comments) {
      threadStatusEl.style.display = "none";
      renderMessages(parseComments(comments));
    })
    .catch(function () {
      threadStatusEl.style.display = "block";
      threadStatusEl.textContent = "Having trouble reaching the clubhouse — retrying…";
    });
}

function startPolling() {
  refreshThread();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(function () {
    var interval = Date.now() < fastPollUntil ? 15000 : 45000;
    if (Date.now() - lastPoll >= interval) {
      lastPoll = Date.now();
      refreshThread();
    }
  }, 5000);
  lastPoll = Date.now();
}

sendBtn.addEventListener("click", function () {
  var text = messageInput.value.trim();
  if (!text) return;
  // Stamp the message with the deploy version this page was sent from, so
  // the thread records who was on what version when.
  var stamped = window.APP_VERSION ? text + "\n\n[" + window.APP_VERSION + "]" : text;
  sendBtn.disabled = true;
  sendBtn.textContent = "Sending…";
  relay({ action: "post", name: visitorName, secret: secretWord, message: stamped })
    .then(function (res) {
      return res
        .json()
        .catch(function () { return {}; })
        .then(function (data) { return { res: res, data: data }; });
    })
    .then(function (r) {
      if (r.res.status === 403) throw new Error("wrong-secret");
      if (!r.res.ok) throw new Error(r.data.error || "relay error " + r.res.status);
      messageInput.value = "";
      messageInput.style.height = "auto";
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      sendErrorEl.hidden = true;
      lastRenderKey = "";
      var bubble = document.createElement("div");
      bubble.className = "bubble visitor pending";
      var who = document.createElement("span");
      who.className = "who";
      who.textContent = visitorName + " · just now";
      bubble.appendChild(who);
      var body = document.createElement("div");
      body.className = "msg-body";
      body.innerHTML = renderMarkdown(text);
      bubble.appendChild(body);
      var thinkingNote = document.getElementById("thinkingNote");
      threadEl.insertBefore(bubble, thinkingNote);
      thinkingNote.classList.add("visible");
      threadEl.scrollTop = threadEl.scrollHeight;
      fastPollUntil = Date.now() + 10 * 60 * 1000;
    })
    .catch(function (err) {
      showSendError(
        err.message === "wrong-secret"
          ? "The secret word stopped working — reload the page and try again."
          : "Message didn't go through. Relay said: " + err.message
      );
    })
    .finally(function () {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    });
});

var sendErrorEl = document.getElementById("sendError");
var sendErrorTextEl = document.getElementById("sendErrorText");
var copyErrorBtn = document.getElementById("copyErrorBtn");
var dismissErrorBtn = document.getElementById("dismissErrorBtn");

function showSendError(msg) {
  sendErrorTextEl.textContent = msg;
  sendErrorEl.hidden = false;
  copyErrorBtn.textContent = "Copy";
}

copyErrorBtn.addEventListener("click", function () {
  var text = sendErrorTextEl.textContent;
  var done = function () { copyErrorBtn.textContent = "Copied!"; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
  } else {
    fallbackCopy(text, done);
  }
});

function fallbackCopy(text, done) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); done(); } catch (e) {}
  ta.remove();
}

dismissErrorBtn.addEventListener("click", function () {
  sendErrorEl.hidden = true;
});

messageInput.addEventListener("input", function () {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
  try { localStorage.setItem(DRAFT_KEY, messageInput.value); } catch (e) {}
});
