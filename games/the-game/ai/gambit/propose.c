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
static double leftMs(void) { return C2.due ? searchesEnd() - nowMs() : 1e9; }
static double leftMsOf(void) { return leftMs(); }

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

#define MAXSTARTS 8
// THE SEARCHES, run once a decision: the planner, the extension of a chain falling or a slab popping, readiness, levelling
typedef struct {
  int32_t haveAp; Plan ap;
  int32_t haveEx; Ext ex; List xAims;
  int32_t haveRd; Readied rd;
  int32_t lvU, lvG;                       // a level swap (0: none)
  int32_t haveRl, rlN, rl[2], rlAt;
  int32_t nstart; XLine start[MAXSTARTS];  // chains begun: a swap that starts a clear, and the links its fall is continued by
  int32_t tried, wide, planDepth, planLong; double idleMs, searchMs, planShare, planFirst;   // (wide: the passes planned again with time over, and kept; the planner's share, and what its first pass took)
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
    if (!E.best.set || E.best.aimIndex < 0 || E.best.nseq + 1 > MAXLINE) continue;
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
  extMsBeside = leftMs();
  if (R->guides.n >= 2) {
    planSplitAt = (R->guides.n + 1) / 2;
    planHalfA = R->guides; planHalfA.n = planSplitAt;
    memset(&planHalfB, 0, sizeof planHalfB);
    for (int i = planSplitAt; i < R->guides.n; i++) planHalfB.aim[planHalfB.n++] = R->guides.aim[i];
    planOptsB = planOptsOf(R, &planHalfB, leftMs());
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
  if (extBeside && !__atomic_load_n(&extDone, __ATOMIC_ACQUIRE)) searchExt(R, S, leftMs() / 2);
}
#define PLAN_URGENT 240   // (frames to the board's loss inside which the planner gives the judging its time: about two breaks' worth)
static void searchAll(const Read *R, Found *S) {
  if (!R->guides.n) return;
  // (EVERY SEARCH TAKES A SHARE OF THE TIME THE DECISION HAS: half of what is left when it begins -- leftMs already keeps back the
  // judging's quarter -- so a decision with a second to its move searches a second's worth, and one with a frame, a frame's)
  if (!extBeside) { double xMs = leftMs() / 2; searchExt(R, S, xMs < leftMs() ? xMs : leftMs()); }
  // (idle time is planning time -- while the board left alone lives; a board the hold loses keeps the time for the survival search)
  // (garbage on the board, or the board lost soon: the lines found must be judged to be played -- the planner takes half, never the most)
  int urgent = R->under || (R->F.v[FACT_US_DIES] > 0 && R->F.v[FACT_US_DIES] < PLAN_URGENT);
  double usual = searchBeside && !urgent ? leftMs() * 0.8 : leftMs() / 2;
  int idle = C2.idle && leftAlone().lives;
  double ms = idle ? (usual > leftMs() ? usual : leftMs()) : usual, extra = ms - (usual > 0 ? usual : 0);
  if (ms >= 20) {
    S->tried++;
    PlanOpts po = planOptsOf(R, planSplit ? &planHalfA : &R->guides, ms);
    double planEnd = nowMs() + ms;
    plan(&decQ, &po, &S->ap); S->haveAp = 1; S->planShare = ms; S->planFirst = S->ap.ms;
    // (THE BEAM SIZED BY THE TIME: the profile's beam is the first pass; a pass done with time over is planned again from its own best
    // lines (its seeds), deeper and as much wider as the time left pays for at the pass's own rate -- each pass holds the last one's
    // lines, so is never the worse -- and kept only where it finished in its time)
    static LOCAL Plan wide; static LOCAL Paths passSeeds, passOut;
    while (!clockOut()) {
      double left = planEnd - nowMs(), last = S->ap.ms > 1 ? S->ap.ms : 1;
      int32_t depth = imin(po.depth + 1, MAXLINE - 1);
      int32_t width = (int32_t)(po.width * (left / (1.3 * last)) * po.depth / depth);
      if (width > PLAN_WIDE_MAX) width = PLAN_WIDE_MAX;
      if (width < po.width) break;
      passSeeds = planOut; passOut = planOut;
      PlanOpts pw = po; pw.width = width; pw.depth = depth; pw.pool = imin(PLAN_POOL, po.pool * width / po.width); pw.ms = left; pw.seeds = &passSeeds;
      double t = nowMs();
      plan(&decQ, &pw, &wide);
      if (nowMs() - t >= pw.ms - 1 || clockOut()) { planOut = passOut; break; }
      wide.ms = nowMs() - t; S->ap = wide; S->wide++; po = pw;
      if (width == PLAN_WIDE_MAX && depth == MAXLINE - 1) break;
    }
    // (the log's: the depth the last pass kept was planned to, and the longest line it ended with)
    S->planDepth = po.depth; S->planLong = S->ap.nsetupLine;
    { const PLine *ls[] = { &S->ap.nearest, &S->ap.quick, &S->ap.lowest, &S->ap.stopBest, &S->ap.pair };
      for (int i = 0; i < 5; i++) if (ls[i]->set && ls[i]->nseq > S->planLong) S->planLong = ls[i]->nseq;
      for (int i = 0; i < MAXAIMS; i++) if (S->ap.perAim[i].set && S->ap.perAim[i].nseq > S->planLong) S->planLong = S->ap.perAim[i].nseq; }
    if (extra > 0) { double v = S->ap.ms - (usual > 0 ? usual : 0); S->idleMs = v < extra ? v : extra; if (S->idleMs < 0) S->idleMs = 0; }
  }
  int32_t nl = R->F.known[FACT_US_NEXTLANDS] ? (int32_t)R->F.v[FACT_US_NEXTLANDS] : 0;
  S->lvU = R->under ? level(&decQ, nl > 0 ? nl : (R->by ? R->by : NOT_ASKED)) : 0;
  if (!R->under && R->readyAt != NOT_ASKED && decQ.narr) { double m2 = leftMs() < 60 ? leftMs() : 60; S->rd = readyFor(&decQ, m2 > 1 ? m2 : 1); S->haveRd = 1; }
  // (the board left alone with no plan once everything shown has landed: a line of one or two swaps that leaves one)
  int32_t lastLand = NOT_ASKED;
  for (int i = 0; i < decQ.narr; i++) if (lastLand == NOT_ASKED || decQ.arr[i].at > lastLand) lastLand = decQ.arr[i].at;
  if (lastLand != NOT_ASKED && !leftAlone().lives) {
    double m3 = leftMs() / 2 < READY_LINE_MS ? leftMs() / 2 : READY_LINE_MS;
    S->haveRl = readyLines(&decQ, lastLand, m3 > 1 ? m3 : 1, S->rl, &S->rlN, &S->rlAt);
  }
  S->lvG = !R->under && R->readyAt != NOT_ASKED && !(S->haveRd && !S->rd.ready && S->rd.setup) ? level(&decQ, R->readyAt ? R->readyAt : NOT_ASKED) : 0;
}

// THE LEVEL BUILT: topped or under garbage, the line that walks the tallest column's top panel onto a lower
// column beside it, panel after panel, until the stack is level (no column more than one above another) -- each step settled, the
// whole line judged on the engine. Its length into seq; 0 for none
static int levelLine(const Board *b, int32_t *seq, int cap) {
  int h[W + 2], top = gridLen(b) - 2, n = 0;
  for (int c = 1; c <= W; c++) { h[c] = 0; for (int r = 1; r <= top; r++) if (cellAt(b, r, c) > 0) h[c] = r; }
  while (n < cap) {
    int best = 0, to = 0;
    for (int c = 1; c <= W; c++)
      for (int d = -1; d <= 1; d += 2) {
        int nb = c + d;
        if (nb < 1 || nb > W || h[nb] >= h[c] - 1) continue;
        if (!best || h[c] > h[best] || (h[c] == h[best] && h[nb] < h[to])) { best = c; to = nb; }
      }
    if (!best) break;
    seq[n++] = h[best] * 8 + (to > best ? best : to);
    h[best]--; h[to]++;
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
static int32_t twinOffered;   // (the two-column lines offered this decision: twinLines)
static int32_t twinRows = -1;   // (and the rows it could sort: six panels at rest on six)
static int32_t twinLo = -2;   // (the fewest swaps a set-up takes on this board: -1 none found, -2 not asked -- the log's)
static const Board *boardBefore(Ctx *x, const int32_t *seq, int n) {
  if (n <= 0) return decQ.b;
  int node = rootOf(x, &decQ);
  for (int i = 0; i < n && liveNode(x, node); i++) node = step(x, node, MK_SWAP, CR(seq[i]), CC(seq[i]), 0);
  return liveNode(x, node) ? ensureBoard(x, node) : 0;
}
static int growLines(Cand *out, int n, int cap) {
  Ctx *x = fillCtx = ctxOf(fillCtx);
  static Land L; static Fills F;
  int bigAsked = 0;
  for (int i = 0; i < theList.n; i++) { const Test *c = &theList.aim[i].combo; if ((c->op == OP_GE || c->op == OP_GT) && c->n + (c->op == OP_GT) >= 8) bigAsked = 1; }
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
    // (A COMBO GROWN TO EIGHT, where the list asks one -- the owner: eight and up throws two blocks: two of the runs the last swap makes
    // each brought a panel more, the walks one after the other, before that swap)
    if (bigAsked) for (int a = 0; a < F.n && a < 4 && n < cap; a++) for (int b = a + 1; b < F.n && b < 4 && n < cap; b++) {
      if (k->nseq + F.len[a] + F.len[b] > MAXLINE) continue;
      Cand *g = &out[n];
      *g = *k; g->grown = 1; g->nseq = 0;
      for (int j = 0; j < k->nseq - 1; j++) g->seq[g->nseq++] = k->seq[j];
      for (int j = 0; j < F.len[a]; j++) g->seq[g->nseq++] = F.seq[a][j];
      for (int j = 0; j < F.len[b]; j++) g->seq[g->nseq++] = F.seq[b][j];
      g->seq[g->nseq++] = last;
      g->x.combo = 8; g->xFire = -1; g->xDone = -1; g->xNats = 0;
      n++;
    }
  }
  return n;
}
// TWO COLUMNS, ONE SWAP (and the arms beside them: each swapped panel may also complete a three along the trigger row -- X at c-2, c-1, Y
// at c+2, c+3 -- the column run and its arm one combo, a cross or an L, as the players make them: plans/gambit-combos.md): two columns side by side, each a run of its colour but for the trigger row, where the two colours sit the wrong
// way round -- the swap there drops each panel into the other's run, both runs at once, a combo of eight or more. Each row of the runs is
// sorted along itself first (its own panels walked within the row, every cell walked through a panel at rest on one, so nothing falls),
// then the trigger. Runs
// of 3 to 5, 8 cells or more between them, split by the trigger row so neither clears before it.
// - Where the list asks a combo of eight or more: the whole line, an entry; the judge plays each out on the engine, so a line that clears
//   early or makes less is ranked on that.
// - Elsewhere, under garbage or not, with none loaded (rank.c twinTime): the rows sorted and the trigger left unpressed, a set-up -- the eight
//   is ready the moment a mode asks one (finish them, the enemy topped out).
//   Any other mode leaves the trigger alone: a combo it does not ask for is wasted (rank.c wastesThree).
#define TWIN_MAXSWAPS 12
#define TWIN_OFFER 3
#define TWIN_REACH 20   // (the most swaps the distance to an eight is counted to -- one distance, the set-ups proposed by it and ranked by it)
#define TWIN_SETUP_MAX 8   // (the most swaps a set-up is built in outside the mode that fires it)
typedef struct { int32_t n, at[8], ok; } RowFix;
static int twinRowFix(const int32_t *row, const uint8_t *ok, int cx, int32_t X, int cy, int32_t Y, RowFix *f) {
  // the fewest swaps along the row that leave X at column cx (0: not asked) and Y at column cy (0: not asked): each panel asked, walked
  // to its column one after the other, either one first, from wherever along the row a panel of its colour sits -- every cell it walks
  // through, and its column, one that can be sorted (ok: a panel of colour at rest on one, or the floor)
  int best = 99; f->n = 0; f->ok = 0;
  for (int ax = 1; ax <= W; ax++) for (int ay = 1; ay <= W; ay++) {
    if (cx ? row[ax] != X || !ok[ax] : ax > 1) continue;
    if (cy ? row[ay] != Y || !ok[ay] || (cx && ay == ax) : ay > 1) continue;
    for (int order = 0; order < 2; order++) {
      int id[W + 2]; for (int c = 1; c <= W; c++) id[c] = c;
      int src[2] = { cx ? ax : 0, cy ? ay : 0 }, to[2] = { cx, cy }, n = 0; int32_t at[8];
      for (int s = 0; s < 2; s++) {
        int w = order ? 1 - s : s;
        if (!to[w]) continue;
        int p = 0; for (int c = 1; c <= W; c++) if (id[c] == src[w]) p = c;
        while (p != to[w] && n < 8) { int l = p < to[w] ? p : p - 1; if (!ok[l] || !ok[l + 1]) { n = 99; break; } int v = id[l]; id[l] = id[l + 1]; id[l + 1] = v; at[n++] = (int32_t)l; p += p < to[w] ? 1 : -1; }
        if (n == 99) break;
      }
      if (n == 99 || (cx && id[cx] != ax) || (cy && id[cy] != ay) || n >= best) continue;
      best = n; f->n = (int32_t)n; for (int i = 0; i < n; i++) f->at[i] = at[i]; f->ok = 1;
    }
  }
  return f->ok ? best : -1;
}
static int twinThree(int32_t g[][W + 2], int top) {
  for (int r = 1; r <= top; r++) for (int c = 1; c <= W; c++) {
    int32_t k = g[r][c]; if (!(k > 0 && k < 8)) continue;
    if (c + 2 <= W && g[r][c + 1] == k && g[r][c + 2] == k) return 1;
    if (r + 2 <= top && g[r + 1][c] == k && g[r + 2][c] == k) return 1;
  }
  return 0;
}
typedef struct { int32_t cost, c, r, X, Y, a0, a1, b0, b1, hx, hy; } Twin;   // (hx, hy: the arms -- X at c-2, c-1 and Y at c+2, c+3 of the trigger row -- 2 or 0; a0 > a1, b0 > b1: no column run)
// (the panels an eight clears: each side its column run and its arm, the trigger cell once)
static int twinSize(const Twin *t) { return (t->a1 >= t->a0 ? t->a1 - t->a0 + 1 : 1) + t->hx + (t->b1 >= t->b0 ? t->b1 - t->b0 + 1 : 1) + t->hy; }
// (A ROW SORTED TO SEVERAL COLUMNS: each target column's colour walked in from the nearest panel of it that need not cross a column already
// set -- the targets in the order given; the fewest swaps of the two orders, nearest first and as given; -1 none)
static int rowFixMulti(const int32_t *row, const uint8_t *ok, const int *col, const int32_t *colour, int nt, RowFix *f) {
  int best = 99; f->n = 0; f->ok = 0;
  for (int order = 0; order < 2; order++) {
    int32_t cur[W + 2]; for (int c = 0; c <= W + 1; c++) cur[c] = row[c];
    uint8_t lock[W + 2] = { 0 }; int n = 0, bad = 0; int32_t at[8];
    int idx[6]; for (int i = 0; i < nt; i++) idx[i] = i;
    if (order) for (int i = 0; i < nt; i++) for (int j = i + 1; j < nt; j++) if (col[idx[j]] < col[idx[i]]) { int t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    for (int s = 0; s < nt && !bad; s++) {
      int to = col[idx[s]]; int32_t want = colour[idx[s]];
      if (!ok[to]) { bad = 1; break; }
      if (cur[to] == want) { lock[to] = 1; continue; }
      int from = 0, d = 99;
      for (int p = 1; p <= W; p++) {
        if (lock[p] || cur[p] != want || !ok[p]) continue;
        int lo = imin(p, to), hi = imax(p, to), clear = 1;
        for (int q = lo; q <= hi; q++) if (!ok[q] || (q != to && q != p && lock[q])) clear = 0;
        if (lock[to]) clear = 0;
        if (clear && iabs(p - to) < d) { d = iabs(p - to); from = p; }
      }
      if (!from) { bad = 1; break; }
      int p = from;
      while (p != to) { int l = p < to ? p : p - 1; if (n >= 8) { bad = 1; break; } int32_t v = cur[l]; cur[l] = cur[l + 1]; cur[l + 1] = v; at[n++] = (int32_t)l; p += p < to ? 1 : -1; }
      lock[to] = 1;
    }
    if (bad || n >= best) continue;
    best = n; f->n = n; for (int i = 0; i < n; i++) f->at[i] = at[i]; f->ok = 1;
  }
  return f->ok ? best : -1;
}
// (the trigger row of t: Y at c, X at c+1 -- the wrong way round -- and its arms)
static int trigFix(const int32_t *row, const uint8_t *ok, int c, int32_t X, int32_t Y, int hx, int hy, RowFix *f) {
  if (!hx && !hy) return twinRowFix(row, ok, c, Y, c + 1, X, f);
  int col[6], nt = 0; int32_t colour[6];
  col[nt] = c; colour[nt++] = Y; col[nt] = c + 1; colour[nt++] = X;
  if (hx) { col[nt] = c - 1; colour[nt++] = X; col[nt] = c - 2; colour[nt++] = X; }
  if (hy) { col[nt] = c + 2; colour[nt++] = Y; col[nt] = c + 3; colour[nt++] = Y; }
  return rowFixMulti(row, ok, col, colour, nt, f);
}
// (every two-column eight the board can be sorted into within TWIN_MAXSWAPS, the cheapest TWIN_OFFER * 4 kept: the grid in g, its top
// in *topOut, the cells that can be sorted in ok, the full rows in *rows)
static int twinScan(Board *b, int32_t g[][W + 2], uint8_t ok[][W + 2], int *topOut, Twin *best, int *rows, int cap) {
  int top = 0, H = imin(gridLen(b) - 2, MAXROWS);
  for (int r = 0; r <= H + 1 && r < MAXROWS + 2; r++) for (int c = 0; c <= W + 1; c++) g[r][c] = 0;
  for (int r = 1; r <= H; r++) for (int c = 1; c <= W; c++) { g[r][c] = cellAt(b, r, c); if (g[r][c] != 0) top = r; }
  if (top > b->topCurRow) top = b->topCurRow;
  // (a cell that can be sorted: a panel of colour at rest, on one at rest -- or the floor; a row with any is a row the runs may pass)
  uint32_t any[MAXROWS + 2];
  for (int r = 1; r <= top; r++) { any[r] = 0; for (int c = 1; c <= W; c++) { ok[r][c] = g[r][c] > 0 && g[r][c] < 8 && b->p[r][c].f[STATE] == NORMAL && (r == 1 || (g[r - 1][c] != 0 && b->p[r - 1][c].f[STATE] == NORMAL)); any[r] += ok[r][c]; } }
  if (rows) { *rows = 0; for (int r = 1; r <= top; r++) *rows += any[r] == W; }
  int nb = 0;
  for (int c = 1; c < W; c++) for (int r = 1; r <= top; r++) {
    if (!any[r]) continue;
    for (int32_t X = 1; X < 8; X++) for (int32_t Y = 1; Y < 8; Y++) for (int hx = 0; hx <= 2; hx += 2) for (int hy = 0; hy <= 2; hy += 2) {
      if (X == Y || (hx && c - 2 < 1) || (hy && c + 3 > W)) continue;
      RowFix trig; int tc = trigFix(g[r], ok[r], c, X, Y, hx, hy, &trig);
      if (tc < 0 || tc > cap) continue;
      // (each side a run of its colour in its column through row r (3 to 5, split by the trigger row so neither clears before it), or
      // none where its arm makes the three; eight or more in all -- each row's cost alone, a row shared by both counted once)
      for (int la = hx ? 0 : 3; la <= 5; la = la ? la + 1 : 3) for (int a0 = la ? r - la + 1 : r + 1; a0 <= r; a0++) {
        int a1 = la ? a0 + la - 1 : r;
        if (la && (a0 < 1 || a1 > top || r - a0 >= 3 || a1 - r >= 3)) continue;
        for (int lb = hy ? 0 : 3; lb <= 5; lb = lb ? lb + 1 : 3) for (int b0 = lb ? r - lb + 1 : r + 1; b0 <= r; b0++) {
          int b1 = lb ? b0 + lb - 1 : r;
          if (lb && (b0 < 1 || b1 > top || r - b0 >= 3 || b1 - r >= 3)) continue;
          Twin t = { 0, c, r, X, Y, a0, a1, b0, b1, hx, hy };
          if (twinSize(&t) < 8) continue;
          int cost = tc, okAll = 1, qlo = imin(la ? a0 : r, lb ? b0 : r), qhi = imax(la ? a1 : r, lb ? b1 : r);
          for (int q = qlo; q <= qhi && okAll; q++) {
            if (q == r) continue;
            int wx = la && q >= a0 && q <= a1, wy = lb && q >= b0 && q <= b1;
            RowFix f; int k = any[q] ? twinRowFix(g[q], ok[q], wx ? c : 0, X, wy ? c + 1 : 0, Y, &f) : -1;
            if (k < 0) okAll = 0; else cost += k;
          }
          if (!okAll || cost > cap) continue;
          t.cost = cost;
          int at = nb < TWIN_OFFER * 4 ? nb++ : -1;
          if (at < 0) { int w = 0; for (int i = 1; i < nb; i++) if (best[i].cost > best[w].cost) w = i; if (best[w].cost <= cost) continue; at = w; }
          best[at] = t;
        }
      }
    }
  }
  *topOut = top;
  return nb;
}
// THE SWAPS TO AN EIGHT: the fewest the board is sorted into a two-column eight in, its trigger pressed (0: one is loaded); 99 none
// within TWIN_REACH -- a distance every line's end board has, so a line that leaves the board nearer one is seen as nearer
static int twinCostOn(Board *b) {
  static int32_t g[MAXROWS + 2][W + 2]; static uint8_t ok[MAXROWS + 2][W + 2]; static Twin best[TWIN_OFFER * 4]; int top;
  int nb = twinScan(b, g, ok, &top, best, 0, TWIN_REACH), lo = 99;
  for (int i = 0; i < nb; i++) if (best[i].cost < lo) lo = best[i].cost;
  return lo;
}
// THE SWAPS THAT SORT ONE: the eight t's rows sorted, the rows nearest the cursor first, then the trigger row, on a copy of the grid g --
// the trigger left unpressed; how many, or -1 where a row cannot be sorted or a three clears before the trigger
static int twinSort(const Board *b, int32_t g[][W + 2], uint8_t ok[][W + 2], int top, const Twin *t, int32_t *seq) {
  static int32_t h[MAXROWS + 2][W + 2];
  memcpy(h, g, sizeof h);
  int ns = 0, bad = 0;
  int lo = imin(t->a0, t->b0), hi = imax(t->a1, t->b1), up = iabs(b->curRow - lo) <= iabs(b->curRow - hi);
  for (int s = 0; s <= hi - lo && !bad; s++) {
    int q = up ? lo + s : hi - s;
    if (q == t->r) continue;
    int wx = q >= t->a0 && q <= t->a1, wy = q >= t->b0 && q <= t->b1;
    RowFix f; if (twinRowFix(h[q], ok[q], wx ? t->c : 0, t->X, wy ? t->c + 1 : 0, t->Y, &f) < 0) return -1;
    for (int k = 0; k < f.n && ns < MAXLINE - 8; k++) { int l = f.at[k]; int32_t v = h[q][l]; h[q][l] = h[q][l + 1]; h[q][l + 1] = v; seq[ns++] = q * 8 + l; if (twinThree(h, top)) bad = 1; }
  }
  RowFix f; if (bad || trigFix(h[t->r], ok[t->r], t->c, t->X, t->Y, t->hx, t->hy, &f) < 0) return -1;
  for (int k = 0; k < f.n && ns < MAXLINE - 2; k++) { int l = f.at[k]; int32_t v = h[t->r][l]; h[t->r][l] = h[t->r][l + 1]; h[t->r][l + 1] = v; seq[ns++] = t->r * 8 + l; if (twinThree(h, top)) bad = 1; }
  return bad ? -1 : ns;
}
// THE SECOND HAND (the owner: set up between moves, in the time the board waits, never at the cost of its life): one eight kept as the
// target across decisions -- the same two columns, colours and trigger row (a row up or down, the stack's rise), while the board still
// holds it within TWIN_REACH swaps; else the cheapest -- so its swaps build one eight and never undo each other. Its next swap in *swap;
// 0 where there is none (none in reach, or it is loaded: its trigger is the mode's to press)
static Twin twinKept; static int32_t twinKeptSet;
static int twinNextSwap(Board *b, int32_t *swap) {
  static int32_t g[MAXROWS + 2][W + 2]; static uint8_t ok[MAXROWS + 2][W + 2]; static Twin best[TWIN_OFFER * 4]; int top;
  int nb = twinScan(b, g, ok, &top, best, 0, TWIN_REACH), w = -1;
  for (int i = 0; i < nb && twinKeptSet; i++)
    if (best[i].c == twinKept.c && best[i].X == twinKept.X && best[i].Y == twinKept.Y && iabs(best[i].r - twinKept.r) <= 1 && (w < 0 || best[i].cost < best[w].cost)) w = i;
  for (int i = 0; i < nb && w < 0; i++) if (w < 0 || best[i].cost < best[w].cost) w = i;
  if (w < 0) { twinKeptSet = 0; return 0; }
  twinKept = best[w]; twinKeptSet = 1;
  if (best[w].cost == 0) return 0;
  int32_t seq[MAXLINE]; int ns = twinSort(b, g, ok, top, &best[w], seq);
  if (ns < 1) return 0;
  // (of the rows still to sort, the next swap of the one nearest the cursor: each row is sorted along itself, apart from the others --
  // the trigger row last)
  int pick = 0, bd = 99;
  for (int i = 0; i < ns; i++) {
    if (i > 0 && CR(seq[i]) == CR(seq[i - 1])) continue;   // (a row's first swap only)
    if (CR(seq[i]) == best[w].r && i > 0) break;           // (the trigger row once the others are sorted)
    int d = iabs(CR(seq[i]) - b->curRow) + iabs(CC(seq[i]) - b->curCol);
    if (d < bd) { bd = d; pick = i; }
  }
  *swap = seq[pick];
  return 1;
}
static int twinLines(const Read *R, Cand *out, int n, int cap) {
  int bigAsked = 0;
  for (int i = 0; i < theList.n; i++) { const Test *c = &theList.aim[i].combo; if ((c->op == OP_GE || c->op == OP_GT) && c->n + (c->op == OP_GT) >= 8) bigAsked = 1; }
  Board *b = decQ.b;
  // (the set-up's first swaps on any board -- under garbage, a pop running, a chain falling: the owner, once the chain's next link is
  // set, go do something else -- the judge plays each on the engine, and one that cuts the board's chain short ranks after the wait)
  int prefixes = !R->topped, setupOnly = !bigAsked && twinTime(R->under, R->topped);
  twinLo = -2;
  if ((!bigAsked && !setupOnly && !prefixes) || clockOut()) return n;
  static int32_t g[MAXROWS + 2][W + 2];
  static uint8_t ok[MAXROWS + 2][W + 2];
  static Twin best[TWIN_OFFER * 4];
  int top, rows, nb = twinScan(b, g, ok, &top, best, &rows, prefixes ? TWIN_REACH : TWIN_MAXSWAPS);
  twinRows = rows;
  // (the fewest swaps first; each line built and played out on a copy of the grid: none that makes a three before its trigger)
  // (a set-up only where none is loaded -- no trigger one swap away -- and short enough to be worth building ahead)
  { int lo = 99; for (int i = 0; i < nb; i++) if (best[i].cost < lo) lo = best[i].cost; twinLo = lo == 99 ? -1 : lo;
    if (!bigAsked && lo == 0) return n; }
  for (int i = 0; i < nb; i++) for (int j = i + 1; j < nb; j++) if (best[j].cost < best[i].cost) { Twin t = best[i]; best[i] = best[j]; best[j] = t; }
  int offered = 0;
  for (int i = 0; i < nb && offered < TWIN_OFFER && n < cap; i++) {
    const Twin *t = &best[i];
    int32_t seq[MAXLINE]; int ns = twinSort(b, g, ok, top, t, seq);
    if (ns < 0) continue;
    // (SET UP BETWEEN MOVES -- the owner: the set-up built of moves that cost nothing, never of the board's life: the first one, two and
    // three of its swaps, each a line of its own -- a swap pressed where the board waits, the rest left for the next wait; the rank takes
    // one only where it is lost no sooner and keeps the window's reserve, rank.c nearerEight)
    if (prefixes && i < 2 && ns > 0)
      for (int p = 1; p <= 3 && p < ns && n < cap; p++)
        if (candOf(&out[n], PLAY_SETUP, seq, p, -1, 0)) { out[n].settled = 1; out[n].twin = 2; n++; twinOffered++; }
    if (t->cost > TWIN_MAXSWAPS) continue;   // (past TWIN_MAXSWAPS: its first swaps only -- an eight that far is set up, never fired whole)
    if (setupOnly) {
      if (ns < 1 || ns > TWIN_SETUP_MAX) continue;
      if (candOf(&out[n], PLAY_SETUP, seq, ns, -1, 0)) { out[n].settled = 1; out[n].twin = 2; n++; offered++; twinOffered++; }
      continue;
    }
    seq[ns++] = t->r * 8 + t->c;
    if (candOf(&out[n], PLAY_ENTRY, seq, ns, -1, 0)) { out[n].x.combo = twinSize(t); out[n].twin = 1; n++; offered++; twinOffered++; }
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
  return actionsFor(r0, c0, CR(s), CC(s), HOLDTIGHT + 1) + actionsFor(CR(s), CC(s), CR(first), CC(first), HOLDTIGHT + 1) <= d + 1;
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
    int d = actionsFor(r0, c0, CR(k->seq[0]), CC(k->seq[0]), HOLDTIGHT + 1);
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
  int under = garbageOn(decQ.b);
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
        int da = actionsFor(r0, c0, CR(a), CC(a), HOLDTIGHT + 1), db = actionsFor(r0, c0, CR(b), CC(b), HOLDTIGHT + 1);
        if (db < da) { s1 = b; s2 = a; }
        int walk = actionsFor(r0, c0, CR(s1), CC(s1), HOLDTIGHT + 1) + actionsFor(CR(s1), CC(s1), CR(s2), CC(s2), HOLDTIGHT + 1) +
                   actionsFor(CR(s2), CC(s2), CR(first), CC(first), HOLDTIGHT + 1);
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
// THE STACK ZIPPED (the players' stacks: a colour left a swap from its partner, not beside it -- one swap then fires what the bot
// chooses, and nothing lands into a match on its own): the single swaps of two panels at rest that clear nothing and leave the stack
// more zipped by ZIP_GAIN or more (judge.c spreadOf, on the colours at rest), the most zipped first, then nearest the cursor -- on a
// stack with ZIP_ROOM rows free above it
#define ZIPN 10
#define ZIP_GAIN 1
#define ZIP_ROOM 3   // (the rows free above the stack a zip needs)
static int32_t zipOffered;   // (the zips this decision offered: the log's)
static int32_t zipSpread(int32_t g[][W + 2], int top) {
  int32_t staged = 0, touching = 0;
  #define ZC(r, c) ((r) >= 1 && (r) <= top && (c) >= 1 && (c) <= W && g[r][c] > 0 && g[r][c] < 8 ? g[r][c] : 0)
  for (int r = 1; r <= top; r++) for (int c = 1; c <= W; c++) {
    int32_t v = ZC(r, c); if (!v) continue;
    if (ZC(r + 1, c) == v) touching++;
    if (ZC(r, c + 1) == v) touching++;
    if (ZC(r + 2, c) == v && ZC(r + 1, c) && ZC(r + 1, c) != v) staged++;
    if (ZC(r, c + 2) == v && ZC(r, c + 1) && ZC(r, c + 1) != v) staged++;
    if (ZC(r + 1, c - 1) == v) staged++;
    if (ZC(r + 1, c + 1) == v) staged++;
  }
  #undef ZC
  return staged - touching;
}
static int zipLines(const Read *R, Cand *out, int n, int cap) {
  zipOffered = 0;
  if (R->pop) return n;
  Board *b = decQ.b;
  static int32_t g[MAXROWS + 2][W + 2]; static uint8_t ok[MAXROWS + 2][W + 2];
  int H = imin(gridLen(b) - 2, MAXROWS), top = 0;
  for (int r = 0; r <= H + 1 && r < MAXROWS + 2; r++) for (int c = 0; c <= W + 1; c++) { g[r][c] = 0; ok[r][c] = 0; }
  for (int r = 1; r <= H; r++) for (int c = 1; c <= W; c++) {
    int32_t v = cellAt(b, r, c); const int32_t *f = b->p[r][c].f;
    g[r][c] = f[STATE] == NORMAL ? v : -1;
    if (v != 0) top = r;
    ok[r][c] = v > 0 && v < 8 && f[STATE] == NORMAL && (r == 1 || (cellAt(b, r - 1, c) != 0 && b->p[r - 1][c].f[STATE] == NORMAL));
  }
  if (top > (b->height ? b->height : 12) - ZIP_ROOM) return n;   // (a stack this high is lowered, not sorted)
  if (top > b->topCurRow) top = b->topCurRow;
  int32_t base = zipSpread(g, top), mv[ZIPN * 4], gain[ZIPN * 4]; int d[ZIPN * 4], nm = 0;
  for (int r = 1; r <= top; r++) for (int c = 1; c < W; c++) {
    int32_t cost;
    if (!ok[r][c] || !ok[r][c + 1] || g[r][c] == g[r][c + 1] || !canSwapPanels(b, P(b, r, c), P(b, r, c + 1), &cost) || cost) continue;
    int32_t t = g[r][c]; g[r][c] = g[r][c + 1]; g[r][c + 1] = t;
    int clears = twinThree(g, top); int32_t s = zipSpread(g, top) - base;
    g[r][c + 1] = g[r][c]; g[r][c] = t;
    if (clears || s < ZIP_GAIN) continue;
    int dd = iabs(r - b->curRow) + iabs(c - b->curCol), at = nm;
    if (nm == ZIPN * 4) { at = -1; for (int i = 0; i < nm; i++) if (gain[i] < s || (gain[i] == s && d[i] > dd)) { if (at < 0 || gain[i] < gain[at] || (gain[i] == gain[at] && d[i] > d[at])) at = i; } if (at < 0) continue; } else nm++;
    mv[at] = r * 8 + c; gain[at] = s; d[at] = dd;
  }
  for (int i = 1; i < nm; i++) for (int j = i; j > 0 && (gain[j] > gain[j - 1] || (gain[j] == gain[j - 1] && d[j] < d[j - 1])); j--) {
    int32_t u = mv[j]; mv[j] = mv[j - 1]; mv[j - 1] = u; u = gain[j]; gain[j] = gain[j - 1]; gain[j - 1] = u; int e = d[j]; d[j] = d[j - 1]; d[j - 1] = e; }
  for (int i = 0; i < nm && i < ZIPN && n < cap; i++) if (candOf(&out[n], PLAY_ZIP, &mv[i], 1, -1, 0)) { out[n].settled = 1; n++; zipOffered++; }
  return n;
}
// THE BOARD'S OWN CHAIN CUT AT THE MODE'S LENGTH: with the board about to chain on its own (decide.c, the read's aloneChain) longer than
// any chain the mode's list asks (rules.c listChainCap -- none in a mode that asks none), every swap the engine allows beside a panel in
// motion or a slab popping, nearest the cursor first -- one of them takes a link out from under the chain, and the ranking keeps the
// line that meets the list (the owner: every attack is what the mode asks)
#define CUTN 16
static int32_t cutOffered;   // (the cuts this decision offered: the log's)
static int cutLines(const Read *R, Cand *out, int n, int cap) {
  cutOffered = 0;
  int32_t longest = listChainCap();
  for (int i = 0; i < theList.n; i++) if (theList.aim[i].chain.op == OP_GE || theList.aim[i].chain.op == OP_GT) longest = MAXCHAIN;   // (an ask of "or longer" has no longest)
  if (R->aloneChain < 2 || R->aloneChain <= longest) return n;
  Board *b = decQ.b;
  int h = b->height ? b->height : 12;
  uint8_t moving[MAXROWS + 2][W + 2]; memset(moving, 0, sizeof moving);
  for (int r = 1; r <= h + 1 && r < b->nrows; r++) for (int c = 1; c <= W; c++) {
    const int32_t *f = P(b, r, c)->f;
    if (f[ISGARBAGE] ? f[STATE] == MATCHED : f[COLOR] != 0 && (f[STATE] != NORMAL || SETB(f[CHAINING]))) moving[r][c] = 1;   // (a slab popping among them: what it turns into chains with what lies beside it)
  }
  int32_t mv[W * MAXROWS]; int d[W * MAXROWS], nm = 0;
  for (int r = 1; r <= h && r < b->nrows; r++) for (int c = 1; c < W; c++) {
    int near = 0;
    for (int rr = imax(1, r - 2); rr <= imin(h + 1, r + 2) && !near; rr++) for (int cc = imax(1, c - 1); cc <= imin(W, c + 2); cc++) if (moving[rr][cc]) { near = 1; break; }
    int32_t cost;
    if (!near || !canSwapPanels(b, P(b, r, c), P(b, r, c + 1), &cost) || cost) continue;
    mv[nm] = r * 8 + c; d[nm] = iabs(r - b->curRow) + iabs(c - b->curCol); nm++;
  }
  for (int i = 1; i < nm; i++) for (int j = i; j > 0 && d[j] < d[j - 1]; j--) { int t = d[j]; d[j] = d[j - 1]; d[j - 1] = t; int32_t u = mv[j]; mv[j] = mv[j - 1]; mv[j - 1] = u; }
  for (int i = 0; i < nm && i < CUTN && n < cap; i++) if (candOf(&out[n], PLAY_CUT, &mv[i], 1, -1, 0)) { n++; cutOffered++; }
  return n;
}
// THE COMBO DUG, STAGED (the players: the dig is the attack, its seam set up over several swaps and fired with one): under garbage, every
// column run of three to five, or arm of two along the trigger row, on either side of one swap -- the twin's shapes, one side enough --
// that clears DIG_MIN cells or more at once, a cell of it touching the garbage; its rows sorted along themselves (no three before the
// trigger, twinSort), then the trigger. The DIGN cheapest within DIG_MAXSWAPS, each a whole line judged on the engine as any entry.
#define DIGN 4
#define DIG_MIN 4
#define DIG_MAXSWAPS 8
static int32_t digOffered;   // (the digs this decision offered: the log's)
static int32_t digWhy[8];   // (the first dig put down as waste: set, threes, broke, combo, chain, outside, combo asked, swaps)
static int digSide(int la, int a0, int a1, int h) { return la ? a1 - a0 + 1 + h : (h ? 1 + h : 0); }
static int digSize(const Twin *t) { return digSide(t->a1 >= t->a0, t->a0, t->a1, t->hx) + digSide(t->b1 >= t->b0, t->b0, t->b1, t->hy); }
static int digTouch(uint8_t gb[][W + 2], int r, int c) {
  return gb[r + 1][c] || gb[r - 1][c] || (c > 1 && gb[r][c - 1]) || (c < W && gb[r][c + 1]);
}
static int digLines(const Read *R, Cand *out, int n, int cap) {
  digOffered = 0; digWhy[0] = 0;
  if (!R->under || clockOut()) return n;
  Board *b = decQ.b;
  static int32_t g[MAXROWS + 2][W + 2]; static uint8_t ok[MAXROWS + 2][W + 2], gb[MAXROWS + 3][W + 2];
  int top = 0, H = imin(gridLen(b) - 2, MAXROWS), any = 0;
  for (int r = 0; r <= MAXROWS + 1; r++) for (int c = 0; c <= W + 1; c++) { g[r][c] = 0; ok[r][c] = 0; gb[r][c] = 0; }
  for (int c = 0; c <= W + 1; c++) gb[MAXROWS + 2][c] = 0;
  for (int r = 1; r <= H; r++) for (int c = 1; c <= W; c++) { g[r][c] = cellAt(b, r, c); if (g[r][c] != 0) top = r; if (b->p[r][c].f[ISGARBAGE]) { gb[r][c] = 1; any = 1; } }
  if (!any) return n;
  if (top > b->topCurRow) top = b->topCurRow;
  uint32_t rowOk[MAXROWS + 2];
  for (int r = 1; r <= top; r++) { rowOk[r] = 0; for (int c = 1; c <= W; c++) { ok[r][c] = !gb[r][c] && g[r][c] > 0 && g[r][c] < 8 && b->p[r][c].f[STATE] == NORMAL && (r == 1 || (g[r - 1][c] != 0 && b->p[r - 1][c].f[STATE] == NORMAL)); rowOk[r] += ok[r][c]; } }
  Twin best[DIGN * 3]; int nb = 0;
  for (int c = 1; c < W; c++) for (int r = 1; r <= top; r++) {
    if (!rowOk[r]) continue;
    for (int32_t X = 1; X < 8; X++) for (int32_t Y = 1; Y < 8; Y++) for (int hx = 0; hx <= 2; hx += 2) for (int hy = 0; hy <= 2; hy += 2) {
      if (X == Y || (hx && c - 2 < 1) || (hy && c + 3 > W)) continue;
      RowFix trig; int tc = trigFix(g[r], ok[r], c, X, Y, hx, hy, &trig);
      if (tc < 0 || tc > DIG_MAXSWAPS - 1) continue;
      for (int la = 0; la <= 5; la = la ? la + 1 : 3) for (int a0 = la ? r - la + 1 : r + 1; a0 <= r; a0++) {
        int a1 = la ? a0 + la - 1 : r;
        if (la && (a0 < 1 || a1 > top || r - a0 >= 3 || a1 - r >= 3)) continue;
        for (int lb = 0; lb <= 5; lb = lb ? lb + 1 : 3) for (int b0 = lb ? r - lb + 1 : r + 1; b0 <= r; b0++) {
          int b1 = lb ? b0 + lb - 1 : r;
          if (lb && (b0 < 1 || b1 > top || r - b0 >= 3 || b1 - r >= 3)) continue;
          int sx = digSide(la, a0, a1, hx), sy = digSide(lb, b0, b1, hy);
          if (sx + sy < DIG_MIN) continue;
          // (the cells it clears, one touching the garbage)
          int touch = 0;
          if (sx) { if (la) for (int q = a0; q <= a1; q++) touch |= digTouch(gb, q, c); else touch |= digTouch(gb, r, c);
                    if (hx) touch |= digTouch(gb, r, c - 1) | digTouch(gb, r, c - 2); }
          if (sy) { if (lb) for (int q = b0; q <= b1; q++) touch |= digTouch(gb, q, c + 1); else touch |= digTouch(gb, r, c + 1);
                    if (hy) touch |= digTouch(gb, r, c + 2) | digTouch(gb, r, c + 3); }
          if (!touch) continue;
          int cost = tc, okAll = 1, qlo = imin(la ? a0 : r, lb ? b0 : r), qhi = imax(la ? a1 : r, lb ? b1 : r);
          for (int q = qlo; q <= qhi && okAll; q++) {
            if (q == r) continue;
            int wx = la && q >= a0 && q <= a1, wy = lb && q >= b0 && q <= b1;
            RowFix f; int k = rowOk[q] ? twinRowFix(g[q], ok[q], wx ? c : 0, X, wy ? c + 1 : 0, Y, &f) : -1;
            if (k < 0) okAll = 0; else cost += k;
          }
          if (!okAll || cost > DIG_MAXSWAPS - 1) continue;
          Twin t = { cost, c, r, X, Y, a0, a1, b0, b1, hx, hy };
          // (kept: the most cells, then the fewest swaps; a shape found again with another colour on its side that clears nothing, the
          // cheaper)
          int sz = sx + sy, at = -1;
          for (int i = 0; i < nb && at < 0; i++) { const Twin *u = &best[i];
            if (u->c == c && u->r == r && u->a0 == a0 && u->a1 == a1 && u->b0 == b0 && u->b1 == b1 && u->hx == hx && u->hy == hy && (!sx || u->X == X) && (!sy || u->Y == Y)) at = u->cost > cost ? i : -2; }
          if (at == -2) continue;
          if (at < 0 && nb < DIGN * 3) at = nb++;
          if (at < 0) {
            int w = 0;
            for (int i = 1; i < nb; i++) if (digSize(&best[i]) < digSize(&best[w]) || (digSize(&best[i]) == digSize(&best[w]) && best[i].cost > best[w].cost)) w = i;
            if (digSize(&best[w]) > sz || (digSize(&best[w]) == sz && best[w].cost <= cost)) continue;
            at = w;
          }
          best[at] = t;
        }
      }
    }
  }
  for (int i = 0; i < nb && n < cap && !clockOut(); i++) {
    const Twin *t = &best[i];
    int32_t seq[MAXLINE]; int ns = twinSort(b, g, ok, top, t, seq);
    if (ns < 0 || ns + 1 > DIG_MAXSWAPS) continue;
    seq[ns++] = t->r * 8 + t->c;
    if (candOf(&out[n], PLAY_DIG, seq, ns, -1, 0)) {
      out[n].x.combo = digSize(t);
      n++; digOffered++;
    }
  }
  return n;
}
static int proposeAll(const Read *R, const Found *S, Cand *out, int cap) {
  int n = 0;
  pairOffered = 0; twinOffered = 0; twinLo = -2; twinRows = -1;
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
    if (S->ex.three.set) { int m0 = n; ADD(R->pop ? PLAY_LINEUP : PLAY_EXTEND, S->ex.three.seq, S->ex.three.nseq, -1, 1); if (n > m0) xFromExt(&out[m0], &S->ex.three); }
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
  n = twinLines(R, out, n, cap);
  n = wayLines(out, n, cap);
  n = zipLines(R, out, n, cap);
  n = cutLines(R, out, n, cap);
  n = digLines(R, out, n, cap);
  return n;
}
