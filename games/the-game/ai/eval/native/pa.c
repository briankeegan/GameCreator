// THE SERVER'S ENGINE IN C, for the survival search. pa-engine.js line for
// line (which is the panel-game server's Lua, checked frame by frame against
// it: pa_engine.test.js), on boards whose panels are plain structs. One stack,
// past its countdown; rows and breaks dealt are the unseen colours; garbage
// sent goes nowhere. native_pa.test.js plays it beside pa-engine.js and
// compares every field after every frame.
#include "libc.h"

#define W 6
#define MAXROWS 48
#define NUL (-2147483647 - 1)   // Lua nil
#define UND (-2147483647)

// Panel fields: pa-engine.js's names, in this order (native.js reads them).
enum { ROW, COL, ID, COLOR, CHAINING, MATCHING, TIMER, INITIALTIME, POPTIME, POPINDEX, XOFF, YOFF, GWIDTH,
       GHEIGHT, SHAKETIME, ISGARBAGE, STATE, COMBOINDEX, COMBOSIZE, SWAPFROMLEFT, DONTSWAP, QUEUEDHOVER, FELL,
       STATECHANGED, PROPCHAIN, MATCHANYWAY, PROPFALL, GARBAGEID, METAL, NF };
enum { NORMAL, DIMMED, SWAPPING, MATCHED, POPPING, POPPED, HOVERING, FALLING, LANDING, DEAD };

typedef struct { int32_t f[NF]; } Panel;
typedef struct { int32_t width, height, isChain, isMetal, frameEarned, finalized; } Incoming;   // finalized: NUL/0/1
typedef struct { int32_t leftId, rightId, row, col, clock; } Stall;

#define MAXINC 256   // a training volley queues fifty at once, and an unbroken queue keeps the last ones
#define MAXSTALL 64
#define MAXLANDED 16
#define MAXCOMBOS 16
#define MAXMATCH 160
#define MAXIDS 64

#define ERR_ROWS 1
#define ERR_INC 2
#define ERR_STALL 8
#define ERR_LANDED 16
#define ERR_MATCH 32
#define ERR_WIDTH 64
#define ERR_STATE 128

#define CD_NULL (-1)
#define DIR_UP 0
#define DIR_DOWN 1
#define DIR_LEFT 2
#define DIR_RIGHT 3

// The server's input bits (KeyDataEncoding).
#define IN_RIGHT 1
#define IN_LEFT 2
#define IN_DOWN 4
#define IN_UP 8
#define IN_SWAP 16
#define IN_RAISE 32

typedef struct Board {
  // the level and the stack's behaviours
  int32_t colors, maxHealth, shockFrequency, shockCap, speedIncreaseMode;
  int32_t fHOVER, fGARBAGE_HOVER, fFLASH, fFACE, fPOP;
  int32_t sFormula, sComboConstant, sChainConstant, sDangerConstant, sCoefficient, sDangerCoefficient;
  int32_t passiveRaise, allowManualRaise, swapStallingMode, swapStallingPunish;
  int32_t height;
  // state
  double riseTimer;
  int32_t nrows, panelIdCount, speed, nextSpeedIncreaseClock, clock, stopWatch, stopWatchIsRunning, inCountdown, displacement;
  int32_t riseLock, hasRisen, manualRaise, manualRaiseYet, preventManualRaise, swapThisFrame;
  int32_t stopTime, preStopTime, shakeTime, prevShakeTime, shakeTimeOnFrame, peakShakeTime, health, wasToppedOut;
  int32_t chainCounter, nActive, nPrevActive, swappingCount, panelsCleared, metalPanelsQueued, score;
  int32_t curRow, curCol, topCurRow, queuedSwapRow, queuedSwapCol, swapCount, curTimer, curWaitTime, cursorDirection, cursorLock;
  int32_t garbageCreatedCount, highestGarbageIdMatched, gameOverClock, gameOver;
  int32_t input, pressSwap, swapDenied, inputBits, unseenRows, unseenBreaks, err;
  int32_t quiet, noQuiet;   // see QUIET; not part of the board, never sent
  int32_t hi;               // see SETTLED ROWS; not part of the board, never sent
  int32_t cdLeft;           // see COUNTDOWN FRAMES; not part of the board, never sent
  int32_t popSeen;          // garbage popping was updated this frame (updatePanels); not part of the board
  // WHAT A STEP DID (search.h MK_SETTLE): each clear's size and the chain
  // counter it reached, panels cleared, garbage cells converted and the most
  // stop time one clear paid. Counted since the step began; not part of the
  // board, never sent.
  int32_t sCombo[MAXCOMBOS], sChainAt[MAXCOMBOS], sNCombo, sCleared, sBroke, sEarned;
  int32_t ninc, nstall, nlanded;
  int32_t dropColumnIndex[7];     // [width], 1-based as the Lua keeps them
  Incoming inc[MAXINC];           // the next to drop last
  Stall stall[MAXSTALL];
  int32_t landed[MAXLANDED];
  // panels last, so a copy can stop at nrows
  Panel p[MAXROWS][W + 1];
} Board;
#define BOARD_HEAD ((unsigned long)&((Board *)0)->p)
#define BOARD_BYTES(b) (BOARD_HEAD + (unsigned long)(b)->nrows * sizeof(Panel) * (W + 1))
#include "memory.h"

static int32_t imax(int32_t a, int32_t b) { return a > b ? a : b; }
static int32_t imin(int32_t a, int32_t b) { return a < b ? a : b; }
static int32_t bound(int32_t a, int32_t b, int32_t c) { return b < a ? a : b > c ? c : b; }
#define SETB(v) ((v) != NUL && (v) != 0)   // Lua truthiness of a nil-or-boolean
#define SETN(v) ((v) != NUL)               // of a nil-or-number: 0 is true


static const int SPEED_TO_RISE_TIME[99] = {
  942, 983, 838, 790, 755, 695, 649, 604, 570, 515, 474, 444, 394, 370, 347, 325, 306, 289, 271, 256,
  240, 227, 213, 201, 189, 178, 169, 158, 148, 138, 129, 120, 112, 105, 99, 92, 86, 82, 77, 73,
  69, 66, 62, 59, 56, 54, 52, 50, 48, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
  47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
  47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47 };
static const int SHAKE_FRAMES[24] = { 18, 18, 18, 18, 24, 42, 42, 42, 42, 42, 42, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 76 };
static const int SCORE_COMBO_TA[31] = { 0, 0, 0, 0, 20, 30, 50, 60, 70, 80, 100, 140, 170, 210, 250, 290, 340, 390, 440, 490, 550, 610, 680, 750, 820, 900, 980, 1060, 1150, 1240, 1330 };
static const int SCORE_CHAIN_TA[14] = { 0, 0, 50, 80, 150, 300, 400, 500, 700, 900, 1100, 1300, 1500, 1800 };
static const int DROP_COLUMNS[7][6] = { { 0 }, { 1, 2, 3, 4, 5, 6 }, { 1, 3, 5 }, { 1, 4 }, { 1, 2, 3 }, { 1, 2 }, { 1 } };
static const int DROP_LEN[7] = { 0, 6, 3, 2, 3, 2, 1 };
static const int DIR_ROW[4] = { 1, -1, 0, 0 }, DIR_COL[4] = { 0, 0, -1, 1 };

#define P(b, r, c) (&(b)->p[(r)][(c)])
#define TOP(b) ((b)->nrows - 1)   // Lua #panels

// ------------------------------------------------------------------ panels
static void clearFlags(Panel *p, int clearChaining) {
  int32_t *f = p->f;
  f[STATE] = NORMAL;
  f[COMBOINDEX] = NUL; f[COMBOSIZE] = NUL; f[SWAPFROMLEFT] = NUL; f[DONTSWAP] = NUL; f[QUEUEDHOVER] = NUL;
  if (clearChaining) f[CHAINING] = NUL;
  f[FELL] = NUL;
  f[STATECHANGED] = 0; f[PROPCHAIN] = 0; f[MATCHANYWAY] = 0;
}
static void clearPanel(Panel *p, int clearChaining, int clearColor) {
  int32_t *f = p->f;
  if (clearColor) f[COLOR] = 0;
  f[TIMER] = 0;
  f[INITIALTIME] = NUL; f[POPTIME] = NUL; f[POPINDEX] = NUL;
  f[XOFF] = NUL; f[YOFF] = NUL; f[GWIDTH] = NUL; f[GHEIGHT] = NUL;
  f[METAL] = NUL; f[SHAKETIME] = NUL;
  f[ISGARBAGE] = 0;
  clearFlags(p, clearChaining);
}
static void makePanel(Panel *p, int32_t row, int32_t col, int32_t id) {
  int32_t *f = p->f;
  f[ROW] = row; f[COL] = col; f[ID] = id;
  f[COLOR] = 0; f[CHAINING] = NUL; f[MATCHING] = NUL; f[PROPFALL] = NUL; f[GARBAGEID] = NUL;
  clearPanel(p, 1, 1);
}
static Panel *createPanelAt(Board *b, int row, int col) {
  Panel *p = P(b, row, col);
  makePanel(p, row, col, ++b->panelIdCount);
  return p;
}
static Panel *below(Board *b, const Panel *p) { return P(b, p->f[ROW] - 1, p->f[COL]); }
static int supportedFromBelow(Board *b, Panel *p) {
  int32_t *f = p->f;
  if (f[ROW] <= 1) return 1;
  if (f[ISGARBAGE]) {
    int start = f[COL] - f[XOFF], end = f[COL] - f[XOFF] + f[GWIDTH] - 1;
    for (int col = start; col <= end; col++) {
      Panel *q = P(b, f[ROW] - 1, col);
      if (q->f[COLOR] != 0) {
        if (!q->f[ISGARBAGE]) return 1;
        if (f[GARBAGEID] == q->f[GARBAGEID]) return f[YOFF] != q->f[YOFF];
        return 1;
      }
    }
    return 0;
  }
  return P(b, f[ROW] - 1, f[COL])->f[COLOR] != 0;
}
// a and b trade cells; each keeps its identity. Returns where a now is.
static Panel *switchPanels(Board *b, Panel *a, Panel *c) {
  int ar = a->f[ROW], ac = a->f[COL], cr = c->f[ROW], cc = c->f[COL];
  Panel t = *a;
  *a = *c; *c = t;
  // the struct that was at a's cell is now c's panel, and vice versa
  P(b, ar, ac)->f[ROW] = ar; P(b, ar, ac)->f[COL] = ac;
  P(b, cr, cc)->f[ROW] = cr; P(b, cr, cc)->f[COL] = cc;
  return P(b, cr, cc);
}
static void addScore(Board *b, int32_t s) { b->score += s; if (b->score > 99999) b->score = 99999; }
static void onPop(Board *b, Panel *p) {
  if (!p->f[ISGARBAGE]) {
    addScore(b, 10);
    b->panelsCleared++;
    if (b->panelsCleared % b->shockFrequency == 0) b->metalPanelsQueued = imin(b->metalPanelsQueued + 1, b->shockCap);
  }
}
static void onLand(Board *b, Panel *p) {
  if (p->f[ISGARBAGE] && SETN(p->f[SHAKETIME]) && p->f[ROW] <= b->height) {
    int seen = 0;
    for (int i = 0; i < b->nlanded; i++) if (b->landed[i] == p->f[GARBAGEID]) seen = 1;
    if (!seen) {
      b->shakeTimeOnFrame = imax(imax(b->shakeTimeOnFrame, p->f[SHAKETIME]), b->peakShakeTime);
      b->peakShakeTime = imax(b->shakeTimeOnFrame, b->peakShakeTime);
      if (b->nlanded < MAXLANDED) b->landed[b->nlanded++] = p->f[GARBAGEID]; else b->err |= ERR_LANDED;
    }
    p->f[SHAKETIME] = NUL;
  }
}
// p falls a row. Returns p where it now is.
static Panel *fall(Board *b, Panel *p) {
  Panel *q = below(b, p);
  p = switchPanels(b, p, q);           // p is now in the lower cell
  Panel *above = P(b, p->f[ROW] + 1, p->f[COL]);
  if (p->f[ISGARBAGE]) { above->f[PROPFALL] = 1; above->f[STATECHANGED] = 1; }
  if (p->f[STATE] != FALLING) { p->f[STATE] = FALLING; p->f[TIMER] = 0; p->f[STATECHANGED] = 1; }
  return p;
}
static void land(Board *b, Panel *p) {
  onLand(b, p);
  if (p->f[ISGARBAGE]) p->f[STATE] = NORMAL;
  else {
    if (SETN(p->f[FELL])) p->f[FELL] = NUL;
    p->f[STATE] = LANDING;
    p->f[TIMER] = 12;
  }
  p->f[STATECHANGED] = 1;
}
static void decrementTimer(Panel *p) { if (p->f[TIMER] > 0) p->f[TIMER]--; }
static void enterHoverFromNormal(Board *b, Panel *p, Panel *q, int32_t hoverTime) {
  clearFlags(p, 0);
  p->f[STATE] = HOVERING;
  if (q->f[PROPCHAIN]) {
    p->f[PROPCHAIN] = 1;
    p->f[CHAINING] = 1;
    if (q->f[COLOR] == 0 || q->f[MATCHANYWAY]) p->f[MATCHANYWAY] = 1;
    else {
      while (q->f[STATE] == SWAPPING || (q->f[STATECHANGED] && q->f[PROPCHAIN] && !q->f[MATCHANYWAY] && q->f[STATE] == HOVERING)) q = below(b, q);
      if (q->f[PROPCHAIN]) p->f[MATCHANYWAY] = (q->f[COLOR] == 0 || q->f[MATCHANYWAY]) ? 1 : 0;
    }
  }
  p->f[TIMER] = hoverTime;
  p->f[STATECHANGED] = 1;
}
// Returns p where it now is.
static Panel *updateNormal(Board *b, Panel *p) {
  if (p->f[ISGARBAGE]) { if (!supportedFromBelow(b, p)) p = fall(b, p); return p; }
  if (p->f[COLOR] == 0) return p;
  Panel *q = below(b, p);
  if (!q->f[STATECHANGED]) return p;
  if (q->f[STATE] == HOVERING) enterHoverFromNormal(b, p, q, q->f[TIMER]);
  else if (q->f[COLOR] == 0) {
    if (SETB(q->f[PROPFALL])) p = fall(b, p);
    else if (q->f[STATE] == NORMAL) enterHoverFromNormal(b, p, q, b->fHOVER);
  } else if (q->f[QUEUEDHOVER] == 1 && q->f[PROPCHAIN] && q->f[STATE] == SWAPPING) {
    int32_t hoverTime = q->f[TIMER];
    Panel *hp = below(b, q);
    while (hp->f[STATE] == SWAPPING) { hoverTime += hp->f[TIMER]; hp = below(b, hp); }
    hoverTime += hp->f[STATE] == HOVERING ? hp->f[TIMER] : b->fHOVER;
    enterHoverFromNormal(b, p, q, hoverTime);
  }
  return p;
}
static void finishSwap(Panel *p) { p->f[STATE] = NORMAL; p->f[DONTSWAP] = NUL; p->f[SWAPFROMLEFT] = NUL; p->f[STATECHANGED] = 1; }
static void updateSwapping(Board *b, Panel *p) {
  decrementTimer(p);
  Panel *q = below(b, p);
  if (p->f[TIMER] == 0) {
    if (p->f[COLOR] == 0) finishSwap(p);
    else if (q->f[COLOR] == 0 || q->f[STATE] == HOVERING || SETB(p->f[QUEUEDHOVER])) {
      clearFlags(p, 0);
      p->f[STATE] = HOVERING;
      p->f[PROPCHAIN] = q->f[PROPCHAIN];
      p->f[MATCHANYWAY] = (q->f[COLOR] != 0 && q->f[STATE] == HOVERING) ? q->f[MATCHANYWAY] : 0;
      p->f[TIMER] = b->fHOVER;
      p->f[STATECHANGED] = 1;
    } else finishSwap(p);
  } else if (q->f[STATECHANGED] && q->f[PROPCHAIN]) {
    p->f[QUEUEDHOVER] = p->f[COLOR] != 0;
    p->f[STATECHANGED] = 1;
    p->f[PROPCHAIN] = 1;
  }
}
static void updateMatched(Board *b, Panel *p) {
  if (p->f[ISGARBAGE]) b->popSeen = 1;
  decrementTimer(p);
  if (p->f[ISGARBAGE] && p->f[TIMER] == p->f[POPTIME]) onPop(b, p);
  if (p->f[TIMER] != 0) return;
  if (p->f[ISGARBAGE]) {
    if (p->f[YOFF] == -1) {
      clearPanel(p, 0, 0);
      p->f[CHAINING] = 1; p->f[PROPCHAIN] = 1; p->f[TIMER] = b->fGARBAGE_HOVER; p->f[FELL] = 12;
      p->f[STATE] = HOVERING; p->f[STATECHANGED] = 1;
    } else p->f[STATE] = NORMAL;
  } else {
    p->f[STATE] = POPPING;
    p->f[TIMER] = p->f[COMBOINDEX] * b->fPOP;
    p->f[STATECHANGED] = 1;
  }
}
static void popped(Board *b, Panel *p) {
  clearPanel(p, 1, 1);
  p->f[PROPCHAIN] = 1;
  p->f[STATECHANGED] = 1;
}
static void updatePopping(Board *b, Panel *p) {
  decrementTimer(p);
  if (p->f[TIMER] != 0) return;
  onPop(b, p);
  if (p->f[COMBOSIZE] == p->f[COMBOINDEX]) popped(b, p);
  else { p->f[STATE] = POPPED; p->f[TIMER] = (p->f[COMBOSIZE] - p->f[COMBOINDEX]) * b->fPOP; p->f[STATECHANGED] = 1; }
}
static void updatePopped(Board *b, Panel *p) { decrementTimer(p); if (p->f[TIMER] == 0) popped(b, p); }
static void updateHovering(Board *b, Panel *p) {
  decrementTimer(p);
  if (p->f[MATCHANYWAY]) p->f[MATCHANYWAY] = 0;
  if (p->f[TIMER] == 0) {
    Panel *q = below(b, p);
    if (p->f[ROW] < 1) { b->err |= ERR_STATE; return; }
    if (q->f[STATE] == HOVERING) p->f[TIMER] = q->f[TIMER];
    else if (q->f[COLOR] != 0) land(b, p);
    else p = fall(b, p);
  }
  if (!p->f[STATECHANGED] && SETN(p->f[FELL])) p->f[FELL]--;
}
static void updateFalling(Board *b, Panel *p) {
  if (p->f[ROW] == 1) land(b, p);
  else if (supportedFromBelow(b, p)) {
    if (p->f[ISGARBAGE]) land(b, p);
    else {
      Panel *q = below(b, p);
      if (q->f[STATE] == HOVERING) {
        clearFlags(p, 0);
        p->f[STATE] = HOVERING; p->f[STATECHANGED] = 1; p->f[PROPCHAIN] = q->f[PROPCHAIN]; p->f[TIMER] = q->f[TIMER];
      } else land(b, p);
    }
  } else p = fall(b, p);
  if (!p->f[STATECHANGED] && SETN(p->f[FELL])) p->f[FELL]--;
}
static void updateLanding(Board *b, Panel *p) {
  p = updateNormal(b, p);
  if (!p->f[STATECHANGED]) {
    decrementTimer(p);
    if (p->f[TIMER] == 0) { p->f[STATE] = NORMAL; p->f[STATECHANGED] = 1; }
  }
}
static void updatePanel(Board *b, Panel *p) {
  int32_t *f = p->f;
  f[STATECHANGED] = 0; f[PROPCHAIN] = 0; f[PROPFALL] = 0; f[MATCHING] = 0;
  switch (f[STATE]) {
    case NORMAL: updateNormal(b, p); break;
    case SWAPPING: updateSwapping(b, p); break;
    case MATCHED: updateMatched(b, p); break;
    case POPPING: updatePopping(b, p); break;
    case POPPED: updatePopped(b, p); break;
    case HOVERING: updateHovering(b, p); break;
    case FALLING: updateFalling(b, p); break;
    case LANDING: updateLanding(b, p); break;
    case DIMMED: if (f[ROW] >= 1) { f[STATE] = NORMAL; f[STATECHANGED] = 1; } break;
    default: break;
  }
}
static int allowsSwap(const Panel *p) {
  if (SETB(p->f[DONTSWAP])) return 0;
  if (p->f[ISGARBAGE]) return 0;
  int32_t st = p->f[STATE];
  return st == NORMAL || st == SWAPPING || st == FALLING || st == LANDING;
}
static void startSwap(Panel *p, int fromLeft) {
  int32_t chaining = p->f[CHAINING];
  clearFlags(p, 0);
  p->f[STATECHANGED] = 1; p->f[STATE] = SWAPPING; p->f[CHAINING] = chaining; p->f[TIMER] = 4; p->f[SWAPFROMLEFT] = fromLeft;
  if (SETN(p->f[FELL])) p->f[FELL] = NUL;
}
static int dangerous(const Panel *p) { return p->f[ISGARBAGE] ? p->f[STATE] != FALLING : p->f[COLOR] != 0; }
static int canMatch(const Panel *p) {
  int32_t col = p->f[COLOR], st = p->f[STATE];
  if (col == 0 || col == 9) return 0;
  return st == NORMAL || st == LANDING || (p->f[MATCHANYWAY] && st == HOVERING);
}

// SETTLED ROWS. A settled cell is empty, not garbage, normal, with no flag a
// pass reads or updatePanel clears: every pass leaves it as it is and no scan
// finds anything in it. Every row from `hi` up is settled, so the passes run
// every frame stop there. Nothing in a frame moves a panel up; a new row, a
// drop, a swap and a loaded board raise hi, and updatePanels lowers it again.
static int rowsTo(const Board *b) { return b->hi < b->nrows ? b->hi : b->nrows; }
static int settled(const int32_t *f) {
  return f[COLOR] == 0 && !f[ISGARBAGE] && f[STATE] == NORMAL && f[STATECHANGED] == 0 && f[PROPCHAIN] == 0 && f[PROPFALL] == 0 &&
         f[MATCHING] == 0 && !SETB(f[CHAINING]) && !f[MATCHANYWAY] && !SETB(f[QUEUEDHOVER]) && !SETN(f[FELL]);
}

// ------------------------------------------------------------------ stack
#define DT_SPEED_INCREASE (15 * 60)
static int hasActivePanels(Board *b) { return b->nActive > 0 || b->nPrevActive > 0; }
static int hasFallingGarbage(Board *b) {
  for (int r = imin(b->height + 3, rowsTo(b) - 1); r >= 1; r--)
    for (int c = 1; c <= W; c++) { Panel *p = P(b, r, c); if (p->f[ISGARBAGE] && p->f[STATE] == FALLING) return 1; }
  return 0;
}
static int swapQueued(Board *b) { return b->queuedSwapCol != 0 && b->queuedSwapRow != 0; }
static int isToppedOut(Board *b) {
  for (int c = 1; c <= W; c++) if (dangerous(P(b, b->height, c))) return 1;
  return 0;
}
static int hasChainingPanels(Board *b) {
  for (int r = 1, n = rowsTo(b); r < n; r++)
    for (int c = 1; c <= W; c++) { Panel *p = P(b, r, c); if (SETB(p->f[CHAINING]) && p->f[COLOR] != 0) return 1; }
  return 0;
}
static void updateActivePanelCount(Board *b) {
  b->nPrevActive = b->nActive;
  int32_t count = 0, swapping = 0;
  for (int r = 1, top = imin(b->height, rowsTo(b) - 1); r <= top; r++)
    for (int c = 1; c <= W; c++) {
      Panel *p = P(b, r, c);
      if (p->f[ISGARBAGE]) { if (p->f[STATE] != NORMAL) count++; }
      else if (p->f[COLOR] != 0 && p->f[STATE] != NORMAL && p->f[STATE] != LANDING) { count++; if (p->f[STATE] == SWAPPING) swapping++; }
    }
  b->nActive = count; b->swappingCount = swapping;
}
static void updateRiseLock(Board *b) {
  int prev = b->riseLock;
  b->riseLock = (swapQueued(b) || b->shakeTime > 0 || hasActivePanels(b)) ? 1 : 0;
  if (prev && !b->riseLock) b->preventManualRaise = 0;
}
static void updateSpeed(Board *b) {
  if (b->speedIncreaseMode != 1) { b->err |= ERR_STATE; return; }
  if (b->clock == b->nextSpeedIncreaseClock) { b->speed = imin(b->speed + 1, 99); b->nextSpeedIncreaseClock += DT_SPEED_INCREASE; }
}
static void decrementInvincibilityTimers(Board *b) {
  b->prevShakeTime = b->shakeTime;
  b->shakeTime = imax(b->shakeTime - 1, b->shakeTimeOnFrame);
  if (b->shakeTime == 0) b->peakShakeTime = 0;
  if (b->preStopTime != 0) b->preStopTime--;
  else if (b->stopTime != 0) b->stopTime--;
}
static int checkDeath(Board *b) {
  if (b->gameOverClock > 0) return 0;
  if (b->health <= 0 && b->shakeTime <= 0) return 1;
  if (!b->riseLock && b->allowManualRaise && b->wasToppedOut && b->manualRaise) return 1;
  return 0;
}
static void recordDeath(Board *b) { if (b->gameOverClock > 0) return; b->gameOverClock = b->clock; b->gameOver = 1; }

// ---- rows. The row dealt is unseen (pa-engine.js Unseen): a colour of its own per
// cell, 30..119, repeating only after fifteen rows, so it matches nothing; never shock,
// since where shock may go is not known yet.
#define UNSEEN_COLOUR(base, k, c) ((base) + ((W * (k) + (c) - 1) % 90))
static void newRow(Board *b) {
  b->quiet = 0; b->cdLeft = 0;
  b->hi = MAXROWS;
  if (b->curRow != 0) b->curRow = bound(1, b->curRow + 1, b->topCurRow);
  if (b->queuedSwapRow > 0) b->queuedSwapRow++;
  int top = TOP(b) + 1, r, c;
  if (top >= MAXROWS) { b->err |= ERR_ROWS; return; }
  if (b->metalPanelsQueued > 3) b->metalPanelsQueued -= 2;
  else if (b->metalPanelsQueued > 0) b->metalPanelsQueued -= 1;
  int32_t k = ++b->unseenRows;
  for (c = 1; c <= W; c++) { Panel *p = createPanelAt(b, top, c); p->f[COLOR] = UNSEEN_COLOUR(30, k, c); p->f[STATE] = DIMMED; }
  b->nrows = top + 1;
  // switched down a row at a time, top to bottom, right to left: the new row
  // ends up at 0 and every other row one higher
  for (r = top; r >= 1; r--)
    for (c = W; c >= 1; c--) switchPanels(b, P(b, r, c), P(b, r - 1, c));
  for (c = 1; c <= W; c++) { P(b, 1, c)->f[STATE] = NORMAL; P(b, 1, c)->f[STATECHANGED] = 1; }
  b->displacement = 16;
}
static int advancePassiveRaise(Board *b) {
  if (b->manualRaise) {
    if (b->displacement == 0 && b->hasRisen) { b->topCurRow = b->height; newRow(b); }
    return 0;
  }
  if (!b->riseLock && b->stopTime == 0) {
    if (isToppedOut(b)) b->health--;
    else {
      b->riseTimer--;
      if (b->riseTimer <= 0) {
        b->displacement--;
        if (b->displacement == 0) { b->preventManualRaise = 0; b->topCurRow = b->height; newRow(b); }
        b->riseTimer += (double)SPEED_TO_RISE_TIME[b->speed - 1] / 16.0;
      }
    }
    return 1;
  }
  return 0;
}
static void handleManualRaise(Board *b) {
  if (!(b->allowManualRaise && b->manualRaise)) return;
  if (!b->riseLock) {
    b->stopTime = 0;
    if (b->wasToppedOut) { if (checkDeath(b)) recordDeath(b); }
    else {
      b->hasRisen = 1;
      b->displacement--;
      if (b->displacement == 1) {
        if (!b->preventManualRaise) addScore(b, 1);
        b->manualRaise = 0; b->riseTimer = 1; b->preventManualRaise = 1;
      }
      b->manualRaiseYet = 1;
    }
  } else if (!b->manualRaiseYet) b->manualRaise = 0;
  else if (hasFallingGarbage(b)) b->manualRaise = 0;
}
static void moveCursorInDirection(Board *b, int d) {
  b->curRow = bound(1, b->curRow + DIR_ROW[d], b->topCurRow);
  b->curCol = bound(1, b->curCol + DIR_COL[d], W - 1);
}
static void applyCursorDirection(Board *b, int d) {
  if (d != CD_NULL && (b->curTimer == 0 || b->curTimer == b->curWaitTime) && !SETB(b->cursorLock)) moveCursorInDirection(b, d);
  else b->curRow = bound(1, b->curRow, b->topCurRow);
  if (b->curTimer != b->curWaitTime) b->curTimer++;
}
static void controls(Board *b) {
  int32_t in = b->inputBits;
  int dir = CD_NULL;
  b->swapThisFrame = (in & IN_SWAP) ? 1 : 0;
  if (b->swapThisFrame && swapQueued(b)) b->swapThisFrame = 0;
  if (in & IN_UP) dir = DIR_UP;
  else if (in & IN_DOWN) dir = DIR_DOWN;
  else if (in & IN_LEFT) dir = DIR_LEFT;
  else if (in & IN_RIGHT) dir = DIR_RIGHT;
  if (dir == b->cursorDirection) { if (b->curTimer != b->curWaitTime) b->curTimer++; }
  else { b->cursorDirection = dir; b->curTimer = 0; }
  if ((in & IN_RAISE) && !b->preventManualRaise) { b->manualRaise = 1; b->manualRaiseYet = 0; }
}

// ---- WigglePay
static int wiggleActive(Board *b) {
  if (b->swapStallingMode == 0 || b->swapStallingPunish == 0) return 0;
  if (!b->wasToppedOut || b->preStopTime != 0 || b->stopTime != 0 || b->shakeTime != 0) return 0;
  return (b->nActive - b->swappingCount) == 0;
}
// Returns 0 if the swap is refused; *cost the health it costs.
static int wiggleCanSwap(Board *b, Panel *p1, Panel *p2, int32_t *cost) {
  *cost = 0;
  if (!wiggleActive(b)) return 1;
  for (int i = 0; i < b->nstall; i++) {
    Stall *o = &b->stall[i];
    if (o->clock >= b->clock) return 1;
    if (o->leftId == p1->f[ID] && o->rightId == p2->f[ID] && o->row == b->curRow && o->col == b->curCol) {
      if (b->health > b->swapStallingPunish) { *cost = b->swapStallingPunish; return 1; }
      return 0;
    }
  }
  return 1;
}
static void wiggleRegister(Board *b, Panel *p1, Panel *p2, int32_t cost) {
  if (wiggleActive(b)) {
    if (cost == 0) {
      if (b->nstall + 2 > MAXSTALL) { b->err |= ERR_STALL; return; }
      Stall a = { p2->f[ID], p1->f[ID], b->curRow, b->curCol, b->clock }, c = { p1->f[ID], p2->f[ID], b->curRow, b->curCol, b->clock };
      b->stall[b->nstall++] = a; b->stall[b->nstall++] = c;
    } else b->health -= cost;
  } else if (b->nstall > 0) b->nstall = 0;
}

// ---- swapping
static int canSwapPanels(Board *b, Panel *p1, Panel *p2, int32_t *cost) {
  *cost = 0;
  int d = p1->f[COL] - p2->f[COL];
  if ((d != 1 && d != -1) || p1->f[ROW] != p2->f[ROW]) return 0;
  if (b->inCountdown || b->clock <= 1) return 0;
  if (p1->f[COLOR] == 0 && p2->f[COLOR] == 0) return 0;
  if (!allowsSwap(p1) || !allowsSwap(p2)) return 0;
  int row = p1->f[ROW];
  Panel *a1 = 0, *a2 = 0;
  if (row < b->height) {
    a1 = P(b, row + 1, p1->f[COL]); a2 = P(b, row + 1, p2->f[COL]);
    if (a1->f[STATE] == HOVERING || a2->f[STATE] == HOVERING) return 0;
  }
  if (p1->f[COLOR] == 0 || p2->f[COLOR] == 0) {
    if (a1 && a2 && a1->f[STATE] == SWAPPING && a2->f[STATE] == SWAPPING &&
        (a1->f[COLOR] == 0 || a2->f[COLOR] == 0) && (a1->f[COLOR] != 0 || a2->f[COLOR] != 0)) return 0;
    if (row > 1) {
      Panel *b1 = P(b, row - 1, p1->f[COL]), *b2 = P(b, row - 1, p2->f[COL]);
      if (b1->f[STATE] == SWAPPING && b2->f[STATE] == SWAPPING &&
          (b1->f[COLOR] == 0 || b2->f[COLOR] == 0) && (b1->f[COLOR] != 0 || b2->f[COLOR] != 0)) return 0;
    }
  }
  if (b->swapStallingMode == 1) return wiggleCanSwap(b, p1, p2, cost);
  return 1;
}
static int tryQueueSwapPanels(Board *b, Panel *p1, Panel *p2) {
  int32_t cost;
  if (canSwapPanels(b, p1, p2, &cost)) {
    wiggleRegister(b, p1, p2, cost);
    b->swapCount++;
    b->queuedSwapCol = imin(p1->f[COL], p2->f[COL]);
    b->queuedSwapRow = p1->f[ROW];
    return 1;
  }
  return 0;
}
static void doSwap(Board *b, int row, int col) {
  b->quiet = 0; b->cdLeft = 0;
  b->hi = imax(b->hi, row + 1);
  startSwap(P(b, row, col), 1);
  startSwap(P(b, row, col + 1), 0);
  switchPanels(b, P(b, row, col), P(b, row, col + 1));
  Panel *left = P(b, row, col), *right = P(b, row, col + 1);
  if (row != 1) {
    Panel *bl = P(b, row - 1, col), *br = P(b, row - 1, col + 1);
    if (left->f[COLOR] != 0 && (bl->f[COLOR] == 0 || bl->f[STATE] == FALLING)) left->f[DONTSWAP] = 1;
    if (right->f[COLOR] != 0 && (br->f[COLOR] == 0 || br->f[STATE] == FALLING)) right->f[DONTSWAP] = 1;
  }
  if (row != b->height) {
    if (left->f[COLOR] == 0 && P(b, row + 1, col)->f[COLOR] != 0) left->f[DONTSWAP] = 1;
    if (right->f[COLOR] == 0 && P(b, row + 1, col + 1)->f[COLOR] != 0) right->f[DONTSWAP] = 1;
  }
}

// ---- matches (checkMatches.lua)
typedef struct { int32_t n; int32_t at[MAXMATCH]; } Cells;
#define CR(x) ((x) >> 3)
#define CC(x) ((x) & 7)
static void cellsPush(Board *b, Cells *l, int r, int c) { if (l->n < MAXMATCH) l->at[l->n++] = r * 8 + c; else b->err |= ERR_MATCH; }
static void getMatchingPanels(Board *b, Cells *out) {
  int32_t cand[W * 16], nc = 0, vert[16], horiz[8], nv, nh, r, c, i, j;
  out->n = 0;
  for (r = 1, nv = imin(b->height, rowsTo(b) - 1); r <= nv; r++)
    for (c = 1; c <= W; c++) { Panel *p = P(b, r, c); if (p->f[STATECHANGED] && canMatch(p)) cand[nc++] = r * 8 + c; }
  for (i = 0; i < nc; i++) {
    int cr = CR(cand[i]), cc = CC(cand[i]);
    Panel *cp = P(b, cr, cc);
    int32_t colour = cp->f[COLOR];
    nv = 0; nh = 0;
    for (r = cr - 1; r >= 1; r--) { Panel *p = P(b, r, cc); if (p->f[COLOR] == colour && canMatch(p)) vert[nv++] = r * 8 + cc; else break; }
    for (r = cr + 1; r <= b->height; r++) { Panel *p = P(b, r, cc); if (p->f[COLOR] == colour && canMatch(p)) vert[nv++] = r * 8 + cc; else break; }
    for (c = cc - 1; c >= 1; c--) { Panel *p = P(b, cr, c); if (p->f[COLOR] == colour && canMatch(p)) horiz[nh++] = cr * 8 + c; else break; }
    for (c = cc + 1; c <= W; c++) { Panel *p = P(b, cr, c); if (p->f[COLOR] == colour && canMatch(p)) horiz[nh++] = cr * 8 + c; else break; }
    if ((nv >= 2 || nh >= 2) && !SETB(cp->f[MATCHING])) { cellsPush(b, out, cr, cc); cp->f[MATCHING] = 1; }
    if (nv >= 2) for (j = 0; j < nv; j++) { Panel *p = P(b, CR(vert[j]), CC(vert[j])); if (!SETB(p->f[MATCHING])) { p->f[MATCHING] = 1; cellsPush(b, out, CR(vert[j]), CC(vert[j])); } }
    if (nh >= 2) for (j = 0; j < nh; j++) { Panel *p = P(b, CR(horiz[j]), CC(horiz[j])); if (!SETB(p->f[MATCHING])) { p->f[MATCHING] = 1; cellsPush(b, out, CR(horiz[j]), CC(horiz[j])); } }
  }
  for (i = 0; i < out->n; i++) { Panel *p = P(b, CR(out->at[i]), CC(out->at[i])); if (p->f[STATE] == HOVERING) p->f[CHAINING] = NUL; }
}
static int popBefore(int32_t a, int32_t b, int garbage) {
  int ar = CR(a), ac = CC(a), br = CR(b), bc = CC(b);
  if (ar == br) return garbage ? ac > bc : ac < bc;
  return garbage ? ar < br : ar > br;
}
static void sortByPopOrder(Cells *l, int garbage) {
  for (int i = 1; i < l->n; i++) {
    int32_t x = l->at[i]; int j = i - 1;
    while (j >= 0 && popBefore(x, l->at[j], garbage)) { l->at[j + 1] = l->at[j]; j--; }
    l->at[j + 1] = x;
  }
}
typedef struct { int32_t left, right, top, bottom, metal; } Box;
static int matchOnContact(const Box *a, const Box *b) {
  if (a->metal != b->metal) return 0;
  if (a->top == b->bottom - 1 || a->bottom == b->top + 1)
    return (a->left <= b->right && b->left <= a->left) || (b->left <= a->right && a->left <= b->left);
  if (a->right == b->left - 1 || a->left == b->right + 1)
    return (b->top >= a->bottom && b->top <= a->top) || (a->top >= b->bottom && a->top <= b->top);
  return 0;
}
// getConnectedGarbagePanels2. Returns 0 when no garbage is hit.
static int getConnectedGarbagePanels(Board *b, Cells *matching, Cells *out) {
  int32_t ids[MAXIDS], nid = 0, matched[MAXIDS], i, j, r, c;
  Box box[MAXIDS];
  out->n = 0;
  for (r = 1; r <= TOP(b); r++)
    for (c = 1; c <= W; c++) {
      Panel *p = P(b, r, c);
      int32_t *f = p->f;
      if (!(f[ISGARBAGE] && f[STATE] == NORMAL)) continue;
      int seen = 0;
      for (i = 0; i < nid; i++) if (ids[i] == f[GARBAGEID]) { seen = 1; break; }
      if (seen) continue;
      if (!((f[ROW] - f[YOFF]) <= b->height || f[GARBAGEID] <= b->highestGarbageIdMatched)) continue;
      if (nid >= MAXIDS) { b->err |= ERR_MATCH; return 0; }
      ids[nid] = f[GARBAGEID];
      box[nid].left = f[COL] - f[XOFF]; box[nid].right = f[COL] - f[XOFF] + f[GWIDTH] - 1;
      box[nid].top = f[ROW] - f[YOFF] + f[GHEIGHT] - 1; box[nid].bottom = f[ROW] - f[YOFF];
      box[nid].metal = SETB(f[METAL]);
      matched[nid] = 0;
      nid++;
    }
  if (!nid) return 0;
  int any = 0;
  for (i = 0; i < nid; i++) {
    Box *g = &box[i];
    for (j = 0; j < matching->n; j++) {
      int mr = CR(matching->at[j]), mc = CC(matching->at[j]);
      if (mr == g->bottom - 1 || mr == g->top + 1) { if (mc >= g->left && mc <= g->right) { matched[i] = 1; any = 1; } }
      else if (mc == g->left - 1 || mc == g->right + 1) { if (mr >= g->bottom && mr <= g->top) { matched[i] = 1; any = 1; } }
    }
  }
  if (!any) return 0;
  // every piece reached from a matched one through contact of its own kind
  int changed = 1;
  while (changed) {
    changed = 0;
    for (i = 0; i < nid; i++) {
      if (!matched[i]) continue;
      for (j = 0; j < nid; j++) if (!matched[j] && i != j && matchOnContact(&box[i], &box[j])) { matched[j] = 1; changed = 1; }
    }
  }
  int32_t hi = 0;
  for (i = 0; i < nid; i++) {
    if (!matched[i]) continue;
    if (ids[i] > hi) hi = ids[i];
    for (r = box[i].bottom; r <= box[i].top; r++) for (c = box[i].left; c <= box[i].right; c++) cellsPush(b, out, r, c);
  }
  if (hi > b->highestGarbageIdMatched) b->highestGarbageIdMatched = hi;
  return 1;
}
// Colours a break turns into, unseen (pa-engine.js Unseen): 130..219, as rows are.
static void convertGarbagePanels(Board *b, int isChain) {
  for (int r = 1; r <= TOP(b); r++) {
    int32_t k = 0;
    for (int c = 1; c <= W; c++) {
      Panel *p = P(b, r, c);
      if (p->f[YOFF] == -1 && p->f[COLOR] == 9) {
        if (!k) k = ++b->unseenBreaks;
        p->f[COLOR] = UNSEEN_COLOUR(130, k, c);
        if (isChain) p->f[CHAINING] = 1;
      }
    }
  }
}
static void matchGarbagePanels(Board *b, Cells *g, int32_t matchTime, int isChain, int32_t onScreen) {
  sortByPopOrder(g, 1);
  for (int i = 0; i < g->n; i++) {
    Panel *p = P(b, CR(g->at[i]), CC(g->at[i]));
    p->f[YOFF] -= 1; p->f[GHEIGHT] -= 1; p->f[STATE] = MATCHED;
    p->f[TIMER] = matchTime + 1; p->f[INITIALTIME] = matchTime;
    p->f[POPTIME] = b->fPOP * (onScreen - (i + 1)); p->f[POPINDEX] = imin(i + 1, 10);
    if (p->f[YOFF] == -1) b->sBroke++;
  }
  convertGarbagePanels(b, isChain);
}
static int32_t calculateStopTime(Board *b, int32_t comboSize, int toppedOut, int isChain, int32_t chainCounter) {
  int32_t t = 0;
  if (b->sFormula != 1) { b->err |= ERR_STATE; return 0; }
  if (comboSize > 3 || isChain) {
    if (toppedOut && isChain) t = b->sDangerConstant + ((chainCounter > 4 ? 6 : chainCounter) - 1) * b->sDangerCoefficient;
    else if (toppedOut) t = b->sCoefficient * (comboSize < 9 ? 2 : 3) + b->sChainConstant;
    else if (isChain) t = b->sCoefficient * imin(chainCounter, 13) + b->sChainConstant;
    else t = b->sCoefficient * comboSize + b->sComboConstant;
  }
  return t;
}
static void clearChainingFlags(Board *b) {
  int top = imin(rowsTo(b) - 1, b->height + 2);
  for (int r = 1; r <= top; r++)
    for (int c = 1; c <= W; c++) {
      Panel *p = P(b, r, c);
      if (SETB(p->f[CHAINING]) && !SETB(p->f[MATCHING]) && !p->f[MATCHANYWAY] && (canMatch(p) || p->f[COLOR] == 9)) {
        if (r > 1) { if (P(b, r - 1, c)->f[STATE] != SWAPPING) p->f[CHAINING] = NUL; }
        else p->f[CHAINING] = NUL;
      }
    }
}
static void checkMatches(Board *b) {
  Cells matching, garbage;
  getMatchingPanels(b, &matching);
  int32_t comboSize = matching.n;
  if (comboSize > 0) {
    int isChainLink = 0, i;
    for (i = 0; i < matching.n; i++) if (SETB(P(b, CR(matching.at[i]), CC(matching.at[i]))->f[CHAINING])) { isChainLink = 1; break; }
    if (isChainLink) b->chainCounter = b->chainCounter != 0 ? b->chainCounter + 1 : 2;
    b->manualRaise = 0;
    b->riseLock = 1;
    sortByPopOrder(&matching, 0);
    for (i = 0; i < comboSize; i++) {
      Panel *p = P(b, CR(matching.at[i]), CC(matching.at[i]));
      p->f[STATE] = MATCHED; p->f[TIMER] = b->fFLASH + b->fFACE + 1;
      if (isChainLink) p->f[CHAINING] = 1;
      if (SETN(p->f[FELL])) p->f[FELL] = NUL;
      p->f[COMBOINDEX] = i + 1; p->f[COMBOSIZE] = comboSize;
    }
    int32_t onScreen = 0;
    if (getConnectedGarbagePanels(b, &matching, &garbage)) {
      for (i = 0; i < garbage.n; i++) if (CR(garbage.at[i]) <= b->height) onScreen++;
      matchGarbagePanels(b, &garbage, b->fFLASH + b->fFACE + b->fPOP * (comboSize + onScreen), isChainLink, onScreen);
    }
    b->preStopTime = imax(b->preStopTime, b->fFLASH + b->fFACE + b->fPOP * (comboSize + onScreen));
    int32_t stopTime = calculateStopTime(b, comboSize, b->wasToppedOut, isChainLink, b->chainCounter);
    if (stopTime > b->stopTime) b->stopTime = stopTime;
    if (b->sNCombo < MAXCOMBOS) { b->sCombo[b->sNCombo] = comboSize; b->sChainAt[b->sNCombo] = b->chainCounter; b->sNCombo++; }
    b->sCleared += comboSize;
    if (stopTime > b->sEarned) b->sEarned = stopTime;
    int32_t bonus = b->chainCounter > 13 ? 0 : b->chainCounter;
    addScore(b, SCORE_CHAIN_TA[bonus]);
    if (comboSize > 3) addScore(b, SCORE_COMBO_TA[imin(30, comboSize)]);
  }
  clearChainingFlags(b);
}

// ---- garbage
static void removeExtraRows(Board *b) {
  for (int r = TOP(b); r >= b->height + 1; r--) {
    for (int c = 1; c <= W; c++) if (P(b, r, c)->f[COLOR] != 0) return;
    b->nrows = r;
  }
}
static int shouldDropGarbage(Board *b) {
  if (!b->ninc) return 0;
  Incoming *g = &b->inc[b->ninc - 1];
  if (isToppedOut(b)) return 0;
  if (hasFallingGarbage(b)) return 0;
  for (int r = b->height + 1; r <= TOP(b); r++)
    for (int c = 1; c <= W; c++) if (P(b, r, c)->f[COLOR] != 0) return 0;
  if (!hasActivePanels(b)) return 1;
  return g->height > 1;
}
static void dropGarbage(Board *b, int32_t width, int32_t height, int32_t isMetal) {
  b->quiet = 0; b->cdLeft = 0;
  b->hi = MAXROWS;
  int32_t originRow = b->height + 1;
  if (width < 1 || width > 6) { b->err |= ERR_WIDTH; return; }
  int32_t index = b->dropColumnIndex[width], originCol = DROP_COLUMNS[width][index - 1];
  b->dropColumnIndex[width] = (index % DROP_LEN[width]) + 1;
  b->garbageCreatedCount++;
  int32_t count = width * height, shake = count > 24 ? 76 : SHAKE_FRAMES[count - 1];
  for (int r = originRow; r <= originRow + height - 1; r++) {
    if (r < b->nrows) continue;
    if (r != b->nrows || r >= MAXROWS) { b->err |= ERR_ROWS; return; }
    b->nrows = r + 1;
    for (int c = 1; c <= W; c++) {
      Panel *p = createPanelAt(b, r, c);
      if (c >= originCol && c < originCol + width) {
        int32_t *f = p->f;
        f[GARBAGEID] = b->garbageCreatedCount; f[ISGARBAGE] = 1; f[COLOR] = 9; f[GWIDTH] = width; f[GHEIGHT] = height;
        f[YOFF] = r - originRow; f[XOFF] = c - originCol; f[SHAKETIME] = shake; f[STATE] = FALLING;
        if (isMetal) f[METAL] = 1;
      }
    }
  }
}
// GarbageQueue order: priority rising with index, the next to drop last.
static int orderBefore(const Incoming *a, const Incoming *b) {
  if (a->isChain == b->isChain) {
    if (a->isChain) {
      if (SETB(a->finalized) == SETB(b->finalized)) return a->frameEarned > b->frameEarned;
      return !SETB(a->finalized);
    }
    if (a->isMetal == b->isMetal) {
      if (a->width != b->width) return a->width > b->width;
      return a->frameEarned < b->frameEarned;
    }
    return a->isMetal;
  }
  return !a->isChain;
}
static void receiveGarbage(Board *b, const Incoming *g) {
  if (b->ninc >= MAXINC) { b->err |= ERR_INC; return; }
  b->inc[b->ninc++] = *g;
  for (int a = 1; a < b->ninc; a++) {
    Incoming x = b->inc[a]; int k = a - 1;
    while (k >= 0 && orderBefore(&x, &b->inc[k])) { b->inc[k + 1] = b->inc[k]; k--; }
    b->inc[k + 1] = x;
  }
}

// ---- the frame
// A ROW OF GARBAGE AT REST ON ITS OWN PIECE: every cell garbage, normal, its
// flags clear, on a cell of its own piece's row below (already updated this
// frame). updatePanel would clear flags already clear and find each cell
// held up -- supportedFromBelow stops on that row -- so the row is skipped.
static int restingRow(const Board *b, int r) {
  const Panel *row = b->p[r], *under = b->p[r - 1];
  for (int c = 1; c <= W; c++) {
    const int32_t *f = row[c].f, *u = under[c].f;
    if (!f[ISGARBAGE] || f[STATE] != NORMAL || f[STATECHANGED] || f[PROPCHAIN] || f[PROPFALL] || f[MATCHING]) return 0;
    if (!u[ISGARBAGE] || u[COLOR] == 0 || u[GARBAGEID] != f[GARBAGEID] || u[YOFF] == f[YOFF]) return 0;
  }
  return 1;
}
// A ROW OF POPPING GARBAGE whose timers reach neither a pop nor their end
// this frame: every cell garbage, matched, its flags clear, its timer past 1
// and not one past its pop time. updatePanel would only count each timer
// down, so that is all that is done.
static int poppingRow(Board *b, int r) {
  Panel *row = b->p[r];
  for (int c = 1; c <= W; c++) {
    const int32_t *f = row[c].f;
    if (!f[ISGARBAGE] || f[STATE] != MATCHED || f[STATECHANGED] || f[PROPCHAIN] || f[PROPFALL] || f[MATCHING]) return 0;
    if (f[TIMER] <= 1 || f[TIMER] - 1 == f[POPTIME]) return 0;
  }
  for (int c = 1; c <= W; c++) row[c].f[TIMER]--;
  b->popSeen = 1;
  return 1;
}
// A ROW AT REST: every cell normal with its flags clear, and each panel's cell
// below unchanged this frame (that row was updated already). updatePanel
// would clear flags already clear and find nothing below to react to.
static int quietRow(const Board *b, int r) {
  const Panel *row = b->p[r], *under = b->p[r - 1];
  for (int c = 1; c <= W; c++) {
    const int32_t *f = row[c].f;
    if (f[STATE] != NORMAL || f[STATECHANGED] || f[PROPCHAIN] || f[PROPFALL] || f[MATCHING]) return 0;
    if (f[COLOR] == 0) continue;
    if (f[ISGARBAGE] || under[c].f[STATECHANGED]) return 0;
  }
  return 1;
}
static void updatePanels(Board *b) {
  b->shakeTimeOnFrame = 0;
  b->popSeen = 0;
  // A panel that falls moves to the cell below, already updated; the one it
  // trades with comes up into this cell, which is not visited again.
  int n = rowsTo(b), r, c;
  for (r = 1; r < n; r++) {
    if (r > 1 && restingRow(b, r)) continue;
    if (quietRow(b, r)) continue;
    if (poppingRow(b, r)) continue;
    for (c = 1; c <= W; c++) updatePanel(b, P(b, r, c));
  }
  for (r = n - 1; r >= 1; r--) {
    for (c = 1; c <= W; c++) if (!settled(P(b, r, c)->f)) break;
    if (c <= W) break;
  }
  b->hi = r + 1;
}
// QUIET: a board on which a frame moves no panel. Every panel is at rest
// (normal, with no flag a neighbour or a scan reads,
// nothing chaining, garbage held up) and nothing is active. Matches are only
// looked for among panels that changed, so a frame on it changes only the
// stack's counters -- checkMatches finds nothing, every updatePanel clears
// flags already clear, nothing is counted active, no row is extra -- until
// something moves a panel: a swap, a row, a drop, each of which ends it (the
// rest of that frame is played in full). Decided after a full frame;
// native_pa.test.js holds every frame to pa-engine.js.
static int isQuiet(Board *b) {
  if (b->nActive || b->nPrevActive || b->swappingCount || swapQueued(b) || b->chainCounter) return 0;
  // Row 0 is neither updated nor scanned, and what reads it (updateNormal
  // on row 1) reads a change flag only a row sets.
  for (int r = 1, n = rowsTo(b); r < n; r++)
    for (int c = 1; c <= W; c++) {
      const int32_t *f = b->p[r][c].f;
      if (f[STATE] != NORMAL || f[STATECHANGED] != 0 || f[PROPCHAIN] != 0 || f[MATCHING] != 0 || f[PROPFALL] != 0 ||
          SETB(f[CHAINING]) || f[MATCHANYWAY] || SETB(f[QUEUEDHOVER]) || SETN(f[FELL])) return 0;
      if (f[ISGARBAGE] && !supportedFromBelow(b, &b->p[r][c])) return 0;
    }
  return 1;
}
static int32_t countdownRoom(Board *b);
static void countdownFrame(Board *b);
static void runPhysics(Board *b) {
  b->nlanded = 0;
  b->wasToppedOut = isToppedOut(b);
  decrementInvincibilityTimers(b);
  updateRiseLock(b);
  updateSpeed(b);
  if (b->passiveRaise || b->preventManualRaise) { if (advancePassiveRaise(b)) { if (checkDeath(b)) recordDeath(b); } }
  if (!b->wasToppedOut && b->health != b->maxHealth && !hasFallingGarbage(b)) b->health = b->maxHealth;
  if (b->displacement % 16 != 0) b->topCurRow = b->height - 1;
  if (swapQueued(b)) { doSwap(b, b->queuedSwapRow, b->queuedSwapCol); b->queuedSwapCol = 0; b->queuedSwapRow = 0; }
  if (b->quiet && !b->noQuiet) {
    STAT(17)++;
    b->shakeTimeOnFrame = 0;
    b->nPrevActive = b->nActive;
  } else if (b->cdLeft > 0 && !b->noQuiet) {
    STAT(19)++;
    countdownFrame(b);
  } else {
    STAT(16)++;
    checkMatches(b);
    updatePanels(b);
    updateActivePanelCount(b);
    if (b->chainCounter != 0 && !hasChainingPanels(b)) b->chainCounter = 0;
    removeExtraRows(b);
    b->quiet = !b->noQuiet && isQuiet(b);
    // countdownRoom needs garbage popping, and every cell of it was updated just now
    b->cdLeft = b->popSeen && !b->quiet && !b->noQuiet && b->nActive > 0 && !b->swappingCount && !swapQueued(b) ? countdownRoom(b) : 0;
  }
  if (checkDeath(b)) recordDeath(b);
}
// Stack:run, past the countdown. b->input is the frame's keys; pressSwap
// adds swap (tryQueueSwap); swapDenied says a swap pressed was not taken.
static void run(Board *b) {
  if (b->gameOverClock > 0 && b->clock >= b->gameOverClock) return;
  if (b->inCountdown || !b->stopWatchIsRunning) { b->err |= ERR_STATE; return; }
  int pressed = b->pressSwap || (b->input & IN_SWAP);
  int32_t queuedBefore = b->swapCount;
  b->swapDenied = 0;
  b->inputBits = b->input | (b->pressSwap ? IN_SWAP : 0);
  b->input = 0; b->pressSwap = 0;
  controls(b);
  runPhysics(b);
  applyCursorDirection(b, b->cursorDirection);
  if (b->swapThisFrame) tryQueueSwapPanels(b, P(b, b->curRow, b->curCol), P(b, b->curRow, b->curCol + 1));
  if (pressed && b->swapCount == queuedBefore) b->swapDenied = 1;
  handleManualRaise(b);
  if (shouldDropGarbage(b)) {
    Incoming g = b->inc[--b->ninc];
    dropGarbage(b, g.width, g.height, g.isMetal);
  }
  b->stopWatch++;
  b->clock++;
}
// COUNTDOWN: frames on which only timers run. With nothing pressed and
// nothing queued, every panel at rest with no flag set -- empty, a coloured
// panel, garbage held up -- or garbage popping, no chain counting, the active
// count steady, no landing shake this frame and no garbage able to drop, a
// frame changes only the popping timers, the stop, pre-stop and shake time,
// the cursor's timer and the clocks. countdown plays up to maxk such frames
// at once and returns how many: never the frame a popping timer runs out,
// the speed rises, or shake runs out with no health left. run() k times
// leaves the board the same (native_countdown.test.js).
// The panels' half of COUNTDOWN: the frames, from this one, on which every
// panel is at rest or popping garbage, no flag is set and no popping timer
// runs out -- the least popping timer less one; 0 if any panel would move,
// match or change, or nothing pops.
static int32_t countdownRoom(Board *b) {
  int32_t k = 0x7fffffff, popping = 0;
  int n = rowsTo(b), top = imin(n - 1, b->height + 2);
  for (int r = n - 1; r >= 1; r--)   // from the top, where what moves usually is
    for (int c = 1; c <= W; c++) {
      Panel *p = P(b, r, c);
      const int32_t *f = p->f;
      if (f[STATECHANGED] || f[PROPCHAIN] || f[PROPFALL] || f[MATCHING] || f[MATCHANYWAY] || SETB(f[QUEUEDHOVER])) return 0;
      if (r <= top && SETB(f[CHAINING]) && (canMatch(p) || f[COLOR] == 9)) return 0;   // clearChainingFlags would clear it
      if (f[ISGARBAGE]) {
        if (f[STATE] == MATCHED) { if (f[TIMER] < 2) return 0; k = imin(k, f[TIMER] - 1); popping = 1; continue; }
        if (f[STATE] != NORMAL || !supportedFromBelow(b, p)) return 0;
        continue;
      }
      if (f[STATE] != NORMAL || SETN(f[FELL])) return 0;
    }
  return popping ? k : 0;
}
// COUNTDOWN FRAMES: after a frame played in full leaves the board in that
// state, the next cdLeft frames skip the panel passes and count the popping
// timers down, the rest of the frame (cursor, stop and shake time, clocks,
// death) played as ever. A swap, a new row or a drop ends it.
static void countdownFrame(Board *b) {
  int n = rowsTo(b);
  for (int r = 1; r < n; r++)
    for (int c = 1; c <= W; c++) { int32_t *f = P(b, r, c)->f; if (f[ISGARBAGE] && f[STATE] == MATCHED) f[TIMER]--; }
  b->shakeTimeOnFrame = 0;
  b->nPrevActive = b->nActive;
  if (b->chainCounter != 0 && !hasChainingPanels(b)) b->chainCounter = 0;
  b->quiet = 0;
  b->cdLeft--;
}
static int countdown(Board *b, int32_t maxk) {
  if (maxk <= 0 || b->gameOverClock > 0 || b->input || b->pressSwap || b->err || b->inCountdown || !b->stopWatchIsRunning) return 0;
  if (swapQueued(b) || b->manualRaise || b->chainCounter || b->nActive != b->nPrevActive || b->shakeTimeOnFrame) return 0;
  if (b->cursorDirection != CD_NULL || b->quiet || b->speedIncreaseMode != 1) return 0;
  if (shouldDropGarbage(b)) return 0;
  int32_t k = maxk;
  if (b->nextSpeedIncreaseClock >= b->clock) k = imin(k, b->nextSpeedIncreaseClock - b->clock);
  if (b->health <= 0) k = imin(k, b->shakeTime - 1);
  int n = rowsTo(b);
  k = imin(k, countdownRoom(b));   // with nothing popping the board is quiet, which run() already makes cheap
  if (k <= 0) return 0;
  for (int r = 1; r < n; r++)
    for (int c = 1; c <= W; c++) { int32_t *f = P(b, r, c)->f; if (f[ISGARBAGE] && f[STATE] == MATCHED) f[TIMER] -= k; }
  // decrementInvincibilityTimers, k times
  b->prevShakeTime = imax(b->shakeTime - (k - 1), 0);
  b->shakeTime = imax(b->shakeTime - k, 0);
  if (b->shakeTime == 0) b->peakShakeTime = 0;
  int32_t d = imin(k, b->preStopTime);
  b->preStopTime -= d;
  b->stopTime = imax(b->stopTime - (k - d), 0);
  // the rest of a frame, done once: each is the same every frame
  b->nlanded = 0;
  b->wasToppedOut = isToppedOut(b);
  b->riseLock = 1;
  if (!b->wasToppedOut && b->health != b->maxHealth && !hasFallingGarbage(b)) b->health = b->maxHealth;
  if (b->displacement % 16 != 0) b->topCurRow = b->height - 1;
  b->curTimer = imin(b->curWaitTime, b->curTimer + 2 * k);   // controls and applyCursorDirection each count it
  b->curRow = bound(1, b->curRow, b->topCurRow);
  b->swapThisFrame = 0; b->swapDenied = 0; b->inputBits = 0;
  b->quiet = 0;
  b->stopWatch += k; b->clock += k;
  b->cdLeft = imax(0, b->cdLeft - k);
  STAT(18) += k;
  return k;
}
// What a bot calls: press swap on the next frame with the cursor at (r, c).
static int tryQueueSwap(Board *b, int r, int c) {
  if (b->gameOverClock > 0) return 0;
  if (r != b->curRow || c != b->curCol) return 0;
  b->pressSwap = 1;
  return 1;
}
static int canSwap(Board *b, int row, int col) {
  int32_t cost;
  if (row < 1 || row > b->height || col < 1 || col >= W) return 0;
  return canSwapPanels(b, P(b, row, col), P(b, row, col + 1), &cost);
}


// ------------------------------------------------------------------ the wire
// HEAD (float64) holds the stack's scalars under pa-engine.js's own names --
// "levelData.x", "frames.X" and "behaviours.x" for the constants -- with NaN
// for Lua nil; BODY (int32) every panel's fields for rows 0..nrows-1, then
// incoming (6 each), the stall log (5 each), garbage landed this frame and
// dropColumnIndex[1..6]. native.js reads the names from pa_head_name.
#define HEAD(X) \
  X(nrows, nrows) X(colors, levelData.colors) X(maxHealth, levelData.maxHealth) X(shockFrequency, levelData.shockFrequency) \
  X(shockCap, levelData.shockCap) X(speedIncreaseMode, levelData.speedIncreaseMode) \
  X(fHOVER, frames.HOVER) X(fGARBAGE_HOVER, frames.GARBAGE_HOVER) X(fFLASH, frames.FLASH) X(fFACE, frames.FACE) X(fPOP, frames.POP) \
  X(sFormula, levelData.stop.formula) X(sComboConstant, levelData.stop.comboConstant) X(sChainConstant, levelData.stop.chainConstant) \
  X(sDangerConstant, levelData.stop.dangerConstant) X(sCoefficient, levelData.stop.coefficient) \
  X(sDangerCoefficient, levelData.stop.dangerCoefficient) \
  X(passiveRaise, behaviours.passiveRaise) X(allowManualRaise, behaviours.allowManualRaise) \
  X(swapStallingMode, behaviours.swapStallingMode) X(swapStallingPunish, behaviours.swapStallingPunish) X(height, height) \
  X(panelIdCount, panelIdCount) X(speed, speed) X(nextSpeedIncreaseClock, nextSpeedIncreaseClock) X(clock, clock) X(stopWatch, stopWatch) \
  X(stopWatchIsRunning, stopWatchIsRunning) X(inCountdown, inCountdown) X(displacement, displacement) X(riseLock, riseLock) \
  X(hasRisen, hasRisen) X(manualRaise, manualRaise) X(manualRaiseYet, manualRaiseYet) X(preventManualRaise, preventManualRaise) \
  X(swapThisFrame, swapThisFrame) X(stopTime, stopTime) X(preStopTime, preStopTime) X(shakeTime, shakeTime) \
  X(prevShakeTime, prevShakeTime) X(shakeTimeOnFrame, shakeTimeOnFrame) X(peakShakeTime, peakShakeTime) X(health, health) \
  X(wasToppedOut, wasToppedOut) X(chainCounter, chainCounter) X(nActive, nActive) X(nPrevActive, nPrevActive) \
  X(swappingCount, swappingCount) X(panelsCleared, panelsCleared) X(metalPanelsQueued, metalPanelsQueued) X(score, score) \
  X(curRow, curRow) X(curCol, curCol) X(topCurRow, topCurRow) X(queuedSwapRow, queuedSwapRow) X(queuedSwapCol, queuedSwapCol) \
  X(swapCount, swapCount) X(curTimer, curTimer) X(curWaitTime, curWaitTime) X(cursorDirection, cursorDirection) \
  X(cursorLock, cursorLock) X(garbageCreatedCount, garbageCreatedCount) X(highestGarbageIdMatched, highestGarbageIdMatched) \
  X(gameOverClock, gameOverClock) X(gameOver, gameOver) X(input, nextInput) X(pressSwap, pressSwap) X(swapDenied, swapDeniedThisFrame) \
  X(unseenRows, unseenRows) X(unseenBreaks, unseenBreaks) X(err, err) X(ninc, ninc) X(nstall, nstall) X(nlanded, nlanded)
#define COUNT1(f, n) + 1
#define NHEAD (1 HEAD(COUNT1))
#define NBODY (MAXROWS * W * NF + MAXINC * 6 + MAXSTALL * 5 + MAXLANDED + 6 + 64 * 5)   // and the arrivals after the board (search.h MAXARR)
static double ioHead[NHEAD];
static int32_t ioBody[NBODY];
EXPORT(nb_io_head) double *nb_io_head(void) { return ioHead; }
EXPORT(nb_io_body) int32_t *nb_io_body(void) { return ioBody; }
EXPORT(nb_nhead) int nb_nhead(void) { return NHEAD; }
#define NAME1(f, n) #n,
static const char *headNames[] = { "riseTimer", HEAD(NAME1) };
EXPORT(nb_head_name) const char *nb_head_name(int i) { return i >= 0 && i < NHEAD ? headNames[i] : 0; }
static int32_t fromD(double v) { return v != v ? NUL : (int32_t)v; }
static double toD(int32_t v) { return v == NUL ? __builtin_nan("") : (double)v; }
EXPORT(nb_load) int nb_load(Board *b) {
  int k = 0, i, r, c, f;
  const int32_t *x = ioBody;
  b->riseTimer = ioHead[k++];
#define LOAD1(fl, n) b->fl = fromD(ioHead[k++]);
  HEAD(LOAD1)
  int err = 0;
  if (b->nrows < 13 || b->nrows > MAXROWS) err |= ERR_ROWS;
  if (b->ninc < 0 || b->ninc > MAXINC) err |= ERR_INC;
  if (b->nstall < 0 || b->nstall > MAXSTALL) err |= ERR_STALL;
  if (b->nlanded < 0 || b->nlanded > MAXLANDED) err |= ERR_LANDED;
  if (err) return err;
  for (r = 0; r < b->nrows; r++) for (c = 1; c <= W; c++) for (f = 0; f < NF; f++) b->p[r][c].f[f] = *x++;
  for (i = 0; i < b->ninc; i++) {
    Incoming *g = &b->inc[i];
    g->width = *x++; g->height = *x++; g->isChain = *x++; g->isMetal = *x++; g->frameEarned = *x++; g->finalized = *x++;
  }
  for (i = 0; i < b->nstall; i++) {
    Stall *s = &b->stall[i];
    s->leftId = *x++; s->rightId = *x++; s->row = *x++; s->col = *x++; s->clock = *x++;
  }
  for (i = 0; i < b->nlanded; i++) b->landed[i] = *x++;
  b->dropColumnIndex[0] = 0;
  for (i = 1; i <= 6; i++) b->dropColumnIndex[i] = *x++;
  b->quiet = 0; b->noQuiet = 0; b->hi = MAXROWS; b->cdLeft = 0;
  return b->err;
}
EXPORT(nb_save) int nb_save(Board *b) {
  int k = 0, i, r, c, f;
  int32_t *x = ioBody;
  ioHead[k++] = b->riseTimer;
#define SAVE1(fl, n) ioHead[k++] = toD(b->fl);
  HEAD(SAVE1)
  for (r = 0; r < b->nrows; r++) for (c = 1; c <= W; c++) for (f = 0; f < NF; f++) *x++ = b->p[r][c].f[f];
  for (i = 0; i < b->ninc; i++) {
    Incoming *g = &b->inc[i];
    *x++ = g->width; *x++ = g->height; *x++ = g->isChain; *x++ = g->isMetal; *x++ = g->frameEarned; *x++ = g->finalized;
  }
  for (i = 0; i < b->nstall; i++) { Stall *s = &b->stall[i]; *x++ = s->leftId; *x++ = s->rightId; *x++ = s->row; *x++ = s->col; *x++ = s->clock; }
  for (i = 0; i < b->nlanded; i++) *x++ = b->landed[i];
  for (i = 1; i <= 6; i++) *x++ = b->dropColumnIndex[i];
  return (int)(x - ioBody);
}

// ------------------------------------------------------------------ one call at a time
EXPORT(nb_set_input) void nb_set_input(Board *b, int32_t bits) { b->input = bits; }
EXPORT(nb_run) int nb_run(Board *b) { run(b); return b->err; }
EXPORT(nb_countdown) int nb_countdown(Board *b, int maxk) { return countdown(b, maxk); }
EXPORT(nb_try_queue_swap) int nb_try_queue_swap(Board *b, int r, int c) { return tryQueueSwap(b, r, c); }
EXPORT(nb_can_swap) int nb_can_swap(Board *b, int r, int c) { return canSwap(b, r, c); }
EXPORT(nb_push_incoming) void nb_push_incoming(Board *b, int32_t w, int32_t h, int32_t isChain, int32_t isMetal) {
  Incoming g = { w, h, isChain, isMetal, b->stopWatch, NUL };
  receiveGarbage(b, &g);
}
// A piece as the Lua has it: when it was earned and whether it is final.
EXPORT(nb_receive) void nb_receive(Board *b, int32_t w, int32_t h, int32_t isChain, int32_t isMetal, int32_t frameEarned, int32_t finalized) {
  Incoming g = { w, h, isChain, isMetal, frameEarned, finalized };
  receiveGarbage(b, &g);
}
EXPORT(nb_game_over) int nb_game_over(Board *b) { return b->gameOver; }
EXPORT(nb_no_quiet) void nb_no_quiet(Board *b, int off) { b->noQuiet = off; if (off) b->quiet = 0; }
EXPORT(nb_quiet) int nb_quiet(Board *b) { return b->quiet; }
EXPORT(nb_clock) int nb_clock(Board *b) { return b->clock; }
// What survivor.js predict needs of a board it plays on: swap pressed as the
// frame loop presses it, the garbage queued, the frame it ends and its stopwatch.
EXPORT(nb_press_swap) void nb_press_swap(Board *b) { b->pressSwap = 1; }
EXPORT(nb_ninc) int nb_ninc(Board *b) { return b->ninc; }
EXPORT(nb_over_clock) int nb_over_clock(Board *b) { return b->gameOverClock; }
EXPORT(nb_stopwatch) int nb_stopwatch(Board *b) { return b->stopWatch; }
// The raise as search.h raiseStep reads it: 1 manualRaise, 2 preventManualRaise.
EXPORT(nb_raise_state) int nb_raise_state(Board *b) { return (b->manualRaise ? 1 : 0) | (b->preventManualRaise ? 2 : 0); }
static void cloneBoard(Board *dst, const Board *src) { copyBoard(dst, src); }
EXPORT(nb_clone) void nb_clone(Board *dst, Board *src) { cloneBoard(dst, src); }

// ---- what the search needs from this engine (search.h)
#define KEY_COLOR(f) ((f)[ISGARBAGE] ? (SETB((f)[METAL]) ? 254 : 255) : ((f)[COLOR] & 255))
#define SWAP_PRESSED 1
#define SENT_KEYS(st, input) ((input) | ((st)->pressSwap ? IN_SWAP : 0))
#define NODE_BREAKS(b) ((b)->unseenBreaks)
#define STEP_STATS 1
#define COUNTDOWN 1
#define SHARED_WALK 1
#define TOUCH_SCORE 1
#define SETTLE_CAP 900   // frames a settle runs at most, as the bot's resolve (engineboard.js settle)
#include "search.h"
// What node i's step did (MK_SETTLE), into the io body: clears, panels
// cleared, garbage cells converted, the most stop time one clear paid, then
// each clear's size and chain counter. Returns the words written, or -1.
EXPORT(ns_step_stats) int ns_step_stats(Ctx *x, int i) {
  Board *b = ensureBoard(x, i);
  if (!b) return -1;
  int32_t *o = ioBody, k = 0;
  o[k++] = b->sNCombo; o[k++] = b->sCleared; o[k++] = b->sBroke; o[k++] = b->sEarned;
  for (int j = 0; j < b->sNCombo; j++) { o[k++] = b->sCombo[j]; o[k++] = b->sChainAt[j]; }
  return k;
}
// Garbage rows broken on node i's board since the game began (convertGarbagePanels).
EXPORT(ns_breaks) int ns_breaks(Ctx *x, int i) { Board *b = ensureBoard(x, i); return b ? b->unseenBreaks : -1; }
