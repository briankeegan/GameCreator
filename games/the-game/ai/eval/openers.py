#!/usr/bin/env python3
# HOW A PLAYER OPENS: the first garbage landed and the cells landed by 10, 20, 30 and 45 s, median over games.
#   python3 openers.py arch LABEL JSONL...   attackState.lua's lines, one file a game (a player's attacks: a combo lands 151 frames
#                                            after it is made, a chain 66 a link more once it ends)
#   python3 openers.py live LABEL JSON...    the stats page's replays (panel-game gh-pages data/replay_rN.json, ungzipped): our pieces
#                                            read off the opponent's garbage queue, each at the frame it is due to land
import json,re,statistics as st,sys
COMBO={4:3,5:4,6:5,7:6,8:7,9:8,10:10,11:11,12:12,13:18}
T=[600,1200,1800,2700]   # 10, 20, 30, 45 s
def arch(files):
  rows=[]
  for f in files:
    L=[json.loads(x) for x in open(f) if x.strip()]
    lands=[]
    for e in L:
      if e['t']=='combo': lands.append((e['f']+151, COMBO.get(e['n'],18)))
      elif e['t']=='chain': lands.append((e['f']+66*(e['n']-1)+151, 6*(e['n']-1)))
    first=min((l for l,c in lands), default=None)
    tops=[e['f'] for e in L if e['t']=='tick' and max(e['d']['h'])>=12]
    rows.append((first,[sum(c for l,c in lands if l<=t) for t in T], tops[0] if tops else None))
  return rows
def live(files):
  rows=[]
  for f in files:
    j=json.load(open(f)); mine=j['mine']; opp=3-mine
    seen={}
    for fr in j['frames']:
      q=j['queues'][fr[1+9*(opp-1)+7]]
      for p in q.split(',') if isinstance(q,str) else q:
        m=re.match(r't(\d+):(\d+)x(\d+)',p or '')
        if m: k=(int(m.group(1)),int(m.group(2))*int(m.group(3))); seen.setdefault(k,fr[0])
    lands=list(seen.keys())
    first=min((l for l,c in lands), default=None)
    rows.append((first,[sum(c for l,c in lands if l<=t) for t in T],None))
  return rows
def show(lab,rows):
  fs=[r[0] for r in rows if r[0] is not None]
  print('%-28s games %3d | first garbage lands: median %4d f (%.1f s) | cells landed by 10/20/30/45 s (median): %s'%(lab,len(rows),st.median(fs),st.median(fs)/60,[st.median([r[1][i] for r in rows]) for i in range(4)]))

if __name__ == '__main__':
  kind, label, files = sys.argv[1], sys.argv[2], sys.argv[3:]
  show(label, arch(files) if kind == 'arch' else live(files))
