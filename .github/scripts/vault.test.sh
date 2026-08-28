#!/usr/bin/env bash
# GATE for .github/art/vault.py — the safety net that stops a paid-for
# generation being lost.
#
# WHY THIS EXISTS. vault.py is built never to fail its caller: losing the net
# must not also lose the art it is protecting. That is the right behaviour and
# it makes the vault the one tool in the pipeline whose failure is INVISIBLE.
# It duly failed invisibly on its very first run — the worktree was created
# under .git/, which git refuses outright — and the run reported success,
# generated a portrait, and left no vault branch at all. Nobody would have
# noticed until the next time something was lost, which is exactly when the
# vault is supposed to be there.
#
# So a round-trip is PROVED on every push, against a throwaway repo with a
# throwaway remote: save a file, delete it, restore it, compare bytes.
#
# Run by hand:  bash .github/scripts/vault.test.sh
set -euo pipefail

VAULT="$(cd "$(dirname "$0")/../art" && pwd)/vault.py"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git init -q --bare -b main "$tmp/remote.git"
git init -q -b main "$tmp/work"
cd "$tmp/work"
git remote add origin "$tmp/remote.git"
git config user.email t@example.com
git config user.name test

# vault.py locates the repo root two levels above itself, so the tools have to
# sit where they sit in the real repo.
mkdir -p .github/art games/g/art-src
cp "$VAULT" .github/art/vault.py
echo seed > README.md
git add -A && git commit -qm seed && git push -q origin HEAD:main

raw=games/g/art-src/hero_portrait_raw.png
printf 'PRETEND-PNG-%s' "$RANDOM$RANDOM" > "$raw"
before="$(cat "$raw")"

python3 .github/art/vault.py save "$raw" | tee "$tmp/save.log"
grep -q '^save: ok$' "$tmp/save.log" || { echo "FAIL: save did not report ok"; exit 1; }

git fetch -q origin art-vault || { echo "FAIL: no art-vault branch was created"; exit 1; }

# THE ACTUAL QUESTION: with the file gone, does it come back?
rm -f "$raw"
python3 .github/art/vault.py restore "$raw" | tee "$tmp/restore.log"
grep -q '^restore: ok$' "$tmp/restore.log" || { echo "FAIL: restore did not report ok"; exit 1; }
[ -s "$raw" ] || { echo "FAIL: restore reported ok but wrote nothing"; exit 1; }
[ "$(cat "$raw")" = "$before" ] || { echo "FAIL: restored bytes differ from what was saved"; exit 1; }

# A restore that finds nothing must say so and exit 0 — a vault MISS is normal
# (nothing saved yet) and must never stop art being made.
python3 .github/art/vault.py restore games/g/art-src/nobody_raw.png > "$tmp/miss.log"
grep -q '^restore: no$' "$tmp/miss.log" || { echo "FAIL: a vault miss should report 'no'"; exit 1; }

# And the restore must leave nothing staged: it hands back a FILE, not a change
# waiting to be committed by whatever job called it.
[ -z "$(git diff --cached --name-only)" ] || { echo "FAIL: restore left files staged"; exit 1; }

# THE SHAPE CI ACTUALLY USES. actions/checkout@v4 clones with fetch-depth 1,
# and a shallow clone is exactly the sort of difference that lets a tool pass
# every test on a developer machine and do nothing on a runner. Tested, because
# that is precisely the failure this whole file exists because of.
cd "$tmp"
# --single-branch as well as --depth 1: actions/checkout configures a restricted
# refspec, and that — not the shallowness — is what actually broke the vault in
# CI. `git fetch origin art-vault` then updates FETCH_HEAD and NOT
# refs/remotes/origin/art-vault, so every save concluded the branch did not
# exist and pushed a fresh orphan at a branch that did. Reproduce the runner.
git clone -q --depth 1 --single-branch --branch main "file://$tmp/remote.git" "$tmp/shallow"
cd "$tmp/shallow"
git config user.email t@example.com
git config user.name test
[ "$(git rev-parse --is-shallow-repository)" = "true" ] || { echo "FAIL: test setup is not shallow"; exit 1; }
mkdir -p games/g/art-src
printf 'SHALLOW-PNG' > games/g/art-src/shallow_raw.png
python3 .github/art/vault.py save games/g/art-src/shallow_raw.png > "$tmp/shallow.log" 2>&1 || true
grep -q '^save: ok$' "$tmp/shallow.log" || { echo "FAIL: save does not work from a shallow clone (the CI case)"; cat "$tmp/shallow.log"; exit 1; }
rm -f games/g/art-src/shallow_raw.png
python3 .github/art/vault.py restore games/g/art-src/shallow_raw.png > /dev/null
[ "$(cat games/g/art-src/shallow_raw.png)" = "SHALLOW-PNG" ] || { echo "FAIL: shallow restore lost bytes"; exit 1; }

# `holds` is what a real generating job calls to prove the net engaged, so it
# has to answer both ways: yes for something saved, and NON-ZERO for something
# that is not there. A holds that always passes is worse than no holds.
python3 .github/art/vault.py holds games/g/art-src/shallow_raw.png > /dev/null || { echo "FAIL: holds says no to a file that is in the vault"; exit 1; }
if python3 .github/art/vault.py holds games/g/art-src/never_saved.png > /dev/null 2>&1; then
  echo "FAIL: holds exited 0 for a file that is NOT in the vault"; exit 1
fi

echo "vault round-trip OK (save, restore, byte-identical, miss handled, nothing staged, shallow clone, holds both ways)"
