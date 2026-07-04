// Clubhouse relay — the ONE Cloudflare Worker shared by every game's chat.
//
// Per-game config (secret word + which PR is its thread) lives in a KV
// namespace, not in this file and not in a dashboard "Variable" — so
// adding, renaming, or re-keying a game's chat is a normal authenticated
// API call (see manage-games.sh), never a Worker redeploy or dashboard
// visit. This file only changes if the *behavior* of the relay changes.
//
// Each game's thread is a permanently-open DRAFT PULL REQUEST (never an
// Issue) — its comments are the chat messages. This matters: Claude can
// subscribe to PR activity and get woken up automatically when a new
// message lands, the same way it can't for Issues. See games/<id>/'s
// clubhouse/<id> branch + the "Clubhouse — <name>" PR.
//
// Actions:
//   { action: "resolve", game }                          — public: which PR is this game's thread?
//   { action: "verify",  game, secret }                  — is the secret word right?
//   { action: "post",    game, name, secret, message }    — post a message to the thread
//   { action: "upload-image", game, name, secret, filename, contentBase64 }
//     — commits an image straight into the repo (games/<id>/clubhouse-images/
//       on that game's own clubhouse/<id> branch, which never merges to
//       main) and returns its raw.githubusercontent.com URL. Third-party
//       anonymous image hosts (imgur, catbox) turned out to be unreliable
//       to hit directly from a browser — this avoids that dependency
//       entirely by reusing the same GITHUB_TOKEN the relay already has.
//   { action: "admin-create-game", adminToken, game, name, tagline?, secretWord }
//     — scaffolds games/<id>/ from games/_template/, lists it in games.json,
//       creates its chat PR, and registers it — the whole "add a game" loop
//       in one call. Fails if the game id already exists.
//   { action: "admin-upsert", adminToken, game, name?, secretWord?, prNumber? }
//     — add/update a game's chat config. Any field you omit is left as
//       whatever the game already has (so you can e.g. repoint just
//       prNumber without re-supplying the secret word). Creating a brand
//       new game this way (no existing config) still requires secretWord.
//   { action: "admin-remove",  adminToken, game }         — remove a game's chat config
//   { action: "admin-list",    adminToken }               — list configured games (secrets redacted)
//
// A valid ADMIN_TOKEN also works as a universal override for the per-game
// `secret` check on "verify"/"post"/"upload-image" below — so whoever is
// logged into admin/ can jump into any game's Clubhouse without looking up
// (or being told) that game's individual secret word.
//
// Required bindings (Worker → Settings → Variables and Secrets / Bindings):
//   GAMES_KV      (KV namespace binding) — per-game config, written via admin-upsert
//   GITHUB_TOKEN  (secret)  — fine-grained PAT on REPO with:
//                               Contents: Read and write
//                               Pull requests: Read and write
//                               Issues: Read and write (legacy threads, comment posting)
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

async function ghGetFile(env, path, ref) {
  const url =
    `https://api.github.com/repos/${env.REPO}/contents/${path}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : "");
  const res = await fetch(url, { headers: GITHUB_HEADERS(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`couldn't read ${path}: ${res.status}`);
  return res.json();
}

// Takes already-base64 content directly (no UTF-8 re-encoding) so binary
// files — images — survive intact. ghPutFile (text files) is just this
// with a UTF-8-encode step in front of it.
async function ghPutFileBase64(env, path, base64Content, message, branch, sha) {
  const body = { message, content: base64Content, branch };
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

async function ghPutFile(env, path, content, message, branch, sha) {
  return ghPutFileBase64(env, path, utf8ToBase64(content), message, branch, sha);
}

async function ghGetDefaultBranchSha(env) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/git/ref/heads/main`, {
    headers: GITHUB_HEADERS(env),
  });
  if (!res.ok) throw new Error(`couldn't read main branch: ${res.status}`);
  const data = await res.json();
  return data.object.sha;
}

async function ghCreatePR(env, branch, title, body) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/pulls`, {
    method: "POST",
    headers: GITHUB_HEADERS(env),
    body: JSON.stringify({ title, head: branch, base: "main", body, draft: true }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const b = await res.json();
      detail = b.message ? ` — ${b.message}` : "";
    } catch {}
    throw new Error(`couldn't open the chat PR: ${res.status}${detail}`);
  }
  const data = await res.json();
  return data.number;
}

// A game's chat thread is a standing draft PR: a dedicated branch with one
// placeholder file, opened as a PR against main and never merged. Unlike an
// Issue, Claude can subscribe to PR activity, so new messages actually wake
// it up instead of silently sitting unread until someone mentions them.
async function ghCreateClubhousePR(env, gameId, name) {
  const sha = await ghGetDefaultBranchSha(env);
  const branch = `clubhouse/${gameId}`;

  const refRes = await fetch(`https://api.github.com/repos/${env.REPO}/git/refs`, {
    method: "POST",
    headers: GITHUB_HEADERS(env),
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!refRes.ok && refRes.status !== 422) {
    // 422 = branch already exists — fine, reuse it.
    let detail = "";
    try {
      const b = await refRes.json();
      detail = b.message ? ` — ${b.message}` : "";
    } catch {}
    throw new Error(`couldn't create branch ${branch}: ${refRes.status}${detail}`);
  }

  const path = `games/${gameId}/CLUBHOUSE.md`;
  const existing = await ghGetFile(env, path, branch);
  const fileBody =
    `This branch/PR IS the chat thread for "${name}" — its comments are the messages, ` +
    `relayed through the shared Worker.\n\nKeep this PR open (draft, never merge) — it's infrastructure, not a real change.\n`;
  await ghPutFile(env, path, fileBody, `Clubhouse thread for ${name}`, branch, existing ? existing.sha : undefined);

  return ghCreatePR(
    env,
    branch,
    `Clubhouse — ${name}`,
    `This PR IS the chat thread for "${name}" — its comments are the messages, relayed through the shared Worker.\n\nDraft, never merge — keep it open, it's infrastructure, not a real change.`
  );
}

const TEMPLATE_FILES = ["index.html", "style.css", "app.js", "manifest.webmanifest", "sw.js", "icons/icon.svg"];

// Chat image attachments land here, never touching main directly.
function safeImageFilename(name) {
  const base = String(name || "image")
    .split(/[\\/]/)
    .pop()
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(-80);
  return base || "image";
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "POST") {
      return json(200, {
        relay: "gc-r7",
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
            await ghPutFile(env, `games/${gameId}/${file}`, text, `Create game: ${name}`, "main");
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
            "main",
            registry ? registry.sha : undefined
          );

          const prNumber = await ghCreateClubhousePR(env, gameId, name);
          const config = { name, secretWord, prNumber };
          await env.GAMES_KV.put(`game:${gameId}`, JSON.stringify(config));

          return json(200, { ok: true, game: gameId, config, path: `games/${gameId}/index.html` });
        } catch (err) {
          return json(502, { error: String((err && err.message) || err) });
        }
      }

      if (payload.action === "admin-upsert") {
        const gameId = String(payload.game || "").trim();
        if (!gameId) return json(400, { error: "missing game id" });
        const existing = await loadGame(env, gameId);

        const name = String(payload.name || (existing && existing.name) || gameId);
        const secretWord = String(payload.secretWord || (existing && existing.secretWord) || "");
        if (!secretWord) return json(400, { error: "secretWord is required" });

        // An explicit prNumber wins (lets you repoint at a different PR).
        // Otherwise reuse whatever thread this game already has, so
        // re-saving to change the secret word doesn't spawn a new PR every
        // time. Only a genuinely new game gets one created here.
        let prNumber = Number(payload.prNumber) || 0;
        if (!prNumber) prNumber = existing ? existing.prNumber : 0;
        if (!prNumber) {
          try {
            prNumber = await ghCreateClubhousePR(env, gameId, name);
          } catch (err) {
            return json(502, { error: String((err && err.message) || err) });
          }
        }

        const config = { name, secretWord, prNumber };
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
            return { game: k.name.slice("game:".length), name: config.name, prNumber: config.prNumber };
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
      return json(200, { prNumber: game.prNumber });
    }

    // A valid ADMIN_TOKEN sent as `secret` counts as the right word for
    // EVERY game — lets whoever's logged into admin/ jump straight into
    // any game's Clubhouse without knowing (or looking up) its individual
    // secret word.
    const isAdminSecret = Boolean(env.ADMIN_TOKEN) && payload.secret === env.ADMIN_TOKEN;
    if (!isAdminSecret && payload.secret !== game.secretWord) {
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

      // The comments API is shared between Issues and PRs — posting to
      // /issues/{n}/comments works whether {n} is an Issue or a PR number.
      const res = await fetch(
        `https://api.github.com/repos/${env.REPO}/issues/${game.prNumber}/comments`,
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
          error: `github said ${res.status}${detail} [game: ${gameId}] [relay gc-r7]`,
        });
      }
      return json(200, { ok: true });
    }

    if (payload.action === "upload-image") {
      const contentBase64 = String(payload.contentBase64 || "").replace(/\s/g, "");
      if (!contentBase64) return json(400, { error: "no image data" });
      // Base64 grows content ~4/3 — cap comfortably under the Contents
      // API's ~1MB-per-file ceiling so uploads fail fast with a clear
      // reason instead of a confusing GitHub error.
      if (contentBase64.length > 1_400_000) {
        return json(413, { error: "image is too big (max ~1MB) — try a smaller one or crop it" });
      }
      const filename = safeImageFilename(payload.filename);
      const path = `games/${gameId}/clubhouse-images/${Date.now()}-${filename}`;
      const branch = `clubhouse/${gameId}`;
      try {
        await ghPutFileBase64(env, path, contentBase64, `Chat image from ${payload.name || "visitor"}`, branch);
      } catch (err) {
        return json(502, { error: String((err && err.message) || err) });
      }
      return json(200, { ok: true, url: `https://raw.githubusercontent.com/${env.REPO}/${branch}/${path}` });
    }

    // Temporary diagnostic: echo back exactly what was received instead of
    // just "unknown action", so a mismatch (wrong action string, missing
    // field, etc.) is visible without needing browser devtools.
    return json(400, {
      error: "unknown action",
      gotAction: payload.action,
      gotActionType: typeof payload.action,
      payloadKeys: Object.keys(payload),
    });
  },
};
