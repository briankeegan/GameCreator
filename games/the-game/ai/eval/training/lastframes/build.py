# Agro Last Frames: packs a training run's games into the page -- each loss's last frames with the bot's decisions, a timeline
# of the whole game, and every training run so far.
# build.py RUN_DIR RUNS_TSV FINDINGS_JSON TEMPLATE OUT
#   RUN_DIR holds the run's artifacts, one folder per game (training-mode-<n>: results.txt, death.jsonl, death.txt)
#   RUNS_TSV: run, commit, mode, frames, one game per column as <frames><s|l> (s survived, l lost)
import json, os, re, sys
run_dir, runs_tsv, findings, tpl, out = sys.argv[1:6]
RESULT = re.compile(r'(\w+) training (lost|survived) frames=(\d+)')
DECISION = re.compile(r'^(\d+) (\d+)>(\d+)@(\d+) (.*)$')

def rows_of(lines):
    # '12 . . G . 3m. ' -> '..g.nn..3m..' two characters a cell: colour ('g' garbage, '.' empty), state ('n' resting)
    out = []
    for l in lines:
        if len(l) < 15: continue
        cells = ''
        for c in range(3, 15, 2):
            v, s = l[c], l[c + 1] if c + 1 < len(l) else ' '
            cells += ('g' if v == 'G' else v) + ('n' if s == ' ' else s)
        out.append(cells)
    return out

def counts(rows):
    g = p = top = 0; brk = False
    for i, r in enumerate(rows):
        row = len(rows) - 1 - i
        for c in range(0, 12, 2):
            v, s = r[c], r[c + 1]
            if v == '.' or row == 0: continue
            top = max(top, row)
            if v == 'g': g += 1
            else: p += 1
            if v == 'g' and s in 'mp': brk = True
    return g, p, top, brk

def pad(rows, h):
    return ['.n' * 6] * (h - len(rows)) + rows

def game(path):
    j = json.load(open(os.path.join(path, 'death.jsonl')))
    logs = {}
    if os.path.exists(os.path.join(path, 'death.txt')):
        for l in open(os.path.join(path, 'death.txt')):
            m = DECISION.match(l.rstrip('\n'))
            if m: logs.setdefault(int(m.group(2)), set()).add(l.strip()[:150])
    hist = [(h['clock'], h['health'], h['stop'], h['incoming'][1], rows_of(h['grid'].split('\n')), h['cursor']) for h in j['history']]
    snaps = [(s['clock'], s['health'], s['stop'], s['incoming'][1], rows_of(s['grid']), None) for s in j['snaps']]
    first = hist[0][0] if hist else 1e9
    allf = [s for s in snaps if s[0] < first] + hist
    H = max(len(f[4]) for f in allf)
    died = allf[-1][0]
    marks = sorted(logs)
    def log_at(clock, prev):
        return [l for k in marks if prev < k <= clock for l in sorted(logs[k])]
    frames, prev = [], (hist[0][0] - 1 if hist else 0)
    for f in hist:
        frames.append([f[0], f[1], f[2], pad(f[4], H), log_at(f[0], prev), f[5], f[3]]); prev = f[0]
    tl, breaks, was = [], [], False
    for f in allf:
        g, p, top, brk = counts(f[4])
        tl.append([f[0], g, p, top, f[3], 1 if f[2] else 0])
        if brk and not was: breaks.append(f[0])
        was = brk
    doomed = None
    for l in open(os.path.join(path, 'death.txt')) if os.path.exists(os.path.join(path, 'death.txt')) else []:
        m = re.match(r'ALL DOOMED from decision \d+ \(asked at (\d+)\)', l)
        if m: doomed = int(m.group(1)); break
    last = frames[-600:]
    return {'died': died, 'doomed': doomed, 'lastBreak': breaks[-1] if breaks else None, 'breaks': len(breaks),
            'topped': round(100 * sum(1 for f in last if counts(f[3])[2] >= 12) / max(1, len(last))),
            'stopped': round(100 * sum(1 for f in last if f[2] > 0) / max(1, len(last))), 'queue': frames[-1][6] if frames else 0,
            'panels': counts(frames[-1][3])[1] if frames else 0, 'timeline': tl, 'breakAt': breaks, 'frames': frames}

results, games = [], {}
for name in sorted(os.listdir(run_dir), key=lambda n: int(re.sub(r'\D', '', n) or 0)):
    p = os.path.join(run_dir, name, 'results.txt')
    if not os.path.exists(p): continue
    m = RESULT.search(open(p).read())
    if not m: continue
    n = int(re.sub(r'\D', '', name)); mode, end, fr = m.group(1), m.group(2), int(m.group(3))
    results.append([n, end, fr, mode])
    if end == 'lost' and os.path.exists(os.path.join(run_dir, name, 'death.jsonl')): games[n] = game(os.path.join(run_dir, name))
runs = []
for l in open(runs_tsv).read().splitlines()[1:]:
    run, commit, mode, frames, *gs = l.split('\t')
    runs.append({'run': run, 'commit': commit, 'mode': mode, 'frames': int(frames),
                 'games': [[int(g[:-1]), g[-1] == 's'] for g in gs if g]})
data = {'results': results, 'runs': runs, 'findings': json.load(open(findings)), 'games': games,
        'mode': results[0][3] if results else ''}
page = open(tpl).read().replace('/*DATA*/null', json.dumps(data, separators=(',', ':')))
open(out, 'w').write(page); print(out, '%.1f MB' % (len(page) / 1e6), len(games), 'losses')
