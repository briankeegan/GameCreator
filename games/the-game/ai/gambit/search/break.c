// THE BREAK SEARCH (as Gambit asks it: maxDepth 1, no line kept from the default bot's touch line).
// Garbage on the board, a break is a line after which more garbage is broken than the board left alone breaks by the same frame (a
// popping slab goes on converting whatever is pressed). In order, the first that finds one answers:
//   1. a first swap that breaks;
//   2. resting garbage, nothing popping: THE TOUCH BEAM -- lines kept by how near a break they are (breakNear, then how even the stack
//      under the garbage is), grown a swap a level for TOUCH_DEPTH levels, TOUCH_BEAM wide and then TOUCH_WIDER; the lines the last
//      decision was growing (resume) are played again first and carried on, half of every level's beam theirs;
//   3. a slab popping (wait: the frames of pop left): a first swap after which the pop's end breaks; then the first of a pair; then the
//      aimed lineup (the colours the converting row turns into, met by pairs on top of their columns); then a first swap leaving a
//      break one swap away once the board has settled; then, the cursor being free, the touch beam on the garbage elsewhere.
// Every line is held to the decision's rules as it is grown (stepOk: each step within the list; firstOk: a first swap that is no swap
// back) and a break is taken only through the shared line check (lineFits). Every step is the clock's: past its share the search
// ends with what it has.

#define TOUCH_DEPTH 12
// (SEARCH DEEP ENOUGH, plans/gambit-next.md 7: the touch beam's depth this decision -- a swap deeper after each decision whose break search
// found no break and was not cut by the clock, back to TOUCH_DEPTH once one is found; set by the decision before its searches begin,
// answer.c, and read by every thread)
#define TOUCH_DEPTH_MAX 16
static int32_t touchDepth = TOUCH_DEPTH;
#define CHEAP_BREAK 6    // the actions a break may walk for before the level after it is searched for a cheaper one
#define TOUCH_BEAM 60
#define TOUCH_WIDE 100     // TOUCH_WIDER, the one wider beam
#define LONGEST (2 * TOUCH_DEPTH)   // a line carried on to the next decision is shorter than this
#define KEEPN TOUCH_BEAM            // the lines carried on
#define LINEUP_BUDGET 400
// (the touch beam from its wider beam on, its narrower left to another thread searching the same board: answer.c's wide job)
static LOCAL int32_t touchFrom;
#define LINEUP_DEPTH 8
#define LINEUP_BEAM 12
#define PAIR 5
#define NEAR_MISS 20
#define MAXPATH 32
#define LINEUP_AFTER 30
#define LINEPOOL 8192   // lines one level holds: TOUCH_WIDE x the swaps of a board

typedef struct { int32_t key, n, s, h, len, kept, res; int32_t path[MAXPATH]; Moved last; } Line;   // res: grown from a line the last decision carried on
typedef struct { int32_t n, len[KEEPN]; int32_t path[KEEPN][MAXPATH]; } Paths;
// THE ANSWER (breakMoves' return): depth 1 with the first swaps that break (moves) and how -- the line (path), the line-up pairs
// (lines, one per first swap found), or depth 0 with the line nearest a break (toward) and the lines to choose among (towards)
typedef struct {
  int32_t depth, nmoves, moves[MAXROWS * W];
  int32_t at, touch, carried, wide, lineup;        // lineup: 0 none, 1 the pop's end, 2 a pair, 3 aimed, 4 ready
  int32_t built;                                    // the line breakNear builds (the nearest break walked to)
  int32_t pathLen, path[MAXPATH];
  int32_t pairs[MAXROWS * W][2];                    // lines, beside moves (lineup 2 and 4)
  int32_t towardLen, toward[MAXPATH];
  Paths towards;                                    // keepOut's lines, then toward
  Paths keepOut;                                    // what the next decision carries on
  int32_t resIn, resPlayed, resLeft;                // the lines the last decision carried on, of them the ones played again whole, and those the clock left unplayed (handed on)
  int32_t resWhy[4];                                // and why the rest were not: a swap not there, a pair put back, the board lost, outside the rules
  int32_t doomed;                                   // lines the touch beam let go for leaving less than a break's time before the board dies
} Broke;

static LOCAL Ctx *breakCtx;
// THE LINES' ROOM: a line carries its own path, so a level's lines are let go once the next level is made -- two arenas a level at a time
// (arena 0 and 1, in turn), and one for what lives through the whole search (the carried lines, the first swaps, the line-ups). A line
// that finds no room ends the search where it is, and says so (Broke.full).
#define LINEARENA 8192
static LOCAL Line *arena[3]; static LOCAL int32_t arenaN[3], linesFull;
static Line *lineIn(int a) {
  if (!arena[a]) arena[a] = (Line *)grab(sizeof(Line) * LINEARENA);
  if (!arena[a] || arenaN[a] >= LINEARENA) { linesFull = 1; return 0; }
  return &arena[a][arenaN[a]++];
}
#define KEEPS 2   // the arena of what lives through the search
#define SEARCH_OUT() (clockOut() || linesFull)
static Line *lineNew(void) { return lineIn(KEEPS); }

// ---- the grid (rows 0..height+1, 0 empty, -2 garbage, else the colour)
static int32_t cellAt(const Board *b, int r, int c) { return r < 0 || r > b->height + 1 || c < 1 || c > W ? 0 : gridCell(b, r, c); }
static int32_t gridLen(const Board *b) { return b->height + 2; }
// the lowest row with garbage, from row 1 (G = grid length when none)
static LOCAL Bits scratchBits;
static int lowestG(const Board *b) { bitsOf(b, &scratchBits); return bitsLowestG(&scratchBits); }
// How uneven the stack under the lowest garbage is: each column's shortfall from the tallest, squared
static int32_t unevenOf(const Bits *B) {
  int G = bitsLowestG(B), hi = 0, tops[W + 1];
  for (int c = 1; c <= W; c++) { int t = 0; for (int r = 1; r < G; r++) if (B->pan[r] >> c & 1) t = r; tops[c] = t; if (t > hi) hi = t; }
  int32_t u = 0;
  for (int c = 1; c <= W; c++) u += (hi - tops[c]) * (hi - tops[c]);
  return u;
}
static int32_t uneven(const Board *b) { bitsOf(b, &scratchBits); return unevenOf(&scratchBits); }
// the swaps that walk the panel at (q, from) to column k along its row
static int walkTo(int q, int from, int k, int32_t *seq, int n) {
  if (from > k) for (int c = from - 1; c >= k && n < MAXPATH; c--) seq[n++] = q * 8 + c;
  else for (int c = from; c < k && n < MAXPATH; c++) seq[n++] = q * 8 + c;
  return n;
}
// HOW MANY SWAPS AWAY THE NEAREST BREAK IS (breakNear): the fewest swaps that line up a match of three with a panel touching garbage --
// each other panel of the match brought along its own row, over cells that hold it up and are not garbage (bitsBring). NEAR_MISS when
// none. (And the line that makes it: seq, *nseq -- each panel walked in turn; 0 for none.)
static int nearLineOf(const Bits *B, int32_t *seq, int *nseq) {
  int top = B->top, best = 1 << 30;
  if (nseq) *nseq = 0;
  for (int r = 1; r <= top; r++) {
    unsigned starts = bitsStarts(B, r);
    for (int c = 1; c <= W; c++) {
      if (!(starts >> c & 1)) continue;
      int32_t k = B->code[r][c];
      // a column of three through it
      for (int r0 = r - 2; r0 <= r; r0++) {
        if (r0 < 1 || r0 + 2 > top) continue;
        int dv = 0, from, fr[3] = { 0 }, qs[3] = { 0 }, nq = 0;
        for (int q = r0; q <= r0 + 2 && dv < best; q++) { if (q == r) continue; int d = bitsBring(B, q, c, k, 0, &from); if (d >= 0) { dv += d; qs[nq] = q; fr[nq++] = from; } else dv = 1 << 30; }
        if (dv < best) { best = dv; if (seq) { int n = 0; for (int i = 0; i < nq; i++) n = walkTo(qs[i], fr[i], c, seq, n); *nseq = n; } }
      }
      // a row of three through it
      for (int c0 = c - 2; c0 <= c; c0++) {
        if (c0 < 1 || c0 + 2 > W) continue;
        unsigned used = 1u << c;
        int dh = 0, from, fr[3] = { 0 }, ts[3] = { 0 }, nt = 0;
        for (int t = c0; t <= c0 + 2 && dh < best; t++) { if (t == c) continue; int d = bitsBring(B, r, t, k, used, &from); if (d >= 0) { used |= 1u << from; dh += d; ts[nt] = t; fr[nt++] = from; } else dh = 1 << 30; }
        if (dh < best) { best = dh; if (seq) { int n = 0; for (int i = 0; i < nt; i++) n = walkTo(r, fr[i], ts[i], seq, n); *nseq = n; } }
      }
    }
  }
  return best;
}
static int breakNearLine(const Board *b, int32_t *seq, int *nseq) { bitsOf(b, &scratchBits); return nearLineOf(&scratchBits, seq, nseq); }
static int breakNear(const Board *b) { return breakNearLine(b, 0, 0); }
// A BREAK'S WALK, MEASURED: the cursor's actions over the nearest break's line on board b (breakNearLine), swap after swap from where
// the cursor is, as the frame loop walks it -- the one measure of a walk every reader asks (the window plan's break walk, decide.c; the
// save a line leaves, rank.c saveKept); -1 with none in reach
static int32_t walkOfBoard(const Board *b) {
  int32_t seq[MAXPATH]; int nseq = 0;
  bitsOf(b, &scratchBits);
  if (nearLineOf(&scratchBits, seq, &nseq) >= NEAR_MISS || nseq <= 0) return -1;
  int r = b->curRow, c = b->curCol, acts = 0;
  for (int i = 0; i < nseq; i++) { acts += actionsFor(r, c, CR(seq[i]), CC(seq[i]), walkLeft() - acts); r = CR(seq[i]); c = CC(seq[i]); }
  return acts;
}
// A PERCHED BLOCK (perchedDrops): a garbage block whose bottom row is held up by panels in some of the columns under it and by nothing in
// the others -- a hollow under it. Its supports walked along their row past the block's nearer edge let it down, and the stack's height
// with it. A block that sits on garbage in any column under it is not perched: there is nothing to walk out. The lines, lowest block
// first: each support's walk, one after another.
#define PERCHMAX 4
typedef struct { int32_t n, len[PERCHMAX], seq[PERCHMAX][MAXPATH]; } Perches;
static void perchedOf(const Bits *B, Perches *P) {
  P->n = 0;
  for (int r = 2; r <= B->top && P->n < PERCHMAX; r++) {
    unsigned g = B->gar[r];
    for (int c = 1; c <= W && P->n < PERCHMAX; c++) {
      if (!(g >> c & 1) || (B->gar[r - 1] >> c & 1)) continue;
      // (the block's bottom row in this row: its cells from c to R, one block)
      int32_t id = B->gid[r][c];
      int L = c, R = c;
      while (R + 1 <= W && (g >> (R + 1) & 1) && B->gid[r][R + 1] == id) R++;
      c = R;
      unsigned span = ((2u << R) - 1u) & ~((1u << L) - 1u), under = r - 1;
      if (B->gar[under] & span) continue;
      unsigned holds = B->pan[under] & span;
      if (!holds || holds == span) continue;
      int n = 0, ok = 1;
      if (L == 1 && R == W) {
        // (A BLOCK AS WIDE AS THE BOARD has no edge to walk past: each support is walked into the nearest hollow beside it -- a column two
        // or more lower, over no taller column on the way -- where it falls; the block comes down onto the next row once every support
        // in its row is gone, and the walk goes on there, till no hollow is left under it. h: each column's top under the block, as the
        // walks leave it; got: the panels walked onto it; a column whose top is garbage cannot be walked. A row whose supports cannot all
        // be walked is left out: the line ends where the block last came down)
        int h[W + 2], got[W + 2], cur = under;
        for (int c2 = 1; c2 <= W; c2++) { h[c2] = 0; got[c2] = 0; for (int r2 = under; r2 >= 1; r2--) if ((B->pan[r2] | B->gar[r2]) >> c2 & 1) { h[c2] = r2; break; } }
        while (cur >= 1 && n < MAXPATH) {
          int walked = 0, left = 0, nRow = n, full = 1;
          for (int k = 1; k <= W && full; k++) {
            if (h[k] != cur) continue;
            if (!got[k] && !(B->pan[cur] >> k & 1)) { left++; continue; }   // (garbage holds it here)
            int to = 0;
            for (int d = 1; d < W && !to; d++)
              for (int j = k - d; j <= k + d && !to; j += 2 * d) {
                if (j < 1 || j > W || h[j] > cur - 2) continue;
                int clear = 1; for (int c2 = j < k ? j + 1 : k + 1; c2 < (j < k ? k : j); c2++) if (h[c2] >= cur) clear = 0;
                if (clear) to = j;
              }
            if (!to) { left++; continue; }
            int was = n;
            n = walkTo(cur, k, to, P->seq[P->n], n);
            if (n - was != (to > k ? to - k : k - to)) { full = 0; break; }
            walked++;
            if (got[k]) got[k]--;
            h[k]--; while (h[k] >= 1 && !got[k] && !((B->pan[h[k]] | B->gar[h[k]]) >> k & 1)) h[k]--;
            h[to]++; got[to]++;
          }
          if (!walked || left || !full) { n = nRow; break; }   // (a support left, or no room for the walk: the block stays where the last row left it)
          int top = 0; for (int c2 = 1; c2 <= W; c2++) top = imax(top, h[c2]);
          cur = top;
        }
      } else
      for (int k = L; k <= R && ok; k++) {
        if (!(holds >> k & 1)) continue;
        int toL = L - 1, toR = R + 1, to = toL >= 1 && (k - toL <= toR - k || toR > W) ? toL : toR <= W ? toR : 0;
        if (!to) { ok = 0; break; }
        int was = n;
        n = walkTo(under, k, to, P->seq[P->n], n);
        if (n - was != (to > k ? to - k : k - to)) ok = 0;
      }
      if (ok && n > 0) { P->len[P->n] = n; P->n++; }
    }
  }
}
static void perchedDrops(const Board *b, Perches *P) { bitsOf(b, &scratchBits); perchedOf(&scratchBits, P); }
static int nearOf(const Board *b) { return imin(breakNear(b), NEAR_MISS); }
static int breakBuildable(const Board *b) { return breakNear(b) < NEAR_MISS; }
// (garbage on the board: the board's shape's, the one reading -- search/bits.c bitsShape, every row the board holds, as the facts read it)
static int garbageOn(const Board *b) { static LOCAL BoardShape GS; bitsOf(b, &scratchBits); bitsShape(&scratchBits, &GS); return GS.garbage; }
// the panels on the board, garbage not counted -- the material every break is made from
static int32_t panelsOn(const Board *b) { bitsOf(b, &scratchBits); return bitsPanels(&scratchBits); }
// THE TOUCH BEAM'S KEY, one order: the swaps to the nearest break, then the fewer empty cells under garbage (bitsShape hollow: a block
// held up over a hollow lets down onto panels as its supports clear -- the way to a break where no match touches it yet), then the
// evener stack under it
static int32_t nearScore(const Board *b) {
  static LOCAL BoardShape NS;
  bitsOf(b, &scratchBits);
  int n = nearLineOf(&scratchBits, 0, 0);
  bitsShape(&scratchBits, &NS);
  int32_t u = unevenOf(&scratchBits);
  return -((int32_t)(n < NEAR_MISS ? n : NEAR_MISS) << 23) - ((int32_t)imin(NS.hollow, 511) << 14) - imin(u, 16383);
}
// How far a board is toward lining up with the converting row `want`: per column, its top panel below the lowest garbage of that colour,
// and the one under it too
static int32_t pairsOf(const Board *b, const int32_t *want) {
  int G = lowestG(b);
  int32_t s = 0;
  for (int c = 1; c <= W; c++) {
    if (!want[c]) continue;
    int t = 0;
    for (int r = 1; r < G; r++) if (cellAt(b, r, c) > 0) t = r;
    if (t && cellAt(b, t, c) == want[c]) s += t > 1 && cellAt(b, t - 1, c) == want[c] ? PAIR : 1;
  }
  return s;
}
// The colours the row a popping slab converts has dealt, per column (0 where none), from the board as the game shows it; 0 if none.
static int converting(const Board *b, int32_t *want) {
  for (int r = 1; r < b->nrows; r++) {
    int any = 0;
    for (int c = 1; c <= W; c++) {
      const int32_t *f = b->p[r][c].f;
      if (f[ISGARBAGE] && f[STATE] == MATCHED && f[COLOR] >= 1 && f[COLOR] <= 8) { want[c] = f[COLOR]; any = 1; } else want[c] = 0;
    }
    if (any) return 1;
  }
  return 0;
}

// ---- the search
typedef struct {
  Ctx *x; int root, wait;
  const Question *q;   // (the board the search is rooted at: the decision's, or a readiness search's landed board -- what a line is judged on)
  Broke *out;
  const Paths *resume;
  int32_t *outside;      // per node: made off the rules (stepOk) -- a break counts only on a line within them from its first swap
  int32_t idleT[256], idleB[256], nIdle;
  int32_t anyFound;
  int32_t towardS, haveToward, towardLen, toward[MAXPATH];
  int32_t tries;
} BS;
static LOCAL int32_t outsideBuf[1 << 20];
// A break is more broken than standing still breaks by the same frame (stillAt: judge.c aloneBrokeAt, kept per frame a search)
static int32_t stillAt(BS *s, int32_t t) {
  for (int i = 0; i < s->nIdle; i++) if (s->idleT[i] == t) return s->idleB[i];
  int32_t b = aloneBrokeAt(s->x, s->root, t);
  if (s->nIdle < 256) { s->idleT[s->nIdle] = t; s->idleB[s->nIdle++] = b; }
  return b;
}
static int within(BS *s, int i) { return !(BREAK_LIST && i >= 0 && i < (1 << 20) && s->outside[i]); }
// (every node a step makes is marked as the rules see it: off them when its parent was, when it is a first swap that is a swap back,
// or when its own clears are outside the list)
static void markStep(BS *s, int par, int kind, int mv, int o) {
  Ctx *x = s->x;
  if (!BREAK_LIST || !liveNode(x, o) || o >= (1 << 20)) return;
  int fromRoot = par == s->root, firstBad = 0;
  if (fromRoot && kind == MK_SWAP) {
    firstBad = !firstOk(CR(mv), CC(mv), madeBy(x, o, s->root));
  }
  s->outside[o] = (par >= 0 && par < (1 << 20) && s->outside[par]) || firstBad || !stepFitsAt(x, o);
}
static int stepMarked(BS *s, int par, int kind, int mv, int32_t frames) {
  int o = step(s->x, par, kind, kind == MK_SWAP || kind == MK_SETTLE ? CR(mv) : 0, kind == MK_SWAP || kind == MK_SETTLE ? CC(mv) : 0, frames);
  markStep(s, par, kind, mv, o);
  return o;
}
// (the same, the swap taken from a batch the search stepped on every thread: core/nodes.h stepBatch)
static int swapTaken(BS *s, int j, int par, int32_t mv) {
  int o = stepTake(s->x, j, par, MK_SWAP, mv);
  markStep(s, par, MK_SWAP, mv, o);
  return o;
}
// THE BREAK: more broken than standing still by then, within the rules, played through its settle within the list,
// and its whole line through the shared line check. Past the clock no check is asked, and nothing breaks.
static int allowedAt(Ctx *x, int o) {
  if (!liveNode(x, o) || !stepFitsAt(x, o)) return 0;
  int z = settleOf(x, o);
  return liveNode(x, z) && stepFitsAt(x, z);
}
static int breaksAt(BS *s, int n, const int32_t *path, int len) {
  Ctx *x = s->x;
  if (!liveNode(x, n) || !within(s, n) || !(NODE(x, n)->brk > stillAt(s, NODE(x, n)->t))) return 0;
  if (clockOut()) return 0;
  // (off the list, the line still through the order's own checks: not dead, pressed whole, no three wasted -- outcome.c lineCheck. A
  // readiness search, rooted at a line's board once everything lands, asks only that a break is there: the decisions until then judge
  // the line that presses it, each through the check)
  int ready = s->q != &decQ;
  return (!BREAK_LIST || allowedAt(x, n)) && (!path || ready || lineCheckOn(s->q, path, len, 0, BREAK_LIST ? CHECK_LIST | CHECK_WASTE : CHECK_WASTE));
}
// (what a break leaves once its board has settled: the garbage rows broken -- a break whose converted panels match again breaks on --
// and the material, the panels under each column's first garbage: a slab broken above another leaves its panels on the lower one,
// out of reach until that breaks)
static int32_t materialOn(const Board *b);   // (facts.c)
static int32_t brokeSettled(Ctx *x, int n, int32_t *mat) {
  int z = settleOf(x, n), w = liveNode(x, z) ? z : n;
  Board *b = ensureBoard(x, w);
  *mat = b ? materialOn(b) : 0;
  return NODE(x, w)->brk;
}
// (whether a break keeps the chain the board is making: its board, at the frame the chain's last link comes, has that link -- judge.c
// ownChainOf; 1 when the board makes none)
static int keepsOwnChain(Ctx *x, int n) {
  if (ownChainBy <= 0) return 1;
  int w = NODE(x, n)->t < ownChainBy ? step(x, n, MK_LONG, 0, 0, ownChainBy - NODE(x, n)->t) : n;
  Board *b = liveNode(x, w) ? ensureBoard(x, w) : 0;
  return b && b->chainCounter >= ownChainN;
}
static int swapsOfNode(Ctx *x, int n, int32_t *ms) { Board *b = ensureBoard(x, n); return b ? legalSwaps(b, ms) : 0; }
// (the searches' side of judge.c's swap back: a child that swaps back what its line moved is grown by none of them)
static int undoesMoved(Ctx *x, int n, int32_t mv, const Moved *m) { return movedUndoes(ensureBoard(x, n), mv, m); }
static Moved movedOn(Ctx *x, int n, int32_t mv, const Moved *m) { Moved o = *m; movedAdd(ensureBoard(x, n), mv, &o); return o; }
static void keepPaths(Paths *p, Line **ls, int n) {
  p->n = 0;
  for (int i = 0; i < n && p->n < KEEPN; i++) {
    if (ls[i]->len >= LONGEST) continue;
    p->len[p->n] = ls[i]->len;
    for (int k = 0; k < ls[i]->len; k++) p->path[p->n][k] = ls[i]->path[k];
    p->n++;
  }
}
static int foundAlready(Broke *o, int32_t key) { for (int i = 0; i < o->nmoves; i++) if (o->moves[i] == key) return i; return -1; }
static int found(Broke *o, int32_t key) { int i = foundAlready(o, key); if (i >= 0) return i; o->moves[o->nmoves] = key; return o->nmoves++; }
static void setPath(Broke *o, const int32_t *path, int len) { o->pathLen = len; for (int k = 0; k < len; k++) o->path[k] = path[k]; }

// THE TOUCH BEAM (touchBeam): the carried lines first, then the first swaps, grown a level at a time
static int touchBeam(BS *s, Line **firsts, int nfirsts) {
  Ctx *x = s->x;
  Broke *o = s->out;
  static LOCAL Line *seeds[LINEPOOL], *act[LINEPOOL], *nxt[LINEPOOL], *tl0[LINEPOOL], *tl[LINEPOOL], *tn[LINEPOOL], *kept[LINEPOOL];
  static LOCAL int32_t idx[LINEPOOL], tmp[LINEPOOL], keyS[LINEPOOL], ms[MAXROWS * W];
  // (the search carried on: the lines the last decision's beam was growing, played again swap by swap within the rules)
  int nseeds = 0, nact = 0;
  for (int i = 0; s->resume && i < s->resume->n; i++) {
    if (!(s->resume->len[i] > 0 && s->resume->len[i] < LONGEST)) continue;
    Line *a = lineNew(); if (!a) break;
    a->len = s->resume->len[i]; for (int k = 0; k < a->len; k++) a->path[k] = s->resume->path[i][k];
    a->n = s->root; a->kept = 0; a->res = 1; a->last.n = 0;   // kept: the swaps played so far
    act[nact++] = a;
  }
  // (a line at a time, in the order they were kept, each played to its end before the next is begun: where the clock runs out, every
  // line played so far is carried on whole -- not every line part-played and none of them)
  // (and the lines the clock left unplayed -- not reached, or stopped part-way, none refused -- handed on as they came in, after the
  // ones played: the next decision goes on from there)
  int nleft = 0;
  for (int i = 0; i < nact; i++) {
    Line *a = act[i];
    int refused = 0;
    while (a->kept < a->len && !SEARCH_OUT()) {
      int mv = a->path[a->kept];
      if (!legalAt(x, a->n, CR(mv), CC(mv))) { o->resWhy[0]++; refused = 1; break; }
      if (undoesMoved(x, a->n, mv, &a->last)) { o->resWhy[1]++; refused = 1; break; }
      a->last = movedOn(x, a->n, mv, &a->last);
      int out = stepMarked(s, a->n, MK_SWAP, mv, 0);
      if (!liveNode(x, out)) { o->resWhy[2]++; refused = 1; break; }
      if (!within(s, out)) { o->resWhy[3]++; refused = 1; break; }
      a->n = out; a->kept++;
    }
    if (a->kept == a->len) { a->key = a->path[0]; seeds[nseeds++] = a; }
    else if (!refused) nxt[nleft++] = a;
  }
  o->resIn = s->resume ? s->resume->n : 0; o->resPlayed = nseeds; o->resLeft = nleft;
  if (nseeds || nleft) { for (int i = 0; i < nleft; i++) act[i] = nxt[i]; for (int i = 0; i < nseeds; i++) nxt[i] = seeds[i]; for (int i = 0; i < nleft; i++) nxt[nseeds + i] = act[i]; keepPaths(&o->keepOut, nxt, nseeds + nleft); }
  for (int i = 0; i < nseeds; i++)
    if (breaksAt(s, seeds[i]->n, seeds[i]->path, seeds[i]->len)) {
      found(o, seeds[i]->key); o->touch = 1; o->carried = 1; setPath(o, seeds[i]->path, seeds[i]->len); o->at = NODE(x, seeds[i]->n)->t;
      return 1;
    }
  int n0 = 0;
  for (int i = 0; i < nseeds; i++) tl0[n0++] = seeds[i];
  for (int i = 0; i < nfirsts; i++) if (liveNode(x, firsts[i]->n) && within(s, firsts[i]->n)) tl0[n0++] = firsts[i];
  int tpath = 0;
  for (int tb = touchFrom; tb < 2 && !tpath && !SEARCH_OUT(); tb++) {
    int beam = tb ? TOUCH_WIDE : TOUCH_BEAM, ntl = n0;
    // (A CHEAPER BREAK ONE SWAP ON: a break found that the cursor walks more than CHEAP_BREAK actions for is kept, and the level after
    // searched too -- one more swap near the cursor can cost fewer actions than one far from it; the better of the two by the level's
    // own key, actions before the material)
    int64_t heldB = -1; int foundTd = -1;
    for (int i = 0; i < n0; i++) tl[i] = tl0[i];
    for (int td = 2; td <= touchDepth && ntl && !tpath && !SEARCH_OUT(); td++) {
      // (how near a break each line's board is, read on the board once what the line cleared has fallen -- settled a batch at a
      // time while the clock allows: past it the rest are scored as they stand)
      // (the settles stepped on every thread first, then taken in this order: core/nodes.h stepBatch)
      static LOCAL int32_t sPar[LINEPOOL], sMv[LINEPOOL], sAt[LINEPOOL];
      int nsb = 0;
      for (int i = 0; i < ntl; i++) { Stats st; sAt[i] = -1; if (statsOf(x, tl[i]->n, &st) && st.cleared > 0) { sAt[i] = nsb; sPar[nsb] = tl[i]->n; sMv[nsb++] = 0; } }
      stepBatch(x, sPar, sMv, MK_SETTLE, nsb);
      for (int i = 0; i < ntl; i++) {
        Line *l = tl[i];
        int32_t sc = nearScore(ensureBoard(x, l->n));
        if (sAt[i] >= 0) { int w = stepTake(x, sAt[i], l->n, MK_SETTLE, 0); if (liveNode(x, w)) { int32_t s2 = nearScore(ensureBoard(x, w)); if (s2 > sc) sc = s2; } }
        l->s = sc; l->h = (int32_t)NODE(x, l->n)->hash;
        idx[i] = i; keyS[i] = sc;
      }
      batchDone();
      sortByKeyDesc(idx, ntl, keyS, tmp);
      for (int i = 0; i < ntl; i++) tn[i] = tl[idx[i]];
      for (int i = 0; i < ntl; i++) tl[i] = tn[i];
      // (THE ORDER'S FIRST KEY at the top of the beam: of the lines the beam would keep, the board each leaves judged on the engine left
      // alone (judge.c lostAlone) -- survival first, in bands of a break's time as the order reads them -- and its nearness to a break
      // within the band; only those, so the judging is bounded by the beam)
      { int top = ntl < beam ? ntl : beam, nb2 = 0; static LOCAL int32_t band[LINEPOOL], idx2[LINEPOOL], key2[LINEPOOL], tmp2[LINEPOOL];
        int32_t save = imax(1, rankSave > 0 ? rankSave : 60), to = NODE(x, s->root)->t + HORIZON + REST;
        static LOCAL int32_t lraw[LINEPOOL];
        for (int i = 0; i < top && !SEARCH_OUT(); i++, nb2++) { int32_t l = lostAlone(x, tl[i]->n, to); lraw[i] = l; band[i] = l == FOREVER ? (1 << 20) : l == NOT_ASKED ? -1 : l / save; }
        if (nb2 == top && top > 1) {
          for (int i = 0; i < top; i++) { idx2[i] = i; key2[i] = band[i]; }
          sortByKeyDesc(idx2, top, key2, tmp2);   // (stable: within a band, the nearness order the beam had)
          for (int i = 0; i < top; i++) tn[i] = tl[idx2[i]];
          for (int i = 0; i < top; i++) tl[i] = tn[i];
          // (A LINE THAT CANNOT SAVE THE BOARD, plans/gambit-next.md 3: its board, left alone, lost within a break's time of the line's
          // end -- no break grown from it can be pressed and pop before the board dies. Such lines leave the beam while any other is in
          // it: the beam's width goes to lines that still have the time a break takes)
          { int nv = 0, nd = 0;
            for (int i = 0; i < top; i++) { int32_t l = lraw[idx2[i]];
              int viable = l == FOREVER || l == NOT_ASKED || l - NODE(x, tl[i]->n)->t >= save;
              if (viable) tn[nv++] = tl[i]; else nd++; }
            if (nv > 0 && nd > 0) {
              for (int i = 0; i < nv; i++) tl[i] = tn[i];
              for (int i = top; i < ntl; i++) tl[nv + i - top] = tl[i];
              ntl -= nd; o->doomed += nd;
            } }
        } }
      // (the line nearest a break the beam has seen: TOWARD, returned when no break is found)
      if (ntl && (!s->haveToward || tl[0]->s > s->towardS)) { s->haveToward = 1; s->towardS = tl[0]->s; s->towardLen = tl[0]->len; for (int k = 0; k < tl[0]->len; k++) s->toward[k] = tl[0]->path[k]; }
      keepPaths(&o->keepOut, tl, ntl < KEEPN ? ntl : KEEPN);
      // Swaps made in another order often leave the same board: each board is kept once, its best-scoring line. (THE SEARCH CARRIED ON:
      // half the beam is the lines grown from the ones the last decision carried, best first, the rest the best of all -- so the beam
      // grows deeper decision after decision while the board is held, beside a search from the board as it is now)
      static LOCAL uint8_t took[LINEPOOL];
      int nk = 0;
      for (int i = 0; i < ntl; i++) took[i] = 0;
      for (int pass = 0; pass < 2; pass++)
        for (int i = 0; i < ntl && nk < beam && (pass || nk < beam / 2); i++) {
          Line *l = tl[i];
          if (took[i] || (!pass && !l->res)) continue;
          Node *ln = NODE(x, l->n);
          int dup = 0;
          for (int q = 0; q < nk && !dup; q++) {
            Node *kn = NODE(x, kept[q]->n);
            if ((int32_t)kn->hash != l->h || kn->keyn != ln->keyn) continue;
            dup = memcmp(kn->key, ln->key, sizeof(int32_t) * ln->keyn) == 0;
          }
          took[i] = 1;
          if (!dup) kept[nk++] = l;
        }
      ntl = nk;
      for (int i = 0; i < nk; i++) tl[i] = kept[i];
      int ntn = 0, ar = td & 1;
      arenaN[ar] = 0;   // (the level before last: its lines are let go)
      // (the level's swaps stepped on every thread first, then taken in this order: core/nodes.h stepBatch)
      static LOCAL int32_t bPar[LINEPOOL * MAXROWS * W / 4], bMv[LINEPOOL * MAXROWS * W / 4], bAt[LINEPOOL + 1];
      int nb = 0;
      for (int i = 0; i < ntl; i++) {
        bAt[i] = nb;
        int nm = swapsOfNode(x, tl[i]->n, ms);
        for (int j = 0; j < nm && nb < (int)(sizeof bPar / sizeof bPar[0]); j++) if (!undoesMoved(x, tl[i]->n, ms[j], &tl[i]->last)) { bPar[nb] = tl[i]->n; bMv[nb++] = ms[j]; }
      }
      bAt[ntl] = nb;
      stepBatch(x, bPar, bMv, MK_SWAP, nb);
      // (the level a break is found on is taken whole: of its lines that break, one that keeps the board's own chain first -- a chain cut
      // leaves the three that began it wasted -- then the one that leaves the most material once its board settles, then the one that
      // has broken most: a break whose converted panels match again is rows more of the slab -- and, with an input allowance to keep (a
      // host that says it), the one the cursor walks fewer actions for before the material: the window pays for every cell of it
      const Board *rb = ensureBoard(x, s->root);
      int starved = pressAllowance >= 0 && rb;
      int64_t bestB = -1; int32_t bestKey = 0, bestLen = 0, bestAt = 0, bestPath[MAXPATH];
      for (int i = 0; i < ntl; i++) {
        for (int b = bAt[i]; b < bAt[i + 1]; b++) {
          int32_t mv = bMv[b];
          int t3 = swapTaken(s, b, tl[i]->n, mv);
          if (!liveNode(x, t3)) continue;
          Line *nl = lineIn(ar); if (!nl) break;
          *nl = *tl[i]; nl->n = t3; nl->last = movedOn(x, tl[i]->n, mv, &tl[i]->last); if (nl->len < MAXPATH) nl->path[nl->len++] = mv;
          if (breaksAt(s, t3, nl->path, nl->len)) {
            int32_t mat, br = brokeSettled(x, t3, &mat);
            int acts = 0;
            if (starved) { int r = rb->curRow, c = rb->curCol; for (int k = 0; k < nl->len; k++) { acts += actionsFor(r, c, CR(nl->path[k]), CC(nl->path[k]), pressAllowance - acts); r = CR(nl->path[k]); c = CC(nl->path[k]); } }
            int64_t bk = ((int64_t)keepsOwnChain(x, t3) << 40) + ((int64_t)(255 - imin(acts, 255)) << 24) + ((int64_t)imin(mat, 4095) << 8) + imin(br, 255);
            if (bk > bestB) { bestB = bk; bestKey = tl[i]->key; bestLen = nl->len; bestAt = NODE(x, t3)->t; for (int k = 0; k < nl->len; k++) bestPath[k] = nl->path[k]; }
            continue;
          }
          if (bestB < 0 && within(s, t3)) tn[ntn++] = nl;
        }
      }
      batchDone();
      if (bestB >= 0 && bestB > heldB) { found(o, bestKey); setPath(o, bestPath, bestLen); o->at = bestAt; heldB = bestB; }
      if (bestB >= 0 && foundTd < 0) foundTd = td;
      if (foundTd >= 0 && (!starved || td > foundTd || 255 - ((heldB >> 24) & 255) <= CHEAP_BREAK || td == touchDepth)) tpath = 1;
      // (and the level expanded: its boards are its children's now -- the frontier the next decision carries on, in its parents' order)
      if (ntn) keepPaths(&o->keepOut, tn, ntn < KEEPN ? ntn : KEEPN);
      for (int i = 0; i < ntn; i++) tl[i] = tn[i];
      ntl = ntn;
    }
    if (foundTd >= 0) tpath = 1;   // (the break held, the level after it ended short: the clock or no lines)
    if (tpath) { o->touch = 1; o->wide = tb; return 1; }
  }
  return 0;
}

// ---- a slab popping: the line-ups (wait > 0)
// whether each node breaks once the pop is over (end: the frame it ends, from the root)
static void linedAll(BS *s, const int *ns, int n, int32_t end, int *out) {
  for (int q = 0; q < n; q++) {
    out[q] = 0;
    if (!liveNode(s->x, ns[q])) continue;
    int w = stepMarked(s, ns[q], MK_LONG, 0, imax(1, end - NODE(s->x, ns[q])->t));
    out[q] = breaksAt(s, w, 0, 0);
  }
}
// Each parent's swaps in turn, as many as `cap` tries leave, till one of them hits: a hit marks the parent's first move and its pair,
// and the next parent goes on (inTurn). hits: 0 the pop's end breaks after the second swap, 1 the second swap itself breaks.
typedef struct { int32_t key, n, m; Moved last; } Parent;
static void inTurn(BS *s, const Parent *ps, int np, int cap, int hits, int32_t end) {
  Ctx *x = s->x;
  Broke *o = s->out;
  static LOCAL int32_t ms[MAXROWS * W];
  for (int k = 0; k < np && s->tries < cap && !SEARCH_OUT(); k++) {
    int nm = swapsOfNode(x, ps[k].n, ms);
    for (int j = 0; j < nm && s->tries < cap; j++) {
      if (undoesMoved(x, ps[k].n, ms[j], &ps[k].last)) continue;
      s->tries++;
      int n2 = step(x, ps[k].n, MK_SWAP, CR(ms[j]), CC(ms[j]), 0), hit;
      markStep(s, ps[k].n, MK_SWAP, ms[j], n2);
      if (hits == 0) { int one = liveNode(x, n2) && NODE(x, n2)->t < end ? n2 : -1; linedAll(s, &one, 1, end, &hit); }
      else hit = breaksAt(s, n2, 0, 0);
      if (hit) { int f = found(o, ps[k].key); o->pairs[f][0] = ps[k].m; o->pairs[f][1] = ms[j]; s->anyFound = 1; break; }
    }
  }
}
static int lineups(BS *s, Line **firsts, int nfirsts) {
  Ctx *x = s->x;
  Broke *o = s->out;
  int32_t end = NODE(x, s->root)->t + s->wait;
  static LOCAL int ns[MAXROWS * W], hit[MAXROWS * W];
  static LOCAL Parent ps[MAXROWS * W];
  for (int q = 0; q < nfirsts; q++) ns[q] = firsts[q]->n;
  linedAll(s, ns, nfirsts, end, hit);
  for (int q = 0; q < nfirsts; q++) if (hit[q]) found(o, firsts[q]->key);
  if (o->nmoves) { o->lineup = 1; return 1; }
  // a pop is long enough for two swaps: the first of a pair that lines up
  int np = 0;
  for (int q = 0; q < nfirsts; q++) if (liveNode(x, firsts[q]->n) && NODE(x, firsts[q]->n)->t < end) { Parent p = { firsts[q]->key, firsts[q]->n, firsts[q]->path[0], firsts[q]->last }; ps[np++] = p; }
  inTurn(s, ps, np, LINEUP_BUDGET, 0, end);
  if (o->nmoves) { o->lineup = 2; return 1; }
  // further, aimed: the colours the row turns into, met by pairs on top of their columns
  int32_t want[W + 1];
  if (converting(ensureBoard(x, s->root), want)) {
    static LOCAL Line *level[LINEPOOL], *next[LINEPOOL];
    static LOCAL int32_t idx[LINEPOOL], tmp[LINEPOOL], keyS[LINEPOOL], ms[MAXROWS * W], n3s[LINEPOOL], scs[LINEPOOL], l3[LINEPOOL], m3[LINEPOOL], from[LINEPOOL];
    int nl = 0, found3 = 0;
    for (int q = 0; q < nfirsts; q++) if (liveNode(x, firsts[q]->n) && NODE(x, firsts[q]->n)->t < end) level[nl++] = firsts[q];
    for (int dpt = 2; dpt <= LINEUP_DEPTH && nl && !found3 && !SEARCH_OUT(); dpt++) {
      for (int i = 0; i < nl; i++) { Board *b = ensureBoard(x, level[i]->n); level[i]->s = 10 * pairsOf(b, want) - uneven(b); idx[i] = i; keyS[i] = level[i]->s; }
      sortByKeyDesc(idx, nl, keyS, tmp);
      for (int i = 0; i < nl; i++) next[i] = level[idx[i]];
      if (nl > LINEUP_BEAM) nl = LINEUP_BEAM;
      for (int i = 0; i < nl; i++) level[i] = next[i];
      // the level's swaps, and the boards that stand up a pair waited to the pop's end
      int n3 = 0;
      for (int i = 0; i < nl; i++) {
        int nm = swapsOfNode(x, level[i]->n, ms);
        for (int j = 0; j < nm && n3 < LINEPOOL; j++) {
          if (undoesMoved(x, level[i]->n, ms[j], &level[i]->last)) continue;
          int t3 = stepMarked(s, level[i]->n, MK_SWAP, ms[j], 0);
          n3s[n3] = t3; m3[n3] = ms[j]; from[n3] = i;
          scs[n3] = !liveNode(x, t3) || NODE(x, t3)->t >= end ? -1 : pairsOf(ensureBoard(x, t3), want);
          n3++;
        }
      }
      for (int q = 0; q < n3; q++) { int one = scs[q] >= PAIR ? n3s[q] : -1; linedAll(s, &one, 1, end, &l3[q]); }
      int nn = 0, ar = dpt & 1;
      arenaN[ar] = 0;
      for (int q = 0; q < n3 && !found3; q++) {
        if (scs[q] < 0) continue;
        Line *l = lineIn(ar); if (!l) break;
        *l = *level[from[q]]; l->n = n3s[q]; l->s = scs[q]; l->last = movedOn(x, level[from[q]]->n, m3[q], &level[from[q]]->last); if (l->len < MAXPATH) l->path[l->len++] = m3[q];
        if (l3[q]) { found(o, level[from[q]]->key); setPath(o, l->path, l->len); found3 = 1; break; }
        next[nn++] = l;
      }
      for (int i = 0; i < nn; i++) level[i] = next[i];
      nl = nn;
    }
    if (o->nmoves) { o->lineup = 3; return 1; }
  }
  // failing that, a first swap leaving a break one swap away once the board has settled from it (the pop over, its panels down)
  if (s->tries < 2 * LINEUP_BUDGET) {
    np = 0;
    for (int q = 0; q < nfirsts; q++) {
      if (!liveNode(x, firsts[q]->n)) continue;
      int w = stepMarked(s, firsts[q]->n, MK_SETTLE, 0, 0);
      if (liveNode(x, w)) { Parent p = { firsts[q]->key, w, firsts[q]->path[0] }; ps[np++] = p; }
    }
    inTurn(s, ps, np, 2 * LINEUP_BUDGET, 1, end);
  }
  if (o->nmoves) { o->lineup = 4; return 1; }
  return 0;
}

// THE BREAK SEARCH from the decision's question: wait, the frames a popping slab has left (0: none); resume, the lines the last
// decision's beam was growing, on this board. Answers into out.
static void breakMovesIn(const Question *q, int32_t wait, const Paths *resume, Broke *out);
// (the marks of the last search's nodes are let go before the next: every node of a search starts within the rules)
static LOCAL int breakBusy;
static void breakMoves(const Question *q, int32_t wait, const Paths *resume, Broke *out) {
  static LOCAL int32_t high;
  memset(outsideBuf, 0, sizeof(int32_t) * (unsigned long)high);
  breakBusy = 1;
  breakMovesIn(q, wait, resume, out);
  breakBusy = 0;
  high = breakCtx && breakCtx->n < (1 << 20) ? breakCtx->n : (1 << 20);
}
static void breakMovesIn(const Question *q, int32_t wait, const Paths *resume, Broke *out) {
  memset(out, 0, sizeof *out);
  Ctx *x = breakCtx = ctxOf(breakCtx);
  arenaN[0] = arenaN[1] = arenaN[KEEPS] = 0; linesFull = 0;
  if (lowestG(q->b) >= gridLen(q->b)) return;   // (no garbage: no break)
  BS s;
  memset(&s, 0, sizeof s);
  s.x = x; s.q = q; s.out = out; s.wait = wait; s.resume = resume; s.outside = outsideBuf;
  s.root = rootOf(x, q);
  if (s.root < 0) return;
  static LOCAL int32_t ms[MAXROWS * W];
  static LOCAL Line *firsts[MAXROWS * W];
  int nf = swapsOfNode(x, s.root, ms), nfirsts = 0, at1 = -1;
  for (int i = 0; i < nf; i++) {
    Line *l = lineNew(); if (!l) break;
    l->key = ms[i]; l->len = 1; l->path[0] = ms[i]; l->res = 0; { static const Moved none; l->last = movedOn(x, s.root, ms[i], &none); }
    l->n = stepMarked(&s, s.root, MK_SWAP, ms[i], 0);
    firsts[nfirsts++] = l;
  }
  for (int i = 0; i < nfirsts; i++)
    if (breaksAt(&s, firsts[i]->n, firsts[i]->path, 1)) { found(out, firsts[i]->key); int32_t t = NODE(x, firsts[i]->n)->t; if (at1 < 0 || t < at1) at1 = t; }
  // (a break found before the beam ran: the lines carried in are carried on as they were -- the search's depth is not given up for it)
  if (out->nmoves) { out->depth = 1; out->at = at1; if (resume) out->keepOut = *resume; return; }
  // (THE BREAK BUILT: the nearest break's panels walked to it along their rows -- breakNear's own line -- played on the engine)
  if (!(wait > 0)) {
    static LOCAL int32_t nl[MAXPATH]; int nn = 0;
    if (breakNearLine(q->b, nl, &nn) < NEAR_MISS && nn > 0) {
      int node = s.root;
      for (int i = 0; i < nn && liveNode(x, node); i++) node = stepMarked(&s, node, MK_SWAP, nl[i], 0);
      if (liveNode(x, node) && breaksAt(&s, node, nl, nn)) { found(out, nl[0]); setPath(out, nl, nn); out->depth = 1; out->at = NODE(x, node)->t; out->built = 1; if (resume) out->keepOut = *resume; return; }
    }
  }
  if (!(wait > 0) && touchBeam(&s, firsts, nfirsts)) { out->depth = 1; return; }
  if (wait > 0) {
    // (a slab popping: the line-up first, in half what is left -- it is a chance that ends with the pop, where the touch beam's lines are
    // carried on to the next decision -- then the touch beam on the garbage elsewhere in the rest, the cursor being free)
    int w0 = step(x, s.root, MK_LONG, 0, 0, wait);
    if (w0 >= 0 && w0 < (1 << 20)) outsideBuf[w0] = 0;   // (made from the root: within the rules so far)
    if (!breaksAt(&s, w0, 0, 0)) {
      int lined;
      if (clockShare > 0) { double half = nowMs() + (clockShare - nowMs()) / 2, old = clockShareBegin(half); lined = lineups(&s, firsts, nfirsts); clockShareEnd(old); }
      else lined = lineups(&s, firsts, nfirsts);
      if (lined) { out->depth = 1; return; }
    }
    if (touchBeam(&s, firsts, nfirsts)) { out->depth = 1; return; }
  }
  // none found: the line nearest a break, and the lines to choose among -- the frontier the beam has grown furthest, then that line
  out->depth = 0;
  if (s.haveToward) { out->towardLen = s.towardLen; for (int k = 0; k < s.towardLen; k++) out->toward[k] = s.toward[k]; }
  out->towards = out->keepOut;
  if (s.haveToward && out->towards.n < KEEPN) { int t = out->towards.n++; out->towards.len[t] = s.towardLen; for (int k = 0; k < s.towardLen; k++) out->towards.path[t][k] = s.toward[k]; }
}

// ---- for a host's check: the decision's question, the lines carried on in the io body (n lines, each
// its length then its swaps), and the answer back into it
static Broke theBroke;
static Paths hostResume;
static void putPaths(int32_t *w, int *k, const Paths *p) { w[(*k)++] = p->n; for (int i = 0; i < p->n; i++) { w[(*k)++] = p->len[i]; for (int j = 0; j < p->len[i]; j++) w[(*k)++] = p->path[i][j]; } }
EXPORT(gb_break) int gb_break(int wait, int nresume) {
  int k = 0;
  hostResume.n = 0;
  for (int i = 0; i < nresume && i < KEEPN; i++) { int len = gbIo[k++]; hostResume.len[i] = len; for (int j = 0; j < len; j++) hostResume.path[i][j] = gbIo[k++]; hostResume.n++; }
  breakMoves(&decQ, wait, &hostResume, &theBroke);
  Broke *o = &theBroke;
  int32_t *w = gbIo;
  k = 0;
  w[k++] = o->depth; w[k++] = o->at; w[k++] = o->touch; w[k++] = o->carried; w[k++] = o->wide; w[k++] = o->lineup; w[k++] = linesFull;
  w[k++] = o->nmoves; for (int i = 0; i < o->nmoves; i++) { w[k++] = o->moves[i]; w[k++] = o->pairs[i][0]; w[k++] = o->pairs[i][1]; }
  w[k++] = o->pathLen; for (int i = 0; i < o->pathLen; i++) w[k++] = o->path[i];
  w[k++] = o->towardLen; for (int i = 0; i < o->towardLen; i++) w[k++] = o->toward[i];
  putPaths(w, &k, &o->towards);
  putPaths(w, &k, &o->keepOut);
  return k;
}

// READY (judge.c breaksAfterLanding): a break on node n's board -- the break search asked of it, off the list (readiness counts any break,
// as a list ended by "default" does), in its share of the time: a caller asking it of many lines gives each an equal part of the time
// left (readyShare: the time over the askings still to come), and otherwise half the time the decision has left; never past the share
// of the search that asks. Asked inside a break search (its line check judging), it
// answers NOT_ASKED: the search's own context is in use.
static int32_t popLeft(const Board *b);   // (propose.c: the frames a popping slab has left)
static double readyShareMs = -1;
static void readyShare(int asks) { readyShareMs = asks > 0 ? timeLeftMs() / (2.0 * asks) : -1; }
// THE BREAKS ALREADY FOUND, kept across decisions (the kept plan's first piece, plans/gambit-infra.md F): a board a line lands on is
// the same board the next decision's line lands on whenever nothing new was told -- the engine predicts every frame -- so the break
// found on it is found again. Keyed by the whole board as it plays on (its state, the garbage queued, the rows it is fed: the step's
// counts and the caches that are no part of it left out), the blocks still on their way, the hold and the press: a board that differs
// anywhere is a board searched afresh -- new information repairs the table by itself. Only a break found is kept -- "none" is the time
// the search had, not the board. Shared by every thread (the jobs beside the decision write it), under one lock.
#define READYN 512
#define READYKEYMAX (sizeof(Board) + sizeof(int32_t) * (4 + 5 * MAXARR))
typedef struct { uint32_t h; int32_t nbytes, whyN, at; int32_t why[MAXLINE]; unsigned char *bytes; } ReadyKept;
static ReadyKept readyKept[READYN];
static int32_t readyLock;
static LOCAL unsigned char *readyKeyBuf;   // (each thread's own: the judging runs on every thread -- decide.c judgeJob)
static int32_t readyClock, readyAsked, readyHit;   // (the log's: asked and found kept, this decision)
static void readyLockOn(void) { while (__atomic_exchange_n(&readyLock, 1, __ATOMIC_ACQUIRE)) {} }
static void readyLockOff(void) { __atomic_store_n(&readyLock, 0, __ATOMIC_RELEASE); }
static int readyKey(const Board *b, const Node *nd, int32_t tight, uint32_t *h) {
  static LOCAL Board canon;
  unsigned long head = BOARD_HEAD, inc = (unsigned long)b->ninc * sizeof(Incoming), rows = (unsigned long)b->nrows * sizeof(Panel) * (W + 1);
  unsigned long extra = sizeof(int32_t) * (4 + 5 * MAXARR), need = head + inc + rows + extra;
  if (!readyKeyBuf) readyKeyBuf = (unsigned char *)grab(READYKEYMAX);
  if (!readyKeyBuf || need > READYKEYMAX) return 0;
  memcpy(&canon, b, head);
  canon.quiet = canon.noQuiet = canon.hi = canon.cdLeft = canon.popSeen = 0; memset(canon.rowActive, 0, sizeof canon.rowActive);
  memset(canon.sCombo, 0, sizeof canon.sCombo); memset(canon.sChainAt, 0, sizeof canon.sChainAt);
  canon.sNCombo = canon.sCleared = canon.sBroke = canon.sEarned = canon.sFell = canon.sHollow = 0; canon.score = 0;
  unsigned char *k = readyKeyBuf;
  memcpy(k, &canon, head); k += head;
  memcpy(k, b->inc, inc); k += inc;
  memcpy(k, b->p, rows); k += rows;
  int32_t q[4 + 5 * MAXARR], nq = 0;
  q[nq++] = nd->holdLeft; q[nq++] = nd->holdStarted; q[nq++] = tight; q[nq++] = nd->narr;
  for (int i = 0; i < nd->narr; i++) { q[nq++] = nd->arr[i].at; q[nq++] = nd->arr[i].width; q[nq++] = nd->arr[i].height; q[nq++] = nd->arr[i].isChain; q[nq++] = nd->arr[i].isMetal; }
  memcpy(k, q, sizeof(int32_t) * (unsigned long)nq); k += sizeof(int32_t) * (unsigned long)nq;
  int32_t nb = (int32_t)(k - readyKeyBuf);
  uint32_t hh = 2166136261u;
  for (int32_t i = 0; i < nb; i++) hh = (hh ^ readyKeyBuf[i]) * 16777619u;
  *h = hh;
  return nb;
}
// (the break kept for the key `key` (nb bytes, hash h): 1 and its line in why, else 0)
static int readyFind(uint32_t h, const unsigned char *key, int32_t nb, int32_t *why, int32_t *whyN) {
  readyLockOn();
  ReadyKept *e = &readyKept[h % READYN];
  int hit = e->bytes && e->h == h && e->nbytes == nb && !memcmp(e->bytes, key, (unsigned long)nb);
  if (hit && why) { for (int i = 0; i < e->whyN; i++) why[i] = e->why[i]; *whyN = e->whyN; }
  readyLockOff();
  return hit;
}
static void readyKeep(uint32_t h, const unsigned char *key, int32_t nb, const int32_t *why, int32_t whyN) {
  unsigned char *fresh = 0;
  if (!readyKept[h % READYN].bytes) fresh = (unsigned char *)grab(READYKEYMAX);
  readyLockOn();
  ReadyKept *e = &readyKept[h % READYN];
  if (!e->bytes) e->bytes = fresh;
  if (e->bytes) {
    memcpy(e->bytes, key, (unsigned long)nb); e->h = h; e->nbytes = nb; e->whyN = whyN;
    for (int i = 0; i < whyN && i < MAXLINE; i++) e->why[i] = why[i];
  }
  readyLockOff();
}
// THE READINESS SEARCH LEFT UNFINISHED, kept across decisions as a break found is: a search whose time ran out first keeps the
// frontier it had grown (Broke keepOut), keyed by the same whole board, and the next check of that board grows it on from there. The
// key is the board exactly, so its lines are carried as they are. Kept only by the decision that reads the check (readyBreakOf), as a
// break found is, and seen only by the decisions after it (gen): a worker still searching past a decision changes nothing the next one
// reads.
#define READYBEAMN 128
typedef struct { uint32_t h; int32_t nbytes, gen; unsigned char *bytes; Paths *paths; } ReadyBeam;
static ReadyBeam readyBeams[READYBEAMN];
static int32_t readyBeamIn, readyBeamOut, readyBeamGen;   // (the log's: the checks that resumed a frontier, and those that kept one, this decision)
static int readyBeamFind(uint32_t h, const unsigned char *key, int32_t nb, Paths *out) {
  out->n = 0;
  readyLockOn();
  ReadyBeam *e = &readyBeams[h % READYBEAMN];
  int hit = e->bytes && e->paths && e->gen < readyBeamGen && e->h == h && e->nbytes == nb && !memcmp(e->bytes, key, (unsigned long)nb);
  if (hit) *out = *e->paths;
  readyLockOff();
  return hit && out->n > 0;
}
static void readyBeamKeep(uint32_t h, const unsigned char *key, int32_t nb, const Paths *paths) {
  unsigned char *fresh = 0; Paths *freshP = 0;
  if (!readyBeams[h % READYBEAMN].bytes) { fresh = (unsigned char *)grab(READYKEYMAX); freshP = (Paths *)grab(sizeof(Paths)); }
  readyLockOn();
  ReadyBeam *e = &readyBeams[h % READYBEAMN];
  if (!e->bytes && fresh && freshP) { e->bytes = fresh; e->paths = freshP; }
  if (e->bytes && e->paths) { memcpy(e->bytes, key, (unsigned long)nb); e->h = h; e->nbytes = nb; e->gen = readyBeamGen; *e->paths = *paths; }
  readyLockOff();
  __atomic_add_fetch(&readyBeamOut, 1, __ATOMIC_RELAXED);
}
static void readyKeptClear(void) {
  readyLockOn();
  for (int i = 0; i < READYN; i++) readyKept[i].h = 0, readyKept[i].nbytes = 0;
  for (int i = 0; i < READYBEAMN; i++) readyBeams[i].h = 0, readyBeams[i].nbytes = 0;
  readyLockOff();
}
// THE BREAK SEARCH ASKED FOR READINESS, on question q until `by`: 1 a break (its line in line, *k), 0 none -- the search ended before its
// time did -- NOT_ASKED its time out first (its own share or the decision's): none found in the time is no answer. Every thread's: what
// it reads is the question and its own nodes.
// (own: a pend's budget, the same whichever thread searches it -- the decision's share no cap on it; key, nb, h: the board's readiness
// key, 0 none -- the frontier a search of it left unfinished is grown on; keep: one left unfinished here kept (the decision's own
// check), else left in readyLeft for the decision that reads it)
static LOCAL const Paths *readyLeft;
static LOCAL int readyResumed;   // (the search grew a kept frontier on: counted by the decision that reads it)
static int32_t readySearchOf(const Question *q, double by, int32_t *line, int32_t *k, int own, const unsigned char *key, int32_t nb, uint32_t h, int keep) {
  int32_t pop = popLeft(q->b), saved = listDefault;
  static LOCAL Broke rb;
  static LOCAL Paths seeds;
  static LOCAL unsigned char *keyOwn;
  int keyed = key && nb > 0 && nb <= (int32_t)READYKEYMAX;
  if (keyed && !keyOwn) keyOwn = (unsigned char *)grab(READYKEYMAX);
  if (keyed && !keyOwn) keyed = 0;
  if (keyed) memcpy(keyOwn, key, (unsigned long)nb);   // (the search may key boards of its own in the buffer it came in)
  int resumed = keyed && readyBeamFind(h, keyOwn, nb, &seeds);
  if (resumed && keep) __atomic_add_fetch(&readyBeamIn, 1, __ATOMIC_RELAXED);
  readyLeft = 0; readyResumed = resumed;
  if (!own && clockShare && clockShare < by) by = clockShare;   // (never past the share of the search that asks)
  double old = own ? clockShare : clockShareBegin(by);
  int ownWas = ownBudget;
  if (own) { clockShare = by; ownBudget = 1; }   // (its budget alone, as on a job's thread: core/clock.h ownBudget)
  listDefault = 1;
  breakMoves(q, pop ? pop + LINEUP_AFTER : 0, resumed ? &seeds : 0, &rb);
  listDefault = saved;
  int out = clockOut();   // (the share asked, or the decision's, run out)
  if (keyed && out && !rb.depth && rb.keepOut.n) { if (keep) readyBeamKeep(h, keyOwn, nb, &rb.keepOut); else readyLeft = &rb.keepOut; }
  ownBudget = ownWas;
  clockShareEnd(old);
  *k = 0;
  if (!rb.depth) return out ? NOT_ASKED : 0;
  if (rb.pathLen) for (; *k < rb.pathLen && *k < MAXLINE; (*k)++) line[*k] = rb.path[*k];
  else if (rb.nmoves) line[(*k)++] = rb.moves[0];
  return 1;
}
// THE READINESS SEARCHED BESIDE THE DECISION (plans/gambit-infra.md E, lazy SMP): while a decision first judges its options (readyDefer),
// each landed board a readiness check will be asked of is kept here (readyPendOf), keyed as the breaks already found are. The workers
// then search them beside the decision (decide.c readySpread: worst-ranked first, each the time the searches have left), while the
// decision asks them best-ranked first in its own shares, exactly as with no workers: whichever thread begins a board first searches
// it (its state claimed), and the other reads the answer -- a break found, or none in the time it had. A worker's break is kept across
// decisions as any is. Only with workers.
#define READYPEND 512   // (every line a decision judges, walked or not, may land on a board and a window of its own: decide.c MAXCANDS)
typedef struct { int32_t gen, h, nb, tight, tap, from, spent, state, whyN, why[MAXLINE], hasLeft, resumed; double budget; int64_t work; Node nd; Question q; unsigned char *key; Paths *left; } ReadyPend;   // (left: the frontier a worker's search left unfinished, kept by the decision that reads it)   // (from, spent: the window its breaks are pressed in, core/nodes.h pressFrom)   // (budget: the work-ms its search is given, whichever thread searches it; work: what that search did)
#define PEND_WAITING 0
#define PEND_FOUND 1
#define PEND_NONE 2
#define PEND_OUT 3
#define PEND_BUSY 4   // (being searched)
static ReadyPend readyPend[READYPEND];
static int32_t readyPendN, readyPendGen, readyPre;   // (readyPre: the checks answered here, this decision -- the log's)
static void readyPendClear(void) { readyPendN = 0; readyPendGen++; readyPre = 0; }
// (a board and the window its break is pressed in, core/nodes.h pressFrom, pressSpent: two lines landing on one board having spent
// differently are two searches -- whichever thread lands its line first, each is searched in its own window)
static ReadyPend *readyPendFind(uint32_t h, int32_t nb) {
  for (int i = 0; i < readyPendN; i++) {
    ReadyPend *p = &readyPend[i];
    if (p->h == (int32_t)h && p->nb == nb && p->from == pressFrom && p->spent == pressSpent && p->tight == pressTight && p->tap == pressTap && !memcmp(p->key, readyKeyBuf, (unsigned long)nb)) return p;
  }
  return 0;
}
// (node n's board kept to be searched beside the decision: its index + 1, 0 when it is not -- no room, a break already found, no key)
// (kept under its own lock: the judging runs on every thread, each landing its lines -- decide.c judgeJob)
static int32_t pendLock;
static int32_t readyPendIn(Ctx *x, int n, Board *b, uint32_t kh, int32_t kn);
static int32_t readyPendOf(Ctx *x, int n) {
  Board *b = ensureBoard(x, n);
  if (!b) return 0;
  uint32_t kh = 0;
  int32_t kn = readyKey(b, NODE(x, n), decQ.tight, &kh);
  if (!kn || readyFind(kh, readyKeyBuf, kn, 0, 0)) return 0;
  while (__atomic_exchange_n(&pendLock, 1, __ATOMIC_ACQUIRE)) {}
  int32_t r = readyPendIn(x, n, b, kh, kn);
  __atomic_store_n(&pendLock, 0, __ATOMIC_RELEASE);
  return r;
}
static int32_t readyPendIn(Ctx *x, int n, Board *b, uint32_t kh, int32_t kn) {
  ReadyPend *p = readyPendFind(kh, kn);
  if (p) return (int32_t)(p - readyPend) + 1;
  if (readyPendN >= READYPEND) return 0;
  p = &readyPend[readyPendN];
  if (!p->key) p->key = (unsigned char *)grab(READYKEYMAX);
  if (!p->q.b) p->q.b = (Board *)grab(sizeof(Board));
  if (!p->key || !p->q.b) return 0;
  memcpy(p->key, readyKeyBuf, (unsigned long)kn); p->h = (int32_t)kh; p->nb = kn;
  cloneBoard(p->q.b, b);
  p->nd = *NODE(x, n);
  p->q.holdLeft = p->nd.holdLeft; p->q.holdStarted = p->nd.holdStarted; p->q.tight = decQ.tight;
  p->q.narr = p->nd.narr; for (int i = 0; i < p->q.narr; i++) p->q.arr[i] = p->nd.arr[i];
  p->tight = pressTight; p->tap = pressTap; p->from = pressFrom; p->spent = pressSpent; p->state = PEND_WAITING; p->whyN = 0; p->gen = readyPendGen; p->budget = 0; p->work = 0; p->hasLeft = 0; p->resumed = 0;
  readyPendN++;
  return readyPendN;
}
static int pendClaim(ReadyPend *p) { int32_t w = PEND_WAITING; return __atomic_compare_exchange_n(&p->state, &w, PEND_BUSY, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE); }
static int32_t readyBreakOf(Ctx *x, int n, int32_t *why, int32_t *whyN) {
  if (breakBusy) return NOT_ASKED;
  Board *b = ensureBoard(x, n);
  if (!b) return NOT_ASKED;
  uint32_t kh = 0;
  int32_t kn = readyKey(b, NODE(x, n), decQ.tight, &kh);
  readyAsked++;
  if (kn && readyFind(kh, readyKeyBuf, kn, why, whyN)) { readyHit++; return 1; }
  ReadyPend *p = kn && readyPendN ? readyPendFind(kh, kn) : 0;
  if (p) {
    // (A BOARD A WORKER HAS: its search is the one this decision would make -- the same budget, p->budget -- so a board being searched is
    // waited for, and its work charged to this decision's clock as if searched here: the answer and the clock alike whichever thread ran it)
    int32_t st = __atomic_load_n(&p->state, __ATOMIC_ACQUIRE);
    if (st == PEND_BUSY) while ((st = __atomic_load_n(&p->state, __ATOMIC_ACQUIRE)) == PEND_BUSY) {}
    // (searched out of its budget -- on a worker or here -- is the answer too: the same whichever thread ran it)
    if ((st == PEND_OUT || st == PEND_NONE || st == PEND_FOUND) && p->resumed) __atomic_add_fetch(&readyBeamIn, 1, __ATOMIC_RELAXED);
    if (st == PEND_OUT) { readyPre++; clockCharge(p->work); if (p->left && kn && __atomic_exchange_n(&p->hasLeft, 0, __ATOMIC_ACQ_REL)) readyBeamKeep(kh, readyKeyBuf, kn, p->left); return NOT_ASKED; }
    if (st == PEND_NONE || st == PEND_FOUND) {
      readyPre++; clockCharge(p->work);
      if (st == PEND_NONE) return 0;
      if (why) { for (int i = 0; i < p->whyN; i++) why[i] = p->why[i]; *whyN = p->whyN; }
      if (kn) readyKeep(kh, readyKeyBuf, kn, p->why, p->whyN);
      return 1;
    }
    if (!(st == PEND_WAITING && pendClaim(p))) p = 0;   // (claimed here: searched here, its budget the pend's)
  }
  static LOCAL Question q;
  memset(&q, 0, sizeof q);
  q.b = b; q.holdLeft = NODE(x, n)->holdLeft; q.holdStarted = NODE(x, n)->holdStarted; q.tight = decQ.tight;
  q.narr = NODE(x, n)->narr; for (int i = 0; i < q.narr; i++) q.arr[i] = NODE(x, n)->arr[i];
  int32_t line[MAXLINE], k = 0;
  int64_t w0 = clockWork;
  int32_t r = readySearchOf(&q, nowMs() + (p && p->budget > 0 ? p->budget : readyShareMs >= 0 ? readyShareMs : timeLeftMs() / 2), line, &k, p && p->budget > 0, kn ? readyKeyBuf : 0, kn, kh, 1);
  if (p) { p->work = clockWork - w0; p->resumed = readyResumed; }   // (what a later check of it is charged, as for a worker's)
  if (p) { if (r == 1) { for (int i = 0; i < k; i++) p->why[i] = line[i]; p->whyN = k; } __atomic_store_n(&p->state, r == 1 ? PEND_FOUND : r == 0 ? PEND_NONE : PEND_OUT, __ATOMIC_RELEASE); }
  if (r != 1) return r;
  if (why) { for (int i = 0; i < k; i++) why[i] = line[i]; *whyN = k; }
  // (the board as keyed before the search: the break search plays it, so it is keyed again from the node)
  if (kn && readyKey(ensureBoard(x, n), NODE(x, n), decQ.tight, &kh) == kn) readyKeep(kh, readyKeyBuf, kn, line, k);
  return 1;
}
// THE JOBS: readySpread's boards in the order it hands them (readyJobs), each searched on whichever worker takes it, if no thread has
// begun it, in the pend's budget -- or until the next decision takes the pool back (jobStop). A worker's clock begins at the work the
// decision had done.
static int32_t readyJobs[READYPEND];
static int64_t readyJobWork;
static double readyJobEnd;
static void readyJob(int32_t i) {
  ReadyPend *p = &readyPend[readyJobs[i]];
  if (!pendClaim(p)) return;
  clockWork = readyJobWork; clockShare = 0; clockAborted = 0; clockPoll = 0;
  inJob = 1; pressTight = p->tight; pressTap = p->tap; pressFrom = p->from; pressSpent = p->spent;
  int32_t line[MAXLINE], k = 0;
  int64_t w0 = clockWork;
  int32_t r = readySearchOf(&p->q, nowMs() + p->budget, line, &k, 1, p->key, p->nb, (uint32_t)p->h, 0);
  p->work = clockWork - w0;
  p->resumed = readyResumed;
  if (r == NOT_ASKED && readyLeft) { if (!p->left) p->left = (Paths *)grab(sizeof(Paths)); if (p->left) { *p->left = *readyLeft; p->hasLeft = 1; } }
  inJob = 0; pressFrom = pressSpent = 0;
  // (kept across decisions only by the decision that reads it: readyBreakOf)
  if (r == 1) { for (int q = 0; q < k; q++) p->why[q] = line[q]; p->whyN = k; }
  __atomic_store_n(&p->state, r == 1 ? PEND_FOUND : r == 0 ? PEND_NONE : PEND_OUT, __ATOMIC_RELEASE);
}
static int32_t (*readyBreak)(Ctx *x, int n, int32_t *why, int32_t *whyN) = readyBreakOf;
// for a tool that reads a logged board: the fewest swaps to the nearest break on the question's board (NEAR_MISS or more: none)
EXPORT(gb_break_near) int gb_break_near(void) { return hostBoard ? breakNear(hostBoard) : -1; }
