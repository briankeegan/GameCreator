import gzip,os,sys,collections
names='NONE RAISE_OPENING RAISE_MATERIAL RAISING READYFIRST AWAITLANDING BREAK LINEUPHOLD LINEUP BREAKREACH BREAKSPEND DIGPLAN DIGWAIT ATTACKWAIT ATTACKPLAN BESTATTACK PLANWAIT SURVIVALPLAN FLATTENWAIT FLATTEN NOBEST SETUP WEIGHTS RULED PLANSAVE KEEPSAVE AWAITDRAIN KEEPHEALTH FILL'.split()
d=sys.argv[1]
for line in open(os.path.join(d,'results.tsv')):
    s,e,f=line.rstrip('\n').split('\t')
    if e!='died': continue
    end=int(f); W=1500
    frames=[]; spent=collections.Counter(); breaks=0
    lastvia=None; pressvia=None; pressat=-999; frame=0; prev=None; prevbrk=False
    for L in gzip.open(os.path.join(d,'seed%s.log.gz'%s),'rt'):
        if L.startswith('@ '): frame=int(L.split()[1]); continue
        if L.startswith('DECIDE'): lastvia=L.split()[2]; continue
        if L.startswith('PRESS'): pressvia=lastvia; pressat=frame; continue
        if not L.startswith('F '): continue
        rows=L.split('|',1)[1].split()[:-1]
        if frame>=end-W:
            pan=sum(1 for r in rows for k in range(0,12,2) if r[k].isdigit()); gar=sum(1 for r in rows for k in range(0,12,2) if r[k]=='g')
            frames.append((frame,pan,gar))
            if prev is not None:
                n=sum(1 for i,r in enumerate(rows) for k in range(0,12,2) if r[k].isdigit() and r[k+1]=='m' and prev[i][k+1]!='m')
                g=sum(1 for i,r in enumerate(rows) for k in range(0,12,2) if r[k]=='g' and r[k+1]=='m' and prev[i][k+1]!='m')
                if g and not prevbrk: breaks+=1
                prevbrk = g>0 or any(r[k]=='g' and r[k+1] in 'mpx' for r in rows for k in range(0,12,2))
                if n and not g:
                    v = (names[int(pressvia)] if pressvia and pressvia.isdigit() else '?') if frame-pressat<=12 else 'fall/chain'
                    spent[v]+=n
        prev=rows
    p0=frames[0][1] if frames else 0; pmin=min(x[1] for x in frames) if frames else 0
    print('seed %s died %d | last %d frames: panels %d -> min %d, garbage at end %d, breaks %d | panels cleared without breaking: %s' % (s,end,W,p0,pmin,frames[-1][2],breaks, ', '.join('%s %d'%kv for kv in spent.most_common(5))))
