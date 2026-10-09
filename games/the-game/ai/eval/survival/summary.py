# summary.py DIR: one pass over each seed's game log, the numbers every cycle needs --
# survival, the decisions by stage (played, held, overridden by the order), the work declined
import gzip, glob, os, re, sys, collections as C
from multiprocessing import Pool
d = sys.argv[1].rstrip('/')
def one(f):
    played, held, over = C.Counter(), C.Counter(), C.Counter(); declined = dec = 0
    for l in gzip.open(f, 'rt', errors='replace'):
        if l.startswith('DECIDE'):
            dec += 1
            m = re.match(r'DECIDE (hold )?via (\d+)', l)
            if m: (held if m[1] else played)[m[2]] += 1
        elif l.startswith('ARBITER'):
            m = re.search(r' over via (\d+) ', l)
            if m: over[m[1]] += 1
        elif l.startswith('WORKS'):
            m = re.search(r'declined (\d+)', l)
            if m: declined += int(m[1])
    return dec, played, held, over, declined
if __name__ == '__main__':
    fs = sorted(glob.glob(d + '/seed*.log.gz'))
    with Pool(4) as p: rs = p.map(one, fs)
    dec = sum(r[0] for r in rs); P, H, O = C.Counter(), C.Counter(), C.Counter(); dc = 0
    for r in rs: P.update(r[1]); H.update(r[2]); O.update(r[3]); dc += r[4]
    top = lambda c, n=5: ' '.join('%s:%d' % (k, v) for k, v in c.most_common(n))
    print('decisions %d | held %d (%.0f%%): %s | overridden %d: %s | played: %s | judges declined %.2f/decision' % (
        dec, sum(H.values()), 100.0 * sum(H.values()) / max(dec, 1), top(H, 3), sum(O.values()), top(O), top(P), dc / max(dec, 1)))
