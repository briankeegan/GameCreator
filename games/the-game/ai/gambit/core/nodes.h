// THE NODES: the one way any of Gambit's searches plays a line. A node is a board at a frame (engine/search.h); step() makes the next
// node -- a swap pressed as the game presses it (the walk to it, the wait for the board), a settle, a wait -- charged to the clock.
#ifndef GAMBIT_NODES_H
#define GAMBIT_NODES_H
#include "clock.h"
// GAMBIT'S OWN IO: what the host hands Gambit (rules, a list, a line, the lines carried on) and what Gambit answers, apart from the
// engine's io (pa.c ioBody), which the host writes a board into -- natively from another thread while Gambit thinks.
#define GBIO (1 << 16)
static int32_t gbIo[GBIO];
EXPORT(gb_io) int32_t *gb_io(void) { return gbIo; }
// THE PRESS AS THE FRAME LOOP MAKES IT: with the input budget tight (pressTight: the decision's allowance at or under the frame loop's
// HOLDTIGHT) the frame loop walks the cursor held from two cells, which presses a swap later than the search's own tapped walk. The
// frames later, from node pi -- the search's keys for the swap, walked as the frame loop walks them.
#define TAP_GAP 4         // frames between taps (cursorMoveFrames)
#define REPEAT_FIRST 10   // frames from the press to the second cell (curWaitTime 20, counted twice a frame)
#define HOLDTIGHT 40      // the actions short of the input limit at which every walk of two cells or more is held (the search and the frame loop)
static LOCAL int32_t pressTight;
// A BOARD NEAR ITS END (pressTap): lost within TAP_DIES frames left alone (its stop, or its rise to the top, and its health) -- its
// walks tapped, on time, while the allowance keeps TAP_RESERVE actions to spare; held as when tight below that. The decision says so
// (answer.c), the frame loop presses its line so.
#define TAP_RESERVE 16
#define TAP_DIES 60
static LOCAL int32_t pressTap;
static int tightAt(int left) { return left <= HOLDTIGHT && !(pressTap && left > TAP_RESERVE); }
#define MIN_LEG 3          // the shortest walk a held key is no later on
// The cost in actions of a swap at (r, c) from the cursor at (row, col): its walk, across then up or down, each held when it would be
// (left: the actions the input budget still allows -- tight at HOLDTIGHT or under). The frame loop's and the judge's, the one count.
static int iabs(int v) { return v < 0 ? -v : v; }
static int actionsFor(int row, int col, int r, int c, int left) {
  int tight = tightAt(left), legs[2], nl = 0, cost = 1;
  if (iabs(c - col)) legs[nl++] = iabs(c - col);
  if (iabs(r - row)) legs[nl++] = iabs(r - row);
  for (int k = 0; k < nl; k++) {
    int n = legs[k], inner = k < nl - 1;
    cost += tight ? (n >= 2 ? 1 : n) : (n >= MIN_LEG + 1 || (n == MIN_LEG && inner)) ? 1 : n;
  }
  return cost;
}
// THE ALLOWANCE A JUDGED LINE PRESSES UNDER: the decision's (NOT_ASKED: the host did not say), less what the line's own swaps spend --
// a line long enough walks held from two cells once its own presses bring the budget to HOLDTIGHT, as the frame loop walks it
static int32_t pressAllowance = -1;
static LOCAL int32_t keyBuf[3 * 4096], walkBuf[2 * 4096];
static int firstSwap(const int32_t *in, int n) { for (int i = 0; i < n; i++) if (in[i] & IN_SWAP) return i; return -1; }
// A WALK'S LEG in a line's keys, from key i: a direction tapped a cell at a time, TAP_GAP frames apart (in[i] the direction with the
// frame's other keys, in[i + 1] those keys alone). 0 when key i begins none; else its cells (*cells), its last tap (*p), the last frame of
// its taps' gap (*end), and the frame a held key reaches its last cell (*last). Every reader of the walks (slowWalks, front.c) asks it.
typedef struct { int32_t v, base; int cells, p, end, last; } Leg;
static int walkLeg(const int32_t *in, int n, int i, Leg *L) {
  int32_t v = in[i], dir = v & 15;
  if (!dir || (dir & (dir - 1)) || i + 1 >= n || (in[i + 1] & 15) || (v & ~15) != in[i + 1]) return 0;
  int32_t base = in[i + 1];
  int cells = 1, p = i;
  while (p + TAP_GAP < n && in[p + TAP_GAP] == v && in[p + 1] == base && in[p + 2] == base && in[p + 3] == base) { p += TAP_GAP; cells++; }
  int end = p;
  while (end + 1 < n && end + 1 <= p + TAP_GAP - 1 && in[end + 1] == base) end++;
  L->v = v; L->base = base; L->cells = cells; L->p = p; L->end = end; L->last = i + cells + REPEAT_FIRST - 2;
  return 1;
}
// slowWalks' keys: every walk of two cells or more held, the frames it is late by put in before the next key
static int slowWalks(const int32_t *in, int n, int32_t *out, int cap) {
  int k = 0, i = 0;
  while (i < n && k < cap) {
    Leg L;
    if (!walkLeg(in, n, i, &L)) { out[k++] = in[i]; i++; continue; }
    int32_t v = L.v, base = L.base, cnt = L.cells, last = L.last, end = L.end;
    if (cnt < 2) { for (int f = i; f <= end && k < cap; f++) out[k++] = in[f]; i = end + 1; continue; }
    for (int g = i; g <= (last > end ? last : end) && k < cap; g++) out[k++] = g <= last ? v : base;
    i = end + 1;
  }
  return k;
}
static int32_t pressDelayOf(Ctx *x, int pi, int mr, int mc) {
  tape = keyBuf; tapeN = 0; tapeCap = (int32_t)(sizeof keyBuf / sizeof keyBuf[0]) / 3;
  int r = advance(x, pi, MK_SWAP, mr, mc, 0);
  tape = 0;
  if (r == STEP_NULL || r == STEP_ERR) return 0;
  int n = tapeN;
  static LOCAL int32_t in[4096];
  for (int i = 0; i < n; i++) in[i] = keyBuf[3 * i];
  int tap = firstSwap(in, n), slow = firstSwap(walkBuf, slowWalks(in, n, walkBuf, (int)(sizeof walkBuf / sizeof walkBuf[0])));
  return tap >= 0 && slow > tap ? slow - tap : 0;
}
// (the delay is the walk's -- where the cursor is and where the swap is -- kept per decision: pressMemoClear at its start; each thread
// keeps its own, let go once the decision is another)
#define PRESS_MEMO (MAXROWS * 8 * MAXROWS * 8)
static LOCAL short pressMemo[PRESS_MEMO];
static int32_t pressMemoGen; static LOCAL int32_t pressMemoAt = -1;
static void pressMemoClear(void) { for (int i = 0; i < PRESS_MEMO; i++) pressMemo[i] = -1; pressMemoAt = ++pressMemoGen; }
static int32_t pressDelay(Ctx *x, int pi, int mr, int mc) {
  if (!pressTight || !mr) return 0;
  Board *b = ensureBoard(x, pi);
  if (!b || b->curRow < 0 || b->curRow >= MAXROWS || b->curCol < 0 || b->curCol > 7) return 0;
  if (pressMemoAt != pressMemoGen) { for (int i = 0; i < PRESS_MEMO; i++) pressMemo[i] = -1; pressMemoAt = pressMemoGen; }
  int key = ((b->curRow * 8 + b->curCol) * MAXROWS + mr) * 8 + mc;
  if (key < 0 || key >= PRESS_MEMO) return pressDelayOf(x, pi, mr, mc);
  if (pressMemo[key] < 0) pressMemo[key] = (short)pressDelayOf(x, pi, mr, mc);
  return pressMemo[key];
}
// The child of node pi by one step (search.h advance: MK_SWAP, MK_SETTLE, MK_LONG, MK_HOLD), STEP_NULL when the clock is out or the
// step is refused, STEP_DEAD when the board is lost on it (deadAt). A swap is pressed as the frame loop presses it: with the input
// budget tight, the frames its held walk is later by are waited first -- every search and the judge on the one press clock.
static int step(Ctx *x, int pi, int kind, int mr, int mc, int32_t frames) {
  if (clockOut()) return STEP_NULL;
  int32_t t0 = NODE(x, pi)->t;
  if (pressTight && mr && (kind == MK_SWAP || kind == MK_SETTLE)) {
    int32_t late = pressDelay(x, pi, mr, mc);
    if (late > 0) {
      int w = advance(x, pi, MK_LONG, 0, 0, late);
      if (w < 0 || NODE(x, w)->dead) { clockCharge(late); return w == STEP_DEAD || (w >= 0 && NODE(x, w)->dead) ? STEP_DEAD : w; }
      pi = w;
    }
  }
  int r = advance(x, pi, kind, mr, mc, frames);
  clockCharge(r >= 0 ? NODE(x, r)->t - t0 : r == STEP_DEAD ? deadAt - t0 : 1);
  return r;
}

// MANY STEPS AT ONCE: a batch of steps (each a parent and a move) played on every thread the host gave the engine's pool (search.h
// runPhase: native.c's workers), then TAKEN one at a time in the batch's order (stepTake): each charged to the clock as step() charges
// it, and none taken once the clock is out -- so a search that takes its batch in order, and stops where it would have stopped, makes
// the same children and spends the same clock as one step at a time. With no workers, a batch too small to share, or a swap whose press
// waits its walk first (pressDelay), the step is made when it is taken.
// A search run as a job on the threads (search/break.c readyJob) is a thread's whole: its steps are its own, never a batch; and while jobs
// hold the pool (search.h poolBusy) the decision's own steps are made one at a time.
#define UNBATCHED (-97)
static Vec batchTasks, batchRes, batchDead;
static LOCAL int batchN;
static void stepBatch(Ctx *x, const int32_t *parents, const int32_t *moves, int kind, int n) {
  batchN = 0;
  if (inJob || __atomic_load_n(&poolBusy, __ATOMIC_ACQUIRE) || pool.nworkers <= 0 || n < 8 || clockOut() || !vreserve(&batchTasks, 4 * n) || !vreserve(&batchRes, n) || !vreserve(&batchDead, n)) return;
  batchTasks.n = 0;
  for (int j = 0; j < n; j++) {
    int mr = CR(moves[j]), mc = CC(moves[j]);
    batchRes.a[j] = UNBATCHED;
    if ((pressTight && mr && pressDelay(x, parents[j], mr, mc) > 0) || !ensureBoard(x, parents[j])) continue;
    batchTasks.a[batchTasks.n++] = parents[j]; batchTasks.a[batchTasks.n++] = ADVANCE_TASK - ((((mr << 3) | mc) << 3) | kind);
    batchTasks.a[batchTasks.n++] = 0; batchTasks.a[batchTasks.n++] = j;
    batchRes.a[j] = PENDING;
  }
  pool.deadAt = batchDead.a; pool.moves = 0;
  int ok = runPhase(x, &batchTasks, batchRes.a);
  pool.deadAt = 0;
  if (!ok) return;
  batchN = n;
}
// the batch's step j (its parent pi, its move), as step() would make it now
static int stepTake(Ctx *x, int j, int pi, int kind, int32_t mv) {
  if (j >= batchN || batchRes.a[j] == UNBATCHED || batchRes.a[j] == PENDING) return clockOut() ? STEP_NULL : step(x, pi, kind, CR(mv), CC(mv), 0);
  if (clockOut()) return STEP_NULL;
  int32_t r = batchRes.a[j], t0 = NODE(x, pi)->t;
  clockCharge(r >= 0 ? NODE(x, r)->t - t0 : r == STEP_DEAD ? batchDead.a[j] - t0 : 1);
  if (r == STEP_DEAD) deadAt = batchDead.a[j];
  return r;
}
// (the batch let go: a search's later steps are made one at a time)
static void batchDone(void) { batchN = 0; }

// THE BOT'S HANDS, as the host has them (gb_config): the frames it waits after a decision, after a swap, and a cursor step. Every
// context a search makes is set so (surviveFrames and surviveRest 0).
static int32_t cfgReaction = 12, cfgSwapGap = 12, cfgCursor = 4;
EXPORT(gb_config) void gb_config(int reaction, int swapGap, int cursorMoveFrames) { cfgReaction = reaction; cfgSwapGap = swapGap; cfgCursor = cursorMoveFrames; }
static Ctx *ctxOf(Ctx *x) {
  if (!x) x = ns_ctx_new();
  ns_ctx_set(x, cfgReaction, cfgCursor, 0, 0); ns_ctx_gap(x, cfgSwapGap);
  return x;
}
// THE QUESTION: the board a decision is made on, the raise in hand and the garbage on its way -- what every search roots its lines at.
typedef struct { Board *b; int32_t holdLeft, holdStarted, narr; Arr arr[MAXARR]; int32_t tight; } Question;
// A search's root, made from the question: every node before it is let go.
static int rootOf(Ctx *x, const Question *q) {
  ns_reset(x);
  Board *b = nb_new();
  if (!b) return STEP_ERR;
  cloneBoard(b, q->b);
  Node *n = newNode(x);
  if (!n) { nb_free(b); return STEP_ERR; }
  n->st = b; n->t = 0; n->holdLeft = q->holdLeft; n->holdStarted = q->holdStarted; n->fresh = 0; n->narr = q->narr;
  for (int i = 0; i < q->narr; i++) n->arr[i] = q->arr[i];
  readBoard(n, b);
  x->rootBrk = n->brk;
  for (int i = 0; i < x->tagCap; i++) x->brkAt[i] = -1;
  return n->err ? STEP_ERR : (int)(n - x->nodes);
}
// A node made and not lost (a step can come back refused, lost, or out of the clock).
static int liveNode(Ctx *x, int i) { return i >= 0 && !NODE(x, i)->dead; }
// Whether the swap at (r, c) is one of node i's legal swaps.
static int legalAt(Ctx *x, int i, int r, int c) {
  static LOCAL int32_t ms[MAXROWS * W];
  Board *b = ensureBoard(x, i);
  if (!b) return 0;
  int n = legalSwaps(b, ms);
  for (int k = 0; k < n; k++) if (ms[k] == r * 8 + c) return 1;
  return 0;
}
// A SWAP PRESSED AS THE FRAME LOOP PRESSES IT (front.c keysOf and the judge, the one way): the walk to it begun and the swap pressed when
// the cursor gets there. A press refused there while the board still moves -- its pair swapping or falling -- is walked to again from
// the frame after, until one is taken or the board stands still: the swap goes in the first frame the walk can put it in, never a walk
// later. walk: the step that walks (the frame loop's advance writing its keys; the judge's, unheld). Returns the walk taken (a node,
// STEP_NULL none, STEP_DEAD lost on it, STEP_ERR) and in *from the node it began on -- -1 when the board was lost while it waited.
#define PRESS_WAIT 240   // the frames a swap is waited for at most
static int pressWalk(Ctx *x, int n, int kind, int mr, int mc, int (*walk)(Ctx *, int, int, int, int, int32_t), int *from) {
  for (int k = 0;; k++) {
    int32_t mark = tapeN;
    int r = walk(x, n, kind, mr, mc, 0);
    *from = n;
    if (r != STEP_NULL) return r;
    tapeN = mark;
    Board *b = ensureBoard(x, n);
    if (k >= PRESS_WAIT || !b || !(hasActivePanels(b) || b->swappingCount > 0)) return STEP_NULL;
    int w = walk(x, n, MK_LONG, 0, 0, 1);
    if (w == STEP_NULL || w == STEP_ERR) return w;
    if (w == STEP_DEAD || NODE(x, w)->dead) { if (w >= 0) deadAt = NODE(x, w)->t; *from = -1; return STEP_DEAD; }
    n = w;
  }
}
// WHAT A STEP DID (pa.c ns_step_stats), read off the board it made: each clear's size and the chain counter it reached, panels
// cleared, garbage cells converted, the most stop one clear paid.
typedef struct { int32_t n, size[MAXCOMBOS], chainAt[MAXCOMBOS], link[MAXCOMBOS], touch[MAXCOMBOS], cleared, broke, earned; } Stats;
static int statsOf(Ctx *x, int i, Stats *s) {
  Board *b = ensureBoard(x, i);
  if (!b) return 0;
  s->n = b->sNCombo; s->cleared = b->sCleared; s->broke = b->sBroke; s->earned = b->sEarned;
  for (int j = 0; j < b->sNCombo; j++) { s->size[j] = b->sCombo[j]; s->chainAt[j] = b->sChainAt[j]; s->link[j] = b->sLink[j]; s->touch[j] = b->sTouch[j]; }
  return 1;
}
// The chain a step's clears reach (attacker sent().chain): the highest chain counter of any of them.
static int32_t chainOfStats(const Stats *s) { int32_t c = 0; for (int j = 0; j < s->n; j++) if (s->chainAt[j] > c) c = s->chainAt[j]; return c; }
static int32_t biggestOf(const Stats *s) { int32_t z = 0; for (int j = 0; j < s->n; j++) if (s->size[j] > z) z = s->size[j]; return z; }
#endif
