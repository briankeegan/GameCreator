# Agro Frames: packs a training run's games into the page -- every frame of each loss with the bot's decisions, a timeline
# of the whole game, and every training run so far. Each game's frames are a file of their own (games/<n>.json beside the page),
# loaded when the game is picked.
# build.py RUN_DIR RUNS_TSV FINDINGS_JSON TEMPLATE OUT_DIR [NAME]   (NAME the bot the page is for, default Agro)
#   RUN_DIR holds the run's artifacts, one folder per game (training-mode-<n>: results.txt, death.jsonl, death.txt)
#   RUNS_TSV: run, commit, mode, frames, one game per column as <frames><s|l> (s survived, l lost)
import gzip, json, os, re, sys, zlib
run_dir, runs_tsv, findings, tpl, out_dir = sys.argv[1:6]
name = sys.argv[6] if len(sys.argv) > 6 else 'Agro'
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

def frame_log(path):
    # every frame of the game (survivor_match.js frameLog): the grid only on the frames it changed on. A log cut off when the
    # mind was stopped is read up to its last whole line.
    f = os.path.join(path, 'frames.jsonl.gz')
    if not os.path.exists(f): return None
    d = zlib.decompressobj(16 + zlib.MAX_WBITS); raw = d.decompress(open(f, 'rb').read())
    out, grid = [], None
    for l in raw.decode('utf8', 'replace').split('\n'):
        try: r = json.loads(l)
        except ValueError: continue
        if r.get('grid'): grid = r['grid']
        if grid is None: continue
        out.append((r['clock'], r['health'], r['stop'], r['incoming'][1], grid, r['cursor']))
    return out

def game(path):
    j = json.load(open(os.path.join(path, 'death.jsonl')))
    logs = {}
    death_txt = os.path.join(path, 'death.txt')
    if os.path.exists(death_txt):
        for l in open(death_txt):
            m = DECISION.match(l.rstrip('\n'))
            if m: logs.setdefault(int(m.group(2)), set()).add(l.strip()[:150])
    for d in j.get('decided', []):
        at = d.get('now', d.get('at'))
        if at is None: continue
        mv = ','.join(map(str, d['move'])) if d.get('move') else ''
        dg = d.get('diag') or {}
        logs.setdefault(at, set()).add('%s %s %s for@%s %sms%s' % (d.get('id'), d.get('kind'), mv, d.get('at'), d.get('ms'), ' ALLDOOMED' if dg.get('allDoomed') else ''))
    full = frame_log(path)
    if full is None: full = [(h['clock'], h['health'], h['stop'], h['incoming'][1], h['grid'], h['cursor']) for h in j['history']]
    grids, gi, frames = [], {}, []
    H = max(len(rows_of(f[4].split('\n'))) for f in full)
    marks = sorted(logs); mk = 0
    for f in full:
        if f[4] not in gi: gi[f[4]] = len(grids); grids.append(pad(rows_of(f[4].split('\n')), H))
        lines = []
        while mk < len(marks) and marks[mk] <= f[0]: lines += sorted(logs[marks[mk]]); mk += 1
        frames.append([f[0], f[1], f[2], gi[f[4]], f[5], f[3]] + ([lines] if lines else []))
    died = frames[-1][0]
    tl, breaks, was = [], [], False
    for k, f in enumerate(frames):
        g, p, top, brk = counts(grids[f[3]])
        if brk and not was: breaks.append(f[0])
        was = brk
        if k % 30 == 0 or k == len(frames) - 1: tl.append([f[0], g, p, top, f[5], 1 if f[2] else 0])
    doomed = None
    for l in open(death_txt) if os.path.exists(death_txt) else []:
        m = re.match(r'ALL DOOMED from decision \d+ \(asked at (\d+)\)', l)
        if m: doomed = int(m.group(1)); break
    last = frames[-600:]
    summary = {'died': died, 'doomed': doomed, 'lastBreak': breaks[-1] if breaks else None, 'breaks': len(breaks), 'first': frames[0][0],
               'topped': round(100 * sum(1 for f in last if counts(grids[f[3]])[2] >= 12) / max(1, len(last))),
               'stopped': round(100 * sum(1 for f in last if f[2] > 0) / max(1, len(last))), 'queue': frames[-1][5],
               'panels': counts(grids[frames[-1][3]])[1], 'timeline': tl, 'breakAt': breaks, 'lastGrid': grids[frames[-1][3]],
               'lastCursor': frames[-1][4], 'count': len(frames)}
    return summary, {'grids': grids, 'frames': frames}

results, games = [], {}
for name in sorted(os.listdir(run_dir), key=lambda n: int(re.sub(r'\D', '', n) or 0)):
    p = os.path.join(run_dir, name, 'results.txt')
    if not os.path.exists(p): continue
    m = RESULT.search(open(p).read())
    if not m: continue
    n = int(re.sub(r'\D', '', name)); mode, end, fr = m.group(1), m.group(2), int(m.group(3))
    results.append([n, end, fr, mode])
    # every game with its frames: a loss, and a game that lived to the end (the page tells them apart)
    if os.path.exists(os.path.join(run_dir, name, 'death.jsonl')):
        games[n], frames = game(os.path.join(run_dir, name))
        games[n]['survived'] = end == 'survived'
        os.makedirs(os.path.join(out_dir, 'games'), exist_ok=True)
        json.dump(frames, open(os.path.join(out_dir, 'games', '%d.json' % n), 'w'), separators=(',', ':'))
runs = []
for l in open(runs_tsv).read().splitlines()[1:]:
    run, commit, mode, frames, *gs = l.split('\t')
    runs.append({'run': run, 'commit': commit, 'mode': mode, 'frames': int(frames),
                 'games': [[int(g[:-1]), g[-1] == 's'] for g in gs if g]})
data = {'results': results, 'runs': runs, 'findings': json.load(open(findings)), 'games': games,
        'mode': results[0][3] if results else ''}
page = open(tpl).read().replace('/*NAME*/', name).replace('/*DATA*/null', json.dumps(data, separators=(',', ':')))
out = os.path.join(out_dir, 'index.html')
open(out, 'w').write(page)
size = sum(os.path.getsize(os.path.join(out_dir, 'games', f)) for f in os.listdir(os.path.join(out_dir, 'games'))) if games else 0
print(out, '%.1f MB page, %.1f MB of frames' % (len(page) / 1e6, size / 1e6), len(games), 'losses')
