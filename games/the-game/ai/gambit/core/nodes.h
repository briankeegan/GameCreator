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
#define HOLDTIGHT 76      // the actions short of the input limit at which every walk is walked as cheaply as the walls allow -- the limit: always
                          // (the search and the frame loop); HOLDTIGHT + 1 asks a walk's cost tapped
static LOCAL int32_t pressTight;
// A BOARD NEAR ITS END (pressTap): lost within TAP_DIES frames left alone, as the decision reads it (the dies fact: decide.c read) -- its
// walks tapped, on time, while the allowance keeps TAP_RESERVE actions to spare; held as when tight below that. The decision says so
// (answer.c), the frame loop presses its line so.
#define TAP_RESERVE 16
#define TAP_DIES 60
static LOCAL int32_t pressTap;
static int tightAt(int left) { return left <= HOLDTIGHT && !(pressTap && left > TAP_RESERVE); }
// THE FRAMES A GARBAGE GROUP OF `cells` CELLS POPS IN once matched: flash, face, a pop a cell and three (pa.c matchGarbagePanels) -- the
// facts' wait for a break, the order's break time (decide.c rankSave: a full-width row)
static int32_t popFrames(const Board *b, int32_t cells) { return b->fFLASH + b->fFACE + b->fPOP * (3 + cells); }
// THE BOARD STILL MOVING: a chain counting, panels chaining or active (clearing, falling), or a pair swapping -- the one test every reader
// asks (a step judged once it is still, a press that waits for its pair, a wasted three played on until both boards stop)
static int boardMoving(const Board *b) { Board *m = (Board *)b; return b->chainCounter > 0 || hasChainingPanels(m) || hasActivePanels(m) || b->swappingCount > 0; }
#define MIN_LEG 3          // the shortest walk a held key is no later on
// A HELD KEY ENDS AT THE WALL: a direction is held only for a walk the board stops -- to column 1 or W - 1, or down to row 1 -- as a
// player slides to the edge and taps back from it; a walk that ends anywhere else is tapped a cell at a time (the owner: the bot slides
// only to the end, as a player would). (The stack's top moves, so a walk up is tapped.) legMove: where a leg of `cells` from (row, col)
// ends; legHeld: whether a leg ending at (row, col) may be held.
static void legMove(int32_t v, int cells, int *row, int *col) {
  int32_t d = v & 15;
  if (d & IN_RIGHT) *col = *col + cells > W - 1 ? W - 1 : *col + cells;
  else if (d & IN_LEFT) *col = *col - cells < 1 ? 1 : *col - cells;
  else if (d & IN_UP) *row += cells;
  else if (d & IN_DOWN) *row = *row - cells < 1 ? 1 : *row - cells;
}
static int legHeld(int32_t v, int row, int col) {
  int32_t d = v & 15;
  return (d & IN_RIGHT) ? col >= W - 1 : (d & IN_LEFT) ? col <= 1 : (d & IN_DOWN) ? row <= 1 : 0;
}
// A WALK'S SHAPE when the allowance is tight, a leg of n cells from (row, col): 1 held to the wall it ends at (*w its cells); 2 slid to
// the wall past its end and tapped back *b cells -- as a player slides to the edge and comes back, where that costs fewer actions than
// tapping each cell (1 + *b against n); 0 tapped.
static int legShape(int32_t v, int n, int row, int col, int *w, int *b) {
  int32_t d = v & 15;
  int wall = (d & IN_RIGHT) ? W - 1 - col : (d & IN_LEFT) ? col - 1 : (d & IN_DOWN) ? row - 1 : -1;
  if (n < 2 || wall < 0) return 0;
  if (wall <= n) { *w = n; *b = 0; return 1; }
  *w = wall; *b = wall - n;
  return 1 + *b < n ? 2 : 0;
}
// (a slide and the taps back, as keys: the direction held until the cursor is at the wall -- REPEAT_FIRST - 2 frames past its w-th
// cell, walkLeg -- then the way back tapped TAP_GAP frames apart, the frames after them the leg's own other keys (base); never shorter
// than the leg tapped (len), so its swap comes no sooner than the judge's tapped walk presses it. The keys written)
static int legSlide(int32_t v, int32_t base, int w, int b, int len, int32_t *out, int cap) {
  int32_t d = v & 15, back = (d & IN_RIGHT) ? IN_LEFT : (d & IN_LEFT) ? IN_RIGHT : IN_UP;
  int k = 0;
  for (int g = 0; g < w + REPEAT_FIRST - 1 && k < cap; g++) out[k++] = v;
  for (int t = 0; t < b; t++) for (int g = 0; g < TAP_GAP && k < cap; g++) out[k++] = g ? base : base | back;
  while (k < len && k < cap) out[k++] = base;
  return k;
}
// The cost in actions of a swap at (r, c) from the cursor at (row, col): its walk, across then up or down, each held when it would be
// -- and only where it ends at the wall -- (left: the actions the input budget still allows -- tight at HOLDTIGHT or under). The frame
// loop's and the judge's, the one count.
static int iabs(int v) { return v < 0 ? -v : v; }
// (and, tight, slid to the wall and tapped back where that costs fewer: legShape)
static int legCost(int32_t d, int n, int row, int col, int tight, int inner) {
  int w, b, s = legShape(d, n, row, col, &w, &b);
  if (tight) return s == 1 ? 1 : s == 2 ? 1 + b : n;
  return s == 1 && (n >= MIN_LEG + 1 || (n == MIN_LEG && inner)) ? 1 : n;
}
static int actionsFor(int row, int col, int r, int c, int left) {
  int tight = tightAt(left), cost = 1;
  if (c != col) cost += legCost(c > col ? IN_RIGHT : IN_LEFT, iabs(c - col), row, col, tight, r != row);
  if (r != row) cost += legCost(r > row ? IN_UP : IN_DOWN, iabs(r - row), row, c, tight, 0);
  return cost;
}
// THE ALLOWANCE A JUDGED LINE PRESSES UNDER: the decision's (NOT_ASKED: the host did not say), less what the line's own swaps spend --
// a line long enough walks held from two cells once its own presses bring the budget to HOLDTIGHT, as the frame loop walks it
static int32_t pressAllowance = -1;
// (the allowance a walk's cost is asked at, for a reader that ranks or proposes by it: the decision's, as the frame loop will walk it)
static int walkLeft(void) { return pressAllowance >= 0 ? pressAllowance : HOLDTIGHT + 1; }
// THE INPUT WINDOW THE LINE IS PRESSED IN (a native host's frame loop says it, front.c ask): how many frames before the question's frame
// each action still inside the window went down -- planned ones up to it too -- and the window's length. The actions left at frame t
// from the question's: the limit less those still inside the window then, less what the line has spent. nWinAges -1: not said, the
// decision's allowance less what is spent.
#define WINMAX 512
// THE RESERVE: the actions the window keeps for the next break, a line that breaks nothing leaving it (outcome.c spendsReserve) and the
// survival search keeping it unless spending it buys a later loss (search/outlive.c). None: the pace keeps the window
// (paceGap), and the line check presses every line in the window as it will be
#define RESERVE 0
// THE NEXT LANDING'S BREAK: the actions a break's walk takes, kept in the window for the frame the next block lands (outcome.c
// leftAtLanding, spendsReserve) -- what a line spends before then the window has back only as it ages
#define LAND_RESERVE 20
static int32_t winAges[WINMAX], nWinAges = -1, winLen = 600, hostWin;
// (A SEARCH ROOTED LATER: a readiness search's board is a line's once everything lands, pressFrom frames after the question with the line
// having spent pressSpent -- its breaks are pressed in the window as it is then, every search asking it here; 0 for the question's own)
static LOCAL int32_t pressFrom, pressSpent;
static int allowLeftAt(int32_t t, int spent) {
  if (pressAllowance < 0) return -1;
  t += pressFrom; spent += pressSpent;
  if (nWinAges < 0) return pressAllowance - spent;
  int in = 0; for (int i = 0; i < nWinAges; i++) in += winAges[i] + t < winLen;
  return imax(0, pressAllowance + nWinAges - in - spent);
}
// THE WINDOW PLAN, the one reading every reader asks of a line (the order's reserve, the line check, the survival search), its values the
// decision's own: whether the window keeps the next break's walk -- breakWalk, the actions this board's nearest break takes (decide.c
// read) -- the frame the next block lands, or the line's end when it is still pressing then or nothing is on its way (landingAt: frames
// from the question, -1 none), with `spent` pressed by its end and every action before aged as the window ages; regainAfter, the frames
// from then until the window gives that walk back to a line short of it; and spendPays, whether a line that spends the walk is worth it
// over one that keeps it: it is, lost after the window has given the walk back -- it never dies on the way, the walk in hand again --
// or where the line that keeps it is lost before it could press that walk -- the walk's frames, a cell every TAP_GAP, past the landing
// or the keeper's end -- and the spender outlives it by a break's time (rankSave): a walk kept by a board dead before it is pressed
// keeps nothing, and a spend that buys less than a break's time buys nothing either
static int32_t landingAt = -1, breakWalk = LAND_RESERVE;
#define LANDN 64
static int32_t landAts[LANDN], nLandAts;   // (every break the blocks shown on their way are due: a row each, its block's landing and a break's
                                            // time after each row before it -- the frames from the question, soonest first)
static int32_t rankSave;   // (rank.c: the frames one break takes)
// (THE WINDOW'S SHARE a line leaves: the actions left at its end, or at the landing when that is later, of the window's whole limit --
// the third margin beside the stack's room and its material; -1 with no allowance said)
static double windowShareAt(int32_t endAt, int spent) {
  if (pressAllowance < 0) return -1;
  int32_t tl = landingAt >= 0 ? landingAt - pressFrom : -1;
  int32_t lim = pressAllowance + (nWinAges > 0 ? nWinAges : 0);
  return (double)allowLeftAt(tl > endAt ? tl : endAt, spent) / (lim > 0 ? lim : 1);
}
// (AN ACTION IN FRAMES: the frames the window takes to give one back -- its length over its limit; 0 with no allowance said)
static double actionFrames(void) {
  if (pressAllowance < 0) return 0;
  int32_t lim = pressAllowance + (nWinAges > 0 ? nWinAges : 0);
  return lim > 0 ? (double)winLen / lim : 0;
}
// (THE WINDOW'S COVER: of the breaks the blocks on their way are due, soonest first, how many the window keeps a walk for -- at each due
// its walk besides the walks the breaks before it took, each pressed as its block lands and aged out as any action is, with what the
// window has given back by then; none on its way, 1 where the window keeps the walk at the line's end. WINDOW_ALL: no allowance said)
#define WINDOW_ALL (LANDN + 1)
static int windowCover(int32_t endAt, int spent) {
  if (pressAllowance < 0) return WINDOW_ALL;
  if (nLandAts <= 0) { int32_t tl = landingAt >= 0 ? landingAt - pressFrom : -1; return allowLeftAt(tl > endAt ? tl : endAt, spent) >= breakWalk; }
  int k = 0;
  for (; k < nLandAts; k++) {
    int32_t tk = landAts[k] - pressFrom; if (tk < endAt) tk = endAt;
    int before = 0;
    for (int i = 0; i < k; i++) { int32_t ti = landAts[i] - pressFrom; if (ti < endAt) ti = endAt; if (tk - ti < winLen) before += breakWalk; }
    if (allowLeftAt(tk, spent) - before < breakWalk) break;
  }
  return k;
}
// (whether the window keeps the next break's walk: the next block's, or the line's end where none is on its way)
static int windowKeepsBreak(int32_t endAt, int spent) { return windowCover(endAt, spent) >= 1; }
static int32_t regainAfter(int32_t endAt, int spent) {
  if (pressAllowance < 0) return 0;
  int32_t tl = landingAt >= 0 ? landingAt - pressFrom : -1, t0 = tl > endAt ? tl : endAt;
  int shortBy = breakWalk - allowLeftAt(t0, spent);
  if (shortBy <= 0) return 0;
  if (nWinAges < 0) return winLen;
  int32_t oldest[WINMAX]; int k = 0;   // (the actions still in the window then, oldest first, as many as it is short by)
  for (int i = 0; i < nWinAges; i++) {
    int32_t a = winAges[i] + t0 + pressFrom; if (a >= winLen) continue;
    int at = k < shortBy ? k++ : shortBy;
    if (at == shortBy && a <= oldest[shortBy - 1]) continue;
    if (at == shortBy) at = shortBy - 1;
    while (at > 0 && oldest[at - 1] < a) { oldest[at] = oldest[at - 1]; at--; }
    oldest[at] = a;
  }
  // (short by more than the actions before it: the line's own come back, the first a window after it was pressed)
  return k < shortBy ? imax(1, winLen - t0) : winLen - oldest[shortBy - 1];
}
static int spendPays(int32_t lostSpender, int32_t endAt, int spent, int32_t lostKeeper, int32_t keeperEnd) {
  int32_t tl = landingAt >= 0 ? landingAt - pressFrom : -1, t0 = tl > endAt ? tl : endAt, k0 = tl > keeperEnd ? tl : keeperEnd;
  if (lostKeeper < k0 + breakWalk * TAP_GAP && lostSpender - lostKeeper >= rankSave) return 1;
  return lostSpender >= t0 + regainAfter(endAt, spent);
}
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
// slowWalks' keys: every walk of two cells or more that ends at the wall held, and one a slide to the wall and back saves actions on
// slid (legShape), the frames it is late by put in before the next key (the cursor at (row, col) when the keys begin)
static int slowWalks(const int32_t *in, int n, int32_t *out, int cap, int row, int col) {
  int k = 0, i = 0;
  while (i < n && k < cap) {
    Leg L;
    if (!walkLeg(in, n, i, &L)) { out[k++] = in[i]; i++; continue; }
    int32_t v = L.v, base = L.base, cnt = L.cells, last = L.last, end = L.end;
    int w, b, shape = legShape(v, cnt, row, col, &w, &b);
    legMove(v, cnt, &row, &col);
    if (shape == 2) { k += legSlide(v, base, w, b, end - i + 1, out + k, cap - k); i = end + 1; continue; }
    if (shape != 1) { for (int f = i; f <= end && k < cap; f++) out[k++] = in[f]; i = end + 1; continue; }
    for (int g = i; g <= (last > end ? last : end) && k < cap; g++) out[k++] = g <= last ? v : base;
    i = end + 1;
  }
  return k;
}
static int32_t pressDelayOf(Ctx *x, int pi, int mr, int mc) {
  const Board *b0 = ensureBoard(x, pi);
  if (!b0) return 0;
  int row = b0->curRow, col = b0->curCol;
  tape = keyBuf; tapeN = 0; tapeCap = (int32_t)(sizeof keyBuf / sizeof keyBuf[0]) / 3;
  int r = advance(x, pi, MK_SWAP, mr, mc, 0);
  tape = 0;
  if (r == STEP_NULL || r == STEP_ERR) return 0;
  int n = tapeN;
  static LOCAL int32_t in[4096];
  for (int i = 0; i < n; i++) in[i] = keyBuf[3 * i];
  int tap = firstSwap(in, n), slow = firstSwap(walkBuf, slowWalks(in, n, walkBuf, (int)(sizeof walkBuf / sizeof walkBuf[0]), row, col));
  return tap >= 0 && slow > tap ? slow - tap : 0;
}
// (the delay is the board's, every time: the same cursor and swap are later by more or less as the board makes the walk wait)
static int32_t pressDelay(Ctx *x, int pi, int mr, int mc) {
  if (!pressTight || !mr) return 0;
  return pressDelayOf(x, pi, mr, mc);
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
// runPhase: native.c's workers), then TAKEN one at a time in the batch's order (stepTake): each charged to the clock as the threads
// spent it -- its frames over the workers that shared the batch, as the order's judging is charged (decide.c judgeAll) -- and none
// taken once the clock is out, so a search that takes its batch in order makes the same children on every run. With no workers, a batch too small to share, or a swap whose press
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
  int32_t r = batchRes.a[j], t0 = NODE(x, pi)->t, u = r >= 0 ? NODE(x, r)->t - t0 : r == STEP_DEAD ? batchDead.a[j] - t0 : 1, nw = imax(pool.nworkers, 1);
  clockCharge((u + nw - 1) / nw);
  if (r == STEP_DEAD) deadAt = batchDead.a[j];
  return r;
}
// (the batch let go: a search's later steps are made one at a time)
static void batchDone(void) { batchN = 0; }

// THE BOT'S HANDS, as the host has them (gb_config): the frames it waits after a decision, after a swap, and a cursor step. Every
// context a search makes is set so (surviveFrames and surviveRest 0).
// (A SWAP'S OWN TIME: a swap step ends no sooner than SWAP_SHOWN frames after its press -- the swapped panels move for 4 frames (pa.c,
// the SWAPPING timer) and match the frame after -- so the board a swap step leaves shows what the swap made; the profile's swapGap is
// any wait the hands add beyond it)
#define SWAP_SHOWN 5
static int32_t cfgReaction = 12, cfgSwapGap = 12, cfgCursor = 4;
EXPORT(gb_config) void gb_config(int reaction, int swapGap, int cursorMoveFrames) { cfgReaction = reaction; cfgSwapGap = swapGap; cfgCursor = cursorMoveFrames; }
// THE PACE: the hands slow as the input window empties -- the wait after a swap twice the window's time to give back an action, times
// the share of the limit spent: SWAP_SHOWN's 5 frames with the window full, 8 at half, 12 at a quarter, 16 empty (the standard budget, 76
// actions in 600 frames). The frame loop sets it with each question (front.c ask: left, the allowance at the question's frame) and
// presses each line with the pace it was judged with; the decision's every context is made with it (decGap).
static int paceGap(int left, int limit, int window) {
  if (limit <= 0 || window <= 0 || left < 0) return 0;
  int spent = limit - imin(left, limit);
  return (2 * window * spent + limit * limit - 1) / (limit * limit);
}
static int32_t decGap;
static int handsGap(int pace) { return imax(imax(cfgSwapGap, SWAP_SHOWN), pace); }
static Ctx *ctxOf(Ctx *x) {
  if (!x) x = ns_ctx_new();
  ns_ctx_set(x, cfgReaction, cfgCursor, 0, 0); ns_ctx_gap(x, handsGap(__atomic_load_n(&decGap, __ATOMIC_RELAXED)));
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
    if (k >= PRESS_WAIT || !b || !boardMoving(b)) return STEP_NULL;
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
