# WHAT A PLAYER'S BIG COMBOS ARE MADE OF, FROM LIVE GAMES.
#   python3 combo_replays.py split LOG OUTDIR NAME   every match against NAME in a live log (bot-prod-smoke.log's REPLAY lines) as a
#                                                    GAME.json for lua/comboReplay.lua; prints the count written
#   python3 combo_replays.py shapes JSONL...         comboReplay.lua's lines: combos a minute by size, and each big combo's shape --
#                                                    the matched cells of each colour as runs (v4 = four in one column, h3 = three in
#                                                    one row, x5 = five across rows and columns)
import json, os, sys, collections

def split(log, out, name):
    os.makedirs(out, exist_ok=True); k = 0
    for line in open(log, errors='replace'):
        if not line.startswith('REPLAY '): continue
        j = json.loads(line[7:]); s = j['settings']; names = [x['name'] for x in s['metadata']['stacks']]
        if name not in names: continue
        for i, inp in enumerate(j['inputs']): s['stacks'][i]['inputs'] = ''.join(inp)
        s['metadata']['completed'] = True
        k += 1; json.dump({'replay': s, 'seat': names.index(name) + 1, 'n': len(j['inputs'][0])}, open('%s/g%02d.json' % (out, k), 'w'))
    print(k)

def runs(cells):
    by = collections.defaultdict(list)
    for r, c, k in cells: by[k].append((r, c))
    out = []
    for k, pts in by.items():
        rs = {p[0] for p in pts}; cs = {p[1] for p in pts}
        out.append(('v' if len(cs) == 1 else 'h' if len(rs) == 1 else 'x') + str(len(pts)))
    return '+'.join(sorted(out, reverse=True))

def shapes(files):
    frames = 0; sizes = collections.Counter(); shape = collections.Counter(); games = ends = 0
    for f in files:
        for line in open(f):
            j = json.loads(line)
            if j['t'] == 'end':
                ends += 1; frames += j['frames']
                for k, v in (j['sizes'] or {}).items(): sizes[int(k)] += v   # (dkjson writes an empty table as [])
            elif j['t'] == 'combo' and j['size'] >= 8:
                shape[('chain ' if j['chain'] else '') + runs(j['cells'])] += 1
        games += 1
    assert ends == games, 'a file with no end line: %d of %d' % (games - ends, games)
    mins = frames / 3600
    print('%d games, %.1f min' % (games, mins))
    print('a minute: ' + ', '.join('%d: %.2f' % (k, v / mins) for k, v in sorted(sizes.items())))
    print('8+ a minute: %.2f' % (sum(v for k, v in sizes.items() if k >= 8) / mins))
    for s, v in shape.most_common(12): print('  %4d  %s' % (v, s))

if __name__ == '__main__':
    if sys.argv[1] == 'split': split(*sys.argv[2:5])
    else: shapes(sys.argv[2:])
