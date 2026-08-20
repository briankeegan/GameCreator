# GameCreator — session conventions

## Replies

Keep chat replies SHORT. The owner has asked for this explicitly and more
than once. Answer the question, state the recommendation, stop. No
restating the ask, no summarising work already described in a commit
message, no tables or headed sections unless the answer genuinely needs
structure. Detail belongs in commit messages and code comments, not in
chat.

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
- **Admin bypasses the gate on every game.** A valid `ADMIN_TOKEN` (the
  passkey typed into `admin/`, stored as `localStorage["gc_admin_token"]`)
  works as a universal override for a game's secret word — checked in
  `worker.js`'s shared `verify`/`post`/`upload-image` gate. `clubhouse.js`
  auto-detects that stored token on load and logs straight in as "Admin",
  skipping the name+secret form entirely, on ANY game — no per-game secret
  lookup needed. Falls back to the normal per-game saved login if the
  admin token is missing/stale.
- **Per-game autopilot toggle.** Each game chooses how its Clubhouse
  messages are handled, via an `"autopilot": true` flag on its `games.json`
  entry (absent = off). OFF (default) = manual: a subscribed session handles
  messages like always. ON = the `.github/workflows/clubhouse-autopilot.yml`
  workflow handles them automatically (edits → in-run art generate+review →
  headless smoke test → auto-merged PR → reply). The flag is set at creation
  via the Admin "Create a new game" checkbox (`admin-create-game` writes it),
  and the workflow's `ctx` step reads it (deriving the game id from the PR's
  `clubhouse/<id>` head branch) to decide whether to act — a manual
  `workflow_dispatch` bypasses the flag so you can always test a game.
- **Autopilot has a backstop — don't hand-nurse it.**
  `.github/workflows/clubhouse-sweeper.yml` runs every 15 min and asks the
  only question that matters: does any autopilot thread have a human
  message as its newest comment, older than 45 min? If so it dispatches
  the autopilot for that thread, whatever went wrong upstream. This exists
  because the event path has failure modes it cannot see or report: a job
  that is CANCELLED rather than failed (job timeout, lost runner) skips
  the `failure()` retry step entirely — that's how a Dog Punk message sat
  unanswered with no error and no retry until someone came asking. Two
  bounds keep it from becoming a cost/spam problem: the 45-min grace (a
  healthy run answers in ~12 min, ~45 with one automatic retry's backoff),
  and an 👀 reaction on the comment as a one-time claim marker, so any
  given message is swept AT MOST ONCE, forever. An 👀 on a message in a
  thread therefore means "the backstop caught this one" — worth noticing,
  since it implies the event path failed silently.
- Related: every step in the autopilot that can block on the network has
  its own `timeout-minutes`, and the retry step is gated on
  `failure() || cancelled()`. Keep both properties if you touch that
  workflow — a hung step with no step-level cap turns into a job-level
  cancellation, which is the one shape of failure that reports nothing.
  Corollary: cancelling an autopilot run by hand now re-dispatches it. To
  actually stop a thread, set `"autopilot": false` on that game.
- **Art is generated as SHEETS, never single frames.** This is the most
  expensive lesson in the repo: a sprite generated on its own is drawn from
  scratch, so its colours, proportions and pixel scale don't match the frames
  beside it. Dog Punk shipped a hero whose front view was an orange dog with a
  magenta mohawk and whose side view was a tan dog with a pink beret, and five
  rounds of regenerating single frames never converged — each new frame drifted
  somewhere else, while every reply honestly reported success. Generate ONE
  image holding a whole row (idle, walk, attack) and cut it up; frames drawn
  together cannot drift.
  - Cutter: `.github/art/build_sheet.py` (shared, not per-game). It keys the
    flat background to transparency — ask the generator for FLAT WHITE, never
    transparency, which comes back as a beige wash — cuts frames at gutters or
    as connected blobs (`--blobs` when sprites overlap), scales each row by ONE
    factor so the character can't change size mid-animation, snaps to the
    art-pixel grid, maps every pixel to the game's `lockedPalette`, and lays
    frames on a common foot baseline. `--help` documents the rest.
  - Rules live in `games/<id>/art-style.json`, and the palette in it is
    ENFORCED by the cutter rather than merely described — a game's hero and its
    enemies cannot drift into different colour worlds. New games are scaffolded
    an unfilled one from `games/_template/` (see `TEMPLATE_FILES` in
    `worker.js`); the first art request fills it in.
  - Relative size between characters lives in `--body-height` (how much of the
    cell the character fills), never in per-character draw sizes — every
    sheet-based character is drawn at ONE on-screen cell size so an art pixel
    is the same size for all of them.
  - Raw generations go in `games/<id>/art-src/`; shipped sheets are rebuilt
    from them, never hand-edited.
- **Every rule that matters gets three pieces: RULE -> TOOL -> GATE.** A rule
  written only in prose gets ignored; a checker nobody runs catches nothing; a
  CI failure with no explanation sends whoever hit it digging through a script
  to find out what they did wrong. So:
  1. **Rule** — plain English, stating what and *why*, sitting where someone
     would be editing (the comment above the thing, or the standard doc).
  2. **Tool** — a script that decides it mechanically, runnable by hand.
  3. **Gate** — a `pages.yml` step that runs the tool on every push, so a
     violation fails the build instead of shipping.
  Existing instances: room exits (`EXIT / DOOR CONVENTION` comment ->
  `.github/scripts/check_room_exits.mjs` -> "Verify room exits"), art
  (`.github/art/CHARACTER_SHEETS.md` -> `.github/art/verify_sheet.py` ->
  "Verify shipped sprite sheets" / "Verify character frame sets"), and rooms
  (`docs/ROOM_ART_STANDARD.md` -> `.github/art/room.py verify` -> "Verify room
  props and floor plates"). Add all three
  pieces together or the rule will not hold.
- **New games ship sprite SHEETS. Individual frame files are legacy.** Newsey
  predates the standard and ships nine files per character; that is supported
  and gated, but is not the pattern to copy — a per-file set can lose one
  frame (the character then flickers or freezes), each file trims to its own
  aspect ratio so sprites drift out of proportion with each other, and it
  costs a request per frame. Cutting one image at load makes all three
  impossible. Don't migrate Newsey for its own sake; do start any new game on
  sheets.
- **Checks are game-type dependent, and the type is DETECTED, not
  configured.** Because both layouts exist, the art gate globs for both — so a
  new game is covered the moment it has art, with no per-game config to forget
  to update.
- **A fuzzy check warns; an unambiguous one fails.** Missing or duplicated
  frames are facts, so they fail the build. "This middle frame isn't really a
  neutral pose" is a threshold on an image-difference metric — it prints a
  warning instead, because a borderline-but-correct set must never block a
  deploy. Thresholds get calibrated against real art and the numbers recorded
  next to them: `verify_sheet.py`'s first threshold passed every bad row, its
  second failed a correct one, and the comment above `NEUTRAL_RATIO` lists
  both so the next person doesn't re-derive it.
- **THE ART INDEX IS `.github/art/README.md`. Start there, every time.** One
  page listing every standard, prompt, generator, cutter and check, with a
  "I want to… / read this / run this" table at the top, so nobody has to
  already know what exists. It is checked by
  `.github/scripts/check_art_registry.mjs` on every push, both directions: a
  tool or prompt that isn't listed fails the build, and so does a path listed
  there that doesn't exist. Add a tool, add its row.
- **Standards for this kind of game live in two documents, and they apply to
  every new game of the same shape — not just the one they were written
  from:** `.github/art/CHARACTER_SHEETS.md` (characters: walk frames,
  attack frames, directions, locked details) and `docs/ROOM_ART_STANDARD.md`
  (rooms: framing, emptiness, exits, and how the walkable-floor mask is
  authored). Read them before generating art for a top-down game; extend
  them when a generation exposes a gap, rather than solving it once in one
  game's head.
- **One front door per kind of art, and EVERY caller uses it — including
  auto mode.** `.github/art/generate_row.py` for a character row (walk or
  attack), `.github/art/room.py generate` for one of a room's three passes.
  Each builds the prompt from the canonical prompt file plus the game's
  `art-style.json`, generates into the canonical path the next step reads
  back, and refuses to run on an incomplete prompt; `generate_row.py` also
  verifies and DELETES a row that fails, so it can never be picked up by a
  later build. Both share one transport, `.github/art/imagegen.py`, which
  picks the in-run image broker if one is listening and otherwise
  `OPENAI_API_KEY` — a model is never handed the key. So the same command
  works interactively, in the "Generate walk row" / "Generate room pass"
  Actions (which are buttons on those scripts), and inside the autopilot,
  which cannot dispatch a workflow from inside one. Before this the row recipe
  was inlined in an Action AND restated in the autopilot's prompt, and rooms
  could only PRINT a prompt for someone to carry to a generator by hand.
- **Point at a standard; never copy it.** The Clubhouse autopilot carried its
  own copy of the art rules in its prompt, and it drifted: it was still
  telling runs to generate `[idle, walk, attack]` rows long after the standard
  became `[step, NEUTRAL, step]`, knew nothing about `verify_sheet.py`, and
  had never heard of the room pipeline at all. Its instructions now say
  "read `CHARACTER_SHEETS.md` / `ROOM_ART_STANDARD.md` first" and carry only
  what is specific to running inside that workflow. Anywhere else a rule
  would be restated — a workflow prompt, a game's README — link instead.
- **Character sheets follow one standard: `.github/art/CHARACTER_SHEETS.md`.**
  Walk is 3 columns `[step, NEUTRAL, step]`; ATTACK is its own sheet, also 3
  columns, `[wind-up, STRIKE, recover]`, with damage landing on the strike
  frame — three frames because one lunging pose reads as a shove, and
  because attacks are where weapons vary (swap the sheet, keep the timing).
  Both are 3 rows: down, side-drawn-facing-RIGHT, up. Canonical prompts are
  `.github/art/walkgrid_prompt.txt` and `.github/art/attacksheet_prompt.txt`
  — use them instead of writing a new one, and fix them in place when a
  generation exposes a gap.
- **Details that drift belong in `art-style.json`, not in a prompt you
  retype.** Sleeves vs sleeveless, ears, which hand holds the weapon —
  Beverly's jacket came back sleeved in some frames and sleeveless in
  others, which is what `lockedDetails` now exists to prevent.
- **Top-down games with directional walking follow the RPG-Maker charset
  convention.** This is the convention for that kind of game (the-game /
  Newsey is the reference implementation) — a game with a different camera
  or no walking doesn't need it, but any new top-down one should start
  here rather than inventing its own frame scheme. Three frames per
  character per direction, named `<id>_<dir>_<0|1|2>.png`:
  - **Frame 1 (the MIDDLE one) is a true NEUTRAL pose** — standing still, legs
    together, arms relaxed. It is used BOTH when idle AND as the resting beat
    mid-walk. Frames 0 and 2 are the two mirrored step poses.
  - While moving, playback is **`[1, 0, 1, 2]`** on a loop (middle → step →
    middle → step) — NOT a 0→1→2 cycle. The instant movement stops it snaps
    back to frame 1, so a character never freezes mid-stride. Asking the
    generator for "three different walking poses" produces a set with no
    correct idle frame and is the single most expensive way to get this wrong.
  - **RIGHT is not its own art.** It reuses the LEFT frames mirrored with
    `ctx.scale(-1, 1)` — for the player and every NPC alike. Only down, left
    and up are ever generated. A LEFT row that isn't a true side profile
    therefore breaks both directions at once.
  - Generating a new character's set is ONE dispatch:
    `.github/workflows/generate-walksheet.yml` (game, character id,
    description, optional reference art). It builds the prompt from
    `.github/art/walksheet_prompt.txt` — the single copy of the recipe, edit
    it there — generates the 4x3 sheet, slices it with
    `.github/art/slice_walksheet.py`, checks the full set came out, and
    commits the frames. Wiring the character into the game's facing-frames
    table is still a code change.
  - Background for these sheets is **chroma-key green (#00FF00)** with magenta
    (#FF00FF) gridlines, not white: white anti-aliases into a pale halo the
    slicer can't fully remove. `games/the-game/WALK_SHEETS.md` records why,
    and what else was tried.
- **A room is generated in THREE PASSES.** Do not ask for a room with its
  scenery painted in — that was the old way and everything downstream fought
  it.
  1. **A COMPOSED SCENE**, kept in `art-src/<room>_scene.png` and NEVER
     shipped. It exists to be MEASURED: every prop's ground point, height,
     width and *count* comes off it. Skipping this is what makes a room look
     like objects were sprinkled on a lawn, and it is the only reliable answer
     to sizing — the Anarchy Garden's scene drew all four fountains the same
     height regardless of depth, and eyeballing them smaller with a depth ramp
     on is what made them read as trinkets.
  2. **THE WALKABLE SURFACE and nothing else**, which is the shipped
     background. Because the plate IS the walkable area, the collision mask is
     its own silhouette — the room goes in `FLOOR_PLATE_ROOMS` and there is
     nothing else to declare.
  3. **EVERYTHING YOU CANNOT WALK ON, as props** — walls, water, trees,
     statues — drawn side by side in ONE image on flat white and cut apart by
     `build_props.py`. Plus flat ground cover (`flat: true`), which you *can*
     walk over but which still isn't part of the plate.

  The game places props from `props: [{ art, x, y, h, w, flat, base }]`, sorts
  them against the player by foot position, and blocks the `base` — an ellipse
  `{rx,ry}` for anything round-ish, a rect `{w,h}` for a wall or a pool coping,
  since an ellipse leaves walkable gaps at their corners.
  - Four things this buys, all of which were problems: the walkable-floor mask
    stops being hand-authored entirely (`build_walkmask.py` documents the five
    techniques that failed at recovering a floor from a finished picture), a
    prop can be moved or replaced without regenerating the room, scenery gets
    depth — a painted tree is something you can only ever be fenced away from —
    and the water can be animated, which is impossible while it is paint.
  - **One front door: `.github/art/room.py`** — `prompt` (canned prompts for
    each pass), `plate` (fit the floor plate + rebuild its mask), `props` (cut
    a sheet), `check` (render the overlays), `verify` (the gate, wired into
    `pages.yml`). Every check in `verify` is a bug that shipped, and each was
    proved to fire by breaking a room on purpose.
  - **The shareable write-up is `docs/ROOM_ART_STANDARD.md`** — the rule, why
    it exists, how to prompt each layer, the pipeline commands and a
    checklist, written to be handed to someone who has never seen this repo.
    `games/the-game/art-style.json` carries the same rule in the form the
    image Action reads, so a prompt only has to say WHICH PASS it wants — and
    `room.py prompt scene|plate|props` prints those prompts filled in. The
    Anarchy Garden is the reference room.
  - **`room.py check` renders two pictures and you have to LOOK at them.** The
    assembled room beside the composed scene is the step that finds things:
    a plate that never filled its frame, statues at two thirds size, three
    patches of ground cover where the scene has drifts. Every one of those was
    invisible in the numbers and obvious in one glance at the side-by-side.
  - Ask for flat pure white behind a prop sheet, never transparency (same
    reason as sprite sheets). If a sheet does come back with real alpha,
    `build_props.py` uses it — keying white would eat a white marble statue.
  - **The generator will not draw a technical diagram of its own picture.**
    Tried, for room collision: one prompt asking for a two-panel sheet —
    the finished room on the left, the same room's walkable floor filled
    flat green on black on the right, so the mask would be authored with
    the art and could never drift out of register with it. gpt-image-1
    drew a cropped room in the left panel and left the right one blank
    white. It will draw a sheet of THINGS (a walk cycle, a set of props);
    it will not draw a second, schematic view of a scene it just painted.
    Collision data has to be authored against the art afterwards — which
    is what `.github/art/build_walkmask.py` does.

## Newsey ("the-game") — the plot is the spec

- The game is an adaptation of a plot the owner wrote. `reference/the-game/
  PLOT.md` is a DISTILLATION of it; the VERBATIM plot is the owner's long
  comment on Clubhouse PR #30 (`clubhouse/the-game`). Read the verbatim one
  before deciding what the game should be — the distilled file has lost
  detail that turned out to decide things (it says "the Lounge (bar +
  portals to duels)"; the original says the bar is on the right side and the
  portal doorways are on the left, and that settled which way to mirror the
  room).
- Where the game and the plot disagree, the plot wins unless the owner says
  otherwise. That call has been made once already: the duel portal could not
  move to the bedroom mirror, because the plot reserves that mirror as the
  menu/screen.
- `games/the-game/TODO.md` carries the running list, including the design
  for the duel-as-arena staging and John's mirror scene. Update it when the
  owner adds to the list; don't keep the plan only in chat.

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
  `admin/` (self-service game creation, list, remove, repoint a thread),
  AND now doubles as a universal per-game secret-word override so admin
  can enter any game's Clubhouse without knowing its individual secret
  word (see "Admin bypasses the gate" above). Also dashboard-only.
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
  even execute to show one). The `generate-image.yml`/`generate-game-asset.yml`
  Actions sidestep this entirely by decoding and `git commit`/`git push`-ing
  the PNG from inside the runner, never through these Contents-API tools.
- **Image generation** — two `workflow_dispatch`-only Actions (never run on
  push, so no accidental cost): `.github/workflows/generate-image.yml`
  ("Generate image") and `.github/workflows/generate-game-asset.yml`
  ("Generate game asset"). Both call OpenAI's `/v1/images/generations`
  directly via curl+jq (model `gpt-image-1` — this account's API rejects
  `dall-e-3` + `response_format`; gpt-image-1 always returns `b64_json`
  and uses sizes `1024x1024`/`1024x1536`/`1536x1024`), decode the PNG, and
  commit it via a normal `git commit`/`git push` inside the runner.
  - **Cost / reliability knobs (both Actions):** a `quality` input
    (`low`/`medium`/`high`, **default `medium`**) — high is ~4× the cost of
    medium per image, so only bump it for a showcase asset that needs it. A
    `force` input (**default false**) makes generation **skip if the output
    file already exists**, so re-running a batch after a partial failure
    never re-bills for art you already have — pass `force=true` to
    deliberately regenerate/replace one. Both Actions also retry on OpenAI
    HTTP 429 (the gpt-image per-minute cap — 5/min) and transient 5xx with
    backoff; a rejected request isn't billed, so bulk batches stop failing
    at no extra cost. NOTE: OpenAI's usage dashboard "Images" panel counts
    the legacy image API only — `gpt-image-1` is token-metered, so those
    calls show up as token usage, and the "Images" widget can read 0 even
    while generation is working fine (confirmed: the API rate-limited us,
    which is impossible if it weren't being called).
  - **"Generate image"** is freeform: inputs are just `prompt`,
    `output_path`, `size`. No persisted style — use it for one-off/
    experimental images, for a game that doesn't have an `art-style.json`
    yet, and — importantly — for **anything that is not a room or an in-room
    sprite**: cutscene illustrations and character portraits.
  - **"Generate game asset" applies the room camera to EVERYTHING.** Its
    `art-style.json` says "top-down RPG interior room view", and that wins
    over the prompt even when the prompt says, in capitals, to ignore it.
    Three generations were burned learning this in one sitting: two cutscene
    illustrations of a mirror seen straight-on and a sheet of two portrait
    busts all came back as top-down rooms with a rug on the floor. If what
    you want is not seen from the room camera, use "Generate image".
  - **"Generate game asset"** is for a consistent set: inputs are `game`,
    `asset` (what's different about THIS image), `output_path`, `size`.
    It reads `games/<game>/art-style.json` (fields: `camera`, `style`,
    `palette`, `background`, `constraints`) and combines those with
    `asset` to build the actual prompt sent to OpenAI — so every asset for
    that game shares the same camera angle, rendering style, palette, and
    background without retyping them each time. Fails loudly if that game
    has no `art-style.json` yet (create one first, modeled on
    `games/hypergolic-hull/art-style.json`).
  - Requires the `OPENAI_API_KEY` repo secret (already set).
- Each game is a PWA (`manifest.webmanifest` + `sw.js`) sharing
  `shared/pwa.js`-style plumbing — scaffolded automatically by
  `admin-create-game` from `games/_template/`. Don't hand-create a game's
  files; use Admin's "Create a new game" (or "Add existing game's chat" if
  only its chat config needs restoring, e.g. after an empty/corrupted KV
  entry — that path does NOT re-scaffold files, unlike "Create a new game").
