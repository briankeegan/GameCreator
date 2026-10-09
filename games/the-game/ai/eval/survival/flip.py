import gzip,os,sys,collections
# decisions between presses: a target left and come back to (A..B..A) with no press between -- the bot changing its mind and back
d=sys.argv[1]; tot=flips=wasted=0; byvia=collections.Counter(); ex=[]
for f in sorted(os.listdir(d)):
    if not f.endswith('.log.gz'): continue
    seq=[]; fr=0
    for line in gzip.open(os.path.join(d,f),'rt'):
        if line.startswith('F '): fr=int(line.split()[1])
        elif line.startswith('DECIDE via'):
            p=line.split(); seq.append((fr,p[3],int(p[2]))); tot+=1
        elif line.startswith('PRESS'):
            # the run since the last press
            tg=[s[1] for s in seq]
            for i in range(2,len(tg)):
                if tg[i]==tg[i-2] and tg[i]!=tg[i-1]:
                    flips+=1; byvia[(seq[i-1][2],seq[i][2])]+=1
                    if len(ex)<6: ex.append((f,seq[i-2:i+1]))
            if seq: wasted+=seq[-1][0]-seq[0][0]
            seq=[]
print('decisions %d, A-B-A flips with no press between %d'%(tot,flips))
print('via pairs (the B, the A back):', byvia.most_common(8))
for e in ex: print(e)
