// THE PLANNER (as Gambit asks it: a list of aims): a beam over swaps, each step played to the
// board's settle, ranked by how near the list the lines one swap on come (o.near: GAMBIT.lead) and then by how connected the board is.
// It keeps, of the lines in time (their last swap begun by `by`) whose board keeps the floor:
//   perAim    for each entry of the list, the line that meets it sending the most garbage (the fewer swaps between equals)
//   nearest   the line nearest the list
//   quick     the line that breaks the most garbage (the sooner between equals) -- and with breakAtSwap, a line the engine settles
//             dead, played again only to its swap, that breaks by then
//   lowest    of the lines done before the board dies (dies), the one that leaves the lowest stack
//   setup     the first swap of the board nearest the list, else the most connected one, reached so far
// A line is kept as an answer only when its end is within the rules through its settle and passes the shared line check. With
// readyAt (a block on its way), an entry's line and the nearest are kept only if the board they leave breaks that block once landed.

#define PLAN_SEQ 16
typedef struct { int32_t n, nseq, seq[PLAN_SEQ], ats[PLAN_SEQ], h, set; double reach; int32_t kid0, nkids; } PItem;   // (a board of the beam, or a kid of one)
typedef struct {
  int32_t set, n, nseq, seq[PLAN_SEQ], ats[PLAN_SEQ];
  int32_t brk, cells, chain, combo, broke, earned, done, fire, floor, aimIndex, top;
  double near;
} PLine;
typedef struct {
  int32_t width, depth, pool;
  const List *aims;          // the list the search plays for (R.guides)
  int32_t by;                // NOT_ASKED: none
  const Keep *keep;          // the floor (R.keepF)
  int32_t readyAt;           // NOT_ASKED: none
  int32_t under;             // garbage on the board: the lead counts a break
  double dies;               // 0: none
  int32_t breakAtSwap;
  double ms;                 // the planner's share, ms
} PlanOpts;
typedef struct { PLine perAim[MAXAIMS], nearest, quick, lowest, stopBest; int32_t setup; double ms; int32_t base; } Plan;

static Ctx *planCtx;
// how connected a board is: like colours side by side, and (twice) one above the other
static int32_t connectedOf(const Board *b) {
  int R = gridLen(b), n = 0;
  for (int r = 1; r < R - 1; r++) for (int c = 1; c <= W; c++) {
    int32_t k = cellAt(b, r, c);
    if (!(k > 0 && k < 8)) continue;
    if (c < W && cellAt(b, r, c + 1) == k) n += 1;
    if (r + 1 < R && cellAt(b, r + 1, c) == k) n += 2;
  }
  return n;
}
// THE SHAPE of a settled board: its top row, evenness, hollow (empty cells under garbage) -- the board's shape as the facts read it
// (search/bits.c bitsShape)
typedef struct { int32_t top, even, hollow; } Shape;
static Shape shapeOf(const Board *b) {
  static Bits PB; static BoardShape PS;
  bitsOf(b, &PB); bitsShape(&PB, &PS);
  Shape s = { PS.top, PS.even, PS.hollow };
  return s;
}
// the garbage a step's clears send: each clear's combo garbage and a slab for every link past the first (attacker sent)
static int32_t sentCells(const Stats *s) {
  int32_t n = 0, chain = chainOfStats(s);
  for (int j = 0; j < s->n; j++) n += comboCells(s->size[j]);
  if (chain > 1) n += W * (chain - 1);
  return n;
}
static void lineFrom(PLine *l, const PItem *it, int32_t mv, int32_t node, int32_t fire) {
  l->set = 1; l->n = node; l->nseq = imin(it->nseq + 1, PLAN_SEQ);
  for (int k = 0; k < it->nseq && k < PLAN_SEQ; k++) { l->seq[k] = it->seq[k]; l->ats[k] = it->ats[k]; }
  if (it->nseq < PLAN_SEQ) { l->seq[it->nseq] = mv; l->ats[it->nseq] = fire; }
  l->fire = fire;
}
// READY (readyAfter): the board the line leaves, run to readyAt and settled, breaks the block with one swap
static int readyAfter(Ctx *x, int n, int32_t readyAt) {
  int land = step(x, n, MK_LONG, 0, 0, imax(1, readyAt + 2 - NODE(x, n)->t));
  if (liveNode(x, land)) { int s0 = settleOf(x, land); if (s0 != STEP_NULL && s0 != STEP_ERR) land = s0; }
  if (!liveNode(x, land)) return 0;
  int32_t base = NODE(x, land)->brk, ms[MAXROWS * W];
  int nm = swapsOfNode(x, land, ms), any = 0;
  for (int q = 0; q < nm; q++) { int o = step(x, land, MK_SWAP, CR(ms[q]), CC(ms[q]), 0); if (liveNode(x, o) && NODE(x, o)->brk > base) any = 1; }
  return any;
}

#define PLAN_POOL 4096
#define PLAN_KIDS 65536
static void plan(const Question *q, const PlanOpts *o, Plan *P) {
  memset(P, 0, sizeof *P);
  double t0 = nowMs(), shareOld = clockShareBegin(t0 + o->ms);
  Ctx *x = planCtx = ctxOf(planCtx);
  int root = rootOf(x, q);
  if (root < 0) { clockShareEnd(shareOld); return; }
  // a cascade already running sends what it sends whatever is swapped: only what a swap adds to it counts
  int baseOut = settleOf(x, root);
  int32_t base = 0;
  Stats bs;
  if (liveNode(x, baseOut) && statsOf(x, baseOut, &bs) && bs.cleared > 0) base = sentCells(&bs);
  // (and the garbage it converts whatever is pressed -- a slab popping: a line's first step breaks what it breaks beyond it, as the judge
  // counts it; the steps after begin once that settle is over)
  int32_t baseBroke = liveNode(x, baseOut) && statsOf(x, baseOut, &bs) ? bs.broke : 0;
  #define BROKE_OF(it, st) imax(0, (st).broke - ((it)->nseq ? 0 : baseBroke))
  P->base = base;
  int32_t rootH = connectedOf(ensureBoard(x, root));
  int32_t setH = rootH, haveSetup = 0; double setReachD = 0;
  // (garbage broken by frame t standing still: a slab already popping goes on converting whatever is pressed)
  BS still; memset(&still, 0, sizeof still); still.x = x; still.root = root;
  static PItem poolA[PLAN_POOL], poolB[PLAN_POOL];
  static PItem kids[PLAN_KIDS];
  static int32_t idx[PLAN_KIDS], tmpI[PLAN_KIDS], keyB[PLAN_KIDS], ms[MAXROWS * W];
  PItem *pool = poolA, *next = poolB;
  int npool = 1;
  memset(&pool[0], 0, sizeof pool[0]); pool[0].n = root; pool[0].h = rootH;
  int na = o->aims ? o->aims->n : 0;
  for (int d = 1; d <= o->depth && npool && !clockOut(); d++) {
    int nk = 0, nj = 0;
    static int32_t jobP[PLAN_KIDS], jobM[PLAN_KIDS], jobOut[PLAN_KIDS];
    for (int pi = 0; pi < npool; pi++) { pool[pi].reach = 0; pool[pi].nkids = 0; }
    // the level's jobs: every legal swap of every board in the pool, played to the board's settle
    for (int pi = 0; pi < npool; pi++) { int nm = swapsOfNode(x, pool[pi].n, ms); for (int j = 0; j < nm && nj < PLAN_KIDS; j++) { jobP[nj] = pi; jobM[nj++] = ms[j]; } }
    for (int j = 0; j < nj; j++) jobOut[j] = clockOut() ? STEP_NULL : step(x, pool[jobP[j]].n, MK_SETTLE, CR(jobM[j]), CC(jobM[j]), 0);
    // (A BREAK JUDGED AT ITS BREAK: a line the engine settles dead -- the next slab lands while the board settles -- is played again
    // only to its swap; if the board then breaks garbage that standing still would not have by the same frame, it is a break, kept as
    // the quick break and grown no further)
    if (o->breakAtSwap && !clockOut())
      for (int j = 0; j < nj; j++) {
        if (jobOut[j] != STEP_DEAD) continue;
        PItem *it = &pool[jobP[j]];
        int32_t m = jobM[j];
        int sw = step(x, it->n, MK_SWAP, CR(m), CC(m), 0);
        if (!liveNode(x, sw) || !stepFitsAt(x, sw)) continue;
        int32_t bk = NODE(x, sw)->brk - stillAt(&still, NODE(x, sw)->t);
        if (o->by != NOT_ASKED && NODE(x, it->n)->t > o->by) bk = 0;
        if (bk > 0 && (!P->quick.set || bk > P->quick.broke || (bk == P->quick.broke && NODE(x, sw)->t < P->quick.done))) {
          PLine *l = &P->quick; memset(l, 0, sizeof *l);
          lineFrom(l, it, m, sw, NODE(x, it->n)->t);
          l->brk = 1; l->broke = bk; l->done = NODE(x, sw)->t; l->aimIndex = -1; l->floor = -1;
        }
      }
    // the level read in the order it was made: every board within the rules is a kid of its parent; one that clears is weighed
    for (int pi = 0; pi < npool; pi++) pool[pi].kid0 = -1;
    for (int j = 0; j < nj; j++) {
      if ((j & 31) == 31 && clockOut()) break;
      PItem *it = &pool[jobP[j]];
      int32_t m = jobM[j];
      int out = jobOut[j];
      if (!liveNode(x, out)) continue;
      Stats st; statsOf(x, out, &st);
      // (HOW NEAR A BOARD IS, it is of the board: a swap outside the list -- never played -- still says how near its parent comes, so it
      // counts toward the parent's reach; it is kept as no line and grows no kid)
      if (!stepFitsAt(x, out)) {
        if (st.cleared > 0 && !(o->by != NOT_ASKED && NODE(x, it->n)->t > o->by)) {
          Made mo = { biggestOf(&st), chainOfStats(&st), BROKE_OF(it, st), imax(0, sentCells(&st) - base) };
          double nr = leadOf(o->aims, mo, o->under);
          if (nr > it->reach) it->reach = nr;
        }
        continue;
      }
      if (!it->nseq && !firstOk(CR(m), CC(m), NODE(x, out)->brk > stillAt(&still, NODE(x, out)->t) ? 2 : st.cleared > 0)) continue;
      if (st.cleared > 0) {
        int32_t fire = NODE(x, it->n)->t, chain = chainOfStats(&st), bigC = biggestOf(&st), done = NODE(x, out)->t;
        int32_t seqTmp[PLAN_SEQ + 1], ns = 0;
        for (int k = 0; k < it->nseq && ns < PLAN_SEQ; k++) seqTmp[ns++] = it->seq[k];
        seqTmp[ns++] = m;
        int endOk = -1;
        #define OKE() (endOk < 0 ? (endOk = allowedAt(x, out) && lineFits(seqTmp, ns, 1)) : endOk)
        Made made = { bigC, chain, BROKE_OF(it, st), imax(0, sentCells(&st) - base) };
        Board *ob = ensureBoard(x, out);
        int inTime = !(o->by != NOT_ASKED && fire > o->by), kept = keepsFloor(o->keep, ob, made.broke), floor = keepsFloor(o->keep, ob, 0);
        #define FILL(L, ai) do { memset(&(L), 0, sizeof (L)); lineFrom(&(L), it, m, out, fire); (L).cells = made.cells; (L).chain = chain; (L).combo = bigC; \
                                 (L).broke = made.broke; (L).earned = st.earned; (L).done = done; (L).floor = floor; (L).aimIndex = (ai); (L).brk = made.broke > 0; } while (0)
        if (!(o->dies > 0 && done > o->dies)) {
          Shape shp = shapeOf(ob);
          if ((!P->lowest.set || shp.top < P->lowest.top || (shp.top == P->lowest.top && ns < P->lowest.nseq)) && OKE()) { FILL(P->lowest, -1); P->lowest.top = shp.top; }
          if (st.earned > 0 && (!P->stopBest.set || st.earned > P->stopBest.earned || (st.earned == P->stopBest.earned && ns < P->stopBest.nseq)) && OKE()) FILL(P->stopBest, -1);
        }
        if (inTime && kept && made.broke > 0 && (!P->quick.set || made.broke > P->quick.broke || (made.broke == P->quick.broke && done < P->quick.done)) && OKE()) { FILL(P->quick, -1); P->quick.brk = 1; }
        if (inTime && kept) {
          double nr = leadOf(o->aims, made, o->under);
          if (nr > it->reach) it->reach = nr;
          if (nr > 0 && (!P->nearest.set || nr > P->nearest.near || (nr == P->nearest.near && ns < P->nearest.nseq)) && OKE()) { FILL(P->nearest, -1); P->nearest.near = nr; }
          for (int ai = 0; ai < na; ai++) {
            if (!meets(&o->aims->aim[ai], made)) continue;
            PLine *pa = &P->perAim[ai];
            if ((!pa->set || made.cells > pa->cells || (made.cells == pa->cells && ns < pa->nseq)) && OKE()) FILL(*pa, ai);
          }
        }
        #undef FILL
        #undef OKE
      }
      if (nk < PLAN_KIDS) {
        PItem *k = &kids[nk]; memset(k, 0, sizeof *k); k->n = out; k->nseq = imin(it->nseq + 1, PLAN_SEQ);
        for (int q2 = 0; q2 < it->nseq && q2 < PLAN_SEQ; q2++) { k->seq[q2] = it->seq[q2]; k->ats[q2] = it->ats[q2]; }
        if (it->nseq < PLAN_SEQ) { k->seq[it->nseq] = m; k->ats[it->nseq] = NODE(x, it->n)->t; }
        if (!it->nkids) it->kid0 = nk;   // (a parent's kids are made one after another: its swaps are one run of jobs)
        nk++; it->nkids++;
      }
    }
    // the pool ranked by how near the list its lines one swap on come, then how connected; their kids, each board once, ranked by how
    // connected, make the next pool
    static double reachK[PLAN_POOL];
    for (int pi = 0; pi < npool; pi++) { idx[pi] = pi; keyB[pi] = pool[pi].h; reachK[pi] = pool[pi].reach; }
    // (reach then how connected, both descending: sorted by connected first, then stably by reach)
    sortByKeyDesc(idx, npool, keyB, tmpI);
    sortByDoubleDesc(idx, npool, reachK, tmpI);
    int nn = 0;
    for (int r = 0; r < npool && r < o->width; r++) {
      int pr = idx[r];
      if (clockOut() && nn) break;
      for (int kk = pool[pr].kid0; kk < pool[pr].kid0 + pool[pr].nkids && nn < PLAN_POOL; kk++) {
        PItem *k = &kids[kk];
        Node *kn = NODE(x, k->n);
        int dup = 0;
        for (int q2 = 0; q2 < nn && !dup; q2++) { Node *on = NODE(x, next[q2].n); dup = on->hash == kn->hash && on->keyn == kn->keyn && !memcmp(on->key, kn->key, sizeof(int32_t) * kn->keyn); }
        if (dup) continue;
        next[nn] = *k; next[nn].h = connectedOf(ensureBoard(x, k->n)); nn++;
      }
    }
    // the most connected board reached so far, if better than the one now: its first swap is a setup -- a board nearer the list one
    // swap on comes first (its reach), so the setup is played toward the same list
    for (int r = 0; r < npool; r++) {
      PItem *it = &pool[idx[r]];
      if (it->nseq && (it->reach > (haveSetup ? setReachD : 0) || (!(haveSetup && setReachD) && !it->reach && it->h > (haveSetup ? setH : rootH)))) {
        haveSetup = 1; setReachD = it->reach; setH = it->h; P->setup = it->seq[0];
      }
    }
    static int32_t nidx[PLAN_POOL];
    for (int q2 = 0; q2 < nn; q2++) { nidx[q2] = q2; keyB[q2] = next[q2].h; }
    sortByKeyDesc(nidx, nn, keyB, tmpI);
    int keepN = imin(nn, o->pool);
    PItem *old = pool; pool = next; next = old;
    static PItem sorted[PLAN_POOL];
    for (int q2 = 0; q2 < keepN; q2++) sorted[q2] = pool[nidx[q2]];
    for (int q2 = 0; q2 < keepN; q2++) pool[q2] = sorted[q2];
    npool = keepN;
  }
  // READY: an entry's line and the nearest kept only if the board it leaves breaks the block on its way once it has landed
  if (o->readyAt != NOT_ASKED) {
    clockShareEnd(shareOld); shareOld = clockShareBegin(t0 + 2 * o->ms);
    for (int ai = 0; ai < na; ai++) if (P->perAim[ai].set && !clockOut() && !readyAfter(x, P->perAim[ai].n, o->readyAt)) P->perAim[ai].set = 0;
    if (P->nearest.set && !readyAfter(x, P->nearest.n, o->readyAt)) P->nearest.set = 0;
  }
  if (!haveSetup) P->setup = 0;
  P->ms = nowMs() - t0;
  clockShareEnd(shareOld);
  #undef BROKE_OF
}

// ---- for a host's check: the planner on the question set (gb_question), the list set (gb_list), its numbers given; back into the io:
// per entry of the list whether a line meets it, its swaps and chain, then the nearest line's near and chain, and the planner's ms
EXPORT(gb_plan) int gb_plan(int width, int depth, int pool, int by, double ms) {
  static Plan P;
  clockStart(0);
  decQ = hostQ; decQ.b = hostBoard;
  PlanOpts o = { width, depth, pool, &theList, by > 0 ? by : NOT_ASKED, 0, NOT_ASKED, 0, 0, 0, ms };
  plan(&decQ, &o, &P);
  int32_t *w = gbIo, k = 0;
  w[k++] = theList.n;
  for (int i = 0; i < theList.n; i++) { w[k++] = P.perAim[i].set; w[k++] = P.perAim[i].nseq; w[k++] = P.perAim[i].chain; }
  w[k++] = (int32_t)(P.nearest.near * 1000); w[k++] = P.nearest.chain; w[k++] = (int32_t)P.ms;
  return k;
}
