import gzip,os,sys,collections
d=sys.argv[1]; G={1:'test',2:'topped/not allowed',3:'garbage falling',4:'no room for the next slab',5:'break line played',6:'raise loses the ready break',7:'six rows of material',8:'a break in the pool, nothing coming',9:'RAISE',10:'no clear in time (raiseSafe)',11:'the rise lock, garbage still to drop',12:'opening: the raised board not ready'}
low=collections.Counter(); n=0
for f in sorted(os.listdir(d)):
    if not f.endswith('.log.gz'): continue
    fr=[]; g=None
    for line in gzip.open(os.path.join(d,f),'rt'):
        if line.startswith('RAISEGATE'): g=int(line.split()[1])
        elif line.startswith('F '):
            h=line.split('|',1)[0].split(); cells=line.split('|',1)[1].split()[:-1]
            pan=sum(1 for r in cells for k in range(0,len(r),2) if r[k].isdigit())
            fr.append((int(h[1]),int(h[3])&32,pan,int(h[5]),g))
    end=fr[-1][0]
    if end>=59990: continue
    for x in fr:
        if x[0]>=end-1500 and x[2]<24 and not x[1]: low[G.get(x[4],x[4])]+=1
n=sum(low.values())
print('deaths, last 1500, panels<24, no raise key: %d frames: '%n+', '.join('%s %d%%'%(k,100*v/n) for k,v in low.most_common()))
