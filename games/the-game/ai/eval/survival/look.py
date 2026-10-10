import gzip,sys
# the boards breakFirst had no line on, near a death: is there a break in one or two swaps? (swap, fall, clear any run touching garbage)
f,lo,hi=sys.argv[1],int(sys.argv[2]),int(sys.argv[3])
def grid(rows):
    # a panel counts only at rest ('n'); one matched, popping, falling or hovering is '#': not swapped, not matched, it stays
    g=[[r[k] if r[k] in 'g.' else int(r[k]) if r[k+1]=='n' else '#' for k in range(0,len(r),2)] for r in rows]
    return g[::-1]   # g[0] bottom
def settle(g):
    W=len(g[0])
    for c in range(W):
        col=[g[r][c] for r in range(len(g))]; out=[]; 
        # panels fall onto anything; garbage stays
        r=0; 
        for k in range(len(g)):
            v=g[k][c]
            if v in ('g','#'):
                while len(out)<k: out.append('.')
                out.append(v)
            elif v!='.': out.append(v)
        while len(out)<len(g): out.append('.')
        for k in range(len(g)): g[k][c]=out[k]
def breaks(g):
    H,W=len(g),len(g[0])
    for r in range(H):
        for c in range(W):
            v=g[r][c]
            if v in ('g','.','#'): continue
            for dr,dc in ((0,1),(1,0)):
                cells=[(r+i*dr,c+i*dc) for i in range(3)]
                if all(0<=a<H and 0<=b<W and g[a][b]==v for a,b in cells):
                    for a,b in cells:
                        for x,y in ((a+1,b),(a-1,b),(a,b+1),(a,b-1)):
                            if 0<=x<H and 0<=y<W and g[x][y]=='g': return True
    return False
def swap(g,r,c):
    h=[row[:] for row in g]
    if h[r][c] in ('g','#') or h[r][c+1] in ('g','#') or (h[r][c]=='.' and h[r][c+1]=='.'): return None
    h[r][c],h[r][c+1]=h[r][c+1],h[r][c]; settle(h); return h
bf=None; shown=0
for line in gzip.open(f,'rt'):
    if line.startswith('BREAKFIRST lines'): bf=int(line.split()[2])
    elif line.startswith('F '):
        fr=int(line.split()[1])
        if lo<=fr<=hi and bf==0 and fr%10==0:
            rows=line.split('|',1)[1].split()[:-1]; g=grid(rows); H,W=len(g),len(g[0])
            one=[(r+1,c+1) for r in range(H) for c in range(W-1) if (h:=swap(g,r,c)) and breaks(h)]
            two=[]
            if not one:
                for r in range(H):
                    for c in range(W-1):
                        h=swap(g,r,c)
                        if not h: continue
                        for r2 in range(H):
                            for c2 in range(W-1):
                                h2=swap(h,r2,c2)
                                if h2 and breaks(h2): two.append(((r+1,c+1),(r2+1,c2+1))); break
                            if two: break
                        if two: break
            print(fr, 'one-swap breaks', one[:4], '| two-swap', two[:1])
        bf=None
