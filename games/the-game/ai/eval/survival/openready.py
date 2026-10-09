import gzip,os,sys,re
d=sys.argv[1]; res={l.split()[0]:int(l.split()[2]) for l in open(d+'/results.tsv')}
print('seed  firstWave  decisions-ready-before-wave  died')
for s in sorted(res,key=int):
    fw=None; rdy=0; tot=0; fr=0
    for l in gzip.open('%s/seed%s.log.gz'%(d,s),'rt',errors='replace'):
        if l.startswith('@ '): fr=int(l[2:])
        elif l.startswith('READY base'):
            m=re.match(r'READY base (\d) readyFirst \d incoming (\S+) slab (\d),(\d),(\d)',l)
            if fw is None and float(m[2])>6: fw=fr
            if fw is None: tot+=1; rdy+=int(m[1])
        if fw is not None and fr>fw+5: break
    print('%-5s %-10s %3d/%-3d %s'%(s,fw,rdy,tot,'died@%d'%res[s] if res[s]<60000 else 'alive'))
