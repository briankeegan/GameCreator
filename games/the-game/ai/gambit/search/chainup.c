// THE OPENER'S CHAIN, BUILT (the owner: the opener has the countdown and the raise to set its chain up -- every move it would hold
// for goes into it): the longest chain one swap sets off on a board, played to its settle on the engine (triggerChainOf), and the
// set-up swap -- one that clears nothing itself -- after which that chain is longest (chainUpSwap), the nearest the cursor first.
// A hill climbed a swap at a time: each swap is judged as any line before it is pressed (decide.c, the opener's second hand).
static LOCAL Ctx *cuCtxA, *cuCtxB;
// the longest chain one swap sets off from the question's board, and that swap in *sw (0: none sets one off)
static int32_t triggerChainOf(const Question *q, int32_t *sw) {
  Ctx *x = cuCtxB = ctxOf(cuCtxB);
  int root = rootOf(x, q);
  if (root < 0) return 0;
  int32_t ms[MAXROWS * W]; int m = swapsOfNode(x, root, ms); int32_t best = 0;
  for (int i = 0; i < m && !clockOut(); i++) {
    int n = step(x, root, MK_SWAP, CR(ms[i]), CC(ms[i]), 0);
    if (!liveNode(x, n)) continue;
    int out = settleOf(x, n);
    if (!liveNode(x, out)) continue;
    Stats s; int32_t c = 0;
    if (statsOf(x, n, &s)) c = chainOfStats(&s);
    if (statsOf(x, out, &s) && chainOfStats(&s) > c) c = chainOfStats(&s);
    if (c > best) { best = c; if (sw) *sw = ms[i]; }
  }
  return best;
}
// the set-up swap after which the board's trigger chain is longest, clearing nothing itself, of those that make it longer than now;
// *now the trigger chain as the board stands, *after the one the swap leaves. 0: none makes it longer
static int chainUpSwap(const Question *q, int32_t *sw, int32_t *now, int32_t *after) {
  int32_t t0 = 0; *now = triggerChainOf(q, &t0); *after = *now;
  Ctx *x = cuCtxA = ctxOf(cuCtxA);
  int root = rootOf(x, q);
  if (root < 0) return 0;
  const Board *b0 = ensureBoard(x, root);
  if (!b0) return 0;
  int32_t ms[MAXROWS * W]; int m = swapsOfNode(x, root, ms);
  // (the nearest the cursor first: a climb cut by the clock has asked the swaps it would press soonest)
  int d[MAXROWS * W];
  for (int i = 0; i < m; i++) d[i] = iabs(CR(ms[i]) - b0->curRow) + iabs(CC(ms[i]) - b0->curCol);
  for (int i = 0; i < m; i++) for (int j = i + 1; j < m; j++) if (d[j] < d[i]) { int t = d[i]; d[i] = d[j]; d[j] = t; int32_t u = ms[i]; ms[i] = ms[j]; ms[j] = u; }
  int found = 0;
  for (int i = 0; i < m && !clockOut(); i++) {
    int n = step(x, root, MK_SWAP, CR(ms[i]), CC(ms[i]), 0);
    if (!liveNode(x, n)) continue;
    int out = settleOf(x, n);
    if (!liveNode(x, out)) continue;
    Stats s;
    if ((statsOf(x, n, &s) && s.cleared > 0) || (statsOf(x, out, &s) && s.cleared > 0)) continue;   // (a set-up clears nothing)
    Board *eb = ensureBoard(x, out);
    if (!eb) continue;
    Question q2 = *q; q2.b = eb; q2.narr = 0; q2.holdLeft = 0; q2.holdStarted = 0;
    int32_t c = triggerChainOf(&q2, 0);
    if (c > *after) { *after = c; *sw = ms[i]; found = 1; }
  }
  return found;
}
// the most garbage one swap sets off from the question's board -- its chain's slabs and every clear's combo garbage (plan.c sentCells),
// the swap in *sw, that clear's chain in *chain (0: none sends any)
static int32_t triggerSendOf(const Question *q, int32_t *sw, int32_t *chain) {
  Ctx *x = cuCtxB = ctxOf(cuCtxB);
  int root = rootOf(x, q);
  if (root < 0) return 0;
  int32_t ms[MAXROWS * W]; int m = swapsOfNode(x, root, ms); int32_t best = 0;
  for (int i = 0; i < m && !clockOut(); i++) {
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
// THE OPENER'S CHAIN PLANNED (the owner: the countdown's seconds plan the chains and set them going at once, big combos on top of them --
// fill the enemy's board with the first): a beam over set-up swaps -- each clearing nothing -- OPEN_DEPTH deep, OPEN_BEAM boards a level,
// the nearest the cursor first, each board scored by the garbage one swap sets off on it (triggerSendOf). The shortest sequence whose
// trigger sends OPEN_FILL cells or more -- the enemy's whole board -- else the one whose trigger sends the most, the trigger last: seq, *n
// its swaps, *chain the chain it sets off. 0: none found
#define OPEN_DEPTH 5
#define OPEN_BEAM 4
#define OPEN_KIDS 24   // (the swaps tried from each board, the nearest the cursor first)
#define OPEN_FILL (12 * W)   // (the cells that fill the enemy's board)
static LOCAL Ctx *cuCtxC;
static int chainPlan(const Question *q, int32_t want, int32_t *seq, int *n, int32_t *chain) {
  Ctx *x = cuCtxC = ctxOf(cuCtxC);
  int root = rootOf(x, q);
  if (root < 0) return 0;
  typedef struct { int node, len; int32_t path[OPEN_DEPTH], c; } Bm;
  Bm beam[OPEN_BEAM], next[OPEN_BEAM]; int nb = 1, best = 0, bestLen = 0; int32_t bestSeq[OPEN_DEPTH + 1], bestC = 0;
  beam[0].node = root; beam[0].len = 0;
  int32_t bestSent = 0; (void)want;
  { int32_t t = 0, ch = 0; int32_t c = triggerSendOf(q, &t, &ch); if (c > 0 && t) { bestSeq[0] = t; bestLen = 1; bestC = ch; bestSent = c; best = 1; if (c >= OPEN_FILL) goto done; } }
  for (int d = 0; d < OPEN_DEPTH && nb > 0 && !clockOut(); d++) {
    int nn = 0;
    for (int bi = 0; bi < nb && !clockOut(); bi++) {
      const Board *b0 = ensureBoard(x, beam[bi].node);
      if (!b0) continue;
      int32_t ms[MAXROWS * W]; int m = swapsOfNode(x, beam[bi].node, ms), dd[MAXROWS * W];
      int cr = b0->curRow, cc = b0->curCol;
      if (beam[bi].len) { cr = CR(beam[bi].path[beam[bi].len - 1]); cc = CC(beam[bi].path[beam[bi].len - 1]); }
      for (int i = 0; i < m; i++) dd[i] = iabs(CR(ms[i]) - cr) + iabs(CC(ms[i]) - cc);
      for (int i = 1; i < m; i++) for (int j = i; j > 0 && dd[j] < dd[j - 1]; j--) { int t = dd[j]; dd[j] = dd[j - 1]; dd[j - 1] = t; int32_t u = ms[j]; ms[j] = ms[j - 1]; ms[j - 1] = u; }
      for (int i = 0; i < m && i < OPEN_KIDS && !clockOut(); i++) {
        int s1 = step(x, beam[bi].node, MK_SWAP, CR(ms[i]), CC(ms[i]), 0);
        if (!liveNode(x, s1)) continue;
        int out = settleOf(x, s1);
        if (!liveNode(x, out)) continue;
        Stats st;
        if ((statsOf(x, s1, &st) && st.cleared > 0) || (statsOf(x, out, &st) && st.cleared > 0)) continue;   // (a set-up clears nothing)
        Board *eb = ensureBoard(x, out);
        if (!eb) continue;
        Question q2 = *q; q2.b = eb; q2.narr = 0; q2.holdLeft = 0; q2.holdStarted = 0;
        int32_t t = 0, ch = 0, c = triggerSendOf(&q2, &t, &ch);
        Bm e = beam[bi]; e.node = out; e.path[e.len++] = ms[i]; e.c = c;
        if (c > bestSent && t) { bestSent = c; bestC = ch; bestLen = e.len + 1; for (int k = 0; k < e.len; k++) bestSeq[k] = e.path[k]; bestSeq[e.len] = t; best = 1; if (c >= OPEN_FILL) goto done; }
        // (kept: the OPEN_BEAM boards whose trigger chain is longest)
        int at = nn < OPEN_BEAM ? nn++ : -1;
        if (at < 0) { int w = 0; for (int k = 1; k < OPEN_BEAM; k++) if (next[k].c < next[w].c) w = k; if (next[w].c < c) at = w; }
        if (at >= 0) next[at] = e;
      }
    }
    for (int i = 0; i < nn; i++) beam[i] = next[i];
    nb = nn;
  }
done:
  if (!best) return 0;
  for (int k = 0; k < bestLen; k++) seq[k] = bestSeq[k];
  *n = bestLen; *chain = bestC;
  return 1;
}
