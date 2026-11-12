// THE OPENING, PLANNED (plans/gambit-opener.md -- the owner: the opener has the whole board and the most time it will ever have; it plans
// something amazing, with every piece): one beam over set-up sequences, kept from decision to decision through the opening. Each board in
// it is scored by the garbage the best trigger on it sends (triggerSendOf) and, tied, by the panels that trigger clears; each set-up
// clears nothing. Every decision grows it a level at a time in the time it has (the countdown's is the longest), re-rooted under the swap
// pressed: a path that begins with the swap pressed goes on without it, any other is let go. The plan is the best path and its trigger.
#define OP_BEAM 48       // the boards a level keeps
#define OP_KIDS 24       // the set-ups tried from each, the nearest the cursor first
#define OP_DEPTH 20      // the set-ups a plan may hold
typedef struct { int len; int32_t path[OP_DEPTH]; int32_t sent, cleared, trig, ch; } OpPath;
static OpPath opBeam[OP_BEAM], opNext[OP_BEAM], opBest;
static int opN, opHave;            // the beam's paths, and whether a plan is held
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
  p->sent = 0; p->cleared = 0; p->trig = 0; p->ch = 0;
  if (!eb) return;
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
  opBest = opBeam[0]; for (int i = 1; i < opN; i++) if (opBetter(opBeam[i].sent, opBeam[i].cleared, opBeam[i].len, &opBest)) opBest = opBeam[i];
  opHave = opBest.trig != 0;
  // (grown a level at a time: every path's set-ups one swap on, the nearest its last swap first; the OP_BEAM best kept)
  int nodesNext[OP_BEAM];
  while (!clockOut()) {
    int nn = 0, grew = 0;
    for (int bi = 0; bi < opN && !clockOut(); bi++) {
      if (opBeam[bi].len >= OP_DEPTH) continue;
      const Board *b0 = ensureBoard(x, nodes[bi]);
      if (!b0) continue;
      int32_t ms[MAXROWS * W]; int mm = swapsOfNode(x, nodes[bi], ms), dd[MAXROWS * W];
      int cr = b0->curRow, cc = b0->curCol;
      if (opBeam[bi].len) { cr = CR(opBeam[bi].path[opBeam[bi].len - 1]); cc = CC(opBeam[bi].path[opBeam[bi].len - 1]); }
      for (int i = 0; i < mm; i++) dd[i] = iabs(CR(ms[i]) - cr) + iabs(CC(ms[i]) - cc);
      for (int i = 1; i < mm; i++) for (int j = i; j > 0 && dd[j] < dd[j - 1]; j--) { int t = dd[j]; dd[j] = dd[j - 1]; dd[j - 1] = t; int32_t u = ms[j]; ms[j] = ms[j - 1]; ms[j - 1] = u; }
      for (int i = 0; i < mm && i < OP_KIDS && !clockOut(); i++) {
        if (opBeam[bi].len == 0 && swapBack(CR(ms[i]), CC(ms[i]), 0)) continue;
        int s1 = step(x, nodes[bi], MK_SWAP, CR(ms[i]), CC(ms[i]), 0);
        if (!liveNode(x, s1)) continue;
        int out = settleOf(x, s1);
        if (!liveNode(x, out)) continue;
        Stats st; if ((statsOf(x, s1, &st) && st.cleared > 0) || (statsOf(x, out, &st) && st.cleared > 0)) continue;
        OpPath e = opBeam[bi]; e.path[e.len++] = ms[i]; opScore(q, x, out, &e);
        if (!e.trig) continue;
        grew = 1;
        if (opBetter(e.sent, e.cleared, e.len, &opBest)) { opBest = e; opHave = 1; }
        int at = nn < OP_BEAM ? nn++ : -1;
        if (at < 0) { int w = 0; for (int k = 1; k < OP_BEAM; k++) if (opBetter(opNext[w].sent, opNext[w].cleared, opNext[w].len, &opNext[k])) w = k;
          if (opBetter(e.sent, e.cleared, e.len, &opNext[w])) at = w; }
        if (at >= 0) { opNext[at] = e; nodesNext[at] = out; }
      }
    }
    if (clockOut() || !grew || !nn) break;
    opN = nn; for (int i = 0; i < nn; i++) { opBeam[i] = opNext[i]; nodes[i] = nodesNext[i]; }
  }
}
