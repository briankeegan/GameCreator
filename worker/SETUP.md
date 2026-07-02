# Clubhouse relay setup — one-time only

This is the *only* Cloudflare dashboard work this project ever needs. After
this, every game's chat is added/updated/removed through `manage-games.sh`
(a plain API call) — no more dashboard visits, no redeploys.

Messages flow: game's clubhouse page → this Worker → GitHub Issue comments
(one Issue per game) → Claude's listener → Claude replies as comments →
page shows the thread.

## 1. Create a GitHub token (the relay's key)

1. https://github.com/settings/personal-access-tokens/new
2. Token name: `gamecreator-clubhouse` · Expiration: 1 year (or custom)
3. Repository access: **Only select repositories** → `briankeegan/GameCreator`
4. Permissions → Repository permissions:
   - **Issues: Read and write**
   - everything else: No access
5. Generate, copy the token (`github_pat_…`).

## 2. Deploy the Worker

You can reuse the existing HayleysGame Cloudflare Worker project (paste this
repo's `worker/worker.js` over its code) or create a fresh one — either is
fine, there just needs to be exactly **one** deployed.

1. https://dash.cloudflare.com → **Workers & Pages** → **Create** (or open
   the existing worker) → **Edit code** → paste in all of `worker/worker.js`
   from this repo → **Deploy**.
2. **Settings → Bindings → Add → KV Namespace**: create a new namespace
   (e.g. `gamecreator-games`), bind it to the variable name **`GAMES_KV`**.
3. **Settings → Variables and Secrets** → add:
   | Name | Type | Value |
   |------|------|-------|
   | `GITHUB_TOKEN` | Secret | the token from step 1 |
   | `ADMIN_TOKEN` | Secret | any long random password — this is what lets `manage-games.sh` add games later without you coming back here |
   | `REPO` | Text | `briankeegan/GameCreator` |
4. Copy the Worker's URL (`https://<name>.<you>.workers.dev`).

## 3. Hand off

Tell Claude the Worker URL and the `ADMIN_TOKEN` you chose. Claude wires
`WORKER_URL` into `shared/clubhouse.js` and uses `manage-games.sh` from then
on to register each game's Issue + secret word — you shouldn't need to open
the Cloudflare dashboard again for routine "add a new game" work.

## Adding a game after setup (no dashboard)

```
export GC_WORKER_URL="https://<name>.<you>.workers.dev"
export GC_ADMIN_TOKEN="<the ADMIN_TOKEN secret>"
./manage-games.sh add sample-clicker "Sample Clicker" pinkunicorn 1
./manage-games.sh list
```

## Notes

- Each game's thread is a GitHub Issue in this repo — create the Issue
  first, then register it with `manage-games.sh add`.
- Threads are technically public (Issue comments on a public repo); the
  secret word only gates *posting*. Fine for game ideas, not for private
  stuff.
- To revoke everything instantly: delete the Worker, or revoke the token at
  https://github.com/settings/personal-access-tokens
