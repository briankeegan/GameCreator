#!/usr/bin/env bash
# Is what's on main actually what the live site is serving?
#
#     .github/scripts/check_deployed.sh [<git-ref>] [<path> ...]
#     .github/scripts/check_deployed.sh                 # every game's art + code
#     .github/scripts/check_deployed.sh HEAD games/dog-punk/hero_sheet.png
#
# WHY. "Did it deploy?" was answered for a long time by looking at whether the
# Pages workflow went green. That is not the same question, and the difference
# cost hours: a run reported success, the deploy went green, and the person
# looking at the game saw no change at all — because the deploy had genuinely
# shipped a file that was itself unchanged. Green means the machinery ran. It
# says nothing about whether the bytes a player downloads are the bytes on
# main.
#
# This asks the only question that matters: fetch the file from the live site,
# hash it, compare it to the ref. No inference, no workflow status.
#
# (It was also believed that this sandbox could not reach *.github.io — it
# can, and had it been tried once, none of the above would have happened.
# Try the direct check before reasoning about an indirect one.)
set -uo pipefail

SITE="${GC_SITE:-https://briankeegan.github.io/GameCreator}"
REF="${1:-origin/main}"; shift || true

if [ "$#" -gt 0 ]; then
  paths=("$@")
else
  mapfile -t paths < <(git ls-tree -r --name-only "$REF" \
    | grep -E '^(games/[^/]+/(.*\.(png|js|json|html|css))|shared/.*\.(js|css)|index.html|app.js|games\.json)$' \
    | grep -v '/art-src/' | grep -v '/clubhouse-images/')
fi

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
stale=0; checked=0; missing=0
for p in "${paths[@]}"; do
  git cat-file -e "$REF:$p" 2>/dev/null || continue
  want=$(git show "$REF:$p" | md5sum | cut -d' ' -f1)
  code=$(curl -sS --max-time 30 -o "$tmp/f" -w '%{http_code}' "$SITE/$p" 2>/dev/null)
  checked=$((checked + 1))
  if [ "$code" != "200" ]; then
    printf 'MISSING  %s (HTTP %s)\n' "$p" "$code"; missing=$((missing + 1)); continue
  fi
  got=$(md5sum "$tmp/f" | cut -d' ' -f1)
  if [ "$got" != "$want" ]; then
    printf 'STALE    %s\n           live %s\n           %s %s\n' "$p" "$got" "$REF" "$want"
    stale=$((stale + 1))
  fi
done

echo
echo "checked $checked file(s) against $SITE"
if [ "$stale" = 0 ] && [ "$missing" = 0 ]; then
  echo "the live site matches $REF"
  exit 0
fi
echo "$stale stale, $missing missing — the live site is NOT serving $REF."
echo "A Pages run going green does not mean this passes; this is the check that counts."
exit 1
