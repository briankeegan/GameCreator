// Clubhouse relay — the ONE Cloudflare Worker shared by every game's chat.
//
// Per-game config (secret word + which GitHub Issue is its thread) lives in
// a KV namespace, not in this file and not in a dashboard "Variable" — so
// adding, renaming, or re-keying a game's chat is a normal authenticated
// API call (see manage-games.sh), never a Worker redeploy or dashboard
// visit. This file only changes if the *behavior* of the relay changes.
//
// Actions:
//   { action: "resolve", game }                          — public: which Issue is this game's thread?
//   { action: "verify",  game, secret }                  — is the secret word right?
//   { action: "post",    game, name, secret, message }    — post a message to the thread
//   { action: "admin-create-game", adminToken, game, name, tagline?, secretWord }
//     — scaffolds games/<id>/ from games/_template/, lists it in games.json,
//       creates its chat Issue, and registers it — the whole "add a game" loop
//       in one call. Fails if the game id already exists.
//   { action: "admin-upsert", adminToken, game, name, secretWord, issueNumber? }
//     — add/update just the CHAT config for a game that already exists (e.g.
//       change its secret word). issueNumber is optional — omit it to create
//       a new thread, or it reuses whatever thread the game already has.
//   { action: "admin-remove",  adminToken, game }         — remove a game's chat config
//   { action: "admin-list",    adminToken }               — list configured games (secrets redacted)
//
// Required bindings (Worker → Settings → Variables and Secrets / Bindings):
//   GAMES_KV      (KV namespace binding) — per-game config, written via admin-upsert
//   GITHUB_TOKEN  (secret)  — fine-grained PAT on REPO with Issues: Read/write
//                             AND Contents: Read/write (needed for admin-create-game
//                             to write game files and games.json)
//   ADMIN_TOKEN   (secret)  — a password only you know, gates the admin-* actions
//   REPO          (text)    — briankeegan/GameCreator

// Only browser requests originating from the real site are allowed to
// actually do anything — this doesn't hide the Worker's URL (nothing can;
// any static site's JS is inspectable) but it does stop someone from
// copy-pasting the URL into their own page and hammering it (e.g.
// brute-forcing a secret word) from outside GameCreator. Non-browser
// callers (curl, scripts) send no Origin header at all and are unaffected.
const ALLOWED_ORIGIN = "https://briankeegan.github.io";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function loadGame(env, gameId) {
  const raw = await env.GAMES_KV.get(`game:${gameId}`);
  return raw ? JSON.parse(raw) : null;
}

const GITHUB_HEADERS = (env) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "gamecreator-clubhouse-relay",
  "X-GitHub-Api-Version": "2022-11-28",
});

// btoa/atob only handle Latin1, so route through UTF-8 bytes for safety
// (game names/taglines may contain non-ASCII characters).
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghGetFile(env, path) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/contents/${path}`, {
    headers: GITHUB_HEADERS(env),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`couldn't read ${path}: ${res.status}`);
  return res.json();
}

async function ghPutFile(env, path, content, message, sha) {
  const body = { message, content: utf8ToBase64(content), branch: "main" };
  if (sha) body.sha = sha;
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/contents/${path}`, {
    method: "PUT",
    headers: GITHUB_HEADERS(env),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const b = await res.json();
      detail = b.message ? ` — ${b.message}` : "";
    } catch {}
    throw new Error(`couldn't write ${path}: ${res.status}${detail}`);
  }
  return res.json();
}

async function ghCreateIssue(env, name) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
    method: "POST",
    headers: GITHUB_HEADERS(env),
    body: JSON.stringify({
      title: `Clubhouse — ${name}`,
      body:
        `This issue IS the chat thread for "${name}" — its comments are the messages, ` +
        `relayed through the shared Worker.\n\nKeep this issue open — it's infrastructure, not a bug report.`,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const b = await res.json();
      detail = b.message ? ` — ${b.message}` : "";
    } catch {}
    throw new Error(`couldn't create the chat Issue: ${res.status}${detail}`);
  }
  const data = await res.json();
  return data.number;
}

const TEMPLATE_FILES = ["index.html", "style.css", "app.js", "manifest.webmanifest", "sw.js", "icons/icon.svg"];

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json(200, {
        relay: "gc-r3",
        settings: {
          GAMES_KV: env.GAMES_KV ? "bound" : "MISSING",
          GITHUB_TOKEN: env.GITHUB_TOKEN ? "set" : "MISSING",
          ADMIN_TOKEN: env.ADMIN_TOKEN ? "set" : "MISSING",
          REPO: env.REPO || "MISSING",
        },
      });
    }

    const origin = request.headers.get("Origin");
    if (origin && origin !== ALLOWED_ORIGIN) {
      return json(403, { error: "forbidden origin" });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json(400, { error: "bad JSON" });
    }

    // ---- admin actions: manage games without touching the dashboard ----
    if (typeof payload.action === "string" && payload.action.startsWith("admin-")) {
      if (!env.ADMIN_TOKEN || payload.adminToken !== env.ADMIN_TOKEN) {
        return json(403, { error: "wrong admin token" });
      }

      if (payload.action === "admin-create-game") {
        const gameId = String(payload.game || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "");
        if (!gameId) return json(400, { error: "missing game id" });
        const name = String(payload.name || gameId);
        const tagline = String(payload.tagline || "");
        const secretWord = String(payload.secretWord || "");
        if (!secretWord) return json(400, { error: "secretWord is required" });

        if (await loadGame(env, gameId)) {
          return json(409, { error: `"${gameId}" already exists — use admin-upsert to change its chat, or pick a different id` });
        }

        try {
          for (const file of TEMPLATE_FILES) {
            const tpl = await ghGetFile(env, `games/_template/${file}`);
            if (!tpl) throw new Error(`template is missing ${file} — can't scaffold from it`);
            const text = base64ToUtf8(tpl.content)
              .split("TEMPLATE_GAME_NAME")
              .join(name)
              .split("TEMPLATE_GAME_ID")
              .join(gameId);
            await ghPutFile(env, `games/${gameId}/${file}`, text, `Create game: ${name}`);
          }

          const registry = await ghGetFile(env, "games.json");
          const data = registry ? JSON.parse(base64ToUtf8(registry.content)) : { games: [] };
          data.games = data.games || [];
          data.games.push({
            id: gameId,
            name,
            tagline,
            themeColor: "#2f3b52",
            icon: `games/${gameId}/icons/icon.svg`,
          });
          await ghPutFile(
            env,
            "games.json",
            JSON.stringify(data, null, 2) + "\n",
            `List "${name}" on the landing page`,
            registry ? registry.sha : undefined
          );

          const issueNumber = await ghCreateIssue(env, name);
          const config = { name, secretWord, issueNumber };
          await env.GAMES_KV.put(`game:${gameId}`, JSON.stringify(config));

          return json(200, { ok: true, game: gameId, config, path: `games/${gameId}/index.html` });
        } catch (err) {
          return json(502, { error: String((err && err.message) || err) });
        }
      }

      if (payload.action === "admin-upsert") {
        const gameId = String(payload.game || "").trim();
        if (!gameId) return json(400, { error: "missing game id" });
        const name = String(payload.name || gameId);
        const secretWord = String(payload.secretWord || "");
        if (!secretWord) return json(400, { error: "secretWord is required" });

        // An explicit issueNumber wins (lets you point at an existing
        // Issue). Otherwise reuse whatever thread this game already has, so
        // re-saving to change the secret word doesn't spawn a new Issue
        // every time. Only a genuinely new game gets one created here.
        let issueNumber = Number(payload.issueNumber) || 0;
        if (!issueNumber) {
          const existing = await loadGame(env, gameId);
          issueNumber = existing ? existing.issueNumber : 0;
        }
        if (!issueNumber) {
          try {
            issueNumber = await ghCreateIssue(env, name);
          } catch (err) {
            return json(502, { error: String((err && err.message) || err) });
          }
        }

        const config = { name, secretWord, issueNumber };
        await env.GAMES_KV.put(`game:${gameId}`, JSON.stringify(config));
        return json(200, { ok: true, game: gameId, config });
      }

      if (payload.action === "admin-remove") {
        const gameId = String(payload.game || "").trim();
        if (!gameId) return json(400, { error: "missing game id" });
        await env.GAMES_KV.delete(`game:${gameId}`);
        return json(200, { ok: true, removed: gameId });
      }

      if (payload.action === "admin-list") {
        const list = await env.GAMES_KV.list({ prefix: "game:" });
        const games = await Promise.all(
          list.keys.map(async (k) => {
            const raw = await env.GAMES_KV.get(k.name);
            const config = raw ? JSON.parse(raw) : {};
            return { game: k.name.slice("game:".length), name: config.name, issueNumber: config.issueNumber };
          })
        );
        return json(200, { games });
      }

      return json(400, { error: "unknown admin action" });
    }

    // ---- per-game actions ----
    const gameId = String(payload.game || "");
    if (!gameId) return json(400, { error: "missing game id" });

    const game = await loadGame(env, gameId);
    if (!game) return json(404, { error: `no chat configured for game "${gameId}"` });

    if (payload.action === "resolve") {
      return json(200, { issueNumber: game.issueNumber });
    }

    if (payload.secret !== game.secretWord) {
      return json(403, { error: "wrong secret word" });
    }

    if (payload.action === "verify") {
      return json(200, { ok: true });
    }

    if (payload.action === "post") {
      const name = String(payload.name || "").trim().slice(0, 40);
      // GitHub caps comment bodies around 65536 chars; stay comfortably
      // under that (room for the "**name says:**" prefix) instead of the
      // old 4000-char cap, which silently truncated anything longer with
      // no warning to the sender.
      const message = String(payload.message || "").trim().slice(0, 60000);
      if (!name || !message) {
        return json(400, { error: "name and message required" });
      }
      const safeName = /^claude$/i.test(name) ? `${name} (visitor)` : name;

      const res = await fetch(
        `https://api.github.com/repos/${env.REPO}/issues/${game.issueNumber}/comments`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "gamecreator-clubhouse-relay",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ body: `**${safeName} says:**\n\n${message}` }),
        }
      );
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          detail = body.message ? ` — ${body.message}` : "";
        } catch {}
        return json(502, {
          error: `github said ${res.status}${detail} [game: ${gameId}] [relay gc-r3]`,
        });
      }
      return json(200, { ok: true });
    }

    return json(400, { error: "unknown action" });
  },
};
