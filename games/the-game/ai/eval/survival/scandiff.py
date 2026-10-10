# scandiff.py NEW_DIR: this scan against the one before it -- alive, mean frames survived (min(death, 60k): steadier than the alive count), and the seeds that moved
import sys, os, glob
new = sys.argv[1].rstrip('/')
base = os.path.dirname(new) or '.'
others = sorted((d for d in glob.glob(base + '/scan-*') if os.path.isdir(d) and os.path.abspath(d) != os.path.abspath(new) and os.path.exists(d + '/results.tsv') and os.path.getsize(d + '/results.tsv') > 0), key=os.path.getmtime)
def load(d): return {int(l.split()[0]): int(l.split()[2]) for l in open(d + '/results.tsv') if len(l.split()) >= 3}
B = load(new)
mean = lambda R: sum(min(v, 60000) for v in R.values()) / len(R)
alive = lambda R: sum(v >= 59990 for v in R.values())
line = 'survival: alive %d/%d, mean frames %.0f' % (alive(B), len(B), mean(B))
if others:
    A = load(others[-1])
    line += ' | before (%s): alive %d, mean %.0f' % (os.path.basename(others[-1])[5:], alive(A), mean(A))
    mv = sorted(((s, A[s], B[s]) for s in B if s in A and abs(min(A[s], 60000) - min(B[s], 60000)) > 2000), key=lambda t: t[2] - t[1])
    line += '\nmoved >2000: ' + ' '.join('%d:%d->%d' % t for t in mv)
print(line)
