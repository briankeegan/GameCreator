#!/usr/bin/env python3
# gambit_decisions.py LOG [SHA] [FROM [TO]]: every Gambit decision of a survivor.log as one plain line -- the frame, the mode, what was
# played and what it makes, the frame the board is lost on, and the option it beat with the rank key that decided, named from rank.c
# (at SHA when given: the build that played the game; else the checkout's). Each option is read from the decision's opts= field:
#   play:lostAt:broke[:n][:bBLOCKS][:thenLOST][:cCOMBO][:xCHAIN]  -- * the line in progress, ~ outside the mode's list, L lives, :n ready next
# and each attack sent (GAMBITA) is printed where it lands.
import sys, re, subprocess, os

HERE = os.path.dirname(os.path.abspath(__file__))
RANK = os.path.join(HERE, '..', 'gambit', 'rank.c')

def rank_lines(sha):
    if sha:
        try: return subprocess.check_output(['git', '-C', HERE, 'show', sha + ':games/the-game/ai/gambit/rank.c'], text=True).splitlines()
        except subprocess.CalledProcessError: pass
    return open(RANK).read().splitlines()

def key_name(lines, n):
    # the nearest numbered key heading above line n ("// 1'c. THE FINISH SENDS NO CHAIN PAST A 2 ..."), else the nearest comment
    if not (1 <= n <= len(lines)): return '?'
    for i in range(n - 1, max(0, n - 120), -1):
        m = re.match(r'\s*//\s*(\d+[\'a-z]*\.\s*.*)', lines[i])
        if m: return m.group(1)[:110]
    for i in range(n - 1, max(0, n - 30), -1):
        m = re.match(r'\s*//\s*(.*)', lines[i])
        if m: return m.group(1)[:110]
    return lines[n - 1].strip()[:110]

def option(s):
    f = s.split(':'); play = f[0]; o = {'play': play.rstrip('*~'), 'carried': '*' in play, 'outside': '~' in play}
    o['lost'] = f[1] if len(f) > 1 else '?'
    o['broke'] = f[2] if len(f) > 2 else '0'
    for x in f[3:]:
        if x.startswith('b'): o['blocks'] = x[1:]
        elif x.startswith('c'): o['combo'] = x[1:]
        elif x.startswith('x'): o['chain'] = x[1:]
        elif x.startswith('then'): o['then'] = x[4:]
    return o

def says(o):
    parts = []
    if o.get('combo'): parts.append('a %s-clear' % o['combo'] if o['combo'] == '3' else 'combo %s' % o['combo'])
    if o.get('chain'): parts.append('chain %sx' % o['chain'])
    if o['broke'] not in ('0', '-1', ''): parts.append('breaks %s cells' % o['broke'])
    if o.get('blocks'): parts.append('sends %s blocks' % o['blocks'])
    if o['outside']: parts.append('outside the list')
    life = 'lives' if o['lost'] == 'L' else 'lost at %s' % o['lost'] + (', %s with the next moves' % o['then'] if o.get('then') else '')
    return '%s%s (%s%s)' % (o['play'], ' [in progress]' if o['carried'] else '', ', '.join(parts) + '; ' if parts else '', life)

def main():
    a = sys.argv[1:]
    if not a: sys.exit(__doc__ or 'gambit_decisions.py LOG [SHA] [FROM [TO]]')
    log = a[0]; sha = a[1] if len(a) > 1 and not a[1].isdigit() else None
    nums = [int(x) for x in a[1:] if x.isdigit()]
    lo = nums[0] if nums else 0; hi = nums[1] if len(nums) > 1 else 10 ** 9
    lines = rank_lines(sha)
    for l in open(log, errors='replace'):
        p = l.split()
        if len(p) < 3: continue
        if p[0] == 'GAMBITA':
            t = int(p[1])
            if lo <= t <= hi: print('%6d   >>> SENT %s %s' % (t, 'combo' if p[2] == 'c' else 'chain', p[3] + ('' if p[2] == 'c' else 'x')))
            continue
        if p[0] != 'GAMBITD': continue
        t = int(p[1])
        if not lo <= t <= hi: continue
        g = lambda k: (re.search(' ' + k + r'=([^ ]+)', l) or [0, None])[1]
        mode = p[2] + (' them' if p[2] == 'finish' else '')
        opts = [option(s) for s in (g('opts') or '').split(',') if s]
        played = opts[0] if opts else {'play': g('play') or '?', 'lost': g('dies') or '?', 'broke': '0', 'outside': False, 'carried': False}
        line = '%6d %-8s %-48s' % (t, p[2], says(played))
        won = g('won')
        if won:
            k, other = won.split(':', 1)
            ro = next((o for o in opts[1:] if o['play'] == other.rstrip('*~')), None)
            line += '  beat %s on key %s: %s' % (says(ro) if ro else other, k[1:], key_name(lines, int(k[1:])))
        elif len(opts) <= 1: line += '  (the only option)'
        seq = g('seq')
        if seq and seq != '-': line += '  swaps ' + seq
        tk = g('twinKey')
        if tk:
            k = tk.split(':')[0][1:]; won8 = k.endswith('+'); k = k.rstrip('+')
            line += '  | an 8 was offered and %s on key %s: %s' % ('WON the comparison with the top but ranked below it' if won8 else 'lost', k, key_name(lines, int(k)))
        print(line)

main()
