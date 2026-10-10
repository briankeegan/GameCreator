// THE BOT'S FRONT END: what it reads off the board it plays, and the keys it
// presses. The board is the server's engine's own (pa.c), read where it lies;
// each frame the bot fills its inputs from it (BIN, the board as masks, the
// risen board, the timed one), decides when it is free to, and walks the
// cursor to the swap it chose. Included at the end of bit.c (PA_LIB), after
// everything the bot is; pa.h comes in here, so its names are not seen above.
#include "pa.h"
#ifndef EXPORT
#define EXPORT(name) __attribute__((export_name(#name)))
#endif

// Garbage cells a combo sends, by size: checkMatches.lua COMBO_GARBAGE
// (none past 72).
static int comboCells(int size) {
  if (size < 4 || size > 72) return 0;
  static const int at[28] = { 0, 0, 0, 0, 3, 4, 5, 6, 7, 8, 10, 11, 12, 18, 24, 24, 24, 24, 24, 24, 36, 36, 36, 36, 36, 36, 36, 48 };
  return at[size < 27 ? size : 27];
}
// The bot's weights, in bitfeatures keys() order.
static const double STARTER_W[] = { -20, -10, -40, 5, 13, 20, 30, 4, 6, 8, 10, 10, 5, 15, 5, 5, 25, 5, 50, 30 };

enum { H_NONE, H_UP, H_DOWN, H_LEFT, H_RIGHT };   // BIN[IN_HELD]
typedef struct { uint8_t last[32][W + 2], first[32][W + 2], same[32][W + 2], garb[32][W + 2]; } Settle;   // per cell (unsettled): the frame it settles from, the frame it first changes, whether it settles to what it holds now, and whether it settles to garbage
// THE INPUT BUDGET, the game's (InputBudget.lua): at most ACTIONLIMIT actions
// in any ACTIONWINDOW frames, an action being a swap, up, down, left or right
// going down; a held direction is one action, raise none. A key the budget
// does not allow is not pressed: the walk waits for the frame it is.
#define ACTIONLIMIT 76   // 456 actions a minute over the window: floor(456 * 600 / 3600)
#define ACTIONWINDOW 600
// the keys' own state, the real front's and every simulated line's alike: the
// frames of the actions inside the window (a ring), and a direction held down
// A RESERVE IS KEPT FOR THE FLURRY A BOARD ABOUT TO LOSE HEALTH NEEDS: while the
// board left alone does not, a press stops ACTIONRESERVE short of the limit
// (limit: what this decision may spend to, set where it begins)
#define ACTIONRESERVE 20
#define HOLDTIGHT 24   // the actions short of the limit at which short walks are held too
#define ACTIONRING 128   // room for the diagnostic limit (GC_INPUT_LIMIT) above the game's
typedef struct { int actAt[ACTIONRING], actOld, actN, holdKey, limit; } Pad;
typedef struct {
  int id, reaction, reveal, allowRaise;
  int cooldown, raiseHeld, wantRaise, wantRows, raiseLives;   // raiseHeld: the raise key pressed this frame
  int walk, wRow, wCol, wTimer, wCooldown, wRetries, wDisp, wHasDisp;
  int park, pRow, pCol, pTimer, pTr, pTc, pDisp;
  int hasLast, lastR, lastC, held;
  double escapeWalk;
  u64 decidedOn;
  int lastKind, lastVia, lastMoveR, lastMoveC;
  Settle settle;   // the board's cells, when each settles (unsettled), at the last decision
  int wWaitTo, wFrames, wWaitAll, wR0, wKept;
  Pad pad;
  int sawWave;   // a real garbage slab has been queued: the phantom first wave is over
  int risen, riseDisp, riseHas;   // rows risen since the game began (IN_RISEN), counted every frame
  int pkR, pkC, pkAt, pkAll, presses;   // presses: every swap pressed, counted (IN_PRESSES)   // the swap walked to, and the clock its first plan pressed it at (pkAt 0: none)   // a walk: the frame its swap's panels settle (every panel's: wWaitAll), the frames it has taken
} Front;
#define MAXFRONTS 16
static Front FRONTS[MAXFRONTS];
static int nFronts;

// ---------------------------------------------------------------- the board, read
static JLOCAL Board *FB;   // per thread: a replay borrows it for the masks (lineStateRun)
static int fRows(void) { return FB->nrows; }
static const int32_t *fp(int r, int c) {
  static const int32_t empty[NF];
  return r >= 0 && r < FB->nrows ? FB->p[r][c].f : empty;
}
static int fState(const int32_t *f) { int s = f[STATE]; return s == DEAD ? NORMAL : s; }   // the view reads dead as normal
static int fFell(const int32_t *f) { return f[FELL] == NUL || f[FELL] < 0 ? 0 : f[FELL]; }
static int fInt(int32_t v) { return v == NUL ? 0 : v; }
// panel-cpu.js motionOf: a panel the snapshot carries the motion of.
static int fMoving(const int32_t *f) {
  return !(fState(f) == NORMAL && !(f[ISGARBAGE] && fInt(f[SHAKETIME])) && !f[STATECHANGED] && !f[PROPCHAIN] &&
           !SETB(f[QUEUEDHOVER]) && !f[MATCHANYWAY] && !fFell(f) && !SETB(f[CHAINING]));
}
// A BREAK'S CELL IS THE PANEL IT TURNS INTO once the game shows it, and not
// before: the engine colours the slab's bottom row as it matches (pa.c
// convertGarbagePanels), the client shows each cell's panel one at a time --
// past the flash, at its own pop (PanelCellRender.lua: initial_time - timer
// >= FLASH, timer <= pop_time). Shown, it pops, hovers and falls as that panel.
static int fConv(const int32_t *f) {
  if (!f[ISGARBAGE] || !(f[COLOR] > 0) || f[COLOR] == 9 || fInt(f[YOFF]) != -1) return 0;
  int s = fState(f);
  if (s == POPPING || s == POPPED) return 1;
  return s == MATCHED && fInt(f[INITIALTIME]) - fInt(f[TIMER]) >= FB->fFLASH && fInt(f[TIMER]) <= fInt(f[POPTIME]);
}
// The snapshot's grid value: -2 garbage, 0 empty or leaving, -1 dimmed, else the colour.
static int fGrid(const int32_t *f) {
  if (fConv(f)) return f[COLOR];
  if (f[ISGARBAGE]) return -2;
  if (f[COLOR] == 0) return 0;
  int s = fState(f);
  if (s == MATCHED || s == POPPING || s == POPPED) return 0;
  if (s == DIMMED) return -1;
  return f[COLOR];
}
static int fTopRow(void) {
  int top = FB->height;
  for (int r = FB->nrows - 1; r > FB->height; r--)
    for (int c = 1; c <= W; c++) if (fp(r, c)[COLOR] != 0) return r;
  return top;
}

// bitmatch.js maskState, on the grid shifted up `rise` rows (0 or 1; the
// risen board's row 1 is the incoming row). Writes the native layout
// (bitnative.js putAt).
static void fMasks(int32_t *m, int rise) {
  int H = FB->height, top = fTopRow(), r, c;
  memset(m, 0, ST_INTS * 4);
  m[O_W] = W; m[O_H] = H; m[O_BUSYF] = 1;
  // what was at row r is at r + rise; row 1 of a risen board is the incoming row, without motion
#define AT(r) ((r) - rise)
  for (r = 1; r <= H; r++) {
    for (c = 1; c <= W; c++) {
      uint32_t b = 1u << (r - 1);
      int moving = 0, st = NORMAL, dont = 0, garb = 0;
      if (AT(r) >= 1 || !rise) {
        const int32_t *f = fp(AT(r), c);
        moving = fMoving(f); st = fState(f); dont = SETB(f[DONTSWAP]); garb = f[ISGARBAGE];
      }
      int allows = !moving || (!dont && !garb && (st == NORMAL || st == SWAPPING || st == LANDING || st == FALLING));
      if (!allows) m[BUSY + c] |= (int32_t)b;
      else if (r < H && AT(r + 1) >= 1) {
        const int32_t *u = fp(AT(r + 1), c);
        if (fMoving(u) && fState(u) == HOVERING) m[BUSY + c] |= (int32_t)b;
      }
    }
  }
  for (r = 1; r <= H; r++) {
    for (c = 1; c <= W; c++) {
      int v;
      if (rise && r == 1) { const int32_t *f = fp(0, c); v = !f[ISGARBAGE] && f[COLOR] ? f[COLOR] : -1; }
      else v = fGrid(fp(AT(r), c));
      uint32_t b = 1u << (r - 1);
      if (v == 0) continue;
      m[OCC + c] |= (int32_t)b;
      if (v == -2) { m[INERT + c] |= (int32_t)b; m[GARB + c] |= (int32_t)b; continue; }
      // dimmed: no masks for it
      if (v < 0) { m[O_BAD] = 1; return; }
      // A COLOUR NOT YET DEALT (pa.c UNSEEN_COLOUR: a break's cells, a row past
      // the feed) is still a panel: it fills its cell, falls and swaps, and
      // matches nothing -- occupied, in no colour's mask
      if (v >= NCOL) continue;
      if (v > m[O_N]) m[O_N] = v;
      m[SCOL + v * WMAX + c] |= (int32_t)b;
    }
  }
  // the slabs, in the order their first cell is met (row 0 up, column by column)
  int32_t ids[MAXSLAB]; int n = 0;
  for (r = 0; r <= top; r++) {
    for (c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      if (!f[ISGARBAGE] || fConv(f)) continue;
      int nr = r + rise;
      if (rise && nr > H) continue;   // pushed past the ceiling, it leaves with its panels
      int i;
      for (i = 0; i < n && ids[i] != f[GARBAGEID]; i++) {}
      if (i == n) {
        if (n == MAXSLAB) { m[O_BAD] = 1; return; }
        ids[n++] = f[GARBAGEID];
      }
      m[SM(i, c)] |= (int32_t)(1u << ((nr - 1) & 31));
      if (fMoving(f)) {
        int s = fState(f);
        if ((s != NORMAL && s != FALLING) || f[COLOR] != 9) m[SLK(i)] = 1;
        if (s == FALLING) m[SAIR(i)] = 2;
      }
    }
  }
  m[O_NSLAB] = n;
#undef AT
}

// bitlineup.js timedOf: the board as masks, with the panels popping put back,
// and when each pops.
static int fTimed(int32_t *m, Timed *t) {
  fMasks(m, 0);
  if (m[O_BAD]) return 0;
  int H = FB->height, r, c, hover = -1;
  memset(t, 0, sizeof *t);
  t->HOVER = FB->fHOVER; t->FLASH = FB->fFLASH; t->FACE = FB->fFACE; t->POP = FB->fPOP;
  for (r = 1; r <= H; r++) {
    for (c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      uint32_t b = 1u << (r - 1);
      if (SETB(f[CHAINING])) t->chaining[c] |= b;
      if (!fMoving(f)) continue;
      int s = fState(f);
      if (s == HOVERING) { t->hovering[c] |= b; if (hover < 0 || fInt(f[TIMER]) < hover) hover = fInt(f[TIMER]); }
      if (!f[ISGARBAGE] && (s == MATCHED || s == POPPING || s == POPPED)) {
        int size = fInt(f[COMBOSIZE]), idx = fInt(f[COMBOINDEX]), tm = fInt(f[TIMER]);
        int at = s == MATCHED ? tm + size * t->POP : s == POPPING ? tm + (size - idx) * t->POP : tm;
        t->popping[c] |= b;
        m[OCC + c] |= (int32_t)b;
        if (f[COLOR] > 0 && f[COLOR] < NCOL) { m[SCOL + f[COLOR] * WMAX + c] |= (int32_t)b; if (f[COLOR] > m[O_N]) m[O_N] = f[COLOR]; }
        if (at > t->popAt) t->popAt = at;
      }
    }
  }
  t->hover = hover > 0 ? hover : 0;
  return 1;
}

// ---------------------------------------------------------------- what the bot asks of the stack (bitbot.js)
static int fBusyPanel(const int32_t *f) {
  int s = fState(f);
  return f[ISGARBAGE] ? s != NORMAL : (s != NORMAL && s != LANDING);
}
static int fAir(int *active) {
  int air = 0;
  *active = FB->nActive > 0 || FB->nPrevActive > 0;
  for (int r = 1; r <= FB->height; r++)
    for (int c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      if (f[COLOR] == 0 || !fBusyPanel(f)) continue;
      *active = 1;
      if (fInt(f[TIMER]) > air) air = fInt(f[TIMER]);
    }
  return air;
}
static int imaxf(int a, int b) { return a > b ? a : b; }
static int lockLeft(void) {
  int active, air = fAir(&active), k = FB->shakeTime;
  return active ? imaxf(k, 1 + imaxf(1, air)) : k;
}
static int drainBound(void) {
  int k = FB->stopTime > 0 ? FB->preStopTime + FB->stopTime : 1;
  k = imaxf(k, FB->shakeTime);
  int active, air = fAir(&active);
  if (active) k = imaxf(k, 1 + imaxf(1, air));
  return k;
}
static int toppedNow(void) { return nb_topped(FB); }
// the tallest column's top row on the board as it is (0: empty)
static int fTallest(void) {
  for (int r = FB->height; r >= 1; r--)
    for (int c = 1; c <= W; c++) if (fp(r, c)[COLOR] != 0) return r;
  return 0;
}
// bot.c raiseRoom on the board as it is this frame: every queued garbage row
static int raiseRoomNow(void) {
  int rows = FB->ninc ? FB->inc[FB->ninc - 1].height : 0;   // the next slab (bot.c raiseRoom)
  return raiseRoom(fTallest(), rows, FB->manualRaise || FB->preventManualRaise);
}
static int canRaise(Front *F) {
  if (!F->allowRaise || F->raiseHeld) return 0;
  if (FB->preventManualRaise || FB->manualRaise) return 0;
  if (toppedNow() || nb_falling_garbage(FB) || FB->riseLock || nb_active(FB) || FB->shakeTime > 0) return 0;
  return 1;
}
static int windowOpen(void) {
  int flying = 0, converted = 0;
  for (int r = 1; r <= FB->height; r++)
    for (int c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      if (fState(f) != NORMAL) flying++;
      if (fFell(f)) converted++;
      if (flying && converted) return 1;
    }
  return 0;
}
static int inFlight(void) { return nb_active(FB) || FB->shakeTime > 0; }
static int swapLanding(void) { return FB->queuedSwapRow > 0 || FB->swappingCount > 0; }
static u64 boardKey(void) {
  static const char LETTER[] = { 'n', 'd', 's', 'm', 'p', 'p', 'h', 'f', 'l', 'n' };
  u64 h = 1469598103934665603ull;
  int top = FB->height + 2;
  for (int r = 1; r <= top; r++)
    for (int c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      h = (h ^ (u64)(uint32_t)f[COLOR]) * 1099511628211ull;
      h = (h ^ (u64)(f[ISGARBAGE] ? 'g' : 0)) * 1099511628211ull;
      h = (h ^ (u64)LETTER[f[STATE] >= 0 && f[STATE] <= DEAD ? f[STATE] : 0]) * 1099511628211ull;
    }
  return (h ^ (u64)(FB->ninc ? 'q' : 0)) * 1099511628211ull;
}

// UNSETTLED PANELS, from the engine: a copy of the board runs on with nothing
// pressed (and nothing more dropped) until nothing moves, UNSETTLEMOST frames
// at most, and each cell's panel is watched frame to frame -- moved, landed,
// matched, popped, converted. settleAt[r][c]: the frame from which the cell
// stays as it is (0: it never changes). A row risen carries the cells up.
// out: the unsettled cells now, a bit per row, per column.
#define UNSETTLEMOST 180
static JLOCAL Board *USB;
static JLOCAL int32_t usPrev[32][W + 2][3];
static void unsettled(Board *b, uint32_t *out, Settle *S) {
  if (!USB) USB = nb_new();
  nb_copy(USB, b);
  USB->ninc = 0;   // what is on the board settling, not what is still to drop
  for (int c = 0; c < W + 2; c++) out[c] = 0;
  for (int r = 0; r < 32; r++) for (int c = 0; c < W + 2; c++) S->last[r][c] = S->first[r][c] = S->same[r][c] = S->garb[r][c] = 0;
  static JLOCAL int32_t usNow[32][W + 2][3];   // per thread: parallel judges each settle their own board
  int top = b->height < 31 ? b->height : 31;
  for (int r = 1; r <= top; r++)
    for (int c = 1; c <= W; c++) {
      const int32_t *x = b->p[r][c].f;
      usPrev[r][c][0] = x[COLOR]; usPrev[r][c][1] = x[ISGARBAGE]; usPrev[r][c][2] = x[STATE] == DEAD ? NORMAL : x[STATE];
      for (int i = 0; i < 3; i++) usNow[r][c][i] = usPrev[r][c][i];
    }
  int risen = 0, disp = USB->displacement;
  for (int k = 0; k < UNSETTLEMOST; k++) {
    USB->input = 0; USB->pressSwap = 0;
    nb_run(USB);
    if (USB->err || USB->gameOverClock > 0) break;
    if (USB->displacement > disp) risen++;
    disp = USB->displacement;
    int moving = USB->nActive > 0 || USB->nPrevActive > 0 || USB->shakeTime > 0 || nb_falling_garbage(USB);
    for (int r = 1; r <= top; r++)
      for (int c = 1; c <= W; c++) {
        int y[3] = { 0, 0, NORMAL };
        if (r + risen < USB->nrows) {
          const int32_t *p = USB->p[r + risen][c].f;
          y[0] = p[COLOR]; y[1] = p[ISGARBAGE]; y[2] = p[STATE] == DEAD ? NORMAL : p[STATE];
        }
        if (y[0] != usPrev[r][c][0] || y[1] != usPrev[r][c][1] || y[2] != usPrev[r][c][2]) {
          S->last[r][c] = (uint8_t)(k + 1 < 255 ? k + 1 : 255);
          if (!S->first[r][c]) S->first[r][c] = S->last[r][c];
          usPrev[r][c][0] = y[0]; usPrev[r][c][1] = y[1]; usPrev[r][c][2] = y[2];
        }
      }
    if (!moving) break;
  }
  for (int r = 1; r <= top; r++) for (int c = 1; c <= W; c++) {
    if (S->last[r][c]) out[c] |= 1u << (r - 1);
    S->same[r][c] = usPrev[r][c][0] == usNow[r][c][0] && usPrev[r][c][1] == usNow[r][c][1] && usPrev[r][c][2] == usNow[r][c][2];
    S->garb[r][c] = usPrev[r][c][1] != 0;
  }
}
static int pairWait(const Settle *S, int r, int c);
// A BREAK'S PRESS WAITS FOR WHAT IT BREAKS, not for the board: its own pair
// settled and every garbage cell at rest (garbage is breakable the frame it
// lands). A clear elsewhere still running is no reason to wait -- on a quiet
// board the next slab drops meanwhile.
static int breakWait(const Settle *S, int r, int c) {
  int m = pairWait(S, r, c);
  for (int rr = 1; rr < 32; rr++) for (int cc = 1; cc <= W; cc++) if (S->garb[rr][cc] && S->last[rr][cc] > m) m = S->last[rr][cc];
  return m;
}
// A PAIR STILL NOW IS PRESSED NOW: both its cells hold what they settle to,
// and nothing reaches either before the swap (SWAPSPAN frames from `f`) is
// done. Panels that pass through it later are not panels moving under it.
#define SWAPSPAN 5
static int pairFree(const Settle *S, int r, int c, int f) {
  if (r < 1 || r > 31) return 0;
  for (int k = c; k <= c + 1; k++)
    if (!S->same[r][k] || (S->first[r][k] && f + SWAPSPAN >= S->first[r][k])) return 0;
  return 1;
}
// The frame from which a pair is settled (both its cells).
static int pairWait(const Settle *S, int r, int c) {
  if (r < 1 || r > 31) return 0;
  return S->last[r][c] > S->last[r][c + 1] ? S->last[r][c] : S->last[r][c + 1];
}

// ---------------------------------------------------------------- one decision (bitbot.js info, _prepare, decide)
static void fPrepare(Front *F) {
  double *d = BIN;
  int r, c, i;
  for (i = 0; i < IN_SIZE; i++) d[i] = 0;
  // info
  int cells = 0, rows = 0;
  for (i = 0; i < FB->ninc; i++) { cells += FB->inc[i].width * FB->inc[i].height; rows += FB->inc[i].height; }
  const Incoming *next = FB->ninc ? &FB->inc[FB->ninc - 1] : 0;
  int topped = toppedNow();
  double perPixel = nb_rise_time(FB->speed);
  d[IN_TOPPED] = topped || FB->wasToppedOut;
  d[IN_STOP] = FB->stopTime;
  d[IN_INCOMING] = cells;
  d[IN_NEXTSLAB] = next ? next->width * next->height : 0;
  d[IN_HELD] = F->held;
  d[IN_SLABW] = next ? next->width : 0; d[IN_SLABH] = next ? next->height : 0;
  d[IN_SLABC] = next ? nb_spawn_col(FB, next->width) : 0;
  d[IN_INROWS] = rows;
  d[IN_FALLING] = nb_falling_garbage(FB);
  d[IN_CROW] = FB->curRow; d[IN_CCOL] = FB->curCol;
  d[IN_HEALTH] = FB->health;
  // topped, the drain is the engine's: a copy of the board left alone
  int drain = topped || FB->wasToppedOut ? nb_drain_in(FB, 600) : drainBound();
  d[IN_DRAIN] = drain;
  d[IN_FPR] = perPixel * 16;
  d[IN_FTNR] = FB->riseTimer + imaxf(0, FB->displacement - 1) * perPixel;
  d[IN_SPEED] = FB->speed; d[IN_NEXTUP] = FB->nextSpeedIncreaseClock;
  d[IN_STARTSPEED] = FB->startingSpeed; d[IN_CLOCK] = FB->clock; d[IN_STACKCLOCK] = FB->clock;
  // the board, as masks
  fMasks(IN, 0);
  int hasRisen = canRaise(F);
  if (hasRisen) fMasks(RISEN, 1);
  int moving = 0, flying = 0, converted = 0;
  for (r = 1; r <= FB->height; r++)
    for (c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      if (!fMoving(f)) continue;
      if (fState(f) != NORMAL) { moving = 1; flying++; }
      if (fFell(f)) converted++;
    }
  // a slab breaking: the cells of its bottom row the game has shown (fConv)
  int nconv = 0, convTimer = -1, top = fTopRow();
  for (r = 1; r <= top; r++)
    for (c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      if (!fMoving(f) || !fConv(f)) continue;
      if (nconv < 80) { d[IN_CONV + 3 * nconv] = r; d[IN_CONV + 3 * nconv + 1] = c; d[IN_CONV + 3 * nconv + 2] = f[COLOR]; nconv++; }
      if (convTimer < 0 || fInt(f[TIMER]) < convTimer) convTimer = fInt(f[TIMER]);
    }
  int open = F->reveal && !nconv && flying > 0 && converted > 0;
  int conv = F->reveal && nconv;
  int timed = (moving || open) && fTimed(TMST, &TM);
  d[IN_HASRISEN] = hasRisen;
  F->raiseLives = F->allowRaise && !topped;   // topped, never (bot.c raiseSafe)
  d[IN_RAISING] = FB->manualRaise || FB->preventManualRaise;   // a row still coming up
  d[IN_INFLIGHT] = inFlight();
  d[IN_DRAINBOUND] = d[IN_TOPPED] ? drain : 0;
  d[IN_LOCKLEFT] = lockLeft();
  d[IN_STACKTOPPED] = topped;
  d[IN_MOVING] = moving;
  nb_copy(paLibBoard(), FB); d[IN_HASPA] = 1;   // the engine holds the board the bot decides on
  // THE BOT KNOWS WHAT THE GAME SHOWS: no row dealt past the one coming up,
  // no break's colours before its cells pop into view (fConv) -- a harness
  // that deals them to its own engine (the drill, train.lua) deals them to
  // the game, not to the bot. A cell not yet shown is a panel of a colour not
  // dealt (pa.c UNSEEN_COLOUR): it fills its cell and matches nothing.
  { Board *pb = paLibBoard();
    pb->nRowFeed = 0; pb->nBrkFeed = 0;
    for (r = 1; r < pb->nrows; r++)
      for (c = 1; c <= W; c++) {
        int32_t *f = pb->p[r][c].f;
        if (f[ISGARBAGE] && f[COLOR] > 0 && f[COLOR] != 9 && f[COLOR] < 130 && !fConv(f)) f[COLOR] = 130 + (W * r + c - 1) % 90;
      } }
  // THE FIRST WAVE BEFORE IT IS SEEN: until a real slab is queued, the board
  // the bot decides on holds one queued slab the width of the board, so every
  // readiness rule and replay readies the first wave as it readies every
  // other. Only the bot's copy holds it; IN_PHANTOM says how much of the
  // incoming is phantom, so what the raise reads is the real queue.
  if (FB->ninc > 0 || FB->garbageCreatedCount > 0) F->sawWave = 1;
  if (!F->sawWave) {
    Board *pb = paLibBoard();
    Incoming *p = &pb->inc[0];
    p->width = W; p->height = 1; p->isChain = 0; p->isMetal = 0; p->frameEarned = FB->clock; p->finalized = 1;
    pb->ninc = 1;
    d[IN_PHANTOM] = W;
    d[IN_INCOMING] = W; d[IN_NEXTSLAB] = W; d[IN_INROWS] = 1;
    d[IN_SLABW] = W; d[IN_SLABH] = 1; d[IN_SLABC] = nb_spawn_col(pb, W);
  }
  d[IN_HASTIMED] = timed;
  d[IN_REVEALOPEN] = open;
  if (conv) { d[IN_CONVN] = nconv; d[IN_CONVTIMER] = convTimer; }
  else for (i = 0; i < 3 * nconv; i++) d[IN_CONV + i] = 0;
  d[IN_BCROW] = FB->curRow; d[IN_BCCOL] = FB->curCol;
  if (conv || open) {
    int nl = 0;
    for (r = 1; r <= FB->height; r++)
      for (c = 1; c < W; c++) {
        int a = fConv(fp(r, c)) ? -2 : fGrid(fp(r, c)), b = fConv(fp(r, c + 1)) ? -2 : fGrid(fp(r, c + 1));
        if (a < 0 || b < 0 || (a == 0 && b == 0) || a == b) continue;
        d[IN_LEGAL + 2 * nl] = r; d[IN_LEGAL + 2 * nl + 1] = c; nl++;
      }
    d[IN_NLEGAL] = nl;
  }
  d[IN_HASINROW] = 1;
  for (c = 1; c <= W; c++) { const int32_t *f = fp(0, c); d[IN_INROW + c] = !f[ISGARBAGE] && f[COLOR] ? f[COLOR] : -1; }
  if (F->hasLast) { d[IN_HASLAST] = 1; d[IN_LASTR] = F->lastR; d[IN_LASTC] = F->lastC; }
  d[IN_PRESSES] = F->presses;
  d[IN_RISEN] = F->risen;
  for (c = 1; c <= W; c++) {
    int settling = 0, popLow = 0;
    for (r = 1; r < fRows(); r++) {
      const int32_t *f = fp(r, c);
      if (f[COLOR] == 0 || f[ISGARBAGE]) continue;
      int s = fState(f);
      if (s == HOVERING || s == FALLING || s == SWAPPING) settling = 1;
      if (!popLow && (s == MATCHED || s == POPPING || s == POPPED)) popLow = r;
    }
    d[IN_SETTLING + c] = settling;
    d[IN_POPLOW + c] = popLow;
  }
  d[IN_SF] = FB->fHOVER; d[IN_SF + 1] = FB->fFLASH; d[IN_SF + 2] = FB->fFACE; d[IN_SF + 3] = FB->fPOP;
  d[IN_SF + 4] = next ? nb_shake_frames(next->width * next->height) : 0;   // the next slab's landing shake
  // the pairs the bot may target: the engine would swap them now, and
  // neither panel is unsettled -- a bit per row, for columns 1..5
  uint32_t still[W + 2];
  unsettled(FB, still, &F->settle);
  for (c = 1; c < W; c++) {
    uint32_t m = 0;
    for (r = 1; r <= FB->height && r <= 31; r++)
      if (!((still[c] | still[c + 1]) & (1u << (r - 1))) && nb_can_swap(FB, r, c)) m |= 1u << (r - 1);
    d[IN_CANSWAP + c] = m;
  }
}

static void fTable(Front *F, double *tab) {
  int i;
  for (i = 0; i < T_SIZE; i++) tab[i] = 0;
  for (i = 0; i < 99; i++) tab[T_RISE + i] = nb_rise_time(i + 1);
  for (i = 0; i < 100; i++) tab[T_COMBO + i] = comboCells(i);
  tab[T_STOP] = FB->sComboConstant; tab[T_STOP + 1] = FB->sChainConstant; tab[T_STOP + 2] = FB->sDangerConstant;
  tab[T_STOP + 3] = FB->sCoefficient; tab[T_STOP + 4] = FB->sDangerCoefficient;
  tab[T_LF] = FB->fFLASH; tab[T_LF + 1] = FB->fFACE; tab[T_LF + 2] = FB->fPOP;
  for (i = 0; i < (int)(sizeof STARTER_W / sizeof STARTER_W[0]); i++) tab[T_W + i] = STARTER_W[i];
  double *o = tab + T_OPT;
  o[O_REACTION] = F->reaction; o[O_REVEAL] = F->reveal; o[O_ALLOWRAISE] = F->allowRaise;
  o[O_REFRETURN] = 1; o[O_REFPAYLESS] = 1; o[O_BEAM] = 8; o[O_MAXDEPTH] = 20; o[O_HORIZON] = 1;
  o[O_PRESS] = 1;   // a press is seen the frame after it is made
}

// ---------------------------------------------------------------- the keys (bitbot.js update, panel-cpu.js walk)
// the game's allowance; GC_INPUT_LIMIT (native, a diagnostic) sets another, to see what the input budget costs
static int actionLimit(void) {
#ifndef __wasm__
  static int lim = -1;
  if (lim < 0) { const char *e = getenv("GC_INPUT_LIMIT"); lim = e && *e ? atoi(e) : ACTIONLIMIT; if (lim < ACTIONRESERVE + 1 || lim > ACTIONRING) lim = ACTIONLIMIT; }
  return lim;
#else
  return ACTIONLIMIT;
#endif
}
static int padCount(Pad *p, int clock) {
  while (p->actN > 0 && clock - p->actAt[p->actOld] >= ACTIONWINDOW) { p->actOld = (p->actOld + 1) % ACTIONRING; p->actN--; }
  return p->actN;
}
static int padAllowed(Pad *p, int clock) { return padCount(p, clock) < (p->limit ? p->limit : ACTIONLIMIT); }
static void padSpend(Pad *p, int clock) {
  if (padCount(p, clock) >= ACTIONRING) return;
  p->actAt[(p->actOld + p->actN) % ACTIONRING] = clock; p->actN++;
}
// THE KEYS OF ONE FRAME: a direction held over two frames is let go (the walk
// taps), except a held walk; a direction that goes down, or a swap, is an action
static int padSend(Pad *p, int input, int *held, int clock) {
  int dir = input & IN_UP ? H_UP : input & IN_DOWN ? H_DOWN : input & IN_LEFT ? H_LEFT : input & IN_RIGHT ? H_RIGHT : H_NONE;
  if (dir && dir == *held && !p->holdKey) {
    input &= ~(IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT);
    dir = H_NONE;
  }
  if (dir && dir != *held) padSpend(p, clock);
  *held = dir;
  return input;
}
static int fSend(Front *F, int input, int held) {
  int had = input & (IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT), h = held;
  input = padSend(&F->pad, input, &h, FB->clock);
  F->held = h;
  if (had && !(input & (IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT))) {
    if (F->walk) F->wTimer = 0;
    if (F->park) F->pTimer = 0;
  }
  return input;
}
// THE NEXT KEY OF A WALK to (row, col) from the cursor of board `bd`, if the
// input budget allows one; a long walk starts a held key
static int padStepToward(Pad *p, const Board *bd, int *timer, int row, int col, int input, int canHold) {
  if (!padAllowed(p, bd->clock)) return input;
  int key, dist;
  if (bd->curCol < col) { key = IN_RIGHT; dist = col - bd->curCol; }
  else if (bd->curCol > col) { key = IN_LEFT; dist = bd->curCol - col; }
  else if (bd->curRow < row) { key = IN_UP; dist = row - bd->curRow; }
  else { key = IN_DOWN; dist = bd->curRow - row; }
  *timer = MOVE_FRAMES - 1;
  // a window nearly spent holds a walk of two cells too: a few frames slower than taps, against a press waiting for the allowance
  int minLeg = padCount(p, bd->clock) + HOLDTIGHT >= (p->limit ? p->limit : ACTIONLIMIT) ? 2 : HOLDLEG;
  if (canHold && dist >= minLeg) p->holdKey = key;
  return input | key;
}
// the held key goes on while the cursor is short of the cell on that axis
static int padHoldGoing(Pad *p, const Board *bd, int row, int col) {
  int k = p->holdKey;
  if (!k) return 0;
  int short_ = k == IN_RIGHT ? bd->curCol < col : k == IN_LEFT ? bd->curCol > col : k == IN_UP ? bd->curRow < row : bd->curRow > row;
  if (!short_) p->holdKey = 0;
  return short_;
}
static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }
// A SWAP IS PRESSED WHEN ITS FIRST PLAN PRESSED IT. The settle is taken on
// the board of the moment, so a plan made a frame later waits for a different
// frame; the front, topped, plans every frame. The swap it walks to keeps the
// clock the first plan gave it, in play and in every replay, until it is
// pressed or another is chosen.
// A KEPT FRAME IS KEPT FOR THE SAME WAIT: a frame fixed waiting for the garbage
// to land (waitAll) is not the frame of a press that waits only for its pair,
// nor the other way -- the judge and the walk read it alike (pkAll)
static int pressWait(Front *F, int r, int c, int clock, int wait, int waitAll) {
  if (F->pkAt && F->pkR == r && F->pkC == c && F->pkAll == waitAll) return F->pkAt > clock ? F->pkAt - clock : 0;
  return wait;
}
static void beginWalk(Front *F, int r, int c, int cooldown, int waitAll) {
  F->pad.holdKey = 0; F->walk = 1; F->wRow = r; F->wCol = c; F->wTimer = 0; F->wCooldown = cooldown; F->wRetries = 0; F->wHasDisp = 0;
  int wait = waitAll ? breakWait(&F->settle, r, c) : pairWait(&F->settle, r, c);
  F->wKept = F->pkAt && F->pkR == r && F->pkC == c && F->pkAll == waitAll;
  if (!F->wKept) { F->pkR = r; F->pkC = c; F->pkAt = FB->clock + wait; F->pkAll = waitAll; }
  F->wWaitTo = pressWait(F, r, c, FB->clock, wait, waitAll); F->wFrames = 0; F->wWaitAll = waitAll; F->wR0 = r;
}
static int driveWalk(Front *F, int input) {
  F->wFrames++;
  if (F->wHasDisp && FB->displacement > F->wDisp) F->wRow++;
  F->wDisp = FB->displacement; F->wHasDisp = 1;
  // a target risen past the rows the cursor reaches is no pair to press: the bot decides again
  if (F->wRow > FB->topCurRow) { F->walk = 0; F->pad.holdKey = 0; F->cooldown = 0; return input; }
  int row = clampi(F->wRow, 1, FB->topCurRow), col = clampi(F->wCol, 1, W - 1);
  if (FB->curRow != row || FB->curCol != col) {
    if (padHoldGoing(&F->pad, FB, row, col)) return input | F->pad.holdKey;
    if (F->wTimer > 0) { F->wTimer--; return input; }
    return padStepToward(&F->pad, FB, &F->wTimer, row, col, input, 1);
  }
  F->pad.holdKey = 0;
  // the swap's panels settle at a known frame: a walk that arrives first waits
  // a pair still now is pressed now, unless a plan has already fixed its frame
#ifndef __wasm__
  { extern int botTraceOn; if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "WALK front %d clock %d at %d,%d (target %d,%d cursor %d,%d top %d) frames %d waitTo %d pkAt %d kept %d waitAll %d free %d can %d topped %d\n", F->id, FB->clock, row, col, F->wRow, F->wCol, FB->curRow, FB->curCol, FB->topCurRow, F->wFrames, F->wWaitTo, F->pkAt, F->wKept, F->wWaitAll, pairFree(&F->settle, F->wR0, col, F->wFrames), nb_can_swap(FB, FB->curRow, FB->curCol), toppedNow()); } }
#endif
  if (F->wFrames < F->wWaitTo && (F->wWaitAll || F->wKept || !pairFree(&F->settle, F->wR0, col, F->wFrames))) {
    // a wait is not a plan: topped, or a reaction's worth of waiting, decide again
    if (!toppedNow() && F->wFrames % (F->reaction > 0 ? F->reaction : 12) != 0) return input;
    F->walk = 0; F->cooldown = 0;
    return input;
  }
  if (!padAllowed(&F->pad, FB->clock)) return input;   // the swap waits for the budget's next action
  int ok = nb_can_swap(FB, FB->curRow, FB->curCol) && nb_try_queue_swap(FB, FB->curRow, FB->curCol);
  F->walk = 0;
  if (ok) {
    padSpend(&F->pad, FB->clock);
#ifndef __wasm__
    { extern int botTraceOn; if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "PRESS clock %d at %d,%d\n", FB->clock, FB->curRow, FB->curCol); } }
#endif
    F->hasLast = 1; F->lastR = FB->curRow; F->lastC = FB->curCol; F->cooldown = F->wCooldown; F->pkAt = 0; F->presses++; return input; }
  // REFUSED, THE BOT DECIDES AGAIN. The swap was the one chosen; another
  // cell walked to instead is a choice nothing judged.
  F->cooldown = 0;
  return input;
}
static int parkStep(Front *F, int input) {
  if (FB->displacement > F->pDisp) F->pRow++;
  F->pDisp = FB->displacement;
  int row = clampi(F->pRow, 1, FB->topCurRow), col = clampi(F->pCol, 1, W - 1);
  if (FB->curRow == row && FB->curCol == col) return input;
  if (F->pTimer > 0) { F->pTimer--; return input; }
  return padStepToward(&F->pad, FB, &F->pTimer, row, col, input, 0);
}
#define DIRS (IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT)

// A LINE PLAYED ON THE ENGINE, as this front plays it: from the board the bot
// is deciding on (paLibBoard), the cursor walks to each step as driveWalk
// walks -- a tap, then MOVE_FRAMES apart, a key held over two frames let go --
// the swap is pressed on arrival, and the next step is walked to when the
// front would decide again: the swap landed, and the cooldown over or lifted
// (stop, or topped). The board then runs on, nothing pressed, to `horizon`.
// out: [0] the frame the board first lost health (0: not within horizon),
// [1] the frame of the last press (-1: a step the engine refused), [2] garbage
// cells converted, [3] panels matched, [4] frames from the last press to the
// drain (horizon when none).
static JLOCAL Board *LNB;
static Front *LF;
// what the decision may spend of the allowance: all of it when the board left alone loses health
static void frontUrgent(int urgent) { if (LF) LF->pad.limit = urgent ? actionLimit() : actionLimit() - ACTIONRESERVE; }
static JLOCAL Settle LSET;
static JLOCAL int LWAITALL;   // the line's last press waits for its pair and the garbage to settle (breakWait)
// A LINE'S PREFIX, KEPT WHERE ITS NEXT STEP BEGINS. A line played to the
// frame its next step would start (stopAtNext 1) leaves the engine exactly
// where every longer line with that prefix stands then: the board, the frame,
// the cooldown before that frame's tick, the key held, the last press and the
// garbage dropped. A longer line resumes there. Wait-all touches only a line's
// last step, so no prefix carries it. Written by the main thread; a worker's
// replay is kept in the slot the main thread gave its job.
#define SNAPN 256
typedef struct { int dec, n, f, cool, held, last, dropped, hasSettle; Pad pad; int32_t sw[2 * LINEMAX]; Board *b; Settle settle; } Snap;
// and the settle the next step starts from, the one the prefix's replay takes of the same board last
static Snap SNAPS[SNAPN];
static JLOCAL int snapTo = -1;   // the slot this thread's next prefix is kept in (-1: by its line)
static JLOCAL Snap *snapLast;    // the prefix this thread kept last, for its settle
static unsigned snapHash(const int32_t *sw, int n) {
  unsigned h = 2166136261u ^ (unsigned)n;
  for (int k = 0; k < 2 * n; k++) h = (h ^ (unsigned)sw[k]) * 16777619u;
  return h & (SNAPN - 1);
}
static Snap *snapFind(const int32_t *sw, int n) {
  Snap *s = &SNAPS[snapHash(sw, n)];
  return s->dec == btDecision && s->n == n && s->b && !__builtin_memcmp(s->sw, sw, (unsigned long)n * 8) ? s : 0;
}
static void snapKeep(const int32_t *sw, int n, Board *b, int f, int cool, int held, int last, int dropped, const Pad *pad) {
  if (n < 1 || n >= LINEMAX || LWAITALL) return;
  int slot = snapTo >= 0 ? snapTo : inWorker ? -1 : (int)snapHash(sw, n);
  if (slot < 0) return;
  Snap *s = &SNAPS[slot];
  if (!s->b) { if (inWorker) return; s->b = nb_new(); }
  nb_copy(s->b, b);
  s->n = n; s->f = f; s->cool = cool; s->held = held; s->last = last; s->dropped = dropped; s->pad = *pad; s->hasSettle = 0; snapLast = s;
  for (int k = 0; k < 2 * n; k++) s->sw[k] = sw[k];
  if (snapTo < 0) s->dec = btDecision;   // a worker's is stamped by the main thread
}
// how many slabs a landing replay waits for (lineLandedK): the queue drops
// slab after slab on a quiet board, each once the one before it has landed
static JLOCAL int landK = 1;
// THE HOLLOW A SLAB PERCHES OVER: the empty cells under every garbage cell
// that rests over nothing, down to what its column holds
static int standingHollow(const Board *b) {
  int h = 0;
  for (int r = 2; r < b->nrows; r++)
    for (int c = 1; c <= W; c++) {
      const int32_t *g = b->p[r][c].f, *u = b->p[r - 1][c].f;
      if (!g[ISGARBAGE] || u[COLOR] != 0) continue;
      for (int k = r - 1; k >= 1 && b->p[k][c].f[COLOR] == 0; k--) h++;
    }
  return h;
}
static int linePlay(const int32_t *steps, int n, int horizon, int stopAtNext, int32_t *out) {
  if (!LNB) LNB = nb_new();
  Snap *from = 0;
  for (int k = n - 1; k >= 1 && !from; k--) from = snapFind(steps, k);
  nb_copy(LNB, from ? from->b : paLibBoard());
  { extern PATLS double paWork; paWork += 10; }   // the copy
  Board *b = LNB;
  if (!from) b->sNCombo = b->sCleared = b->sBroke = b->sEarned = b->sFell = b->sHollow = 0;   // a prefix kept carries its counts
  int32_t h0 = paLibBoard()->health;
  int step = 0, walking = n > 0, timer = 0, held = LF ? LF->held : H_NONE, cool = 0, disp = b->displacement;
  int tr = n > 0 ? steps[0] : 0, tc = n > 0 ? steps[1] : 0, last = n > 0 ? -1 : 0, f, dropped = b->garbageCreatedCount, f0 = 0;
  Pad pad; if (from) pad = from->pad; else if (LF) pad = LF->pad; else __builtin_memset(&pad, 0, sizeof pad);
  pad.holdKey = 0;   // the line begins with the key let go
  if (from) { step = from->n; walking = 0; held = from->held; cool = from->cool; last = from->last; dropped = from->dropped; f0 = from->f; }
  int snapSettle = from && from->hasSettle;
  int kept0 = n > 0 && LF && LF->pkAt && LF->pkR == steps[0] && LF->pkC == steps[1] && LF->pkAll == (LWAITALL && n == 1);
  int fs = 0, r0 = tr;   // the frame the step's settle was taken, its row then
  int waitTo = n > 0 && LF ? pressWait(LF, steps[0], steps[1], paLibBoard()->clock, LWAITALL && n == 1 ? breakWait(&LF->settle, steps[0], steps[1]) : pairWait(&LF->settle, steps[0], steps[1]), LWAITALL && n == 1) : 0;
#ifndef __wasm__
  if (botTraceOn && n == 1 && waitTo > 60 && LF) { extern int fprintf(void *, const char *, ...); extern void *stderr; int r = steps[0], c = steps[1];
    fprintf(BLOG, "  WAIT %d,%d to %d | first %d,%d last %d,%d\n", r, c, waitTo, LF->settle.first[r][c], LF->settle.first[r][c + 1], LF->settle.last[r][c], LF->settle.last[r][c + 1]); }
#endif
  out[0] = 0; out[1] = -1; out[5] = out[6] = -1; out[7] = paLibBoard()->ninc; out[8] = -1; out[9] = out[10] = out[11] = out[12] = out[13] = out[14] = 0; out[15] = out[16] = -1;   // out[16]: the clock the first step is pressed at
  int32_t landedFrom = b->garbageCreatedCount;   // out[15]: read once the next slab has landed
  int pressStep = -1, pressLast = 0;   // the step pressed this frame, and the last press before it
  { extern int paBudgetOut(void); if (paBudgetOut() || workLeft() <= 0) return -1; }   // past the decision's budget, or this thread's share of it (workLeft): not played
  // A LINE IS JUDGED TO WHERE ITS CONSEQUENCE SHOWS: past the horizon the
  // judge plays on while the board is still busy -- a chain running, garbage
  // converting or falling, a landing shaking, a topped board held up by stop
  // time (it loses health the frame the stop ends; pa.c drops nothing on a
  // topped board, so nothing else moves) -- for as long as a board settles
  // (UNSETTLEMOST), so a break whose chain and conversion run past the horizon
  // is seen to the quiet board the queue drops on
  for (f = f0; f < horizon || (stopAtNext == 0 && f < horizon + UNSETTLEMOST && (b->nActive > 0 || nb_falling_garbage(b) || b->shakeTime > 0 || (b->stopTime > 0 && nb_topped(b)))); f++) {
    { extern int paBudgetOut(void); if (paBudgetOut() || workLeft() <= 0) return -1; }   // past the budget, or this thread's share of it, mid-line: not played
    int input = 0;
    // stopAtNext 2: on until the next landK slabs have dropped and landed
    if (stopAtNext == 2 && step == n && !walking && b->garbageCreatedCount >= dropped + landK && !nb_falling_garbage(b)) {
      out[1] = last; out[8] = f; return 1;
    }
    if (!walking && (step < n || stopAtNext == 1)) {
      int coolIn = cool;
      if (cool > 0) cool--;
      int landing = b->queuedSwapRow > 0 || b->swappingCount > 0 || b->pressSwap;
      if (!landing && (cool == 0 || b->stopTime > 0 || nb_topped(b))) {
        if (step == n) {   // the front decides again here
          if (stopAtNext == 1) snapKeep(steps, n, b, f, coolIn, held, last, dropped, &pad);
          out[1] = last; out[8] = f; return 1;
        }
        walking = 1; tr = steps[2 * step]; tc = steps[2 * step + 1]; timer = 0; disp = b->displacement;
        { uint32_t still[W + 2];
          if (snapSettle && step == from->n) { LSET = from->settle; snapSettle = 0; } else unsettled(b, still, &LSET);
          waitTo = f + (LWAITALL && step == n - 1 ? breakWait(&LSET, tr, tc) : pairWait(&LSET, tr, tc)); fs = f; r0 = tr; }
      }
    }
    if (walking) {
      if (b->displacement > disp) tr++;
      disp = b->displacement;
      int row = clampi(tr, 1, b->topCurRow), col = clampi(tc, 1, W - 1);
      if (b->curRow == row && b->curCol == col) {
        pad.holdKey = 0;
        if (f < waitTo && ((LWAITALL && step == n - 1) || (step == 0 && kept0) || !pairFree(step == 0 ? &LF->settle : &LSET, r0, col, f - fs))) { /* its panels settle at waitTo: never pressed on panels still moving */ }
        else if (!padAllowed(&pad, b->clock)) { /* the input budget's next action */ }
        else if (!nb_can_swap(b, row, col) || !nb_try_queue_swap(b, row, col)) {
#ifndef __wasm__
          if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr;
            Panel *p1 = &b->p[row][col], *p2 = &b->p[row][col + 1], *a1 = &b->p[row + 1][col], *a2 = &b->p[row + 1][col + 1];
            fprintf(BLOG, "REFUSE step %d f %d at %d,%d cur %d,%d clock %d | p1 c%d s%d ds%d g%d p2 c%d s%d ds%d g%d above s%d s%d canNow(fresh) %d\n", step, f, row, col,
                    b->curRow, b->curCol, b->clock, p1->f[COLOR], p1->f[STATE], p1->f[DONTSWAP], p1->f[ISGARBAGE], p2->f[COLOR], p2->f[STATE], p2->f[DONTSWAP], p2->f[ISGARBAGE],
                    a1->f[STATE], a2->f[STATE], nb_can_swap(paLibBoard(), row, col)); }
#endif
          out[1] = -1; out[5] = step; out[6] = f; out[7] = b->ninc; return -1;
        }
        else { padSpend(&pad, b->clock); pressStep = step; pressLast = last; if (step == 0) out[16] = b->clock; last = f; step++; walking = 0; cool = LF ? LF->reaction : 12; dropped = b->garbageCreatedCount; }
      } else if (padHoldGoing(&pad, b, row, col)) input = pad.holdKey;
      else if (timer > 0) timer--;
      else input = padStepToward(&pad, b, &timer, row, col, 0, 1);
    }
    { int had = input & (IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT);
      input = padSend(&pad, input, &held, b->clock);
      if (had && !input) timer = 0; }
    b->input = input;
    nb_run(b);
    if (b->err) return -1;
    // A PRESS THE ENGINE DENIES IS NO PRESS: the swap is checked after the
    // frame's physics, and a pair swappable before it may not be after (pa.c
    // swapDenied) -- the step is still to press, as on the real board
    if (pressStep >= 0) {
      if (b->swapDenied) { step = pressStep; last = pressLast; if (step == 0) out[16] = -1; cool = 0; }
      pressStep = -1;
    }
    if (b->health < h0 || b->gameOverClock > 0) { out[0] = f + 1; break; }
    if (out[15] < 0 && b->garbageCreatedCount > landedFrom && !nb_falling_garbage(b)) out[15] = standingHollow(b);
  }
  out[1] = step == n ? last : -1;
  out[2] = b->sBroke; out[3] = b->sCleared; out[9] = b->sFell; out[10] = b->sHollow;
  // and the gaps under garbage as it stands on the board the line ends on: a
  // pile propped above empty cells is hollow whether or not it just landed
  for (int r = 2; r < b->nrows; r++)
    for (int c = 1; c <= W; c++) {
      const int32_t *g = b->p[r][c].f, *u = b->p[r - 1][c].f;
      if (!g[ISGARBAGE] || u[COLOR] != 0) continue;
      for (int k = r - 1; k >= 1 && b->p[k][c].f[COLOR] == 0; k--) out[10]++;
    }
  // the board it ends on, as one number: a line that ends where the board left
  // alone ends has done nothing
  uint32_t fh = 2166136261u;
  for (int r = 0; r < b->nrows; r++)
    for (int c = 1; c <= W; c++) { fh = (fh ^ (uint32_t)(b->p[r][c].f[COLOR] * 2 + (b->p[r][c].f[ISGARBAGE] != 0))) * 16777619u; }
  out[11] = (int32_t)fh;
  // the material it ends with: panels, not garbage, not already matched to
  // go, and of a known colour -- a break's cells are unseen (130 and up, pa.c
  // convertGarbagePanels) until they show
  for (int r = 1; r < b->nrows; r++)
    for (int c = 1; c <= W; c++) {
      const int32_t *g = b->p[r][c].f;
      if (g[COLOR] && g[COLOR] < 130 && !g[ISGARBAGE] && g[STATE] != MATCHED && g[STATE] != POPPING && g[STATE] != POPPED) out[12]++;
    }
  // the hollow the slabs to come would leave on it: a slab four wide rests on
  // the tallest column under it, and the slabs come over every four columns in
  // turn -- each window's gap under its tallest column, summed
  { int h[WMAX + 2];
    for (int c = 1; c <= W; c++) {
      h[c] = 0;
      for (int r = b->nrows - 1; r >= 1 && !h[c]; r--) {
        const int32_t *g = b->p[r][c].f;
        if (g[COLOR] && g[STATE] != FALLING && g[STATE] != MATCHED && g[STATE] != POPPING && g[STATE] != POPPED) h[c] = r;
      }
    }
    for (int w = 1; w + 3 <= W; w++) {
      int top = 0;
      for (int c = w; c < w + 4; c++) if (h[c] > top) top = h[c];
      for (int c = w; c < w + 4; c++) out[13] += top - h[c];
    }
    // VERTICAL TWOS READY: two matching panels atop a column's panels --
    // under open sky, or under the column's lowest garbage -- with a third of
    // their colour in the row under them at most two columns off, the way
    // along that row clear of garbage: one or two swaps from three in a
    // column whose top touches whatever lands on it, or what already has
#define VPANEL(r, c) (b->p[r][c].f[COLOR] > 0 && b->p[r][c].f[COLOR] < 8 && !b->p[r][c].f[ISGARBAGE] && b->p[r][c].f[STATE] == NORMAL)
    for (int c = 1; c <= W; c++) {
      int r = h[c];
      for (int k = 1; k <= h[c]; k++) if (b->p[k][c].f[ISGARBAGE]) { r = k - 1; break; }
      if (r < 3 || !VPANEL(r, c) || !VPANEL(r - 1, c)) continue;
      int col = b->p[r][c].f[COLOR];
      if (b->p[r - 1][c].f[COLOR] != col || (VPANEL(r - 2, c) && b->p[r - 2][c].f[COLOR] == col)) continue;
      int ready = 0;
      for (int d = -1; d <= 1 && !ready; d += 2)
        for (int k = 1; k <= 2; k++) {
          int cc = c + d * k;
          if (cc < 1 || cc > W || b->p[r - 2][cc].f[ISGARBAGE]) break;
          if (VPANEL(r - 2, cc) && b->p[r - 2][cc].f[COLOR] == col) { ready = 1; break; }
        }
      out[14] += ready;
    }
#undef VPANEL
  }
  out[4] = out[1] < 0 ? 0 : (out[0] ? out[0] : horizon) - out[1];
  return 0;
}

int lineOnEngine(const int32_t *steps, int n, int horizon, int waitAll, int32_t *out) { LWAITALL = waitAll; int rc = linePlay(steps, n, horizon, 0, out); LWAITALL = 0; return rc < 0 ? -1 : 0; }
// THE BOARD THE NEXT STEP IS CHOSEN ON: `steps` played on the engine as the
// front plays them, up to the frame the front would decide again. Its masks,
// the pairs the bot may target on it (swappable, settled), the cursor and the
// frames it took. -1: a step refused, or the board lost health on the way.
// landing: the board instead once the next slab has dropped and landed.
static int lineStateRun(const int32_t *steps, int n, int landing, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t);
// ONE REPLAY PER LINE PER DECISION: the board a line leaves depends only on
// the line and this decision's board, so every search that replays it again
// is answered from the first replay.
#define LSMN 4096
typedef struct { int dec, n, landing, rc; int32_t sw[2 * LINEMAX], masks[ST_INTS], cur[2], t; uint32_t can[WMAX]; uint8_t wait[32][WMAX]; } LSMemo;
static LSMemo LSM[LSMN];
static LSMemo *lsmSlot(const int32_t *steps, int n, int landing) {
  unsigned h = 2166136261u ^ (unsigned)(n * 7 + landing);
  for (int k = 0; k < 2 * n; k++) h = (h ^ (unsigned)steps[k]) * 16777619u;
  return &LSM[h & (LSMN - 1)];
}
static int lsmHas(const int32_t *steps, int n, int landing) {
  LSMemo *m = lsmSlot(steps, n, landing);
  return m->dec == btDecision && m->n == n && m->landing == landing && (n == 0 || !__builtin_memcmp(m->sw, steps, (unsigned long)n * 8));
}
// REPLAYED IN PARALLEL: the one-swap lines a search is about to replay, those
// the decision has not, replayed on GC_THREADS threads and this one; the
// boards they leave go into the decision's memo
static LSMemo PRJ[128];
static int prjN;
static int prjSnap[128];
static double prjWork[128];   // each task's own work
static void prjTask(int k) {
  LSMemo *j = &PRJ[k];
  snapTo = prjSnap[k];
  double w0 = paWork;
  j->rc = lineStateRun(j->sw, j->n, 0, j->masks, j->can, j->wait, j->cur, &j->t);
  prjWork[k] = paWork - w0;
  snapTo = -1;
}
// count lines of n steps each, `stride` ints apart
static void prereplayN(const int32_t *sws, int stride, int count, int n) {
  prjN = 0;
  if (inWorker) return;   // a worker's task: its replays are its own, kept by no one
  if (n < 1 || n > LINEMAX) return;
  for (int k = 0; k < count && prjN < 128; k++) {
    if (lsmHas(sws + stride * k, n, 0)) continue;
    LSMemo *j = &PRJ[prjN++];
    for (int i = 0; i < 2 * n; i++) j->sw[i] = sws[stride * k + i];
    j->n = n; j->landing = 0;
  }
  if (prjN < 2) return;
  // each job's prefix kept in its line's slot, the slot cleared first; two jobs on one slot: the first keeps it
  for (int k = 0; k < prjN; k++) {
    int slot = PRJ[k].n < LINEMAX ? (int)snapHash(PRJ[k].sw, PRJ[k].n) : -1;
    for (int q = 0; q < k && slot >= 0; q++) if (prjSnap[q] == slot) slot = -1;
    prjSnap[k] = slot;
    if (slot >= 0) { SNAPS[slot].dec = -1; if (!SNAPS[slot].b) SNAPS[slot].b = nb_new(); }
  }
  prjN = fitTasks(prjN, rpCost);
  parallelDo(prjN, prjTask);
  for (int k = 0; k < prjN; k++) if (prjWork[k] > rpCost) rpCost = prjWork[k];
  for (int k = 0; k < prjN; k++) {
    int slot = prjSnap[k];
    if (slot >= 0 && PRJ[k].rc == 0 && SNAPS[slot].n == PRJ[k].n && !__builtin_memcmp(SNAPS[slot].sw, PRJ[k].sw, (unsigned long)PRJ[k].n * 8)) SNAPS[slot].dec = btDecision;
  }
  extern int paBudgetOut(void);
  if (paBudgetOut()) return;
  for (int k = 0; k < prjN; k++) { LSMemo *m = lsmSlot(PRJ[k].sw, PRJ[k].n, 0); *m = PRJ[k]; m->dec = btDecision; }
}
static void prereplay(const int32_t *sws, int count) { prereplayN(sws, 2, count, 1); 
}
// BREAK TIMES WORKED OUT AHEAD. While the main option search holds this
// thread, the workers replay each pool swap, out from the cursor (as breakSoon
// takes them), keep its board as prereplay does, and find its soonest break
// with no bound (parallelBg). A swap's time under any bound is then that time
// if it is within the bound, INF if not -- what a bounded search finds, since
// a bound drops only what reaches no sooner than it. Those not started when
// the search ends are dropped, and replayed and searched as before.
static void parallelBg(int count, void (*task)(int));
static int32_t BAQ[2 * MAXCAND]; static double BAV[MAXCAND]; static int BAD[MAXCAND], BASLOT[MAXCAND], baN, baDecision = -1;
static LSMemo BAJ[MAXCAND];
static void baTask(int k) {
  LSMemo *j = &BAJ[k];
  snapTo = BASLOT[k];
  j->rc = lineStateRun(j->sw, 1, 0, j->masks, j->can, j->wait, j->cur, &j->t);
  snapTo = -1;
  int32_t st[ST_INTS], cur[2] = { j->cur[0], j->cur[1] }; uint32_t can[WMAX]; uint8_t w[32][WMAX];
  __builtin_memcpy(st, j->masks, sizeof st); __builtin_memcpy(can, j->can, sizeof can); __builtin_memcpy(w, j->wait, sizeof w);
  BAV[k] = j->rc != 0 ? INF : breakTimeAfter(j->sw, 1, INF, st, can, w, cur, j->t);
  BAD[k] = 1;
}
// OFF: which of its tasks start before the search ends is the threads' timing,
// so the work a decision counts (paWork, and the budgets read off it) would
// differ run to run with the same board. A decision repeats exactly; the
// replays are made on demand instead.
static void breakAheadStart(void) {
  if (1 || baDecision == btDecision || !BIN[IN_HASPA] || !hasGarbage(DBASE) || !parAvailable()) return;
  baDecision = btDecision; baN = 0;
  int32_t pl[2 * MAXCAND]; int pn = 0, q; double far;
  for (int k = 0; k < nPool && pn < MAXCAND; k++) if (POOL[k].kind == K_SWAP) { pl[2 * pn] = POOL[k].sr; pl[2 * pn + 1] = POOL[k].sc; pn++; }
  Out o; outBegin(&o, pl, 2, pn, (int)BIN[IN_CROW], (int)BIN[IN_CCOL]);
  while (outNext(&o, &q, &far)) {
    int32_t *sw = BAQ + 2 * baN;
    sw[0] = pl[2 * q]; sw[1] = pl[2 * q + 1]; BAD[baN] = 0;
    LSMemo *j = &BAJ[baN]; j->n = 1; j->landing = 0; j->sw[0] = sw[0]; j->sw[1] = sw[1];
    // its board kept in its line's slot, cleared now; two on one slot: the first keeps it
    int slot = (int)snapHash(sw, 1);
    for (int i = 0; i < baN && slot >= 0; i++) if (BASLOT[i] == slot) slot = -1;
    if (slot >= 0 && snapFind(sw, 1)) slot = -1;   // kept already
    BASLOT[baN] = slot;
    if (slot >= 0) { SNAPS[slot].dec = -1; if (!SNAPS[slot].b) SNAPS[slot].b = nb_new(); }
    baN++;
  }
  parallelBg(baN, baTask);
}
// after the join: the boards kept and the replays memoised, as prereplay's
static void breakAheadEnd(void) {
  if (baDecision != btDecision) return;
  extern int paBudgetOut(void);
  for (int k = 0; k < baN; k++) {
    if (!BAD[k]) continue;
    LSMemo *j = &BAJ[k]; int slot = BASLOT[k];
    if (slot >= 0 && j->rc == 0 && SNAPS[slot].n == 1 && SNAPS[slot].sw[0] == j->sw[0] && SNAPS[slot].sw[1] == j->sw[1]) SNAPS[slot].dec = btDecision;
    if (!paBudgetOut() && !lsmHas(j->sw, 1, 0)) { LSMemo *m = lsmSlot(j->sw, 1, 0); *m = *j; m->dec = btDecision; }
  }
}
static int breakAhead(const int32_t *sw, double lim, double *out) {
  if (baDecision != btDecision) return 0;
  for (int k = 0; k < baN; k++) if (BAQ[2 * k] == sw[0] && BAQ[2 * k + 1] == sw[1]) {
    if (!BAD[k]) return 0;
    *out = BAV[k] < lim ? BAV[k] : INF;
    return 1;
  }
  return 0;
}
static int lineStateAt(const int32_t *steps, int n, int landing, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t) {
  if (n < 0 || n > LINEMAX) return lineStateRun(steps, n, landing, masks, can, wait, cur, t);
  unsigned h = 2166136261u ^ (unsigned)(n * 7 + landing);
  for (int k = 0; k < 2 * n; k++) h = (h ^ (unsigned)steps[k]) * 16777619u;
  LSMemo *m = &LSM[h & (LSMN - 1)];
  if (m->dec == btDecision && m->n == n && m->landing == landing && (n == 0 || !__builtin_memcmp(m->sw, steps, (unsigned long)n * 8))) {
    __builtin_memcpy(masks, m->masks, sizeof m->masks); __builtin_memcpy(can, m->can, sizeof m->can);
    __builtin_memcpy(wait, m->wait, sizeof m->wait); cur[0] = m->cur[0]; cur[1] = m->cur[1]; *t = m->t;
    return m->rc;
  }
  // a replay only where the budget holds one (rpCost, the most one has taken)
  if (rpCost > workLeft()) { budgetRefused++; return -1; }   // the decision's work, or a parallel task's own share
  double w0 = paWork;
  int rc = lineStateRun(steps, n, landing, masks, can, wait, cur, t);
  if (!inWorker && paWork - w0 > rpCost) rpCost = paWork - w0;
  extern int paBudgetOut(void);
  if (!paBudgetOut() && !inWorker) {
    m->dec = btDecision; m->n = n; m->landing = landing; m->rc = rc;
    for (int k = 0; k < 2 * n; k++) m->sw[k] = steps[k];
    __builtin_memcpy(m->masks, masks, sizeof m->masks); __builtin_memcpy(m->can, can, sizeof m->can);
    __builtin_memcpy(m->wait, wait, sizeof m->wait); m->cur[0] = cur[0]; m->cur[1] = cur[1]; m->t = *t;
  }
  return rc;
}
static int lineStateRun(const int32_t *steps, int n, int landing, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t) {
  int32_t out[LNOLEN];
  snapLast = 0;
  landK = landing > 0 ? landing : 1;
  int rc = n > 0 || landing ? linePlay(steps, n, 400, landing ? 2 : 1, out) : (nb_copy(LNB ? LNB : (LNB = nb_new()), paLibBoard()), out[0] = 0, out[8] = 0, 1);
  landK = 1;
  if (rc != 1 || out[0]) return -1;
  // the next step targets settled panels: the board once it has settled, each
  // pair with the frame (from now) its panels settle
  { extern PATLS double paWork; paWork += 60; }   // the copies, the masks and the swap tests below
  uint32_t still[W + 2];
  unsettled(LNB, still, &LSET);
  if (snapLast) { snapLast->settle = LSET; snapLast->hasSettle = 1; snapLast = 0; }
  Board *save = FB;
  FB = USB;
  fMasks(masks, 0);
  FB = save;
  for (int c = 0; c < WMAX; c++) can[c] = 0;
  for (int r = 0; r < 32; r++) for (int c = 0; c < WMAX; c++) wait[r][c] = 0;
  for (int c = 1; c < W; c++)
    for (int r = 1; r <= USB->height && r <= 31; r++)
      if (nb_can_swap(USB, r, c)) { can[c] |= 1u << (r - 1); wait[r][c] = (uint8_t)pairWait(&LSET, r, c); }
  cur[0] = LNB->curRow; cur[1] = LNB->curCol; *t = out[8];
  return masks[O_BAD] ? -1 : 0;
}

// JUDGED IN PARALLEL (native): the lines a search is about to ask about, those
// the decision has not judged, played on the engine by GC_THREADS threads (3
// by default; 0: none) and the main one, each with its own scratch (JLOCAL);
// the verdicts go into the decision's memo, so the search reads the same
// answers it would have worked out one by one.
#ifndef __wasm__
typedef unsigned long gcThread;
extern int pthread_create(gcThread *, const void *, void *(*)(void *), void *);
extern int pthread_join(gcThread, void **);
typedef struct { int32_t sw[2 * LINEMAX]; int n, waitAll, v; int32_t lno[LNOLEN]; double work; } PJob;   // work: the task's own
static PJob PJ[256];
static int pjLock, pjThreads = -1;
static void (*pjTask)(int);
// A WORKER'S WORK, counted on a line of its own and added to the deciding
// thread's once the batch is done (paWork is each thread's own)
static struct { double w, e; char pad[48]; } __attribute__((aligned(64))) pjW[17];
static JLOCAL int pjMe;   // 0 on the deciding thread, 1.. on a worker
extern void paOutcomeBoard(int make);
static int pjHeldR, pjHeldC, pjHeldDir, pjPress;   // the settings travelCost reads, from the main thread
// A BATCH IS ONE WORD: generation, task count and the next task, taken
// together by one atomic add, so a thread late from an earlier batch can
// never take a task of this one by its count. The main thread takes tasks
// too, and waits for the TASKS to finish, never for the workers: a napping
// worker that wakes after the batch is done finds nothing left and naps again.
#define PJ_IX 0xFFFFFull
static unsigned long long pjWord;
static int pjFinished, pjGen;
// A TASK'S SHARE OF THE DECISION: a batch's tasks fold their work into the
// decision only once it ends, so each is handed, before it starts, an even
// share of what optional work has left (pjShare) and stops its searches at
// taskEnd (searchInTime) -- the batch together never runs past optLine
static double pjShare;
static int pjSeq;   // batches begun: with a task's index, its cache tag
static void pjShareOf(int count) {
  extern PATLS double paWork;
  double room = optLine() - paWork;
  pjShare = room > 0 && count > 0 ? room / count : 0;
  pjSeq++;
}
// ONE TASK, THE SAME WHEREVER IT RUNS: the front's key state, its share of
// the decision's work (taskEnd), its own cache (cacheTag) -- on a worker, on
// this thread at a join, or one by one with no threads at all
static void pjOne(int ix) {
  HELDR = pjHeldR; HELDC = pjHeldC; HELDDIR = pjHeldDir; PRESS = pjPress;
  extern PATLS double paWork, paEngFrames; double w0 = paWork, e0 = paEngFrames;
  taskEnd = paWork + pjShare;
#ifndef GC_NOCACHETAG
  cacheTag = (u64)pjSeq * 4096 + (u64)ix + 1;
#endif
  pjTask(ix);
  cacheTag = 0;
  if (pjMe) { pjW[pjMe].w += paWork - w0; pjW[pjMe].e += paEngFrames - e0; }
}
// THE SAME TASKS ON THE SAME THREAD, EVERY RUN: thread p (0 the deciding
// one, 1.. the workers) runs tasks p, p + P, p + 2P, ... in order. Each
// thread keeps its own caches, and an answer found in a cache costs no work,
// so a search's share reaches as far as that thread's history allows: with
// tasks taken first come, which thread ran what -- the machine's timing --
// would change the answers. Fixed, every machine plays the same game.
static void pjRun(void) {
  unsigned long long w = __atomic_load_n(&pjWord, __ATOMIC_ACQUIRE), count = (w >> 20) & PJ_IX;
  for (unsigned long long ix = (unsigned long long)pjMe; ix < count; ix += (unsigned long long)pjThreads + 1) {
    pjOne((int)ix);
    __atomic_add_fetch(&pjFinished, 1, __ATOMIC_RELEASE);
  }
}
// PERSISTENT WORKERS, as the browser's: started once, each with its own
// boards, waiting for the next batch: a brief spin, then asleep in the kernel
// (a futex) until a batch wakes it. A worker that polls steals the core the
// search runs on.
extern long syscall(long, ...);
#if defined(__x86_64__)
#define GC_NR_FUTEX 202
#else
#define GC_NR_FUTEX 98
#endif
#define PJ_SPIN 20000
static int pjStarted, pjSleepers;
static void *pjWorker(void *arg) {
  (void)arg;
  inWorker = 1;
  while (__atomic_exchange_n(&pjLock, 1, __ATOMIC_ACQUIRE)) {}
  { static int pjIds; extern void paThreadId(int); pjMe = ++pjIds; paThreadId(pjMe); }
  LNB = nb_new(); USB = nb_new(); paOutcomeBoard(1); bitWorkerInit();
  __builtin_memset(LNB, 0, sizeof(Board)); __builtin_memset(USB, 0, sizeof(Board));   // touched now, not mid-decision
  __atomic_store_n(&pjLock, 0, __ATOMIC_RELEASE);
  int seen = 0;
  for (;;) {
    int g;
    for (int spin = 0; (g = __atomic_load_n(&pjGen, __ATOMIC_SEQ_CST)) == seen; spin++)
      if (spin > PJ_SPIN) {
        __atomic_add_fetch(&pjSleepers, 1, __ATOMIC_SEQ_CST);
        syscall(GC_NR_FUTEX, &pjGen, 128 /* FUTEX_WAIT_PRIVATE */, seen, 0, 0, 0);   // returns at once if pjGen moved
        __atomic_sub_fetch(&pjSleepers, 1, __ATOMIC_SEQ_CST);
      }
    seen = g;
    pjRun();
  }
  return 0;
}
// whether work is handed out as tasks from here (parallelDo): always, but
// from inside a task -- the same with threads or without, so the thread
// count never changes which path a search takes
static int parTasks(void) { return !inWorker; }
// whether parallelDo has workers to hand tasks to from here
static int parAvailable(void) {
  if (pjThreads < 0) { pjThreads = getenv("GC_THREADS") ? atoi(getenv("GC_THREADS")) : 3; if (pjThreads > 15) pjThreads = 15; }
  return pjThreads > 0 && !inWorker;
}
// count tasks, task(k) each, on GC_THREADS workers and this thread (one by one without)
// THE WORKERS ALONE: a batch handed out while this thread does serial work of
// its own (parallelBg); parallelJoin ends it once every task is done (this
// thread takes those not yet started). A batch of either kind starts only
// once the last background one has ended.
static int pjBg, pjBgCount;
static void pjFold(void) {
  extern PATLS double paWork, paEngFrames;
  for (int t = 1; t <= pjThreads; t++) { paWork += pjW[t].w; paEngFrames += pjW[t].e; pjW[t].w = pjW[t].e = 0; }
}
static void parallelJoin(void) {
  if (!pjBg) return;
  // EVERY TASK DONE, WHATEVER THE MACHINE'S SPEED: this thread takes the ones
  // not yet started, so what the batch found -- and the work it cost, each
  // task within its share -- is the same on every machine
  { int wasIn = inWorker; inWorker = 1; pjRun(); inWorker = wasIn; }
  while (__atomic_load_n(&pjFinished, __ATOMIC_ACQUIRE) < pjBgCount) {}
  bgReserve = 0;
  pjFold();
  pjBg = 0;
}
static void pjStart(int count, void (*task)(int)) {
  if (!LNB) LNB = nb_new();
  if (!USB) USB = nb_new();
  paOutcomeBoard(1);
  if (!pjStarted) {
    gcThread th;
    for (int t = 0; t < pjThreads; t++) pthread_create(&th, 0, pjWorker, 0);
    pjStarted = 1;
  }
  pjTask = task;
  pjHeldR = HELDR; pjHeldC = HELDC; pjHeldDir = HELDDIR; pjPress = PRESS;
  __atomic_store_n(&pjFinished, 0, __ATOMIC_RELAXED);
  int g = __atomic_load_n(&pjGen, __ATOMIC_RELAXED) + 1;
  __atomic_store_n(&pjWord, ((unsigned long long)(g & 0xFFFFF) << 40) | ((unsigned long long)count << 20), __ATOMIC_RELEASE);
  __atomic_store_n(&pjGen, g, __ATOMIC_SEQ_CST);
  if (__atomic_load_n(&pjSleepers, __ATOMIC_SEQ_CST)) syscall(GC_NR_FUTEX, &pjGen, 129 /* FUTEX_WAKE_PRIVATE */, 0x7fffffff, 0, 0, 0);
}
// count tasks on the workers alone, now; this thread goes on with its own work
static void parallelBg(int count, void (*task)(int)) {
  if (!parAvailable() || count < 1) return;
  parallelJoin();
  // THE WORKERS' HALF, HELD BACK: their work is folded into the decision only
  // at the join, while this thread's own goes on beside them; half of what is
  // left is theirs, shared evenly, and reserved from this thread's until then
  extern PATLS double paWork;
  double room = optLine() - paWork;
  pjShare = room > 0 ? room / 2 / count : 0;
  bgReserve = pjShare * count;
  pjStart(count, task);
  pjBg = 1; pjBgCount = count;
}
static void parallelDo(int count, void (*task)(int)) {
  if (pjThreads < 0) { pjThreads = getenv("GC_THREADS") ? atoi(getenv("GC_THREADS")) : 3; if (pjThreads > 15) pjThreads = 15; }
  if (inWorker) { for (int k = 0; k < count; k++) task(k); return; }   // a task's own: one by one
  parallelJoin();
  if (count < 2) { for (int k = 0; k < count; k++) task(k); return; }
  // NO THREADS, THE SAME STEPS: the tasks run here, one by one, as workers --
  // a decision is the same whatever the thread count
  if (pjThreads <= 0) {
    if (!LNB) LNB = nb_new();
    if (!USB) USB = nb_new();
    paOutcomeBoard(1);
    int wasIn = inWorker; inWorker = 1;
    int heldR = HELDR, heldC = HELDC, heldDir = HELDDIR, press = PRESS;
    pjShareOf(count);
    pjTask = task; pjHeldR = heldR; pjHeldC = heldC; pjHeldDir = heldDir; pjPress = press;
    for (int k = 0; k < count; k++) pjOne(k);
    HELDR = heldR; HELDC = heldC; HELDDIR = heldDir; PRESS = press;
    inWorker = wasIn;
    return;
  }
  if (!LNB) LNB = nb_new();
  if (!USB) USB = nb_new();
  paOutcomeBoard(1);
  if (!pjStarted) {
    gcThread th;
    for (int t = 0; t < pjThreads; t++) pthread_create(&th, 0, pjWorker, 0);
    pjStarted = 1;
  }
  int heldR = HELDR, heldC = HELDC, heldDir = HELDDIR, press = PRESS;
  pjShareOf(count);
  pjTask = task;
  pjHeldR = heldR; pjHeldC = heldC; pjHeldDir = heldDir; pjPress = press;
  __atomic_store_n(&pjFinished, 0, __ATOMIC_RELAXED);
  int g = __atomic_load_n(&pjGen, __ATOMIC_RELAXED) + 1;
  __atomic_store_n(&pjWord, ((unsigned long long)(g & 0xFFFFF) << 40) | ((unsigned long long)count << 20), __ATOMIC_RELEASE);
  __atomic_store_n(&pjGen, g, __ATOMIC_SEQ_CST);
  if (__atomic_load_n(&pjSleepers, __ATOMIC_SEQ_CST)) syscall(GC_NR_FUTEX, &pjGen, 129 /* FUTEX_WAKE_PRIVATE */, 0x7fffffff, 0, 0, 0);
  int wasIn = inWorker; inWorker = 1;
  pjRun();
  inWorker = wasIn;
  HELDR = heldR; HELDC = heldC; HELDDIR = heldDir; PRESS = press;
  while (__atomic_load_n(&pjFinished, __ATOMIC_ACQUIRE) < count) {}
  pjFold();
}
static void pjJudge(int k) {
  PJob *j = &PJ[k];
  double w0 = paWork;
  j->v = lineJudgeIn(j->sw, j->n, j->waitAll);
  j->work = paWork - w0;
  for (int i = 0; i < LNOLEN; i++) j->lno[i] = LNO[i];
}
static void prejudge(const int32_t *sws, int stride, int count, int n, int waitAll) {
  if (pjThreads < 0) pjThreads = getenv("GC_THREADS") ? atoi(getenv("GC_THREADS")) : 3;
  if (!BIN[IN_HASPA] || !aloneOnEngine()) return;
  int jobs = 0;
  for (int k = 0; k < count && jobs < 256; k++) {
    const int32_t *sw = sws + stride * k;
    int v; int32_t lno[LNOLEN];
    if (jmFind(sw, n, waitAll, &v, lno)) continue;
    PJob *j = &PJ[jobs++];
    for (int i = 0; i < 2 * n; i++) j->sw[i] = sw[i];
    j->n = n; j->waitAll = waitAll;
  }
  jobs = fitTasks(jobs, jdCost);
  if (jobs < 2) return;
  parallelDo(jobs, pjJudge);
  for (int k = 0; k < jobs; k++) if (PJ[k].work > jdCost) jdCost = PJ[k].work;   // the most one task cost
  extern int paBudgetOut(void);
  if (paBudgetOut()) return;
  for (int k = 0; k < jobs; k++) jmPut(PJ[k].sw, PJ[k].n, PJ[k].waitAll, PJ[k].v, PJ[k].lno);
}
// lines of their own lengths, judged as judged() judges them (waitAll: its second judgement)
static void prejudgeLinesW(LineC *const *ls, int count, int waitAll) {
  if (pjThreads < 0) pjThreads = getenv("GC_THREADS") ? atoi(getenv("GC_THREADS")) : 3;
  if (!BIN[IN_HASPA] || !aloneOnEngine()) return;
  int jobs = 0;
  for (int k = 0; k < count && jobs < 256; k++) {
    const LineC *l = ls[k];
    int v; int32_t lno[LNOLEN];
    if (jmFind(l->sw, l->n, waitAll, &v, lno)) continue;
    PJob *j = &PJ[jobs++];
    for (int i = 0; i < 2 * l->n; i++) j->sw[i] = l->sw[i];
    j->n = l->n; j->waitAll = waitAll;
  }
  jobs = fitTasks(jobs, jdCost);
  if (jobs < 2) return;
  parallelDo(jobs, pjJudge);
  for (int k = 0; k < jobs; k++) if (PJ[k].work > jdCost) jdCost = PJ[k].work;   // the most one task cost
  extern int paBudgetOut(void);
  if (paBudgetOut()) return;
  for (int k = 0; k < jobs; k++) jmPut(PJ[k].sw, PJ[k].n, PJ[k].waitAll, PJ[k].v, PJ[k].lno);
}
#else
static void prejudgeLinesW(LineC *const *ls, int count, int waitAll) { (void)ls; (void)count; (void)waitAll; }
static void prejudge(const int32_t *sws, int stride, int count, int n, int waitAll) { (void)sws; (void)stride; (void)count; (void)n; (void)waitAll; }
static void parallelDo(int count, void (*task)(int)) { for (int k = 0; k < count; k++) task(k); }
static int parAvailable(void) { return 0; }
static int parTasks(void) { return 0; }
static void parallelBg(int count, void (*task)(int)) { (void)count; (void)task; }
static void parallelJoin(void) {}
#endif
int lineState(const int32_t *steps, int n, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t) {
  return lineStateAt(steps, n, 0, masks, can, wait, cur, t);
}
// THE BOARD THE NEXT SLAB LANDS ON: `steps` played, then the board left alone
// until the next slab has dropped and landed, then settled.
int lineLandedFull(const int32_t *steps, int n, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t) {
  return lineStateAt(steps, n, 1, masks, can, wait, cur, t);
}
// THE BOARD THE K-TH SLAB LANDS ON: as lineLandedFull, k slabs of the queue down
int lineLandedK(const int32_t *steps, int n, int k, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t) {
  return lineStateAt(steps, n, k, masks, can, wait, cur, t);
}
int lineLanded(const int32_t *steps, int n, int32_t *masks, int32_t *t) {
  uint32_t can[WMAX]; uint8_t wait[32][WMAX]; int32_t cur[2];
  return lineStateAt(steps, n, 1, masks, can, wait, cur, t);
}

// The decision, out of the bot: K_HOLD / K_RAISE / K_SWAP, the move, the park.
typedef struct { int kind, hasMove, mr, mc, hasPark, pr, pc, via, waitAll; } FDec;
static int fDecide(Front *F, FDec *out) {
  fPrepare(F);
  LF = F;
  BOTS[F->id].tab[T_OPT + O_PRESS] = 1;
  int rc = bot_decide(F->id);
  { extern void paBudget(double); paBudget(1e300); }   // the budget is the decision's
  if (rc != 0) return -1;
  double *o = BOUT;
  out->kind = (int)o[0]; out->hasMove = o[1] != 0; out->mr = (int)o[2]; out->mc = (int)o[3];
  out->hasPark = o[4] != 0; out->pr = (int)o[5]; out->pc = (int)o[6]; out->via = (int)o[7]; out->waitAll = o[98] != 0;
  F->wantRaise = o[12] != 0;
  F->wantRows = (int)o[13];
  if (o[14]) F->wantRaise = 0;
  F->escapeWalk = o[15];
  F->lastKind = out->kind; F->lastVia = out->via;
  F->lastMoveR = out->hasMove ? out->mr : out->hasPark ? out->pr : 0; F->lastMoveC = out->hasMove ? out->mc : out->hasPark ? out->pc : 0;
  return 0;
}

// One frame: the keys to press (the server's bits), the swap queued on the
// board itself as the walk arrives. -1: the bot failed.
static int frontFrame(int fid, Board *b);
// THE FRAME'S TIME, measured: the budget is the decision's work (bot.c
// WORKBUDGET), the same here as in the browser; the clock is reported
// (front_took_ms), the machine's speed being no rule of the game's.
#ifndef __wasm__
#ifndef GC_TS
struct gcTs { long s, ns; };
extern int clock_gettime(int, struct gcTs *);
#endif
extern char *getenv(const char *);
static double nowMs(void) { struct gcTs t; clock_gettime(1, &t); return t.s * 1e3 + t.ns / 1e6; }
#endif
// THE BOT'S OWN TIME FOR THE LAST FRAME, so a runner can report every frame
// past the budget as it plays rather than a separate check after
static double lastTookMs;
EXPORT(front_took_ms) double front_took_ms(void) { return lastTookMs; }
EXPORT(front_frame) int front_frame(int fid, Board *b) {
#ifndef __wasm__
  extern PATLS double paWork, paEngFrames;
  double t0 = nowMs(), w0 = paWork, e0 = paEngFrames;
  int bits = frontFrame(fid, b);
  double took = nowMs() - t0;
  lastTookMs = took;
  if (getenv("GC_WORKSTAT") && paWork > w0) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "WORK %d %.0f %.3f %.0f\n", b->clock, paWork - w0, took, paEngFrames - e0); }
  return bits;
#else
  return frontFrame(fid, b);
#endif
}
static int frontFrame(int fid, Board *b) {
  Front *F = &FRONTS[fid];
  FB = b;
  // THE ROWS RISEN, every frame: a new row shows as the displacement jumping
  // back up. The last press's row rises with the stack.
  if (F->riseHas && b->displacement > F->riseDisp) { F->risen++; if (F->hasLast) F->lastR++; }
  F->riseDisp = b->displacement; F->riseHas = 1;
  F->lastKind = -1;
  if (b->gameOverClock > 0) return 0;
  int held = F->held, input = 0;
  // RAISING WHILE IT CANNOT KILL (Stack.lua: a held raise key starts the
  // next row as soon as one is done): a raise the bot wants is held every
  // frame the board, as it is that frame, leaves room for it and for every
  // queued garbage row (raiseRoom) and has no garbage in the air -- for as
  // many frames and rows as that is; each decision says again whether it
  // wants one. Topped, never: a raise pressed topped is game over (checkDeath).
  F->raiseHeld = F->wantRaise && F->raiseLives && !nb_topped(b) && !nb_falling_garbage(b) && raiseRoomNow() > 0;
  if (F->raiseHeld) input |= IN_RAISE;
  if (F->walk) return fSend(F, driveWalk(F, input), held);
  if (F->park) input = parkStep(F, input);
  int sent = fSend(F, input, held);
  int urgent = b->stopTime > 0 || toppedNow();
  if (F->cooldown > 0) {
    int lift = (urgent || (F->reveal && windowOpen())) && !swapLanding();
    // a line being played goes on to its next step as its replay does, the swap landed
    if (lift && toppedNow() && !(F->reveal && windowOpen()) && boardKey() == F->decidedOn && drainBound() > F->escapeWalk + 2 && !BOTS[F->id].nLine) lift = 0;
    if (!lift) { F->cooldown--; return sent; }
    F->cooldown = 0;
  }
  F->decidedOn = boardKey();
  FDec d;
  // the held key the decision measures from is the one held before this frame
  int heldNow = F->held;
  F->held = held;
  if (fDecide(F, &d)) return -1;
  F->held = heldNow;
  if (d.kind == K_RAISE) {
    F->wantRaise = !nb_topped(b); F->cooldown = F->reaction;
    return sent;
  }
  if (d.kind == K_HOLD || !d.hasMove) {
    F->cooldown = F->reaction;
    if (d.hasPark && F->park && F->pTr == d.pr && F->pTc == d.pc) return sent;
    F->park = d.hasPark;
    if (d.hasPark) { F->pRow = d.pr; F->pCol = d.pc; F->pTimer = 0; F->pTr = d.pr; F->pTc = d.pc; F->pDisp = b->displacement; }
    return fSend(F, input & ~DIRS, held);
  }
  F->park = 0;
  beginWalk(F, d.mr, d.mc, F->reaction, d.waitAll);
  return fSend(F, driveWalk(F, input & ~DIRS), held);
}

// A bot for the board `b` (its level's constants go into the bot's table).
// EVERY PAGE THE BOT WRITES, TOUCHED BEFORE THE GAME: its memos and tables
// are written at random places, and a page's first write faults -- a
// thousand faults in one decision are milliseconds of a frame.
static void botWarm(void);
static void parallelDo(int count, void (*task)(int));
// a thread's stack, touched to the depth the searches reach (their frames hold whole boards)
__attribute__((noinline)) static void stackWarm(void) { volatile char buf[1 << 20]; for (int i = 0; i < (int)sizeof buf; i += 4096) buf[i] = 0; }
static void sitWarm(void);
static void warmTask(int k) { (void)k; stackWarm(); sitWarm(); }
static void frontWarm(void) {
  memoRoom();
  __builtin_memset(LSM, 0, sizeof LSM);
  for (int i = 0; i < SNAPN; i++) { if (!SNAPS[i].b) SNAPS[i].b = nb_new(); __builtin_memset(SNAPS[i].b, 0, sizeof(Board)); }
  if (!LNB) LNB = nb_new();
  if (!USB) USB = nb_new();
  __builtin_memset(LNB, 0, sizeof(Board)); __builtin_memset(USB, 0, sizeof(Board));
  botWarm();
  stackWarm();
  sitWarm();
  parallelDo(16, warmTask);   // the workers started, their boards and stacks touched, before the game
}
EXPORT(front_new) int front_new(Board *b, int reaction, int allowRaise) {
  if (nFronts >= MAXFRONTS) return -1;
#ifndef __wasm__
  frontWarm();
#endif
  Front *F = &FRONTS[nFronts];
  memset(F, 0, sizeof *F);
  F->pad.limit = actionLimit();
  F->reaction = reaction; F->reveal = 1; F->allowRaise = allowRaise; F->escapeWalk = INF;
  F->id = bot_new();
  if (F->id < 0) return -1;
  FB = b;
  fTable(F, BOTS[F->id].tab);
  return nFronts++;
}
// The last decision's swap (or park) cell, row * 10 + column.
EXPORT(front_move) int front_move(int fid) { return FRONTS[fid].lastMoveR * 10 + FRONTS[fid].lastMoveC; }
EXPORT(front_last) int front_last(int fid) { Front *F = &FRONTS[fid]; return F->lastKind < 0 ? -1 : F->lastKind * 100 + F->lastVia; }
// What the bot is handed on board `b` (BIN, the masks, the timed board), as if
// the key `held` were down and (lastR, lastC) the last swap: front.test.js.
EXPORT(front_prepare) int front_prepare(int fid, Board *b, int held, int hasLast, int lastR, int lastC) {
  Front *F = &FRONTS[fid];
  FB = b;
  F->held = held; F->hasLast = hasLast; F->lastR = lastR; F->lastC = lastC;
  fPrepare(F);
  LF = F;
  return 0;
}
// THE BREAKS WITHIN REACH, time aside: the shortest line of up to `depth`
// swaps, each played on the board the last one settled to, that breaks
// garbage. Returns its length (0: none) and writes it to out as row, column
// pairs, out[0] the number of such lines at that length: drill.c GC_PROBE.
#define PROBEMAX 4
static int32_t PRB[PROBEMAX + 1][ST_INTS], PRR[R_INTS + ST_INTS], PRSW[PROBEMAX][2 * 128];
static int prLine[2 * PROBEMAX], prBest, prCount, prBestLine[2 * PROBEMAX];
static void probeAt(int d, int depth) {
  int n = legal(PRB[d], PRSW[d]);
  for (int i = 0; i < n; i++) {
    int r = PRSW[d][2 * i], c = PRSW[d][2 * i + 1];
    stcpy(PRB[d + 1], PRB[d]);
    if (!swapIn(PRB[d + 1], r, c)) continue;
    resolve(PRB[d + 1], PRR, 1);
    prLine[2 * d] = r; prLine[2 * d + 1] = c;
    if (PRR[R_SCOPE] == SC_BROKE) {
      if (d + 1 < prBest) { prBest = d + 1; prCount = 0; for (int k = 0; k < 2 * (d + 1); k++) prBestLine[k] = prLine[k]; }
      if (d + 1 == prBest) prCount++;
      continue;
    }
    if (PRR[R_SCOPE] != SC_OK || d + 1 >= depth || d + 1 >= prBest) continue;
    stcpy(PRB[d + 1], PRR + R_INTS);
    probeAt(d + 1, depth);
  }
}
EXPORT(front_probe) int front_probe(int fid, Board *b, int depth, int32_t *out) {
  Front *F = &FRONTS[fid];
  FB = b;
  fPrepare(F);
  if (depth > PROBEMAX) depth = PROBEMAX;
  resolve(IN, PRR, 1);
  if (PRR[R_SCOPE] == SC_BROKE) { out[0] = 1; return 0; }
  if (PRR[R_SCOPE] != SC_OK) return -1;
  stcpy(PRB[0], PRR + R_INTS);
  prBest = depth + 1; prCount = 0;
  probeAt(0, depth);
  if (prBest > depth) return 0;
  out[0] = prCount;
  for (int k = 0; k < 2 * prBest; k++) out[1 + k] = prBestLine[k];
  return prBest;
}
