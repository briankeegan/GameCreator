# packs a scan's games into the page: boards, the bot's decision lines, a timeline
import gzip, json, os, re, sys
d, hist, tpl, out = sys.argv[1:5]
FRAME = re.compile(r'^F (\d+) keys (\d+) stop (\d+) shake \d+ lock \d+ raise \d+ health (\d+) cur (\d+),(\d+) in (\d+) \| (.*)$')
TAGS = ('READIES', 'BREAKFIRST', 'SOON!', 'FILL!', 'PLAN', 'KEEPREADY', 'KEPT', 'SPEND', 'GUARD', 'MEANWHILE', 'SA ', 'budget', 'PERCH', 'RETURN', 'RWL by', 'READY ')
def cells(rows):
    g = p = top = 0; broke = False
    for i, r in enumerate(rows):
        row = len(rows) - 1 - i
        for c in range(0, len(r), 2):
            v, s = r[c], r[c + 1]
            if v == '.': continue
            if row > 0:
                top = max(top, row)
                if v == 'g' or s == 'r': g += 1
                else: p += 1
            if (v == 'g' and s in 'mpx') or s == 'r': broke = True
    return g, p, top, broke
def seed(n):
    frames, logs, log = [], {}, []
    for line in gzip.open(os.path.join(d, 'seed%d.log.gz' % n), 'rt'):
        line = line.rstrip('\n')
        if line.startswith('@ '): log = []; continue
        m = FRAME.match(line)
        if m:
            f = int(m.group(1)); rows = m.group(8).split(); g, p, top, broke = cells(rows)
            frames.append((f, int(m.group(2)), int(m.group(3)), int(m.group(7)), g, p, top, broke, rows, [int(m.group(5)), int(m.group(6))]))
            if log: logs[f] = log
        elif line.startswith(TAGS): log.append(re.sub(r'\s+', ' ', line.strip())[:170])
    died = frames[-1][0]
    breaks = [fr[0] for i, fr in enumerate(frames) if fr[7] and (i == 0 or not frames[i - 1][7])]
    last = frames[-600:]
    dec = [l for fr in frames[-300:] for l in logs.get(fr[0], [])]
    def share(tag, ok):
        xs = [l for l in dec if l.startswith(tag)]; return [sum(1 for l in xs if ok(l)), len(xs)]
    return {'died': died, 'lastBreak': breaks[-1] if breaks else None, 'breaks': len(breaks),
            'idle': round(100 * sum(1 for fr in last if fr[1] == 0) / len(last)),
            'stopped': round(100 * sum(1 for fr in last if fr[2] > 0) / len(last)), 'queue': frames[-1][3],
            'decisions': {'breakFirst': share('BREAKFIRST', lambda l: not l.startswith('BREAKFIRST lines 0 ')),
                          'readies': share('READIES', lambda l: 'ready:' in l)},
            'timeline': [[fr[0], fr[4], fr[5], fr[6], fr[3], 1 if fr[2] else 0] for fr in frames[::30]] + [[died, frames[-1][4], frames[-1][5], frames[-1][6], frames[-1][3], 0]],
            'breakAt': breaks,
            'frames': [[fr[0], fr[1], fr[2], fr[8], logs.get(fr[0], []), fr[9]] for fr in frames[-1500:]]}
results = [l.rstrip('\n').split('\t') for l in open(os.path.join(d, 'results.tsv'))]
H = [l.rstrip('\n').split('\t') for l in open(hist)][1:]
data = {'results': [[int(s), e, int(f) if f.isdigit() else None] for s, e, f in results],
        'scans': [{'run': r, 'commit': c, 'alive': int(a), 'died': [int(x) for x in ds.split(' ')[0].split(',') if x.isdigit()]} for r, c, a, ds in H],
        'findings': json.load(open(os.path.join(d, 'findings.json'))), 'seeds': {}}
for s, e, f in data['results']:
    if e == 'died' and os.path.exists(os.path.join(d, 'seed%d.log.gz' % s)): data['seeds'][s] = seed(s)
page = open(tpl).read().replace('/*DATA*/null', json.dumps(data, separators=(',', ':')))
open(out, 'w').write(page); print(out, '%.1f MB' % (len(page) / 1e6), len(data['seeds']), 'seeds')
