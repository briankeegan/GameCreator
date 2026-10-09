import gzip,os,sys,re,collections as C
# what slips through: each decision in a death's last WIN frames, its best judged
# option (a break; else the latest loss of health) against what it played
d=sys.argv[1]; WIN=int(sys.argv[2]) if len(sys.argv)>2 else 900; INF=1<<20
tot=C.Counter(); byvia=C.Counter(); ex={}
def dv(x): x=int(x); return INF if x==0 or x>=INF else x
for f in sorted(os.listdir(d)):
    if not f.endswith('.log.gz'): continue
    blocks=[]; cur=None
    for l in gzip.open(os.path.join(d,f),'rt'):
        if l.startswith('@ '): cur=[int(l[2:]),[]]; blocks.append(cur)
        elif cur and not l.startswith('F '): cur[1].append(l)
    end=blocks[-1][0]
    if end>=59990: continue
    for fr,ls in blocks:
        if fr<end-WIN: continue
        dec=[l for l in ls if l.startswith('DECIDE')]
        if not dec: continue
        brk=None; best=0; bl=None
        for l in ls:
            m=re.match(r'JUDGE n\d+ (.*?) brk (\d) est \S+ -> v(\d+) \| drain (\d+)',l)
            if m:
                v=int(m[3]); die=dv(m[4])
                if v&4 and brk is None: brk=m[1]
                if v&1 and die>best: best,bl=die,m[1]
            m=re.match(r'\s+pool (\S+) v (\d+) die (\d+)',l)
            if m and int(m[2])&1 and dv(m[3])>best: best,bl=dv(m[3]),m[1]
        p=[l for l in ls if l.startswith('PLAN')]
        chosen=dv(re.search(r'die (\d+)',p[-1])[1]) if p else None
        via=re.search(r'via (\d+)',dec[-1])[1]; hold='hold' in dec[-1]
        broke=' broke 0 ' not in dec[-1] and ' broke -1 ' not in dec[-1]
        tot['decisions']+=1
        if brk and not broke and not (p and 'kind 1' in p[-1]):
            tot['break judged, not played']+=1; byvia['break skipped via %s%s'%(via,' hold' if hold else '')]+=1; ex.setdefault('brk',(f,fr,brk,dec[-1].strip()))
        if chosen is not None and best>chosen+30:
            tot['lives longer judged, not played']+=1; byvia['shorter life via %s'%via]+=1; ex.setdefault('life',(f,fr,bl,best,chosen))
        if hold and best>0 and best<INF and not p:
            tot['held with a living line judged']+=1; byvia['held via %s'%via]+=1
for k,v in tot.items(): print('%-34s %d'%(k,v))
for k,v in byvia.most_common(12): print('  %-30s %d'%(k,v))
for k,v in ex.items(): print('example',k,v)
