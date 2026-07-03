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
//   { action: "admin-upsert", adminToken, game, name, secretWord, issueNumber } — add/update a game
//   { action: "admin-remove",  adminToken, game }         — remove a game
//   { action: "admin-list",    adminToken }               — list configured games (secrets redacted)
//
// Required bindings (Worker → Settings → Variables and Secrets / Bindings):
//   GAMES_KV      (KV namespace binding) — per-game config, written via admin-upsert
//   GITHUB_TOKEN  (secret)  — fine-grained PAT, Issues: Read/write on REPO
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json(200, {
        relay: "gc-r1",
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

      if (payload.action === "admin-upsert") {
        const gameId = String(payload.game || "").trim();
        if (!gameId) return json(400, { error: "missing game id" });
        const config = {
          name: String(payload.name || gameId),
          secretWord: String(payload.secretWord || ""),
          issueNumber: Number(payload.issueNumber),
        };
        if (!config.secretWord || !config.issueNumber) {
          return json(400, { error: "secretWord and issueNumber are required" });
        }
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
      const message = String(payload.message || "").trim().slice(0, 4000);
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
          error: `github said ${res.status}${detail} [game: ${gameId}] [relay gc-r1]`,
        });
      }
      return json(200, { ok: true });
    }

    return json(400, { error: "unknown action" });
  },
};
