import gzip,os,sys,statistics as st
# every wave landing: garbage cells on the board jump by >= 8 within 30 frames.
# record panels and tallest column just before, wave size, and whether the seed died within 900 frames after.
d=sys.argv[1]; rows_out=[]
for f in sorted(os.listdir(d)):
    if not f.endswith('.log.gz'): continue
    hist=[]; rdy=0
    for line in gzip.open(os.path.join(d,f),'rt'):
        if line.startswith('READY base '): rdy=int(line.split()[2]); continue
        if not line.startswith('F '): continue
        p=line.split(); fr=int(p[1]); rows=line.split('|',1)[1].split()[:-1]
        g=sum(1 for r in rows for k in range(0,len(r),2) if r[k]=='g')
        pan=sum(1 for r in rows for k in range(0,len(r),2) if r[k].isdigit())
        top=0
        for i,r in enumerate(rows):
            if any(r[k]!='.' for k in range(0,len(r),2)): top=len(rows)-i; break
        hist.append((fr,g,pan,top,rdy))
    end=hist[-1][0]; died=end<59999
    i=30
    while i<len(hist):
        if hist[i][1]-hist[i-30][1]>=8:
            pre=hist[i-30]; size=hist[i][1]-pre[1]
            j=i
            while j+1<len(hist) and hist[j+1][1]>=hist[j][1] and j-i<60: j+=1
            size=hist[j][1]-pre[1]
            fatal=died and end-hist[i][0]<=900
            k=i
            while k>0 and hist[k-1][1]>=hist[k][1] and hist[k][1]>pre[1]: k-=1   # the frame the wave started down
            rows_out.append((fatal,pre[2],pre[3],size,f,hist[i][0],hist[max(k-1,0)][4]))
            i=j+60
        else: i+=1
for lab,sel in (('fatal',[r for r in rows_out if r[0]]),('survived',[r for r in rows_out if not r[0]])):
    if not sel: continue
    print('%-9s n=%4d panels median %4.0f | top median %4.1f | wave cells median %4.0f | ready before it %d (%.0f%%)' % (lab,len(sel),st.median(r[1] for r in sel),st.median(r[2] for r in sel),st.median(r[3] for r in sel),sum(r[6] for r in sel),100.0*sum(r[6] for r in sel)/len(sel)))
fat=[r for r in rows_out if r[0]]
print('fatal:', ' '.join('%s@%d p%d top%d w%d' % (r[4][4:-7],r[5],r[1],r[2],r[3]) for r in fat))
# survival rate by panels bucket
for lo,hi in ((0,18),(18,24),(24,30),(30,36),(36,48),(48,99)):
    s=[r for r in rows_out if lo<=r[1]<hi]
    if s: print('panels %2d-%2d: %4d landings, %3d fatal (%.1f%%)' % (lo,hi-1,len(s),sum(r[0] for r in s),100.0*sum(r[0] for r in s)/len(s)))
# frames from landing to the first break after it
def firstbreak(path, fr0):
    for line in gzip.open(path,'rt'):
        if not line.startswith('F '): continue
        p=line.split(); fr=int(p[1])
        if fr<fr0: continue
        rows=line.split('|',1)[1].split()[:-1]
        if any(r[k]=='g' and r[k+1] in 'mpx' for r in rows for k in range(0,len(r),2)): return fr-fr0
        if fr-fr0>900: return 999
    return 999
import random
random.seed(1)
samp=[r for r in rows_out if not r[0]]; samp=random.sample(samp,min(150,len(samp)))
for lab,sel in (('fatal',fat),('survived(sample)',samp)):
    t=[firstbreak(os.path.join(d,r[4]),r[5]) for r in sel]
    print('%-17s first break after landing: median %d, within 60f %d/%d, none in 900f %d' % (lab, st.median(t), sum(x<=60 for x in t), len(t), sum(x>=999 for x in t)))
