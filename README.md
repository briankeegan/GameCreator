# GameCreator

A multi-game arcade. One landing page lists every game; each game lives at
its own URL, is independently installable (Android + iOS "Add to Home
Screen"), and gets its own private chat thread with Claude for feedback —
all from a shared, reusable layer so a new game only needs its own gameplay
code.

## Layout

```
index.html, style.css, app.js   — the landing page (reads games.json)
games.json                      — public registry: one entry per game, shown on the landing page
shared/                         — the reusable layer every game plugs into, unmodified
  storage.js                    — namespaced localStorage (per-game save data)
  nav.js, nav.css                — "All Games" bar + chat button, injected into every game
  pwa.js                        — install banner (iOS instructions / Android install prompt)
  sw-core.js                    — offline-caching logic every game's own sw.js calls into
  clubhouse.html                 — the shared chat page (?game=<id> picks the thread)
games/
  _template/                    — copy this to start a new game
  sample-clicker/                — a tiny working demo, proves the whole scaffold end to end
admin/                           — game/chat management UI (passkey-gated, talks to the Worker)
worker/
  worker.js, wrangler.jsonc      — the one shared Cloudflare Worker that relays chat messages
  manage-games.sh                — CLI alternative to the admin page
  SETUP.md                       — one-time setup (only needs doing once, ever)
```

## Adding a new game (the whole checklist)

1. `cp -r games/_template games/<your-game-id>`
2. Edit `games/<your-game-id>/index.html`, `style.css`, `app.js` — build the game.
   Use `window.GCStorage.get(gameId, key, fallback)` / `.set(...)` to save
   progress; it's namespaced automatically so games never collide, and the
   value can be anything JSON-serializable (a number, or a big nested object
   — whatever the game needs).
3. Update `games/<your-game-id>/manifest.webmanifest` (name, colors) and
   swap in your own `icons/icon.svg` (see that folder's README for why it's
   SVG instead of PNG, and how to use real PNGs instead if you want them).
4. Add one entry to root `games.json` (id, name, tagline, icon path). That's
   what makes it show up on the landing page.

Steps 1-4 above are also fully automated: open the **Admin** page on the
live site (linked from the landing page) and use **"Create a new game"** —
fill in a game id, display name, and secret word, and it scaffolds
`games/<id>/` from the template, adds it to `games.json`, and creates its
chat thread, all in one submit. No manual copying, no files to edit until
you're ready to build the actual gameplay in that game's `app.js`.

## Why one shared Worker

Every game's chat relays through the same Cloudflare Worker. The Worker
looks up each game's secret word and GitHub Issue number in a small KV
store, keyed by game id — so adding, renaming, or re-keying a game's chat is
a single authenticated API call (the admin page, or `manage-games.sh`), not
a Worker code change. The Worker itself only needs deploying once, ever
(see `worker/SETUP.md`).
