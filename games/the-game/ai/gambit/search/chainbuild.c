// THE CHAIN DESIGNED (time attack -- the owner: flatten, raise to the top, and build one chain that uses every block, up to 13, again
// and again; a machine has the time to find it): on a board whose rows are full, a swap only orders the panels of its row, so the chain is
// designed as an order for each row. The design is searched on an abstract board -- colours only, every clear and fall played wave by
// wave (cbRun) -- by annealing: a move swaps two panels of one row, a design is worth the time attack score its best trigger's chain earns
// (SCORE_CHAIN_TA) less the swaps it takes to build from the board as it is, and one with a match before its trigger is worth nothing;
// the best kept is one whose swaps can be played in an order that sets nothing off on the way (cbOrder).
// The swaps are then put in an order that sets nothing off on the way (cbOrder), the trigger last.
typedef signed char cb8;
#define CB_ROWS (MAXROWS + 2)
#define CB_MAXSWAPS 96
typedef struct { cb8 g[CB_ROWS][W + 2]; int rows; } CbGrid;   // g[r][c]: a colour, 0 empty, -1 what does not move or match (garbage)
static const int32_t CB_CHAIN_TA[14] = { 0, 0, 50, 80, 150, 300, 400, 500, 700, 900, 1100, 1300, 1500, 1800 };   // panel-game checkMatches
static int32_t cbChainScore(int n) { int32_t s = 0; for (int k = 2; k <= n; k++) s += CB_CHAIN_TA[k < 13 ? k : 13]; return s; }
// (the cells in a run of three or more of one colour, across or up and down: marked, their count returned)
static LOCAL int32_t cbAcross, cbUpDown;   // (the runs marked across and up and down: the shape of a chain, for the log and the checks)
static int cbMark(const CbGrid *G, uint8_t m[CB_ROWS][W + 2]) {
  int n = 0;
  memset(m, 0, sizeof(uint8_t) * CB_ROWS * (W + 2));
  for (int r = 1; r <= G->rows; r++) for (int c = 1; c <= W - 2; c++) {
    cb8 a = G->g[r][c];
    if (a > 0 && G->g[r][c + 1] == a && G->g[r][c + 2] == a && (c == 1 || G->g[r][c - 1] != a)) cbAcross++;
    if (a > 0 && G->g[r][c + 1] == a && G->g[r][c + 2] == a) { int k = c; while (k <= W && G->g[r][k] == a) { if (!m[r][k]) { m[r][k] = 1; n++; } k++; } }
  }
  for (int c = 1; c <= W; c++) for (int r = 1; r <= G->rows - 2; r++) {
    cb8 a = G->g[r][c];
    if (a > 0 && G->g[r + 1][c] == a && G->g[r + 2][c] == a && (r == 1 || G->g[r - 1][c] != a)) cbUpDown++;
    if (a > 0 && G->g[r + 1][c] == a && G->g[r + 2][c] == a) { int k = r; while (k <= G->rows && G->g[k][c] == a) { if (!m[k][c]) { m[k][c] = 1; n++; } k++; } }
  }
  return n;
}
// (everything falls to the floor or the cell under it)
static void cbFall(CbGrid *G) {
  for (int c = 1; c <= W; c++) {
    int to = 1;
    for (int r = 1; r <= G->rows; r++) {
      cb8 v = G->g[r][c];
      if (v == 0) continue;
      if (v < 0) { to = r + 1; continue; }   // (garbage holds where it is: what is above it rests on it)
      if (to != r) { G->g[to][c] = v; G->g[r][c] = 0; }
      to++;
    }
  }
}
// THE CHAIN A SWAP SETS OFF: the swap at (r, c) played, then every wave -- the runs cleared, everything fallen -- until nothing matches.
// The links (a wave after the first is the chain's next), the panels cleared into *cleared; 0 when the swap makes no match.
static int cbRun(const CbGrid *G0, int r, int c, int *cleared) {
  static LOCAL CbGrid G; static LOCAL uint8_t m[CB_ROWS][W + 2];
  G = *G0;
  cb8 t = G.g[r][c]; G.g[r][c] = G.g[r][c + 1]; G.g[r][c + 1] = t;
  cbFall(&G);
  int links = 0, cl = 0;
  for (;;) {
    int n = cbMark(&G, m);
    if (!n) break;
    links++; cl += n;
    for (int y = 1; y <= G.rows; y++) for (int x = 1; x <= W; x++) if (m[y][x]) G.g[y][x] = 0;
    cbFall(&G);
    if (links > 30) break;
  }
  if (cleared) *cleared = cl;
  return links;
}
// (a swap that can set something off: one of the two cells finishes a run of three where the other was)
static int cbMaySet(const CbGrid *G, int r, int c) {
  cb8 a = G->g[r][c], b = G->g[r][c + 1];
  if (a < 0 || b < 0 || a == b) return 0;
  if (a == 0 || b == 0) return 1;
  // (a lands in c + 1, b in c)
  cb8 x[2] = { b, a };
  for (int s = 0; s < 2; s++) {
    int col = c + s; cb8 v = x[s];
    int n = 1;
    for (int k = col - 1; k >= 1 && k != c + (1 - s) && G->g[r][k] == v; k--) n++;
    for (int k = col + 1; k <= W && k != c + (1 - s) && G->g[r][k] == v; k++) n++;
    if (n >= 3) return 1;
    n = 1;
    for (int q = r - 1; q >= 1 && G->g[q][col] == v; q--) n++;
    for (int q = r + 1; q <= G->rows && G->g[q][col] == v; q++) n++;
    if (n >= 3) return 1;
  }
  return 0;
}
// THE BEST TRIGGER of a design: the swap whose chain scores most (its links' score, ten a panel); the swap into *tr (r * 8 + c)
static int32_t cbBest(const CbGrid *G, int32_t *tr, int *links) {
  int32_t best = 0; int bl = 0;
  for (int r = 1; r <= G->rows; r++) for (int c = 1; c < W; c++) {
    if (!cbMaySet(G, r, c)) continue;
    int cl = 0, l = cbRun(G, r, c, &cl);
    if (!l) continue;
    int32_t s = cbChainScore(l) + 10 * cl;
    if (s > best) { best = s; bl = l; if (tr) *tr = r * 8 + c; }
  }
  if (links) *links = bl;
  return best;
}
// (the adjacent swaps that make row `to` of `from`, panels of one colour kept in their order: the count; the swaps, left cell of each,
// into sw when given)
static int cbRowSwaps(const cb8 *from, const cb8 *to, cb8 *sw, int cap) {
  cb8 cur[W + 2]; int n = 0;
  for (int c = 1; c <= W; c++) cur[c] = from[c];
  for (int c = 1; c <= W; c++) {
    if (cur[c] == to[c]) continue;
    int k = c + 1; while (k <= W && cur[k] != to[c]) k++;
    if (k > W) return 999;
    for (; k > c; k--) { cb8 t = cur[k]; cur[k] = cur[k - 1]; cur[k - 1] = t; if (sw && n < cap) sw[n] = (cb8)(k - 1); n++; }
  }
  return n;
}
static int cbSwapsTo(const CbGrid *A, const CbGrid *B) {
  int n = 0;
  for (int r = 1; r <= A->rows; r++) n += cbRowSwaps(A->g[r], B->g[r], 0, 0);
  return n;
}
static int cbStable(const CbGrid *G) { static LOCAL uint8_t m[CB_ROWS][W + 2]; return cbMark(G, m) == 0; }
// (a row the design may order: full, nothing in it that does not move)
static int cbFull(const CbGrid *G, int r) { for (int c = 1; c <= W; c++) if (G->g[r][c] <= 0) return 0; return 1; }
static LOCAL uint32_t cbRand;
static double cbExp(double x) { return x >= 0 ? 1 : 1 / (1 - x + x * x / 2 - x * x * x / 6); }   // (e^x for x <= 0, near enough to anneal by)
static uint32_t cbNext(void) { cbRand ^= cbRand << 13; cbRand ^= cbRand >> 17; cbRand ^= cbRand << 5; return cbRand; }
// THE SWAPS IN AN ORDER THAT SETS NOTHING OFF: each row's swaps (cbRowSwaps) kept in their row's order, the rows interleaved -- searched
// depth first, a swap whose board would match not taken, CB_ORDER_TRIES boards tried at most; the trigger last. Into seq (r * 8 + c); the
// count, -1 where no order is found.
#define CB_ORDER_TRIES 20000
static LOCAL cb8 cbSw[CB_ROWS][CB_MAXSWAPS]; static LOCAL int cbNs[CB_ROWS], cbAt[CB_ROWS], cbTries;
static int cbOrderFrom(CbGrid *G, int left, int32_t *seq, int n) {
  if (!left) return n;
  if (++cbTries > CB_ORDER_TRIES) return -1;
  for (int r = 1; r <= G->rows; r++) {
    if (cbAt[r] >= cbNs[r]) continue;
    int c = cbSw[r][cbAt[r]];
    cb8 t = G->g[r][c]; G->g[r][c] = G->g[r][c + 1]; G->g[r][c + 1] = t;
    if (cbStable(G)) {
      seq[n] = r * 8 + c; cbAt[r]++;
      int k = cbOrderFrom(G, left - 1, seq, n + 1);
      if (k >= 0) return k;
      cbAt[r]--;
    }
    G->g[r][c + 1] = G->g[r][c]; G->g[r][c] = t;
  }
  return -1;
}
static int cbOrder(const CbGrid *G0, const CbGrid *D, int32_t tr, int32_t *seq, int cap) {
  int left = 0;
  for (int r = 1; r <= G0->rows; r++) { cbNs[r] = cbRowSwaps(G0->g[r], D->g[r], cbSw[r], CB_MAXSWAPS); cbAt[r] = 0; if (cbNs[r] > CB_MAXSWAPS) return -1; left += cbNs[r]; }
  if (left + 1 > cap) return -1;
  CbGrid G = *G0; cbTries = 0;
  int n = cbOrderFrom(&G, left, seq, 0);
  if (n < 0) return -1;
  seq[n++] = tr;
  return n;
}
#define CB_SWAP_COST 120   // a swap's worth in score: the time it takes against the score a link's time brings (measured: time attack runs)
// THE DESIGN SEARCHED, from `start` (the board's own order, or a design of it kept), in `ms` of the wall clock: the best design into *out,
// its trigger, links and score
static int32_t cbDesign(const CbGrid *G0, const CbGrid *start, double ms, CbGrid *out, int32_t *tr, int *links, int *swaps) {
  int full[CB_ROWS], nf = 0;
  for (int r = 1; r <= G0->rows; r++) if (cbFull(G0, r)) full[nf++] = r;
  *out = *G0; *tr = 0; *links = 0; *swaps = 0;
  if (!nf) return 0;
  if (!cbRand) cbRand = 2463534242u;
  CbGrid cur = start ? *start : *G0, best = *G0;
  int32_t t0 = 0, l0 = 0, bestV = 0, bestT = 0; int bestL = 0, bestS = 0;
  int32_t curV = cbStable(&cur) ? cbBest(&cur, &t0, &l0) - CB_SWAP_COST * cbSwapsTo(G0, &cur) : -100000;
  { static LOCAL int32_t ord0[CB_MAXSWAPS + 1];
    if (curV > 0 && t0 && cbOrder(G0, &cur, t0, ord0, CB_MAXSWAPS + 1) > 0) { best = cur; bestV = curV; bestT = t0; bestL = l0; bestS = cbSwapsTo(G0, &cur); } }
  double end = nowMs() + ms, temp = 400;
  for (int it = 0; ; it++) {
    if ((it & 63) == 0) { double now = nowMs(); if (now >= end) break; temp = 400 * (end - now) / ms + 5; }
    int r = full[cbNext() % (unsigned)nf], a = 1 + (int)(cbNext() % W), b = 1 + (int)(cbNext() % W);
    if (a == b || cur.g[r][a] == cur.g[r][b]) continue;
    cb8 t = cur.g[r][a]; cur.g[r][a] = cur.g[r][b]; cur.g[r][b] = t;
    int32_t tt = 0, ll = 0, v;
    if (!cbStable(&cur)) v = -100000;
    else { int s = cbSwapsTo(G0, &cur); v = cbBest(&cur, &tt, &ll) - CB_SWAP_COST * s; if (s > CB_MAXSWAPS) v = -100000; }
    if (v >= curV || (double)(cbNext() % 100000) / 100000.0 < cbExp((v - curV) / temp)) {
      curV = v;
      // (a new best only where its swaps can be played setting nothing off on the way)
      static LOCAL int32_t ord[CB_MAXSWAPS + 1];
      if (v > bestV && cbOrder(G0, &cur, tt, ord, CB_MAXSWAPS + 1) > 0) { bestV = v; best = cur; bestT = tt; bestL = ll; bestS = cbSwapsTo(G0, &cur); }
    } else { cur.g[r][b] = cur.g[r][a]; cur.g[r][a] = t; }
  }
  *out = best; *tr = bestT; *links = bestL; *swaps = bestS;
  return bestV;
}
// (a board read as the design's: its settled cells, garbage as what does not move)
static void cbOfBoard(const Board *b, CbGrid *G) {
  memset(G, 0, sizeof *G);
  G->rows = imin(b->height, CB_ROWS - 2);
  for (int r = 1; r <= G->rows; r++) for (int c = 1; c <= W; c++) { int32_t v = cellAt(b, r, c); G->g[r][c] = (cb8)(v > 0 && v < 100 ? v : v < 0 ? -1 : 0); }
}

// THE DESIGN SEARCHED ON EVERY THREAD (cbDesignAll): a search of its own on each, from a seed of its own, the best of them kept
#define CB_JOBS 5
static CbGrid cbJG, cbJStart, cbJOut[CB_JOBS]; static int cbJHasStart, cbJL[CB_JOBS], cbJS[CB_JOBS]; static double cbJMs;
static int32_t cbJTr[CB_JOBS], cbJV[CB_JOBS];
static Ctx *cbJobCtx;   // (the phase's own: each search makes no nodes)
static void cbJob(int32_t i) {
  cbRand = 2463534242u ^ ((uint32_t)i * 2654435761u) ^ (uint32_t)nowMs();
  if (!cbRand) cbRand = 1;
  cbJV[i] = cbDesign(&cbJG, cbJHasStart ? &cbJStart : 0, cbJMs, &cbJOut[i], &cbJTr[i], &cbJL[i], &cbJS[i]);
}
static int32_t cbDesignAll(const CbGrid *G, const CbGrid *start, double ms, CbGrid *out, int32_t *tr, int *links, int *swaps) {
  cbJG = *G; cbJHasStart = start != 0; if (start) cbJStart = *start; cbJMs = ms;
  int n = 1 + imin(pool.nworkers, CB_JOBS - 1);
  for (int i = 0; i < CB_JOBS; i++) cbJV[i] = -1000000;
  if (n > 1 && !poolBusy) {
    if (!cbJobCtx) cbJobCtx = ctxOf(0);
    if (startJobs(cbJobCtx, cbJob, n)) { finishPhase(cbJobCtx); pool.job = 0; __atomic_store_n(&poolBusy, 0, __ATOMIC_RELEASE); }
    else { n = 1; cbJob(0); }
  } else { n = 1; cbJob(0); }
  int b = 0; for (int i = 1; i < n; i++) if (cbJV[i] > cbJV[b]) b = i;
  *out = cbJOut[b]; *tr = cbJTr[b]; *links = cbJL[b]; *swaps = cbJS[b];
  return cbJV[b];
}
// THE DESIGN KEPT ACROSS DECISIONS (time attack, decide.c): the board it is building toward (taD), its trigger, its links and the time
// searched on it; taOn once its swaps are being pressed. Each decision finds it again on the board as it is -- the stack risen s rows,
// each row of the design the same panels as the board's row s above it (cbShiftOf) -- and the rest of its swaps are worked out afresh
// from there (cbOrder), so the rise never leaves a swap on the wrong row.
static CbGrid taD; static int32_t taHave, taOn, taTr, taLinks, taSwaps, taStep, taVal; static double taMs;
static int cbSameRow(const cb8 *a, const cb8 *b, int exact) {
  if (exact) { for (int c = 1; c <= W; c++) if (a[c] != b[c]) return 0; return 1; }
  int na[16] = { 0 }, nb[16] = { 0 };
  for (int c = 1; c <= W; c++) { na[a[c] & 15]++; nb[b[c] & 15]++; }
  for (int k = 0; k < 16; k++) if (na[k] != nb[k]) return 0;
  return 1;
}
static int cbShiftOf(const CbGrid *G, const CbGrid *D) {
  for (int sft = 0; sft <= 3; sft++) {
    int ok = 1;
    for (int r = 1; r <= D->rows && ok; r++) {
      int any = 0; for (int c = 1; c <= W; c++) if (D->g[r][c]) any = 1;
      if (!any) continue;
      if (r + sft > G->rows) { ok = 0; break; }
      ok = cbSameRow(G->g[r + sft], D->g[r], !cbFull(D, r));
    }
    if (ok) return sft;
  }
  return -1;
}
// (the design moved up `sft` rows on the board G: its rows under them the board's own)
static void cbShiftUp(CbGrid *D, const CbGrid *G, int sft) {
  if (sft <= 0) return;
  for (int r = D->rows; r >= 1; r--) for (int c = 1; c <= W; c++) D->g[r][c] = r - sft >= 1 ? D->g[r - sft][c] : G->g[r][c];
  taTr += sft * 8;
}
static void taReset(void) { taHave = taOn = 0; taTr = taLinks = taSwaps = taStep = taVal = 0; taMs = 0; }
