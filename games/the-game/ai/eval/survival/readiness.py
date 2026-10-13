# readiness.py DIR: was the board READY when each slab landed, and what became of the landing -- and, behind it, how often the search that
# readies a board runs and what it finds. DIR is a fetched scan (scan_deaths.sh / scan.sh): results.tsv and every seed's game log.
#
# Landings: a landing is the garbage on a board growing after 40 frames without; its board is ready if the last READY line before it says so
# (a break in reach when the slab lands); the delay is the frames to the first break after it; a landing is fatal when no break came before
# the game ended within 900 frames. Funnel: the decisions that asked for readiness, how many ran each search, why the rest did not.
import gzip, glob, os, re, sys, collections
d = sys.argv[1].rstrip('/')
FRAME = re.compile(r'^F (\d+) keys \d+ stop \d+ shake \d+ lock \d+ raise \d+ health \d+ cur \d+,\d+ in \d+ \| (.*)$')
def pct(xs, q):
    xs = sorted(xs); return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else float('nan')
died = {}
for l in open(os.path.join(d, 'results.tsv')):
    p = l.split()
    if len(p) >= 3: died[int(p[0])] = int(p[2])
lands = []; funnel = collections.Counter(); seen = []; nolanding = collections.Counter()
for f in sorted(glob.glob(os.path.join(d, 'seed*.log.gz'))):
    seed = int(re.search(r'seed(\d+)', f).group(1))
    cur = 0; ready = {}; frames = []
    for l in gzip.open(f, 'rt', errors='ignore'):
        if l.startswith('@ '): cur = int(l.split()[1]); st = {}; continue
        m = FRAME.match(l)
        if m:
            rows = m.group(2).split()
            g = sum(r[i] == 'g' for r in rows for i in range(0, len(r), 2))
            br = any(r[i] == 'g' and r[i + 1] in 'mpx' for r in rows for i in range(0, len(r), 2))
            frames.append((int(l.split()[1]), g, br)); continue
        m = re.match(r'READY base (\d) readyFirst (\d) incoming (\S+)', l)
        if m: ready[cur] = int(m.group(1)); st = {'inc': float(m.group(3)) > 0}; continue
        m = re.match(r'RWL \d+,\d+ via \d+ ready (\d)', l)
        if m: st['rwl'] = int(m.group(1)); continue
        if l.startswith('RWL by distance: lands'): st['dist'] = 1
        if l.startswith('READIES lines'):
            st['readies'] = 1; m = re.search(r'(\d+) seen', l)
            if m: seen.append(int(m.group(1)))
        m = re.match(r'RWL no landing: rc (-?\d+).*dying (\d) topped (\d)', l)
        if m: nolanding['dying and topped' if m.group(2) == '1' and m.group(3) == '1' else 'other'] += 1
        if re.search(r'total \d+, declined \d+, ready refused (\d+)', l) and st.get('inc'):
            funnel['decisions with a slab queued'] += 1
            if st.get('rwl') == 0:
                funnel['asked, board not ready'] += 1
                funnel['  distance search ran'] += st.get('dist', 0)
                funnel['  second search ran'] += st.get('readies', 0)
            st = {}
    prev = 0; last = -999; breaks = [f for i, (f, g, b) in enumerate(frames) if b and (i == 0 or not frames[i - 1][2])]
    rf = sorted(ready)
    for i, (fr, g, b) in enumerate(frames):
        if g > prev and i and fr - last > 40:
            last = fr
            k = max((j for j in range(len(rf)) if rf[j] < fr), default=None)
            nxt = [x for x in breaks if x >= fr]
            end = died.get(seed, frames[-1][0])
            delay = nxt[0] - fr if nxt and nxt[0] <= end else None
            lands.append((ready[rf[k]] if k is not None else 0, delay, delay is None and end - fr < 900))
        prev = g
print('%d landings' % len(lands))
for r, name in ((1, 'ready at the landing'), (0, 'not ready')):
    s = [x for x in lands if x[0] == r]
    if not s: continue
    dl = [x[1] for x in s if x[1] is not None]
    print('  %-22s n %4d | frames to the first break: p50 %.0f p90 %.0f | later than 150: %4.1f%% | fatal %d (%.1f%%)' % (name, len(s), pct(dl, .5), pct(dl, .9), 100 * sum(1 for x in s if x[1] is None or x[1] > 150) / len(s), sum(x[2] for x in s), 100 * sum(x[2] for x in s) / len(s)))
print('the search that readies a board:')
for k, v in funnel.items(): print('  %-30s %d' % (k, v))
if nolanding: print('  the next slab cannot land (no board to ready):', dict(nolanding))
if seen: print('  second search: %d runs, nodes seen mean %.1f p90 %.0f' % (len(seen), sum(seen) / len(seen), pct(seen, .9)))
