#!/usr/bin/env python3
# staged.py JSONL...: on calm boards, how many matches each player has staged -- a colour one cell apart in a column or a row (A x A:
# one swap from a run of three) and a colour diagonal to a pair's end (one swap from three) -- per 10 panels
import json, sys, collections, statistics as st
def staged(rows):
  n = len(rows); pan = sum(1 for r in rows for v in r if v > 0)
  if pan < 12: return None
  gapV = gapH = diag = 0
  for r in range(n):
    for c in range(6):
      v = rows[r][c]
      if v <= 0: continue
      if r + 2 < n and rows[r + 2][c] == v and rows[r + 1][c] > 0 and rows[r + 1][c] != v: gapV += 1
      if c + 2 < 6 and rows[r][c + 2] == v and rows[r][c + 1] > 0 and rows[r][c + 1] != v: gapH += 1
      for dc in (-1, 1):
        if 0 <= c + dc < 6 and r + 1 < n and rows[r + 1][c + dc] == v: diag += 1
  return 10 * gapV / pan, 10 * gapH / pan, 10 * diag / pan
acc = {True: [], False: []}
for f in sys.argv[1:]:
  for line in open(f):
    j = json.loads(line)
    if j.get('end') or j['garbage']: continue
    s = staged(j['rows'])
    if s: acc[j['me']].append(s)
for me, who in ((True, 'Tanycanayt'), (False, 'Gambit')):
  a = acc[me]
  print('%-11s per 10 panels: A-x-A in a column %.2f, in a row %.2f, same colour on a diagonal %.2f' % (who, st.mean(x[0] for x in a), st.mean(x[1] for x in a), st.mean(x[2] for x in a)))
