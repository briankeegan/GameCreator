// THE NODES: the one way any of Gambit's searches plays a line. A node is a board at a frame (engine/search.h); step() makes the next
// node -- a swap pressed as the game presses it (the walk to it, the wait for the board), a settle, a wait -- charged to the clock.
#ifndef GAMBIT_NODES_H
#define GAMBIT_NODES_H
#include "clock.h"
// The child of node pi by one step (search.h advance: MK_SWAP, MK_SETTLE, MK_LONG, MK_HOLD), STEP_NULL when the clock is out or the
// step is refused, STEP_DEAD when the board is lost on it (deadAt).
static int step(Ctx *x, int pi, int kind, int mr, int mc, int32_t frames) {
  if (clockOut()) return STEP_NULL;
  int32_t t0 = NODE(x, pi)->t;
  int r = advance(x, pi, kind, mr, mc, frames);
  clockCharge(r >= 0 ? NODE(x, r)->t - t0 : r == STEP_DEAD ? deadAt - t0 : 1);
  return r;
}

// THE BOT'S HANDS, as the host has them (gb_config): the frames it waits after a decision, after a swap, and a cursor step. Every
// context a search makes is set so (native.js Search: surviveFrames and surviveRest 0).
static int32_t cfgReaction = 12, cfgSwapGap = 12, cfgCursor = 4;
EXPORT(gb_config) void gb_config(int reaction, int swapGap, int cursorMoveFrames) { cfgReaction = reaction; cfgSwapGap = swapGap; cfgCursor = cursorMoveFrames; }
static Ctx *ctxOf(Ctx *x) {
  if (!x) x = ns_ctx_new();
  ns_ctx_set(x, cfgReaction, cfgCursor, 0, 0); ns_ctx_gap(x, cfgSwapGap);
  return x;
}
// THE QUESTION: the board a decision is made on, the raise in hand and the garbage on its way -- what every search roots its lines at.
typedef struct { Board *b; int32_t holdLeft, holdStarted, narr; Arr arr[MAXARR]; int32_t tight; } Question;
// A search's root, made from the question (native.js Search.root): every node before it is let go.
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
// Whether the swap at (r, c) is one of node i's legal swaps.
static int legalAt(Ctx *x, int i, int r, int c) {
  static int32_t ms[MAXROWS * W];
  Board *b = ensureBoard(x, i);
  if (!b) return 0;
  int n = legalSwaps(b, ms);
  for (int k = 0; k < n; k++) if (ms[k] == r * 8 + c) return 1;
  return 0;
}
// WHAT A STEP DID (pa.c ns_step_stats), read off the board it made: each clear's size and the chain counter it reached, panels
// cleared, garbage cells converted, the most stop one clear paid.
typedef struct { int32_t n, size[MAXCOMBOS], chainAt[MAXCOMBOS], cleared, broke, earned; } Stats;
static int statsOf(Ctx *x, int i, Stats *s) {
  Board *b = ensureBoard(x, i);
  if (!b) return 0;
  s->n = b->sNCombo; s->cleared = b->sCleared; s->broke = b->sBroke; s->earned = b->sEarned;
  for (int j = 0; j < b->sNCombo; j++) { s->size[j] = b->sCombo[j]; s->chainAt[j] = b->sChainAt[j]; }
  return 1;
}
// The chain a step's clears reach (attacker sent().chain): the highest chain counter of any of them.
static int32_t chainOfStats(const Stats *s) { int32_t c = 0; for (int j = 0; j < s->n; j++) if (s->chainAt[j] > c) c = s->chainAt[j]; return c; }
static int32_t biggestOf(const Stats *s) { int32_t z = 0; for (int j = 0; j < s->n; j++) if (s->size[j] > z) z = s->size[j]; return z; }
#endif
