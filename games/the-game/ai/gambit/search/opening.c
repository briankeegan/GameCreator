// THE OPENING, PLANNED (plans/gambit-opener.md -- the owner: the opener has the whole board and the most time it will ever have; it plans
// something amazing, with every piece): one beam over set-up sequences, kept from decision to decision through the opening. Each board in
// it is scored by the garbage the best trigger on it sends (triggerSendOf) and, tied, by the panels that trigger clears; each set-up
// clears nothing. Half the beam is the boards whose trigger sends the most, the other half the boards with the most promise (opPot) --
// a chain is built for swaps before any trigger is there. Every decision grows it a level at a time in the time it has (the countdown's is
// the longest), re-rooted under the swap pressed: a path that begins with the swap pressed goes on without it, any other is let go. The
// plan is the best path with a trigger, and its trigger.
#define OP_BEAM 48       // the boards a level keeps
#define OP_KIDS 24       // the set-ups tried from each, the nearest the cursor first
#define OP_DEPTH 20      // the set-ups a plan may hold
typedef struct { int len; int32_t path[OP_DEPTH]; int32_t sent, cleared, trig, ch, pot; } OpPath;
static OpPath opBeam[OP_BEAM], opNext[OP_BEAM], opBest;
static int opN, opHave;            // the beam's paths, and whether a plan is held
static int32_t opLevels, opGrowMs;   // (the levels the last decision grew and the ms it had: the log's)
static int32_t opPressed;          // the plan's set-up the last decision played (0: none) -- the beam is re-rooted under it
static LOCAL Ctx *opCtx;
// (A SWAP THAT CAN SET SOMETHING OFF, read off the cells before it is played: a panel swapped into an empty cell falls and may match
// where it lands, so it is played; else one of the two cells must finish a run of three, across or up and down -- the rest set nothing off
// and are not played)
static int opRun(const Board *b, int r, int c, int32_t col, int skipC) {
  if (col <= 0) return 0;
  int n = 1;
  for (int k = c - 1; k >= 1 && k != skipC && cellAt(b, r, k) == col; k--) n++;
  for (int k = c + 1; k <= W && k != skipC && cellAt(b, r, k) == col; k++) n++;
  if (n >= 3) return 1;
  n = 1;
  for (int q = r - 1; q >= 1 && cellAt(b, q, c) == col; q--) n++;
  for (int q = r + 1; q <= b->height && cellAt(b, q, c) == col; q++) n++;
  return n >= 3;
}
static int opMaySet(const Board *b, int r, int c) {
  int32_t a = cellAt(b, r, c), d = cellAt(b, r, c + 1);
  if (a == 0 || d == 0) return 1;
  if (a < 0 || d < 0 || a == d) return 0;
  return opRun(b, r, c + 1, a, c) || opRun(b, r, c, d, c + 1);
}
// the most garbage one swap sets off from the question's board -- its chain's slabs and every clear's combo garbage (plan.c sentCells),
// the swap in *sw, that clear's chain in *chain (0: none sends any)
static int32_t triggerSendOf(const Question *q, int32_t *sw, int32_t *chain) {
  Ctx *x = cuCtxB = ctxOf(cuCtxB);
  int root = rootOf(x, q);
  if (root < 0) return 0;
  int32_t ms[MAXROWS * W]; int m = swapsOfNode(x, root, ms); int32_t best = 0;
  const Board *b0 = ensureBoard(x, root);
  for (int i = 0; i < m && !clockOut(); i++) {
    if (b0 && !opMaySet(b0, CR(ms[i]), CC(ms[i]))) continue;
    int n = step(x, root, MK_SWAP, CR(ms[i]), CC(ms[i]), 0);
    if (!liveNode(x, n)) continue;
    int out = settleOf(x, n);
    if (!liveNode(x, out)) continue;
    Stats s; int32_t c = 0, ch = 0;
    if (statsOf(x, n, &s)) { c = sentCells(&s); ch = chainOfStats(&s); }
    if (statsOf(x, out, &s) && sentCells(&s) > c) { c = sentCells(&s); ch = chainOfStats(&s); }
    if (c > best) { best = c; if (sw) *sw = ms[i]; if (chain) *chain = ch; }
  }
  return best;
}
// (A HALF-BUILT CHAIN'S PROMISE: the pairs of one colour side by side or one on the other -- the set-ups a chain is made of before any of
// its links can go off. A path whose board has no trigger yet is kept by it.)
static int32_t opPot(const Board *b) {
  int32_t n = 0;
  for (int r = 1; r <= b->height; r++) for (int c = 1; c <= W; c++) {
    int32_t a = cellAt(b, r, c);
    if (a <= 0) continue;
    if (c < W && cellAt(b, r, c + 1) == a) n++;
    if (r < b->height && cellAt(b, r + 1, c) == a) n++;
  }
  return n;
}
static uint32_t opHash(const Board *b) {
  uint32_t h = 2166136261u;
  for (int r = 1; r <= b->height; r++) for (int c = 1; c <= W; c++) { h ^= (uint32_t)(cellAt(b, r, c) + 16); h *= 16777619u; }
  return h;
}
// (a board's score: the garbage its best trigger sends, the panels that trigger clears beside it)
static int opBetter(int32_t s, int32_t c, int len, const OpPath *o) {
  if (s != o->sent) return s > o->sent;
  if (c != o->cleared) return c > o->cleared;
  return len < o->len;
}
static int32_t opClearedOf(const Question *q, int32_t sw) {
  Ctx *x = cuCtxB = ctxOf(cuCtxB);
  int root = rootOf(x, q);
  if (root < 0 || !sw) return 0;
  int n = step(x, root, MK_SWAP, CR(sw), CC(sw), 0);
  if (!liveNode(x, n)) return 0;
  int out = settleOf(x, n);
  Stats s; return liveNode(x, out) && statsOf(x, out, &s) ? s.cleared : 0;
}
// a path played from the question's board, its set-ups each clearing nothing: the node it ends on, -1 where one is not there to press
static int opReplay(Ctx *x, int root, const OpPath *p) {
  int at = root;
  for (int k = 0; k < p->len && !clockOut(); k++) {
    int s1 = step(x, at, MK_SWAP, CR(p->path[k]), CC(p->path[k]), 0);
    if (!liveNode(x, s1)) return -1;
    int out = settleOf(x, s1);
    if (!liveNode(x, out)) return -1;
    Stats st; if (statsOf(x, out, &st) && st.cleared > 0) return -1;
    at = out;
  }
  return clockOut() ? -1 : at;
}
// a board's trigger, scored into p (sent, cleared, trig): the question q's board replaced by the node's
static void opScore(const Question *q, Ctx *x, int node, OpPath *p) {
  Board *eb = ensureBoard(x, node);
  p->sent = 0; p->cleared = 0; p->trig = 0; p->ch = 0; p->pot = 0;
  if (!eb) return;
  p->pot = opPot(eb);
  Question q2 = *q; q2.b = eb; q2.narr = 0; q2.holdLeft = 0; q2.holdStarted = 0;
  int32_t t = 0, ch = 0, c = triggerSendOf(&q2, &t, &ch);
  if (c > 0 && t) { p->sent = c; p->trig = t; p->ch = ch; p->cleared = opClearedOf(&q2, t); }
}
// (a chain the mode's list asks for: the opener throws nothing smaller -- a short chain only feeds the enemy)
static int opAsked(int32_t ch) {
  for (int i = 0; i < theList.n; i++) if (theList.aim[i].chain.op && test(ch, theList.aim[i].chain)) return 1;
  return 0;
}
// A new game: nothing held
static void openingReset(void) { opN = 0; opHave = 0; opPressed = 0; }
// ONE PATH'S SET-UPS SCORED (opKids, a job: on whichever thread takes it, on that thread's own nodes): the path's board opJPar[p], each
// of its set-ups opJSw[p] played on it, those setting nothing off scored by their best trigger and their promise into opJRes[p]. Its
// own share, the decision's (opJEnd); the thread's clock as it was after.
typedef struct { int32_t sw, sent, cleared, trig, ch, pot; uint32_t h; } OpKid;
static Board opJPar[OP_BEAM];   // (copies: a node's board may be let go before a job reads it)
static int32_t opJSw[OP_BEAM][OP_KIDS], opJN[OP_BEAM], opJGot[OP_BEAM];
static OpKid opJRes[OP_BEAM][OP_KIDS];
static Question opJQ;
static double opJEnd;
static LOCAL Ctx *opJCtx;
static Ctx *opJobCtx;   // (the phase's own: the jobs make nodes only on their threads' contexts)
static void opKids(int32_t p) {
  double sShare = clockShare; int sJob = inJob; int32_t sAb = clockAborted; int64_t sPoll = clockPoll;
  clockShare = opJEnd; inJob = 1; clockAborted = 0; clockPoll = 0;
  int got = 0;
  Ctx *x = opJCtx = ctxOf(opJCtx);
  Question q = opJQ; q.b = &opJPar[p];
  int root = rootOf(x, &q);
  for (int i = 0; root >= 0 && i < opJN[p] && !clockOut(); i++) {
    int32_t sw = opJSw[p][i];
    int s1 = step(x, root, MK_SWAP, CR(sw), CC(sw), 0);
    if (!liveNode(x, s1)) continue;
    int out = settleOf(x, s1);
    if (!liveNode(x, out)) continue;
    Stats st; if ((statsOf(x, s1, &st) && st.cleared > 0) || (statsOf(x, out, &st) && st.cleared > 0)) continue;
    OpPath e; e.len = 0; opScore(&opJQ, x, out, &e);
    const Board *ob = ensureBoard(x, out);
    if (!ob) continue;
    opJRes[p][got++] = (OpKid){ sw, e.sent, e.cleared, e.trig, e.ch, e.pot, opHash(ob) };
  }
  opJGot[p] = got;
  clockShare = sShare; inJob = sJob; clockAborted = sAb; clockPoll = sPoll;
}
// every path's set-ups scored: on the workers beside this thread where the pool is free, else here one after another
static void opKidsAll(int n) {
  for (int p = 0; p < n; p++) opJGot[p] = 0;
  if (pool.nworkers > 0 && !poolBusy) {
    if (!opJobCtx) opJobCtx = ctxOf(0);
    __atomic_store_n(&jobStop, 0, __ATOMIC_SEQ_CST);
    if (startJobs(opJobCtx, opKids, n)) { finishPhase(opJobCtx); pool.job = 0; __atomic_store_n(&poolBusy, 0, __ATOMIC_RELEASE); return; }
  }
  for (int p = 0; p < n && !clockOut(); p++) opKids(p);
}
// THE PLAN GROWN in the time the clock gives: the beam re-rooted under the swap the last decision pressed, every path replayed on the board
// as it is (a path whose set-ups are no longer there is let go), then grown a level at a time. The best plan into opBest.
static void openingGrow(const Question *q) {
  Ctx *x = opCtx = ctxOf(opCtx);
  int root = rootOf(x, q);
  if (root < 0) return;
  // (re-rooted: the paths that began with the swap pressed, without it; the others let go)
  if (opPressed) {
    int m = 0;
    for (int i = 0; i < opN; i++) if (opBeam[i].len > 0 && opBeam[i].path[0] == opPressed) {
      OpPath p = opBeam[i]; for (int k = 1; k < p.len; k++) p.path[k - 1] = p.path[k]; p.len--; opBeam[m++] = p; }
    opN = m; opPressed = 0;
  }
  // (the board as it is: the empty path, and every path still there to press)
  int nodes[OP_BEAM]; int m = 0;
  { OpPath e; memset(&e, 0, sizeof e); opScore(q, x, root, &e); opNext[m] = e; nodes[m++] = root; }
  for (int i = 0; i < opN && m < OP_BEAM && !clockOut(); i++) {
    int at = opReplay(x, root, &opBeam[i]);
    if (at < 0) continue;
    OpPath p = opBeam[i]; opScore(q, x, at, &p);
    opNext[m] = p; nodes[m++] = at;
  }
  if (clockOut()) return;
  opN = m; for (int i = 0; i < m; i++) opBeam[i] = opNext[i];
  opHave = 0;
  for (int i = 0; i < opN; i++) if (opBeam[i].trig && (!opHave || opBetter(opBeam[i].sent, opBeam[i].cleared, opBeam[i].len, &opBest))) { opBest = opBeam[i]; opHave = 1; }
  // (grown a level at a time: every path's set-ups one swap on, the nearest its last swap first, each scored on whichever thread takes
  // its path (opKids); the OP_BEAM best kept and played again here, where the next level grows from them)
  opLevels = 0;
  while (!clockOut()) {
    int np = 0, from[OP_BEAM];
    for (int bi = 0; bi < opN && np < OP_BEAM; bi++) {
      if (opBeam[bi].len >= OP_DEPTH) continue;
      const Board *b0 = ensureBoard(x, nodes[bi]);
      if (!b0) continue;
      int32_t ms[MAXROWS * W]; int mm = swapsOfNode(x, nodes[bi], ms), dd[MAXROWS * W];
      int cr = b0->curRow, cc = b0->curCol;
      if (opBeam[bi].len) { cr = CR(opBeam[bi].path[opBeam[bi].len - 1]); cc = CC(opBeam[bi].path[opBeam[bi].len - 1]); }
      for (int i = 0; i < mm; i++) dd[i] = iabs(CR(ms[i]) - cr) + iabs(CC(ms[i]) - cc);
      for (int i = 1; i < mm; i++) for (int j = i; j > 0 && dd[j] < dd[j - 1]; j--) { int t = dd[j]; dd[j] = dd[j - 1]; dd[j - 1] = t; int32_t u = ms[j]; ms[j] = ms[j - 1]; ms[j - 1] = u; }
      int k = 0;
      for (int i = 0; i < mm && k < OP_KIDS; i++) { if (opBeam[bi].len == 0 && swapBack(CR(ms[i]), CC(ms[i]), 0)) continue; opJSw[np][k++] = ms[i]; }
      copyBoard(&opJPar[np], b0); opJN[np] = k; from[np++] = bi;
    }
    if (!np) break;
    opJQ = *q; opJQ.narr = 0; opJQ.holdLeft = 0; opJQ.holdStarted = 0; opJEnd = clockShare;
    opKidsAll(np);
    if (clockOut()) break;
    // (the kept: half the beam the kids whose trigger sends the most, the rest those with the most promise -- each board once)
    static int32_t cp[OP_BEAM * OP_KIDS], ci[OP_BEAM * OP_KIDS]; static uint8_t taken[OP_BEAM * OP_KIDS];
    int nc = 0;
    for (int p = 0; p < np; p++) for (int i = 0; i < opJGot[p]; i++) {
      const OpKid *c = &opJRes[p][i]; const OpPath *par = &opBeam[from[p]];
      if (c->trig && (!opHave || opBetter(c->sent, c->cleared, par->len + 1, &opBest))) {
        opBest = *par; opBest.path[opBest.len++] = c->sw; opBest.sent = c->sent; opBest.cleared = c->cleared; opBest.trig = c->trig; opBest.ch = c->ch;
        opBest.pot = c->pot; opHave = 1; }
      int dup = 0; for (int j = 0; j < nc && !dup; j++) dup = opJRes[cp[j]][ci[j]].h == c->h;
      if (!dup) { cp[nc] = p; ci[nc] = i; taken[nc++] = 0; }
    }
    int nn = 0, kp[OP_BEAM], kk[OP_BEAM];
    for (int half = 0; half < 2; half++) {
      int want = half ? OP_BEAM : OP_BEAM / 2;
      while (nn < want) {
        int w = -1;
        for (int j = 0; j < nc; j++) {
          if (taken[j]) continue;
          const OpKid *c = &opJRes[cp[j]][ci[j]];
          if (!half && !c->trig) continue;
          if (w < 0) { w = j; continue; }
          const OpKid *d = &opJRes[cp[w]][ci[w]];
          if (!half ? (c->sent != d->sent ? c->sent > d->sent : c->cleared > d->cleared) : (c->pot != d->pot ? c->pot > d->pot : c->sent > d->sent)) w = j;
        }
        if (w < 0) break;
        taken[w] = 1;
        const OpKid *c = &opJRes[cp[w]][ci[w]];
        opNext[nn] = opBeam[from[cp[w]]]; opNext[nn].path[opNext[nn].len++] = c->sw; opNext[nn].sent = c->sent; opNext[nn].cleared = c->cleared;
        opNext[nn].trig = c->trig; opNext[nn].ch = c->ch; opNext[nn].pot = c->pot; kp[nn] = from[cp[w]]; kk[nn] = c->sw; nn++;
      }
    }
    if (!nn) break;
    // (the kept played again here, from their paths' nodes)
    int m = 0, nodesNext[OP_BEAM];
    for (int i = 0; i < nn && !clockOut(); i++) {
      int s1 = step(x, nodes[kp[i]], MK_SWAP, CR(kk[i]), CC(kk[i]), 0);
      if (!liveNode(x, s1)) continue;
      int out = settleOf(x, s1);
      if (!liveNode(x, out)) continue;
      opNext[m] = opNext[i]; nodesNext[m++] = out;
    }
    if (clockOut() || !m) break;
    opN = m; for (int i = 0; i < m; i++) { opBeam[i] = opNext[i]; nodes[i] = nodesNext[i]; }
    opLevels++;
  }
}
