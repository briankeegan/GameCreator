#!/usr/bin/env bash
# The checker's own test: it must REJECT the defect it exists for, and ACCEPT
# the awkward-but-correct case. Runs against a throwaway repo beside this
# file, so it never touches the real one and takes about a second.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$HERE/check_sw_version.mjs"
WORK="$HERE/.check_sw_version.work"
rm -rf "$WORK"; mkdir -p "$WORK/games/toy"
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
git init -q .; git config user.email t@t; git config user.name t
cat > games/toy/sw.js <<'SW'
GCRegisterServiceWorker("toy-v1", ["./", "./index.html", "./app.js"]);
SW
echo "one" > games/toy/app.js
echo "<html></html>" > games/toy/index.html
git add -A; git commit -qm base
BASE=$(git rev-parse HEAD)

fail=0
run() { GC_BASE_REF="$BASE" node "$CHECK" >"$WORK/out.txt" 2>&1; echo $?; }

# 1. THE DEFECT: a precached file changes, the version does not.
echo "two" > games/toy/app.js; git commit -qam "changed app.js"
if [ "$(run)" = "0" ]; then echo "NOT CAUGHT: stale version passed"; cat "$WORK/out.txt"; fail=1
else echo "ok  rejects a shipped change under an unchanged worker version"; fi

# 2. THE FIX: the version moves with it.
sed -i 's/toy-v1/toy-v2/' games/toy/sw.js; git commit -qam "bumped"
if [ "$(run)" = "0" ]; then echo "ok  accepts it once the version moves"
else echo "FALSE ALARM: a correct bump was rejected"; cat "$WORK/out.txt"; fail=1; fi

# 3. THE AWKWARD CASE: a file the worker does NOT precache changes alone.
#    Art, a README, a test — none of it is pinned by the cache, so demanding
#    a bump for it would train everyone to bump it for nothing.
echo "x" > games/toy/notes.md; git add -A; git commit -qm "unrelated file"
if [ "$(run)" = "0" ]; then echo "ok  silent for a file the worker never caches"
else echo "FALSE ALARM: unprecached file demanded a bump"; cat "$WORK/out.txt"; fail=1; fi

[ "$fail" = "0" ] && echo "check_sw_version.test.sh: passed"
exit "$fail"
