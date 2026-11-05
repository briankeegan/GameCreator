#!/usr/bin/env python3
# boardstats.py JSONL...: how two players organise their stacks, from boardSample.lua's samples (calm boards: no garbage on them)
import json, sys, collections, statistics as st
def stats(rows):
  R = [r for r in rows if any(v > 0 for v in r)]
  H = [0] * 6
  for c in range(6):
    for r in range(len(rows)):
      if rows[r][c] != 0: H[c] = r + 1
  pan = [(r, c, rows[r][c]) for r in range(len(rows)) for c in range(6) if rows[r][c] > 0]
  if len(pan) < 12: return None
  vs = vt = hs = ht = 0
  for r in range(len(rows)):
    for c in range(6):
      v = rows[r][c]
      if v <= 0: continue
      if r + 1 < len(rows) and rows[r + 1][c] > 0: vt += 1; vs += rows[r + 1][c] == v
      if c + 1 < 6 and rows[r][c + 1] > 0: ht += 1; hs += rows[r][c + 1] == v
  # column purity: the share of each column's panels its commonest colour holds
  pur = []
  for c in range(6):
    col = [rows[r][c] for r in range(len(rows)) if rows[r][c] > 0]
    if len(col) >= 3: pur.append(collections.Counter(col).most_common(1)[0][1] / len(col))
  # each colour's mean column (0..5)
  mc = {}
  for k in set(p[2] for p in pan):
    cs = [p[1] for p in pan if p[2] == k]
    if len(cs) >= 3: mc[k] = sum(cs) / len(cs)
  # distinct colours per row, per full row
  dist = [len(set(v for v in r if v > 0)) for r in rows if sum(1 for v in r if v > 0) == 6]
  return dict(vert=vs / max(vt, 1), horiz=hs / max(ht, 1), purity=st.mean(pur) if pur else None, height=st.mean(H),
              bump=sum(abs(H[i] - H[i + 1]) for i in range(5)), panels=len(pan), mc=mc, rowcolours=st.mean(dist) if dist else None)
acc = {True: collections.defaultdict(list), False: collections.defaultdict(list)}
sides = {True: [], False: []}; combos = {True: collections.Counter(), False: collections.Counter()}; frames = {True: 0, False: 0}
for f in sys.argv[1:]:
  per = {True: collections.defaultdict(list), False: collections.defaultdict(list)}
  for line in open(f):
    j = json.loads(line); me = j['me']
    if j.get('end'):
      frames[me] += j['frames']
      for k, v in (j['combos'] or {}).items(): combos[me][int(k)] += v
      continue
    if j['garbage']: continue
    s = stats(j['rows'])
    if not s: continue
    for k in ('vert', 'horiz', 'purity', 'height', 'bump', 'panels', 'rowcolours'):
      if s[k] is not None: acc[me][k].append(s[k])
    for k, v in s['mc'].items(): per[me][k].append(v)
  # a colour's place: how far its mean column sits from the middle, and how much it moves, over the game
  for me in (True, False):
    for k, vs in per[me].items():
      if len(vs) >= 10: sides[me].append((abs(st.mean(vs) - 2.5), st.pstdev(vs)))
for me, who in ((True, 'Tanycanayt'), (False, 'Gambit')):
  a = acc[me]; mins = frames[me] / 3600
  big = sum(v for k, v in combos[me].items() if k >= 8); mid = sum(v for k, v in combos[me].items() if 5 <= k <= 7)
  print('%-11s calm boards %5d | same colour above %.0f%%, beside %.0f%% | column purity %.0f%% | colours in a full row %.2f | height %.1f, bumpiness %.1f, panels %.0f | a colour off the middle by %.2f columns, wandering %.2f | combos 8+ %.2f a minute, 5-7 %.2f' % (
    who, len(a['vert']), 100 * st.mean(a['vert']), 100 * st.mean(a['horiz']), 100 * st.mean(a['purity']), st.mean(a['rowcolours']), st.mean(a['height']), st.mean(a['bump']), st.mean(a['panels']),
    st.mean(x[0] for x in sides[me]), st.mean(x[1] for x in sides[me]), big / mins, mid / mins))
