# GameCreator — session conventions

A multi-game static site (no build system), deployed to
briankeegan.github.io/GameCreator/. Landing page lists every game from
`games.json`; each game lives at `games/<id>/`, is independently
installable as a PWA, and has its own private "Clubhouse" chat thread for
design discussion. `shared/` holds the components every game reuses
(Clubhouse UI, storage, nav, PWA plumbing) — don't fork it per-game.

## The Clubhouse (design-request pipeline)

- Each game's chat thread is a **permanently-open draft PR**, never a
  GitHub Issue. Issues can't be subscribed to — nothing wakes a session up
  when a new Issue comment lands. PRs can (`subscribe_pr_activity`), which
  is the entire point of using them here. Never merge or close these PRs.
- Thread naming: branch `clubhouse/<gameId>`, one placeholder file
  `games/<gameId>/CLUBHOUSE.md`, PR titled `Clubhouse — <name>`.
- Messages are PR comments starting with `**<name> says:**`. The
  Clubhouse page (`shared/clubhouse.js`) parses that marker; a name of
  "claude" (case-insensitive) renders as Claude's side of the chat. Reply
  the same way: post a comment starting with `**Claude says:**`.
- **A fresh session is not automatically subscribed to anything.**
  Subscription (`subscribe_pr_activity`) is per-session and does not
  persist across a cleared/new conversation. At the start of a session
  working on this repo, call `admin-list` via the Worker (or check
  `games.json` + open PRs) to find every game's current PR number, and
  subscribe to each one so new messages actually reach you instead of
  requiring the user to come explain what happened.
- As of this writing, active threads: `sample-clicker` → PR #7,
  `hypergolic-hull` → PR #8. Don't trust this list once it's stale — always
  re-check `admin-list` / open PRs, since games get added and threads get
  repointed via Admin's "Fix link" / "Add existing game's chat".
- Chat image attachments are committed straight into the repo (`games/<id>/
  clubhouse-images/` on that game's own `clubhouse/<id>` branch, never
  `main`) via the relay's `upload-image` action, then referenced by their
  `raw.githubusercontent.com` URL. Third-party anonymous hosts (imgur,
  catbox.moe) were tried first and both proved unreliable to hit directly
  from a browser — imgur's signup flow was broken, catbox.moe's endpoint
  returned raw XML errors (likely Cloudflare bot protection) instead of
  its documented plain-text response.
- Same convention as HayleysGame: every Claude reply ends with a version
  stamp on its own line, `[v0.<run_number>]`, where `<run_number>` is the
  `run_number` of the latest successful "Deploy static site to Pages" run
  (`pages.yml`) at reply time. Since that workflow only triggers on push to
  `main`, the stamp tells the reader whether the reply is describing code
  that's actually live yet, without them having to ask. Look it up with
  `actions_list` / `list_workflow_runs` on `pages.yml`, not by guessing.

## Handling a clubhouse request

1. If it's a clear game-design ask: implement it in the relevant
   `games/<id>/` files, push to `main` (Pages deploys only from `main`,
   nothing else — see below), and reply on the PR confirming what shipped.
2. If it touches the shared relay's behavior (worker.js), it now
   auto-deploys on push — see below — but still verify via the `relay`
   marker before claiming a change is live, since Cloudflare builds can
   fail or lag behind the push.
3. If the request is ambiguous or architecturally significant, ask before
   building — this project has been explicitly steered away from
   speculative "mechanisms" for hypothetical edge cases. Fix what's asked,
   pragmatically, and move on.

## Infrastructure notes

- **Relay:** one shared Cloudflare Worker (`worker/worker.js`) used by
  every game's Clubhouse and by the Admin page — not one Worker per game.
  Per-game config (secret word + PR number) lives in a KV namespace
  (`GAMES_KV`, key `game:<id>`), not in the Worker file.
- **The Worker auto-deploys from git pushes** via Cloudflare's own Git
  integration (Workers & Pages → game-creator → Settings → Build), not a
  GitHub Actions workflow — configured with deploy command
  `npx wrangler deploy` against `wrangler.jsonc` at the repo root. A push
  to `main` that touches `worker/worker.js` deploys automatically; no
  manual dashboard paste needed anymore. `wrangler.jsonc` declares the
  `REPO` var and the `GAMES_KV` namespace binding — both get wiped/reset
  on deploy if omitted from that file, so don't remove them. Secrets
  (`GITHUB_TOKEN`, `ADMIN_TOKEN`) stay dashboard-only and are NOT in
  `wrangler.jsonc` — they survive deploys as long as the file doesn't
  redeclare them. The Worker's non-POST response includes a
  `relay: "gc-rN"` version marker — bump it whenever behavior changes, so
  a stale deploy is visible without needing network access to
  `*.workers.dev` (which cloud sandboxes here can't reach) or the
  Cloudflare dashboard.
  - **History:** this Worker's Git connection was found pointed at the
    wrong repo (`briankeegan/HayleysGame`) for an unknown period. Every
    time HayleysGame's repo changed, Cloudflare silently redeployed
    *HayleysGame's* worker code onto this `game-creator` Worker, wiping
    out whatever had been manually pasted here. That's why chat messages
    kept working (HayleysGame's worker has similar post/verify actions)
    while image uploads always failed with "unknown action" no matter how
    many times worker.js got manually redeployed — HayleysGame's worker
    has no such action at all. Fixed by reconnecting Git to the right
    repo and adding `wrangler.jsonc` here. If a relay-behavior change ever
    seems to silently not take effect again, check the Git connection
    (Workers & Pages → game-creator → Settings → Build) before assuming
    the code itself is wrong.
- **GitHub Pages deploys only on push to `main`** (`.github/workflows/pages.yml`,
  `on: push: branches: ["main"]`). It was rewritten to upload with
  `overwrite: true` so re-running it after a prior attempt doesn't collide
  with "Multiple artifacts named github-pages" — don't manually re-trigger
  runs via the Actions API; push a commit and let it run fresh instead.
- **GITHUB_TOKEN** (Worker secret) is a fine-grained PAT on this repo with
  Contents: Read/write, Pull requests: Read/write, Issues: Read/write.
  Needed for scaffolding game files, creating/writing the Clubhouse
  branch+PR, and posting chat comments. Never ask for or store this token
  in the repo — it lives only in the Worker's dashboard secrets.
- **ADMIN_TOKEN** (Worker secret) gates the `admin-*` actions used by
  `admin/` (self-service game creation, list, remove, repoint a thread).
  Also dashboard-only.
- Cloud sandboxes here usually can't reach `*.workers.dev`, `*.github.io`,
  or `api.cloudflare.com` directly — verify Worker/Pages changes via the
  GitHub API (commits, Actions run status, file contents) or ask the owner
  to check, rather than assuming a fetch failure means something's broken.
- Binary files (PNG) don't survive the Contents API reliably through these
  tools — base64 content has come back stored as literal text, not decoded.
  Use SVG for any new icons/images. This applies to `create_or_update_file`-
  style tools too: pass PLAIN TEXT content, never pre-base64-encode it
  yourself — the tool encodes internally, so pre-encoding double-encodes
  and silently corrupts the file (confirmed the hard way: it broke the
  live Clubhouse page with no error, since the corrupted script couldn't
  even execute to show one).
- Each game is a PWA (`manifest.webmanifest` + `sw.js`) sharing
  `shared/pwa.js`-style plumbing — scaffolded automatically by
  `admin-create-game` from `games/_template/`. Don't hand-create a game's
  files; use Admin's "Create a new game" (or "Add existing game's chat" if
  only its chat config needs restoring, e.g. after an empty/corrupted KV
  entry — that path does NOT re-scaffold files, unlike "Create a new game").
