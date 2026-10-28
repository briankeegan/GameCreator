// THE PROPOSERS (plans/decision.md step 2): each kind of move the bot can make, one function each. A proposer reads
// what the searches found and offers lines; it decides nothing. The searches run once a decision (searchAll).

// THE DECISION'S CONTEXT the proposers and the rank read (answer.c fills it): the question, the profile's numbers, the clock
typedef struct {
  int32_t mode, ms, extendMs, width, depth, pool, extendDepth, extendOff;   // the profile's gambit (GP)
} Profile;
typedef struct {
  Profile GP;
  double due, t0, margin;          // ms; due 0: no deadline
  int32_t idle;                    // the decision before held or had nothing to play (bot._gambitIdle)
  int32_t reaction;
  Broke *br;                       // the break search's answer (0: none)
  int32_t brMs;
} Ctx2;
static Ctx2 C2;
// what the searches may take: the decision's time less the answer's margin and a quarter of it kept for judging what they found --
// searchesEnd, the share every search runs in (answer.c answerTurn), so no search runs into the judging's quarter
static double searchesEnd(void) { return C2.due ? C2.due - C2.margin - (C2.due - C2.t0) / 4 : 0; }
// THE ORDER'S OWN SHARE (decide.c ranked: the readiness asked of each line, the survival backup, the three taken out): half the time the
// decision has left once the order is first made -- the other half the save's and the answer's. Its own, not the searches': the searches
// spend theirs to its end, and an order searched in a share already out searches nothing
static double orderEnd(void) { if (!C2.due) return 0; double now = nowMs(), end = C2.due - C2.margin; return now < end ? now + (end - now) / 2 : end; }

// ---- the board's state the proposers read
static int cascadeLive(Board *b) {
  if (b->chainCounter > 0) return 1;
  int stop = b->stopTime + b->preStopTime > 0;
  if (hasChainingPanels(b)) return 1;
  return stop && hasActivePanels(b);
}
static int32_t popLeft(const Board *b) {
  int32_t t = 0;
  for (int r = 0; r < b->nrows; r++) for (int c = 1; c <= W; c++) { const int32_t *f = b->p[r][c].f; if (f[ISGARBAGE] && f[STATE] == MATCHED && f[TIMER] > t) t = f[TIMER]; }
  return t;
}

#define LANDED_MS 40       // and the time it is given
#define MAXSTARTS 8
// THE SEARCHES, run once a decision: the planner, the extension of a chain falling or a slab popping, readiness, levelling
typedef struct {
  int32_t haveAp; Plan ap;
  int32_t haveEx; Ext ex; List xAims;
  int32_t haveRd; Readied rd;
  int32_t lvU, lvG;                       // a level swap (0: none)
  int32_t haveRl, rlN, rl[2], rlAt;
  int32_t haveLb, lbN, lb[MAXLINE], lbOne;   // (the break on the board to come: search/ready.c landedBreak; lbOne: one swap, pressed once the block has landed)
  int32_t nstart; XLine start[MAXSTARTS];  // chains begun: a swap that starts a clear, and the links its fall is continued by
  int32_t tried; double idleMs, searchMs;
  int32_t haveFs, fsN, fs[MAXPATH];   // (the flatten search's line: search/solve.c)
} Found;
#define READY_LINE_MS 120
// whether a list asks for a chain at all
static int wantsChain(const List *L) { for (int i = 0; i < L->n; i++) if (L->aim[i].chain.op && listWantsLonger(L, 1)) return 1; return 0; }
static LOCAL Ctx *startCtx;
static void startChains(const Read *R, Found *S, double ms) {
  if (ms < 5) return;
  Profile *GP = &C2.GP;
  double t0 = nowMs(), shareOld = clockShareBegin(t0 + ms);
  Ctx *x = startCtx = ctxOf(startCtx);
  int root = rootOf(x, &decQ);
  if (root < 0) { clockShareEnd(shareOld); return; }
  static LOCAL int32_t ms_[MAXROWS * W], starts[MAXROWS * W];
  int nm = swapsOfNode(x, root, ms_), ns = 0;
  // (the swaps that start a clear: played to the settle, they clear panels)
  for (int j = 0; j < nm && !clockOut(); j++) {
    int out = step(x, root, MK_SETTLE, CR(ms_[j]), CC(ms_[j]), 0);
    Stats st;
    if (liveNode(x, out) && statsOf(x, out, &st) && st.cleared > 0) starts[ns++] = ms_[j];
  }
  for (int j = 0; j < ns && S->nstart < MAXSTARTS && !clockOut(); j++) {
    int sw = step(x, root, MK_SWAP, CR(starts[j]), CC(starts[j]), 0);
    if (!liveNode(x, sw)) continue;
    Question q = decQ; q.b = ensureBoard(x, sw); q.holdLeft = 0; q.holdStarted = 0;
    if (!q.b) continue;
    double left = t0 + ms - nowMs();
    if (left < 2) break;
    ExtOpts eo = { GP->width ? GP->width : 40, GP->extendDepth ? GP->extendDepth : 6, &R->guides, R->by ? R->by : NOT_ASKED, R->keepOn ? &R->keep : 0,
                   left / (ns - j) };
    Ext E;
    extend(&q, &eo, &E);
    if (!E.best.set || E.best.aimIndex < 0 || E.best.nseq + 1 > PLAN_SEQ) continue;
    XLine *l = &S->start[S->nstart++];
    *l = E.best;
    l->nseq = E.best.nseq + 1; l->seq[0] = starts[j];
    for (int k = 0; k < E.best.nseq; k++) l->seq[k + 1] = E.best.seq[k];
  }
  clockShareEnd(shareOld);
}
// THE SEARCHES BESIDE THIS THREAD (answer.c searchJob): with three workers or more, the list the planner plays for split in two -- its
// first entries planned here, the rest on a worker, two plans at once, each beam led by its own entries -- and the chain extended or
// begun on a worker too; each its own thread's nodes and buffers (LOCAL), its lines merged into this decision's after (searchMerge).
// Asked of before the jobs begin (searchPrep); with fewer workers, or none begun, every search is this thread's, one after another.
static int32_t planSplit, planSplitAt, extBeside, planBDone, extDone;
static List planHalfA, planHalfB;
static PlanOpts planOptsB; static Plan planB; static Paths planOutB;
static double extMsBeside;
static PlanOpts planOptsOf(const Read *R, const List *aims, double ms) {
  Profile *GP = &C2.GP;
  PlanOpts po = { GP->width ? GP->width : 40, GP->depth ? GP->depth : 7, GP->pool ? GP->pool : 250, aims, R->by ? R->by : NOT_ASKED,
                  R->keepOn ? &R->keep : 0, R->readyAt, R->under, R->F.v[FACT_US_DIES] > 0 ? R->F.v[FACT_US_DIES] : 0, R->under, ms,
                  planSeedsHave ? &planSeeds : 0 };
  return po;
}
static void searchPrep(const Read *R, Found *S) {
  memset(S, 0, sizeof *S);
  planSplit = 0; extBeside = 0; planBDone = 0; extDone = 0;
  if (!R->guides.n) return;
  Profile *GP = &C2.GP;
  Board *board = decQ.b;
  // (a slab popping is lined up as the list is written -- the pop is the break; with garbage left, the entries that break again first)
  S->xAims = !R->pop ? R->guides : R->list;
  if (R->pop && R->under) {
    S->xAims = R->guides;
    for (int i = 0; i < R->list.n && S->xAims.n < MAXAIMS; i++) S->xAims.aim[S->xAims.n++] = R->list.aim[i];
    if (S->xAims.n < MAXAIMS) { Aim brk; memset(&brk, 0, sizeof brk); brk.brk = 1; S->xAims.aim[S->xAims.n++] = brk; }
  }
  if (pool.nworkers < 3 || !C2.due || poolBusy) return;
  extBeside = !GP->extendOff && ((cascadeLive(board) || R->pop) || wantsChain(&R->guides));
  extMsBeside = timeLeftMs();
  if (R->guides.n >= 2) {
    planSplitAt = (R->guides.n + 1) / 2;
    planHalfA = R->guides; planHalfA.n = planSplitAt;
    memset(&planHalfB, 0, sizeof planHalfB);
    for (int i = planSplitAt; i < R->guides.n; i++) planHalfB.aim[planHalfB.n++] = R->guides.aim[i];
    planOptsB = planOptsOf(R, &planHalfB, timeLeftMs());
    planSplit = 1;
  }
}
static void searchUnsplit(void) { planSplit = 0; extBeside = 0; }
// (the searches running beside this thread -- answer.c breakBegin: then each, this thread's planner too, has the searches' whole time,
// this one keeping back a fifth for the level and the readiness lines after it, rather than half of what is left)
static int32_t searchBeside;
// (the chain extended or begun, wherever it runs: S->ex or S->start)
static void searchExt(const Read *R, Found *S, double ms) {
  Profile *GP = &C2.GP;
  Board *board = decQ.b;
  if ((cascadeLive(board) || R->pop) && !GP->extendOff && ms >= 20) {
    ExtOpts eo = { GP->width ? GP->width : 40, GP->extendDepth ? GP->extendDepth : 6, &S->xAims, R->by ? R->by : NOT_ASKED, R->keepOn ? &R->keep : 0, ms };
    extend(&decQ, &eo, &S->ex); S->haveEx = 1;
  }
  // (A CHAIN IS BEGUN AND CONTINUED: on a board at rest, each swap that starts a clear, then the links its fall is continued by -- the
  // extension's own search, from the board the swap leaves falling; a beginning whose chain ends in the list is a line)
  if (!cascadeLive(board) && !R->pop && !GP->extendOff && wantsChain(&R->guides)) startChains(R, S, ms);
}
static void extJob(const Read *R, Found *S) { searchExt(R, S, extMsBeside); __atomic_store_n(&extDone, 1, __ATOMIC_RELEASE); }
static void planJob(void) {
  planOut.n = 0; planSeeded = 0;
  plan(&decQ, &planOptsB, &planB);
  planOutB = planOut;
  __atomic_store_n(&planBDone, 1, __ATOMIC_RELEASE);
}
static int pLineBetter(const PLine *a, const PLine *b, int how) {   // (a over b: 0 nearer, 1 more broken, 2 lower, 3 more earned, 4 more sent)
  if (!a->set) return 0;
  if (!b->set) return 1;
  if (how == 0) return a->near > b->near || (a->near == b->near && a->nseq < b->nseq);
  if (how == 1) return a->broke > b->broke || (a->broke == b->broke && a->done < b->done);
  if (how == 2) return a->top < b->top || (a->top == b->top && a->nseq < b->nseq);
  if (how == 4) return a->cells > b->cells || (a->cells == b->cells && a->nseq < b->nseq);
  return a->earned > b->earned || (a->earned == b->earned && a->nseq < b->nseq);
}
static void searchMerge(const Read *R, Found *S) {
  // (THE FLATTEN SEARCH'S LINE, search/solve.c: its own job's answer; with no worker for it, searched here in a third of what is left)
  S->haveFs = 0;
  if (flatJobOn) { if (__atomic_load_n(&flatDone, __ATOMIC_ACQUIRE) && flatOk && flatOutN > 0) { S->haveFs = 1; S->fsN = flatOutN; for (int k = 0; k < flatOutN; k++) S->fs[k] = flatOut[k]; } }
  else if (flatWanted(decQ.b)) {
    double m5 = timeLeftMs() / 3 < FLAT_MS ? timeLeftMs() / 3 : FLAT_MS;
    if (m5 > 1) { int fn = 0; S->haveFs = flattenBreak(&decQ, m5, S->fs, &fn); S->fsN = fn; }
  }
  // (the board to come, its own job's answer once the jobs are taken back: answer.c breakEnd)
  if (landedJobOn && __atomic_load_n(&landedDone, __ATOMIC_ACQUIRE) && landedOk && landedOutN > 0) { S->haveLb = 1; S->lbN = landedOutN; S->lbOne = landedOutOne; for (int k = 0; k < landedOutN; k++) S->lb[k] = landedOut[k]; }
  if (planSplit && __atomic_load_n(&planBDone, __ATOMIC_ACQUIRE)) {
    for (int i = 0; i < planHalfB.n && planSplitAt + i < MAXAIMS; i++)
      if (planB.perAim[i].set) { S->ap.perAim[planSplitAt + i] = planB.perAim[i]; S->ap.perAim[planSplitAt + i].aimIndex = planSplitAt + i; }
    if (pLineBetter(&planB.nearest, &S->ap.nearest, 0)) S->ap.nearest = planB.nearest;
    if (pLineBetter(&planB.quick, &S->ap.quick, 1)) S->ap.quick = planB.quick;
    if (pLineBetter(&planB.lowest, &S->ap.lowest, 2)) S->ap.lowest = planB.lowest;
    if (pLineBetter(&planB.stopBest, &S->ap.stopBest, 3)) S->ap.stopBest = planB.stopBest;
    if (pLineBetter(&planB.pair, &S->ap.pair, 4)) { S->ap.pair = planB.pair; if (S->ap.pair.aimIndex >= 0) S->ap.pair.aimIndex += planSplitAt; }
    if (!S->haveAp) { S->haveAp = 1; S->ap.setup = planB.setup; S->ap.nsetupLine = planB.nsetupLine; memcpy(S->ap.setupLine, planB.setupLine, sizeof planB.setupLine); }
    for (int i = 0; i < planOutB.n; i++) planKeep(planOutB.path[i], planOutB.len[i]);
  }
  // (a chain the workers did not begin: extended or begun here, in what is left)
  if (extBeside && !__atomic_load_n(&extDone, __ATOMIC_ACQUIRE)) searchExt(R, S, timeLeftMs() / 2);
}
static void searchAll(const Read *R, Found *S) {
  if (!R->guides.n) return;
  // (EVERY SEARCH TAKES A SHARE OF THE TIME THE DECISION HAS: half of what is left when it begins -- timeLeftMs, in the searches' share, already keeps back the
  // judging's quarter -- so a decision with a second to its move searches a second's worth, and one with a frame, a frame's)
  if (!extBeside) { double xMs = timeLeftMs() / 2; searchExt(R, S, xMs < timeLeftMs() ? xMs : timeLeftMs()); }
  // (idle time is planning time -- while the board left alone lives; a board the hold loses keeps the time for the survival search)
  double usual = searchBeside ? timeLeftMs() * 0.8 : timeLeftMs() / 2;
  int idle = C2.idle && leftAlone().lives;
  double ms = idle ? (usual > timeLeftMs() ? usual : timeLeftMs()) : usual, extra = ms - (usual > 0 ? usual : 0);
  if (ms >= 20) {
    S->tried++;
    PlanOpts po = planOptsOf(R, planSplit ? &planHalfA : &R->guides, ms);
    plan(&decQ, &po, &S->ap); S->haveAp = 1;
    if (extra > 0) { double v = S->ap.ms - (usual > 0 ? usual : 0); S->idleMs = v < extra ? v : extra; if (S->idleMs < 0) S->idleMs = 0; }
  }
  int32_t nl = R->F.known[FACT_US_NEXTLANDS] ? (int32_t)R->F.v[FACT_US_NEXTLANDS] : 0;
  S->lvU = R->under ? level(&decQ, nl > 0 ? nl : (R->by ? R->by : NOT_ASKED)) : 0;
  if (!R->under && R->readyAt != NOT_ASKED && decQ.narr) { double m2 = timeLeftMs() < 60 ? timeLeftMs() : 60; S->rd = readyFor(&decQ, m2 > 1 ? m2 : 1); S->haveRd = 1; }
  // (READY FOR THE NEXT BLOCK, plans/gambit-next.md 1 and 3: nothing shown, the biggest block the mode has sent landed on this board --
  // the swap after which a break is in reach, so a proof is held before the block is shown)
  else if (!R->under && !decQ.narr && nextBlk.height > 0 && timeLeftMs() > 5) {
    Question q2 = decQ; q2.narr = 1; q2.arr[0] = nextBlk; q2.arr[0].at = nextBlkAt > 0 ? nextBlkAt : END_READY_LEAD;
    double m2 = timeLeftMs() < 60 ? timeLeftMs() : 60; S->rd = readyFor(&q2, m2 > 1 ? m2 : 1); S->haveRd = 1;
  }
  // (the board left alone with no plan once everything shown has landed: a line of one or two swaps that leaves one)
  int32_t lastLand = NOT_ASKED;
  for (int i = 0; i < decQ.narr; i++) if (lastLand == NOT_ASKED || decQ.arr[i].at > lastLand) lastLand = decQ.arr[i].at;
  if (lastLand != NOT_ASKED && !leftAlone().lives) {
    double m3 = timeLeftMs() / 2 < READY_LINE_MS ? timeLeftMs() / 2 : READY_LINE_MS;
    S->haveRl = readyLines(&decQ, lastLand, m3 > 1 ? m3 : 1, S->rl, &S->rlN, &S->rlAt);
  }
  // (the break the next block will need, searched on the board it lands on: while it is still to come, every decision asks it)
  // (a job of its own where a worker has it: answer.c JOB_LANDED, read in searchMerge; else here in what the proposers have)
  if (!landedJobOn && decF.next != NOT_ASKED && decF.next > 0) {
    double m4 = timeLeftMs() / 3 < LANDED_MS ? timeLeftMs() / 3 : LANDED_MS;
    if (m4 > 1) { S->haveLb = landedBreak(&decQ, decF.next + 2, m4, S->lb, &S->lbN); S->lbOne = S->haveLb && landedOne; }
  }
  S->lvG = !R->under && R->readyAt != NOT_ASKED && !(S->haveRd && !S->rd.ready && S->rd.setup) ? level(&decQ, R->readyAt ? R->readyAt : NOT_ASKED) : 0;
}

// THE LEVEL BUILT: topped or under garbage, the line that walks the tallest column's top panel onto a lower
// column beside it, panel after panel, until the stack is level (no column more than one above another) -- each step settled, the
// whole line judged on the engine. A panel walked onto a column is never walked back to the one it came from (judge.c movedUndoes).
// Its length into seq; 0 for none
static int levelLine(const Board *b, int32_t *seq, int cap) {
  int h[W + 2], top = gridLen(b) - 2, n = 0, cameAt[W + 2], cameFrom[W + 2];   // (the height and column of the panel last walked onto a column)
  for (int c = 1; c <= W; c++) { h[c] = 0; cameAt[c] = 0; cameFrom[c] = 0; for (int r = 1; r <= top; r++) if (cellAt(b, r, c) > 0) h[c] = r; }
  while (n < cap) {
    int best = 0, to = 0;
    for (int c = 1; c <= W; c++)
      for (int d = -1; d <= 1; d += 2) {
        int nb = c + d;
        if (nb < 1 || nb > W || h[nb] >= h[c] - 1 || (cameAt[c] == h[c] && cameFrom[c] == nb)) continue;
        if (!best || h[c] > h[best] || (h[c] == h[best] && h[nb] < h[to])) { best = c; to = nb; }
      }
    if (!best) break;
    seq[n++] = h[best] * 8 + (to > best ? best : to);
    if (cameAt[best] == h[best]) cameAt[best] = 0;
    h[best]--; h[to]++;
    cameAt[to] = h[to]; cameFrom[to] = best;
  }
  return n;
}

// ---- the candidates
static int candOf(Cand *k, int play, const int32_t *seq, int n, int aim, int extend) {
  memset(k, 0, sizeof *k);
  if (!seq || n <= 0 || !seq[0]) return 0;
  k->set = 1; k->play = play; k->nseq = imin(n, MAXLINE); k->aim = aim; k->extend = extend; k->settled = -1;
  for (int i = 0; i < k->nseq; i++) k->seq[i] = seq[i];
  k->x.floor = -1; k->xFire = -1; k->xDone = -1;
  return 1;
}
static void xFromPlan(Cand *k, const PLine *l) {
  k->x.combo = l->combo; k->x.chain = l->chain; k->x.broke = l->broke; k->x.cells = l->cells; k->x.earned = l->earned; k->x.near = l->near;
  k->x.floor = l->floor; k->xFire = l->fire; k->xDone = l->done; k->xNats = imin(l->nseq, MAXLINE);
  for (int i = 0; i < k->xNats; i++) k->xAts[i] = l->ats[i];
}
static void xFromExt(Cand *k, const XLine *l) {
  k->x.combo = l->combo; k->x.chain = l->chain; k->x.broke = l->broke; k->x.cells = l->cells; k->x.near = l->near; k->x.floor = l->floor;
  k->xFire = l->fire; k->xDone = l->done;
}
static int seenDigHas(const Board *b, int32_t mv);   // (answer.c: the boards this dig has stood on)
static int32_t towardRest[MAXPATH], towardRestLen;   // (answer.c: the rest of the line toward a break played last)
// Every candidate, in the order they are offered: entries, the extension, the nearest, the break line, the break
// search's breaks, toward a break, ready, level, setup, clear
// A THREE GROWN (search/fill.c): each line proposed whose last swap makes a match of three, again with one more panel of its colour walked
// beside the match before that swap -- a combo of four or more buys the stop a three does not (pa.c calculateStopTime). Offered as the
// play that found the three, so its place in the order is that play's; the engine judges whether the match is made.
static Ctx *fillCtx;
static const Board *boardBefore(Ctx *x, const int32_t *seq, int n) {
  if (n <= 0) return decQ.b;
  int node = rootOf(x, &decQ);
  for (int i = 0; i < n && liveNode(x, node); i++) node = step(x, node, MK_SWAP, CR(seq[i]), CC(seq[i]), 0);
  return liveNode(x, node) ? ensureBoard(x, node) : 0;
}
static int growLines(Cand *out, int n, int cap) {
  Ctx *x = fillCtx = ctxOf(fillCtx);
  static Land L; static Fills F;
  for (int i = 0, n0 = n; i < n0 && n < cap && !clockOut(); i++) {
    const Cand *k = &out[i];
    if (k->nseq < 1 || k->grown) continue;
    const Board *B = boardBefore(x, k->seq, k->nseq - 1);
    if (!B) continue;
    int32_t last = k->seq[k->nseq - 1];
    swapLand(B, CR(last), CC(last), &L);
    fillWalks(B, &L, 3, &F);
    for (int w = 0; w < F.n && w < 2 && n < cap; w++) {
      if (k->nseq + F.len[w] > MAXLINE) continue;
      Cand *g = &out[n];
      *g = *k; g->grown = 1; g->nseq = 0;
      for (int j = 0; j < k->nseq - 1; j++) g->seq[g->nseq++] = k->seq[j];
      for (int j = 0; j < F.len[w]; j++) g->seq[g->nseq++] = F.seq[w][j];
      g->seq[g->nseq++] = last;
      g->x.combo = 4; g->xFire = -1; g->xDone = -1; g->xNats = 0;
      n++;
    }
  }
  return n;
}
// THE CONVERTED ROW'S CHAIN (search/fill.c): the panels a break converts fall chaining once its pop is over, so a panel of their colour
// waiting beside where they land makes a link of a chain. While a pop runs, the land is the board left alone and the colours are the ones
// the screen has drawn; before a break is pressed, the land is the break line's own end and the colours the board already shows -- the
// break line and the walk after it, one line. Each a candidate like any other (PLAY_CONVERT), judged on the engine and in time.
static int convertLines(const Read *R, Cand *out, int n, int cap) {
  Ctx *x = fillCtx = ctxOf(fillCtx);
  static Land L; static Fills F;
  #define ADDC(seq_, n_, aim_) do { if (n < cap && candOf(&out[n], PLAY_CONVERT, seq_, n_, aim_, 1)) { out[n].settled = 0; n++; } } while (0)
  if (R->pop) {
    const Board *E = lineEnd(0, 0, 0);
    if (E && settledLand(decQ.b, E, &L)) { fillWalks(decQ.b, &L, 2, &F); for (int w = 0; w < F.n; w++) ADDC(F.seq[w], F.len[w], -1); }
  }
  if (R->under && !R->pop) {
    for (int i = 0, n0 = n; i < n0 && n < cap && !clockOut(); i++) {
      const Cand *k = &out[i];
      if (!(k->x.broke > 0) || k->grown || k->play == PLAY_CONVERT) continue;
      int st = k->settled >= 0 ? k->settled : settledPlay(k->play);
      const Board *E0 = lineEnd(k->seq, k->nseq, st);
      if (!E0) continue;
      static Board *E; if (!E) E = nb_new(); if (!E) break;
      cloneBoard(E, E0);
      const Board *B = boardBefore(x, k->seq, k->nseq);
      if (!B || !settledLand(B, E, &L)) continue;
      fillWalks(B, &L, 2, &F);
      for (int w = 0; w < F.n && w < 2; w++) {
        if (k->nseq + F.len[w] > MAXLINE) continue;
        int32_t seq[MAXLINE], m = 0;
        for (int j = 0; j < k->nseq; j++) seq[m++] = k->seq[j];
        for (int j = 0; j < F.len[w]; j++) seq[m++] = F.seq[w][j];
        ADDC(seq, m, k->aim);
      }
    }
  }
  #undef ADDC
  return n;
}
// WORK ON THE WAY (plans/gambit-infra.md B, D): a settled line whose first swap is a walk away, again with a swap made first on a cell
// the cursor passes anyway (a step aside at most) that does something there -- it clears, or it sets up: the board it settles to has the
// nearest break nearer (search/break.c nearOf, under garbage) or its colours more connected (search/plan.c connectedOf, the planner's own
// setup measure). Only the swaps on some line's way are stepped (on every thread: core/nodes.h stepBatch), the most useful first: a
// clear, then the break brought nearer, then the colours joined. Offered as the play it was made from, every swap pressed once the board
// settles; the engine judges the whole of it, so a swap that spoils the line or leaves the board no better is ranked by what it does.
#define WAY_MIN 3     // the cursor's actions to a line's first swap before its way is searched
#define WAY_PER 2     // lines on the way, a line
#define WAY_LINES 6   // the lines whose way is searched, in the order offered
static int32_t wayOffered, wayPlayed;   // (the lines on the way this decision offered, and whether one was played: the log's)
static int32_t pairOffered;              // (the lines firing two ideas this decision offered: the log's)
static int waySharesCell(int32_t a, int32_t b) { return CR(a) == CR(b) && iabs(CC(a) - CC(b)) <= 1; }
static int onWay(int r0, int c0, int32_t s, int32_t first, int d) {
  return actionsFor(r0, c0, CR(s), CC(s), walkLeft()) + actionsFor(CR(s), CC(s), CR(first), CC(first), walkLeft()) <= d + 1;
}
static int wayLines(Cand *out, int n, int cap) {
  wayOffered = 0;
  if (hasActivePanels(decQ.b) || clockOut()) return n;
  Ctx *x = fillCtx = ctxOf(fillCtx);
  int root = rootOf(x, &decQ);
  if (root < 0) return n;
  int r0 = decQ.b->curRow, c0 = decQ.b->curCol;
  // (the lines whose way is searched, and the swaps on any of their ways)
  static int32_t want[WAY_LINES], wantD[WAY_LINES], ms[MAXROWS * W], on[MAXROWS * W], par[MAXROWS * W], score[MAXROWS * W], idx[MAXROWS * W], tmp[MAXROWS * W];
  int nw = 0;
  for (int i = 0; i < n && nw < WAY_LINES; i++) {
    const Cand *k = &out[i];
    if (k->nseq < 1 || k->nseq >= MAXLINE || k->way || k->grown || !(k->settled >= 0 ? k->settled : settledPlay(k->play))) continue;
    int d = actionsFor(r0, c0, CR(k->seq[0]), CC(k->seq[0]), walkLeft());
    if (d < WAY_MIN) continue;
    want[nw] = i; wantD[nw++] = d;
  }
  if (!nw) return n;
  int nm = swapsOfNode(x, root, ms), no = 0;
  for (int j = 0; j < nm; j++) {
    int any = 0;
    for (int w = 0; w < nw && !any; w++) any = onWay(r0, c0, ms[j], out[want[w]].seq[0], wantD[w]);
    if (any) { on[no] = ms[j]; par[no++] = root; }
  }
  if (!no) return n;
  const Board *b0 = ensureBoard(x, root);
  int under = decF.under;   // (the one under-garbage test: decide.c read)
  int32_t near0 = under ? nearOf(b0) : 0, conn0 = connectedOf(b0);
  stepBatch(x, par, on, MK_SETTLE, no);
  int nu = 0;
  for (int j = 0; j < no; j++) {
    int o = stepTake(x, j, root, MK_SETTLE, on[j]);
    Stats st;
    if (!liveNode(x, o) || !statsOf(x, o, &st)) continue;
    const Board *b = ensureBoard(x, o);
    if (!b) continue;
    int32_t nearer = under ? near0 - nearOf(b) : 0, joined = connectedOf(b) - conn0;
    // (a clear of three that breaks nothing is no work: a wasted three)
    int32_t sc = st.cleared > 3 || st.broke > 0 ? 1000 + st.cleared : nearer > 0 ? 100 + nearer : joined > 0 ? joined : 0;
    if (sc > 0) { on[nu] = on[j]; score[nu++] = sc; }
  }
  batchDone();
  for (int q = 0; q < nu; q++) idx[q] = q;
  sortByKeyDesc(idx, nu, score, tmp);
  for (int w = 0; w < nw && n < cap; w++) {
    const Cand k0 = out[want[w]];
    int32_t first = k0.seq[0];
    for (int q = 0, added = 0; q < nu && added < WAY_PER && n < cap; q++) {
      int32_t s = on[idx[q]];
      if (!onWay(r0, c0, s, first, wantD[w])) continue;
      int shared = 0;
      for (int m = 0; m < k0.nseq && !shared; m++) shared = waySharesCell(s, k0.seq[m]);
      if (shared) continue;
      int32_t seq[MAXLINE]; seq[0] = s;
      for (int m = 0; m < k0.nseq; m++) seq[m + 1] = k0.seq[m];
      // (twice: each swap pressed once the board settles, and pressed straight through -- the cursor walks on while the swap on its
      // way still clears, so the line it was on its way to is not put off by that clear's time)
      int got = 0;
      for (int at = 0; at < 2 && n < cap; at++) {
        Cand *c = &out[n];
        if (!candOf(c, k0.play, seq, k0.nseq + 1, k0.aim, 0)) continue;
        c->settled = !at; c->way = 1; c->x = k0.x; c->xFire = -1; c->xDone = -1;
        n++; got = 1; wayOffered++;
      }
      added += got;
    }
    // (and two on the way: the two most useful the cursor passes in turn, a step aside at most for each)
    for (int q = 0, done2 = 0; q < nu && !done2 && n < cap && k0.nseq + 2 <= MAXLINE; q++) {
      int32_t a = on[idx[q]];
      for (int u = q + 1; u < nu && !done2 && n < cap; u++) {
        int32_t b = on[idx[u]], s1 = a, s2 = b;
        if (waySharesCell(a, b)) continue;
        int da = actionsFor(r0, c0, CR(a), CC(a), walkLeft()), db = actionsFor(r0, c0, CR(b), CC(b), walkLeft());
        if (db < da) { s1 = b; s2 = a; }
        int walk = actionsFor(r0, c0, CR(s1), CC(s1), walkLeft()) + actionsFor(CR(s1), CC(s1), CR(s2), CC(s2), walkLeft()) +
                   actionsFor(CR(s2), CC(s2), CR(first), CC(first), walkLeft());
        if (walk > wantD[w] + 2) continue;
        int shared = 0;
        for (int m = 0; m < k0.nseq && !shared; m++) shared = waySharesCell(s1, k0.seq[m]) || waySharesCell(s2, k0.seq[m]);
        if (shared) continue;
        int32_t seq[MAXLINE]; seq[0] = s1; seq[1] = s2;
        for (int m = 0; m < k0.nseq; m++) seq[m + 2] = k0.seq[m];
        for (int at = 0; at < 2 && n < cap; at++) {
          Cand *c = &out[n];
          if (!candOf(c, k0.play, seq, k0.nseq + 2, k0.aim, 0)) continue;
          c->settled = !at; c->way = 1; c->x = k0.x; c->xFire = -1; c->xDone = -1;
          n++; wayOffered++; done2 = 1;
        }
      }
    }
  }
  return n;
}
static int proposeAll(const Read *R, const Found *S, Cand *out, int cap) {
  int n = 0;
  pairOffered = 0;
  #define ADD(...) do { if (n < cap && candOf(&out[n], __VA_ARGS__)) n++; } while (0)
  // AN ENTRY: the planner's line for each entry of the list it found one for
  if (S->haveAp) for (int i = 0; i < R->guides.n; i++) if (S->ap.perAim[i].set) { int m0 = n; ADD(PLAY_ENTRY, S->ap.perAim[i].seq, S->ap.perAim[i].nseq, i, 0); if (n > m0) xFromPlan(&out[m0], &S->ap.perAim[i]); }
  // TWO IDEAS FIRED (search/plan.c pair): the planner's line that fires two entries of the list, each step once the board settles -- and
  // the same swaps pressed at once, the second while the first still clears: both attacks out in the time of one, if the engine says
  // the second is still there to press
  if (S->haveAp && S->ap.pair.set) {
    for (int at = 0; at < 2; at++) { int m0 = n; ADD(PLAY_ENTRY, S->ap.pair.seq, S->ap.pair.nseq, S->ap.pair.aimIndex, 0); if (n > m0) { xFromPlan(&out[m0], &S->ap.pair); out[m0].pair = 1; if (at) { out[m0].settled = 0; out[m0].xNats = 0; out[m0].xFire = -1; out[m0].xDone = -1; } } }
    pairOffered += 2;
  }
  // THE EXTENSION: links that keep a chain already falling going (or a popping slab lined up), and the nearest of them to the list
  if (S->haveEx) {
    const XLine *ex = &S->ex.best;
    if (ex->nseq && ex->aimIndex >= 0) {
      int na = R->guides.n, xi = ex->aimIndex, xa = !(R->pop && R->under) ? xi : xi < na ? xi : xi < 2 * na ? xi - na : -1;
      int m0 = n; ADD(R->pop ? PLAY_LINEUP : PLAY_EXTEND, ex->seq, ex->nseq, xa, 1); if (n > m0) xFromExt(&out[m0], ex);
    }
    if (S->ex.nearest.set) { int m0 = n; ADD(R->pop ? PLAY_LINEUP : PLAY_EXTEND, S->ex.nearest.seq, S->ex.nearest.nseq, -1, 1); if (n > m0) xFromExt(&out[m0], &S->ex.nearest); }
  }
  // A CHAIN BEGUN: a swap that starts a clear and the links that continue its fall into an entry of the list
  for (int i = 0; i < S->nstart; i++) { int m0 = n; ADD(PLAY_EXTEND, S->start[i].seq, S->start[i].nseq, S->start[i].aimIndex, 1); if (n > m0) xFromExt(&out[m0], &S->start[i]); }
  // THE NEAREST: the planner's line nearest the list; THE BREAK LINE: its line in time that breaks the most garbage
  if (S->haveAp && S->ap.nearest.set && S->ap.nearest.nseq) { int m0 = n; ADD(PLAY_NEAREST, S->ap.nearest.seq, S->ap.nearest.nseq, -1, 0); if (n > m0) xFromPlan(&out[m0], &S->ap.nearest); }
  if (S->haveAp && S->ap.quick.set) { int m0 = n; ADD(PLAY_BREAKLINE, S->ap.quick.seq, S->ap.quick.nseq, -1, 0); if (n > m0) xFromPlan(&out[m0], &S->ap.quick); }
  // THE BREAK SEARCH'S BREAKS: its line to a break, and every first swap it found breaks (a row each: it counts rows, the planner cells)
  Broke *br = C2.br;
  if (br && br->depth) {
    int play = br->lineup ? PLAY_LINEUPBREAK : PLAY_BREAKSEARCH;
    #define BX(k) do { (k)->x.broke = 6; (k)->xDone = br->at ? br->at : -1; (k)->xFire = br->at ? br->at : -1; } while (0)
    if (br->pathLen) { int m0 = n; ADD(play, br->path, br->pathLen, -1, 0); if (n > m0) BX(&out[m0]); }
    else for (int i = 0; i < br->nmoves; i++) {
      int hasPair = br->pairs[i][0] != 0, m0 = n;
      int32_t one = br->moves[i];
      if (hasPair) ADD(play, br->pairs[i], 2, -1, 0); else ADD(play, &one, 1, -1, 0);
      if (n > m0) { BX(&out[m0]); if (br->lineup == 4 && hasPair) out[m0].settled = 1; }
    }
    #undef BX
  }
  // THE FLATTEN SEARCH'S BREAK (search/solve.c): a break search line, its break known once the board settles
  if (S->haveFs && S->fsN > 0) { int m0 = n; ADD(PLAY_BREAKSEARCH, S->fs, S->fsN, -1, 0); if (n > m0) { out[m0].x.broke = 6; out[m0].xDone = -1; out[m0].xFire = -1; } }
  // TOWARD A BREAK: under garbage with none in reach, the line begun last gone on with first, then the break search's lines: the first
  // whose first swap does not bring back a board this dig has already stood on
  if (R->under && br) {
    static int32_t lines[KEEPN + 2][MAXPATH], lens[KEEPN + 2];
    int nl = 0;
    const Paths *tw = &br->towards;
    if (tw->n) for (int i = 0; i < tw->n && nl < KEEPN; i++) { lens[nl] = tw->len[i]; for (int k = 0; k < tw->len[i]; k++) lines[nl][k] = tw->path[i][k]; nl++; }
    else if (br->towardLen) { lens[nl] = br->towardLen; for (int k = 0; k < br->towardLen; k++) lines[nl][k] = br->toward[k]; nl++; }
    static int32_t ord[KEEPN + 2][MAXPATH], olen[KEEPN + 2];
    int no = 0;
    if (towardRestLen) {
      // (the lines that carry the one begun further, then its rest, then the others)
      for (int pass = 0; pass < 3; pass++) {
        if (pass == 1) { olen[no] = towardRestLen; for (int k = 0; k < towardRestLen; k++) ord[no][k] = towardRest[k]; no++; continue; }
        for (int i = 0; i < nl; i++) {
          int starts = lens[i] >= towardRestLen;
          for (int k = 0; k < towardRestLen && starts; k++) starts = lines[i][k] == towardRest[k];
          if ((pass == 0) != !!starts) continue;
          olen[no] = lens[i]; for (int k = 0; k < lens[i]; k++) ord[no][k] = lines[i][k]; no++;
        }
      }
    } else for (int i = 0; i < nl; i++) { olen[no] = lens[i]; for (int k = 0; k < lens[i]; k++) ord[no][k] = lines[i][k]; no++; }
    for (int i = 0; i < no; i++) {
      if (!olen[i]) continue;
      if (seenDigHas(decQ.b, ord[i][0])) continue;
      ADD(PLAY_TOWARD, ord[i], olen[i], -1, 0);
      break;
    }
  }
  // READY: the swap that leaves the next block breakable when it lands, and the line that leaves a plan once everything has landed
  if (S->haveRd && !S->rd.ready && S->rd.setup) { int32_t one = S->rd.setup; ADD(PLAY_READY, &one, 1, -1, 0); }
  if (S->haveRl) { int m0 = n; ADD(PLAY_READY, S->rl, S->rlN, -1, 0); if (n > m0) out[m0].xDone = S->rlAt; }
  if (S->haveLb && !S->lbOne) ADD(PLAY_READY, S->lb, S->lbN, -1, 0);
  // (THE ONE-SWAP BREAK CHECKED, not offered: judged pressed once the block has landed, its cells broken logged against the search's
  // claim of a break -- search/ready.c landedOne)
  if (S->haveLb && S->lbOne && decF.next != NOT_ASKED && timeLeftMs() > 2) { Outcome lo = outcomeOf(S->lb, 1, 0, 0, decF.next + 2); landedOneBroke = lo.late || lo.j.dead ? -1 : lo.j.made.broke; }
  // (LOWERING THE STACK: the tallest column's top walked onto a lower one, each step settled -- on any board with a column two above
  // its neighbour, the move when there is nothing better to do (rank.c markIdle); topped or under garbage, a perched block let down too
  // -- its supports walked out from under it (search/break.c perchedDrops). Each judged as any line: a lower stack is a later loss)
  // (never while a slab pops -- its first swap waits out the pop; on a board at rest only, unless topped or under garbage: panels walked
  // while a chain falls spoil what the board makes alone)
  if (!R->pop && (R->topped || R->under || (!hasActivePanels(decQ.b) && decQ.b->chainCounter == 0))) {
    static int32_t lv[MAXLINE]; int nl = levelLine(decQ.b, lv, MAXLINE);
    if (nl > 0) { int m0 = n; ADD(PLAY_LEVEL, lv, nl, -1, 0); if (n > m0) out[m0].settled = 1; } }
  if (R->topped || R->under) {
    static Perches pd; perchedDrops(decQ.b, &pd);
    for (int i = 0; i < pd.n; i++) { int m0 = n; ADD(PLAY_LEVEL, pd.seq[i], pd.len[i], -1, 0); if (n > m0) out[m0].drop = 1; }
  }
  // LEVEL: the swap that flattens the stack, under garbage or before a block lands
  // (a swap that clears nothing and brings back a board this dig has stood on goes nowhere: not offered)
  if (S->lvU && !seenDigHas(decQ.b, S->lvU)) { int32_t one = S->lvU; ADD(PLAY_LEVEL, &one, 1, -1, 0); }
  if (S->lvG && !seenDigHas(decQ.b, S->lvG)) { int32_t one = S->lvG; ADD(PLAY_LEVEL, &one, 1, -1, 0); }
  // SET UP: the planner's swap toward the ask, with no block on its way; CLEAR: the line that leaves the lowest stack
  // (the set-up as the line the planner found it on, the whole way to the board it builds toward: its first swap played, the rest carried
  // on as the line in progress -- decide.c carryOf -- judged again each decision, so a set-up built is one the next decisions know of)
  if (S->haveAp && S->ap.setup && R->readyAt == NOT_ASKED && !seenDigHas(decQ.b, S->ap.setup)) {
    if (S->ap.nsetupLine > 1) { int m0 = n; ADD(PLAY_SETUP, S->ap.setupLine, S->ap.nsetupLine, -1, 0); if (n > m0) out[m0].settled = 1; }
    int32_t one = S->ap.setup; ADD(PLAY_SETUP, &one, 1, -1, 0);
  }
  if (S->haveAp && S->ap.lowest.set) { int m0 = n; ADD(PLAY_CLEAR, S->ap.lowest.seq, S->ap.lowest.nseq, -1, 0); if (n > m0) xFromPlan(&out[m0], &S->ap.lowest); }
  #undef ADD
  // (and from the lines above: the converted row's chain, then every three grown -- the converted lines' own among them)
  n = convertLines(R, out, n, cap);
  n = growLines(out, n, cap);
  n = wayLines(out, n, cap);
  return n;
}
