// THE ENGINE IN C, for the survival search. panel-engine.js line for line, on
// a board whose panels are plain structs, so a copy is one block of memory.
// The search's boards only: countdown over, no rng -- rows and breaks dealt
// in the search are the unseen colours puyocpu.js deals (unseenRow,
// unseenBreak) -- and events are not kept. native.test.js plays it beside
// panel-engine.js and compares every field after every frame.
#include "libc.h"

#define W 6
#define MAXROWS 48
#define NUL (-2147483647 - 1)
#define UND (-2147483647)

enum { ROW, COL, ID, COLOR, CHAINING, MATCHING, TIMER, INITIALTIME, POPTIME, POPINDEX, XOFF, YOFF, GWIDTH,
       GHEIGHT, SHAKETIME, ISGARBAGE, STATE, COMBOINDEX, COMBOSIZE, SWAPFROMLEFT, DONTSWAP, QUEUEDHOVER, FELL,
       STATECHANGED, PROPCHAIN, MATCHANYWAY, PROPFALL, GARBAGEID, NF };
enum { NORMAL, DIMMED, SWAPPING, MATCHED, POPPING, POPPED, HOVERING, FALLING, LANDING };

typedef struct { int32_t f[NF]; } Panel;
// Garbage in flight: an outgoing piece, or the chain still growing.
typedef struct { int32_t width, height, isChain, frameEarned, finalized, orow, ocol; } Garb;

#define MAXINC 32
#define MAXOUT 64
#define MAXSTALL 32
#define MAXLANDED 16
#define MAXMATCH 160

// Board.err: something the port has no room for. The board is then wrong
// and the caller must refuse it, never read it.
#define ERR_ROWS 1
#define ERR_INC 2
#define ERR_OUT 4
#define ERR_STALL 8
#define ERR_LANDED 16
#define ERR_MATCH 32
#define ERR_WIDTH 64

typedef struct Board {
  // constants of the level
  int32_t colors, maxHealth, height, fHOVER, fGARBAGE_HOVER, fFLASH, fFACE, fPOP;
  int32_t sComboConstant, sChainConstant, sDangerConstant, sCoefficient, sDangerCoefficient;
  // state
  double riseTimer;
  int32_t nrows, panelIdCount, speed, nextSpeedIncreaseClock, clock, displacement;
  int32_t riseLock, hasRisen, manualRaise, manualRaiseYet, preventManualRaise;
  int32_t stopTime, preStopTime, shakeTime, shakeTimeOnFrame, peakShakeTime, health, wasToppedOut;
  int32_t chainCounter, nActive, nPrevActive, swappingCount, panelsCleared, score;
  int32_t curRow, curCol, topCurRow, queuedSwapRow, queuedSwapCol, garbageCreatedCount, highestGarbageIdMatched;
  // cursorDirection: CD_UND, CD_NULL, or DIR_UP..DIR_RIGHT
  int32_t gameOver, cursorTimer, cursorDirection, input, prevInput, unseenRows, unseenBreaks;
  int32_t stopWatchIsRunning, animatingCursor, hasChain, chainAt, err, swapDenied;  // chainAt: the chain's entry in out, or -1
  int32_t quiet, noQuiet;  // see QUIET; not part of the board, never sent
  int32_t hi;  // see SETTLED ROWS; not part of the board, never sent
  Garb chain;
  int32_t ninc, nout, nstall, nlanded;
  int32_t dropColumnIndex[7];     // -1: never set
  int32_t inc[MAXINC][3];         // width, height, isChain
  Garb out[MAXOUT];
  int32_t stall[MAXSTALL][2];
  int32_t landed[MAXLANDED];
  // panels last, so a copy can stop at nrows
  Panel p[MAXROWS][W + 1];
} Board;
#define BOARD_HEAD ((unsigned long)&((Board *)0)->p)
#define BOARD_BYTES(b) (BOARD_HEAD + (unsigned long)(b)->nrows * sizeof(Panel) * (W + 1))

#define CD_UND (-2)
#define CD_NULL (-1)
#define DIR_UP 0
#define DIR_DOWN 1
#define DIR_LEFT 2
#define DIR_RIGHT 3

#define IN_LEFT 1
#define IN_RIGHT 2
#define IN_UP 4
#define IN_DOWN 8
#define IN_SWAP 16
#define IN_RAISE 32

static int32_t imax(int32_t a, int32_t b) { return a > b ? a : b; }
static int32_t imin(int32_t a, int32_t b) { return a < b ? a : b; }
static int32_t nz(int32_t v) { return v == NUL ? 0 : v; }


static const int SPEED_TO_RISE_TIME[99] = {
  942, 983, 838, 790, 755, 695, 649, 604, 570, 515, 474, 444, 394, 370, 347, 325, 306, 289, 271, 256,
  240, 227, 213, 201, 189, 178, 169, 158, 148, 138, 129, 120, 112, 105, 99, 92, 86, 82, 77, 73,
  69, 66, 62, 59, 56, 54, 52, 50, 48, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
  47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47,
  47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47, 47 };
static double riseTime(int32_t speed) {
  int32_t i = imin(99, imax(1, speed)) - 1;
  return (double)SPEED_TO_RISE_TIME[i] / 16.0;
}
static const int SHAKE_FRAMES[24] = { 18, 18, 18, 18, 24, 42, 42, 42, 42, 42, 42, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 66, 76 };
static int32_t shakeFramesFor(int32_t width, int32_t height) {
  int32_t count = width * height;
  if (count <= 0) return 0;
  return SHAKE_FRAMES[imin(count, 24) - 1];
}
static const int SCORE_COMBO_TA[31] = { 0, 0, 0, 0, 20, 30, 50, 60, 70, 80, 100, 140, 170, 210, 250, 290, 340, 390, 440, 490, 550, 610, 680, 750, 820, 900, 980, 1060, 1150, 1240, 1330 };
static const int SCORE_CHAIN_TA[14] = { 0, 0, 50, 80, 150, 300, 400, 500, 700, 900, 1100, 1300, 1500, 1800 };
// COMBO_GARBAGE: pieces for a combo size (widths), up to 8 pieces.
static int comboGarbage(int32_t size, int32_t *out) {
  static const int keys[] = { 27, 20, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4 };
  int32_t s = imin(size, 27);
  for (int k = 0; k < 13; k++) {
    if (keys[k] > s) continue;
    switch (keys[k]) {
      case 4: out[0] = 3; return 1;
      case 5: out[0] = 4; return 1;
      case 6: out[0] = 5; return 1;
      case 7: out[0] = 6; return 1;
      case 8: out[0] = 3; out[1] = 4; return 2;
      case 9: out[0] = 4; out[1] = 4; return 2;
      case 10: out[0] = 5; out[1] = 5; return 2;
      case 11: out[0] = 5; out[1] = 6; return 2;
      case 12: out[0] = 6; out[1] = 6; return 2;
      case 13: for (int i = 0; i < 3; i++) out[i] = 6; return 3;
      case 14: for (int i = 0; i < 4; i++) out[i] = 6; return 4;
      case 20: for (int i = 0; i < 6; i++) out[i] = 6; return 6;
      case 27: for (int i = 0; i < 8; i++) out[i] = 6; return 8;
    }
  }
  return 0;
}

#define P(b, r, c) (&(b)->p[(r)][(c)])
// SETTLED ROWS. A settled cell is empty, not garbage, normal, with no flag
// set that updatePanel clears: updatePanel leaves it as it is and no scan
// finds anything in it. Every row from `hi` up is settled, so every pass over
// the board stops there. Only a panel moving into a row, a swap, a drop or a
// new row unsettles one, and each raises hi; updatePanels lowers it again.
static int rowsTo(const Board *b) { return b->hi < b->nrows ? b->hi : b->nrows; }
static int settled(const int32_t *f) {
  return f[COLOR] == 0 && !f[ISGARBAGE] && f[STATE] == NORMAL && !f[STATECHANGED] && !f[PROPCHAIN] && f[PROPFALL] == 0 && !f[MATCHING];
}

// ------------------------------------------------------------------ panels
static void clearFlags(Panel *p, int clearChaining) {
  int32_t *f = p->f;
  f[STATE] = NORMAL; f[COMBOINDEX] = NUL; f[COMBOSIZE] = NUL; f[SWAPFROMLEFT] = NUL; f[DONTSWAP] = 0; f[QUEUEDHOVER] = 0;
  if (clearChaining) f[CHAINING] = 0;
  f[FELL] = 0; f[STATECHANGED] = 0; f[PROPCHAIN] = 0; f[MATCHANYWAY] = 0;
}
static void clearPanel(Panel *p, int clearChaining, int clearColor) {
  int32_t *f = p->f;
  if (clearColor) f[COLOR] = 0;
  f[TIMER] = 0; f[INITIALTIME] = 0; f[POPTIME] = 0; f[POPINDEX] = 0; f[XOFF] = NUL; f[YOFF] = NUL;
  f[GWIDTH] = 0; f[GHEIGHT] = 0; f[SHAKETIME] = 0; f[ISGARBAGE] = 0;
  clearFlags(p, clearChaining);
}
static void makePanel(Panel *p, int32_t row, int32_t col, int32_t id) {
  int32_t *f = p->f;
  f[ROW] = row; f[COL] = col; f[ID] = id; f[COLOR] = 0; f[CHAINING] = 0; f[MATCHING] = 0;
  clearPanel(p, 1, 1);
  f[PROPFALL] = UND; f[GARBAGEID] = UND;
}
static void makeEmptyRow(Board *b, int32_t row) {
  for (int c = 1; c <= W; c++) makePanel(P(b, row, c), row, c, ++b->panelIdCount);
}
// Two panels trade places: the structs move, and each takes its new cell.
static void switchPanels(Board *b, int ar, int ac, int br, int bc) {
  Panel t = b->p[ar][ac];
  b->p[ar][ac] = b->p[br][bc];
  b->p[br][bc] = t;
  b->p[ar][ac].f[ROW] = ar; b->p[ar][ac].f[COL] = ac;
  b->p[br][bc].f[ROW] = br; b->p[br][bc].f[COL] = bc;
}
static int supportedFromBelow(Board *b, int r, int c) {
  Panel *p = P(b, r, c);
  if (r <= 1) return 1;
  if (!p->f[ISGARBAGE]) return P(b, r - 1, c)->f[COLOR] != 0;
  int start = c - nz(p->f[XOFF]), end = start + p->f[GWIDTH] - 1;
  for (int col = start; col <= end; col++) {
    Panel *below = P(b, r - 1, col);
    if (below->f[COLOR] != 0) {
      if (!below->f[ISGARBAGE]) return 1;
      if (p->f[GARBAGEID] == below->f[GARBAGEID]) {
        if (p->f[YOFF] != below->f[YOFF]) return 1;
      } else return 1;
    }
  }
  return 0;
}
// p at (r,c) falls: it goes to r-1 and the panel below comes up to r.
static void fall(Board *b, int r, int c) {
  switchPanels(b, r, c, r - 1, c);
  Panel *p = P(b, r - 1, c), *above = P(b, r, c);
  if (p->f[ISGARBAGE]) { above->f[PROPFALL] = 1; above->f[STATECHANGED] = 1; }
  if (p->f[STATE] != FALLING) { p->f[STATE] = FALLING; p->f[TIMER] = 0; p->f[STATECHANGED] = 1; }
}
static void onGarbageLand(Board *b, Panel *p) {
  if (p->f[SHAKETIME] && p->f[ROW] <= b->height) {
    int seen = 0;
    for (int i = 0; i < b->nlanded; i++) if (b->landed[i] == p->f[GARBAGEID]) seen = 1;
    if (!seen) {
      b->shakeTimeOnFrame = imax(imax(b->shakeTimeOnFrame, p->f[SHAKETIME]), b->peakShakeTime);
      b->peakShakeTime = imax(b->shakeTimeOnFrame, b->peakShakeTime);
      if (b->nlanded < MAXLANDED) b->landed[b->nlanded++] = p->f[GARBAGEID]; else b->err |= ERR_LANDED;
    }
    p->f[SHAKETIME] = 0;
  }
}
static void land(Board *b, Panel *p) {
  if (p->f[ISGARBAGE]) { onGarbageLand(b, p); p->f[STATE] = NORMAL; }
  else { p->f[FELL] = 0; p->f[STATE] = LANDING; p->f[TIMER] = 12; }
  p->f[STATECHANGED] = 1;
}
static void enterHoverFromNormal(Board *b, Panel *p, Panel *below, int32_t hoverTime) {
  clearFlags(p, 0);
  p->f[STATE] = HOVERING;
  if (below->f[PROPCHAIN] == 1) {
    p->f[PROPCHAIN] = 1;
    p->f[CHAINING] = 1;
    if (below->f[COLOR] == 0 || below->f[MATCHANYWAY]) p->f[MATCHANYWAY] = 1;
    else {
      Panel *source = below;
      while (source->f[STATE] == SWAPPING ||
             (source->f[STATECHANGED] && source->f[PROPCHAIN] && !source->f[MATCHANYWAY] && source->f[STATE] == HOVERING)) {
        source = P(b, source->f[ROW] - 1, source->f[COL]);
      }
      if (source->f[PROPCHAIN]) p->f[MATCHANYWAY] = (source->f[COLOR] == 0 || source->f[MATCHANYWAY]) ? 1 : 0;
    }
  }
  p->f[TIMER] = hoverTime;
  p->f[STATECHANGED] = 1;
}
static void updateNormal(Board *b, int r, int c) {
  Panel *p = P(b, r, c);
  if (p->f[ISGARBAGE]) { if (!supportedFromBelow(b, r, c)) fall(b, r, c); return; }
  if (p->f[COLOR] == 0 || r < 1) return;
  Panel *below = P(b, r - 1, c);
  if (!below->f[STATECHANGED]) return;
  if (below->f[STATE] == HOVERING) enterHoverFromNormal(b, p, below, below->f[TIMER]);
  else if (below->f[COLOR] == 0) {
    if (below->f[PROPFALL] == 1) fall(b, r, c);
    else if (below->f[STATE] == NORMAL) enterHoverFromNormal(b, p, below, b->fHOVER);
  } else if (below->f[QUEUEDHOVER] && below->f[PROPCHAIN] && below->f[STATE] == SWAPPING) {
    int32_t hoverTime = below->f[TIMER];
    int hr = below->f[ROW] - 1;
    Panel *hp = hr >= 0 ? P(b, hr, c) : 0;
    while (hp && hp->f[STATE] == SWAPPING) {
      hoverTime += hp->f[TIMER];
      hp = hp->f[ROW] > 1 ? P(b, hp->f[ROW] - 1, c) : 0;
    }
    hoverTime += (hp && hp->f[STATE] == HOVERING) ? hp->f[TIMER] : b->fHOVER;
    enterHoverFromNormal(b, p, below, hoverTime);
  }
}
static void finishSwap(Panel *p) { p->f[STATE] = NORMAL; p->f[DONTSWAP] = 0; p->f[SWAPFROMLEFT] = NUL; p->f[STATECHANGED] = 1; }
static void updateSwapping(Board *b, int r, int c) {
  Panel *p = P(b, r, c);
  if (p->f[TIMER] > 0) p->f[TIMER]--;
  if (p->f[TIMER] == 0) {
    Panel *below = r > 1 ? P(b, r - 1, c) : 0;
    if (p->f[COLOR] == 0 || !below) finishSwap(p);
    else if (below->f[COLOR] == 0 || below->f[STATE] == HOVERING || p->f[QUEUEDHOVER]) {
      clearFlags(p, 0);
      p->f[STATE] = HOVERING;
      p->f[PROPCHAIN] = below->f[PROPCHAIN];
      p->f[MATCHANYWAY] = (below->f[COLOR] != 0 && below->f[STATE] == HOVERING) ? below->f[MATCHANYWAY] : 0;
      p->f[TIMER] = b->fHOVER;
      p->f[STATECHANGED] = 1;
    } else finishSwap(p);
  } else if (r > 1) {
    Panel *bl = P(b, r - 1, c);
    if (bl->f[STATECHANGED] && bl->f[PROPCHAIN]) {
      p->f[QUEUEDHOVER] = p->f[COLOR] != 0;
      p->f[STATECHANGED] = 1;
      p->f[PROPCHAIN] = 1;
    }
  }
}
static void addScore(Board *b, int32_t s) { b->score += s; if (b->score > 99999) b->score = 99999; }
static void updateMatched(Board *b, Panel *p) {
  if (p->f[TIMER] > 0) p->f[TIMER]--;
  if (p->f[TIMER] != 0) return;
  if (p->f[ISGARBAGE]) {
    if (p->f[YOFF] == -1) {
      clearPanel(p, 0, 0);
      p->f[CHAINING] = 1; p->f[PROPCHAIN] = 1; p->f[TIMER] = b->fGARBAGE_HOVER; p->f[FELL] = 12;
      p->f[STATE] = HOVERING; p->f[STATECHANGED] = 1;
    } else p->f[STATE] = NORMAL;
  } else {
    p->f[STATE] = POPPING;
    p->f[TIMER] = nz(p->f[COMBOINDEX]) * b->fPOP;
    p->f[STATECHANGED] = 1;
  }
}
static void popped(Board *b, Panel *p) {
  b->panelsCleared++;
  clearPanel(p, 1, 1);
  p->f[PROPCHAIN] = 1;
  p->f[STATECHANGED] = 1;
}
static void updatePopping(Board *b, Panel *p) {
  if (p->f[TIMER] > 0) p->f[TIMER]--;
  if (p->f[TIMER] != 0) return;
  addScore(b, 10);
  if (p->f[COMBOSIZE] == p->f[COMBOINDEX]) popped(b, p);
  else { p->f[STATE] = POPPED; p->f[TIMER] = (nz(p->f[COMBOSIZE]) - nz(p->f[COMBOINDEX])) * b->fPOP; p->f[STATECHANGED] = 1; }
}
static void updatePopped(Board *b, Panel *p) {
  if (p->f[TIMER] > 0) p->f[TIMER]--;
  if (p->f[TIMER] == 0) popped(b, p);
}
static void updateHovering(Board *b, int r, int c) {
  Panel *p = P(b, r, c);
  if (p->f[TIMER] > 0) p->f[TIMER]--;
  if (p->f[MATCHANYWAY]) p->f[MATCHANYWAY] = 0;
  if (p->f[TIMER] == 0) {
    Panel *below = P(b, r - 1, c);
    if (below->f[STATE] == HOVERING) p->f[TIMER] = below->f[TIMER];
    else if (below->f[COLOR] != 0) land(b, p);
    else { fall(b, r, c); p = P(b, r - 1, c); }
  }
  if (!p->f[STATECHANGED] && p->f[FELL]) p->f[FELL]--;
}
static void updateFalling(Board *b, int r, int c) {
  Panel *p = P(b, r, c);
  if (r == 1) land(b, p);
  else if (supportedFromBelow(b, r, c)) {
    if (p->f[ISGARBAGE]) land(b, p);
    else {
      Panel *below = P(b, r - 1, c);
      if (below->f[STATE] == HOVERING) {
        clearFlags(p, 0);
        p->f[STATE] = HOVERING; p->f[STATECHANGED] = 1; p->f[PROPCHAIN] = below->f[PROPCHAIN]; p->f[TIMER] = below->f[TIMER];
      } else land(b, p);
    }
  } else { fall(b, r, c); p = P(b, r - 1, c); }
  if (!p->f[STATECHANGED] && p->f[FELL]) p->f[FELL]--;
}
static void updateLanding(Board *b, int r, int c) {
  int32_t id = P(b, r, c)->f[ID];
  updateNormal(b, r, c);
  Panel *p = P(b, r, c)->f[ID] == id ? P(b, r, c) : P(b, r - 1, c);
  if (!p->f[STATECHANGED]) {
    if (p->f[TIMER] > 0) p->f[TIMER]--;
    if (p->f[TIMER] == 0) { p->f[STATE] = NORMAL; p->f[STATECHANGED] = 1; }
  }
}
static void updatePanel(Board *b, int r, int c) {
  Panel *p = P(b, r, c);
  p->f[STATECHANGED] = 0; p->f[PROPCHAIN] = 0; p->f[PROPFALL] = 0; p->f[MATCHING] = 0;
  switch (p->f[STATE]) {
    case NORMAL: updateNormal(b, r, c); break;
    case SWAPPING: updateSwapping(b, r, c); break;
    case MATCHED: updateMatched(b, p); break;
    case POPPING: updatePopping(b, p); break;
    case POPPED: updatePopped(b, p); break;
    case HOVERING: updateHovering(b, r, c); break;
    case FALLING: updateFalling(b, r, c); break;
    case LANDING: updateLanding(b, r, c); break;
    default: break;
  }
}
static int canMatch(const Panel *p) {
  int32_t col = p->f[COLOR], st = p->f[STATE];
  if (col == 0 || col == 9) return 0;
  return st == NORMAL || st == LANDING || (p->f[MATCHANYWAY] && st == HOVERING);
}
static int allowsSwap(const Panel *p) {
  if (p->f[DONTSWAP] || p->f[ISGARBAGE]) return 0;
  int32_t st = p->f[STATE];
  return st == NORMAL || st == SWAPPING || st == LANDING || st == FALLING;
}

// ------------------------------------------------------------------ stack
#define DT_SPEED_INCREASE (15 * 60)
#define GARBAGE_FLIGHT (45 + 45 + 1 + 60)
#define SWAP_STALLING_PUNISH 4
#define DAS_DELAY 20

static Panel *panelAt(Board *b, int row, int col) {
  if (row < 0 || row >= b->nrows || col < 1 || col > W) return 0;
  return P(b, row, col);
}
static int isToppedOut(Board *b) {
  for (int c = 1; c <= W; c++) {
    Panel *p = P(b, b->height, c);
    if (p->f[ISGARBAGE] ? p->f[STATE] != FALLING : p->f[COLOR] != 0) return 1;
  }
  return 0;
}
static int hasActivePanels(Board *b) { return b->nActive > 0 || b->nPrevActive > 0; }
static int hasFallingGarbage(Board *b) {
  if (b->quiet) return 0;
  for (int r = imin(b->height + 3, rowsTo(b) - 1); r >= 1; r--)
    for (int c = 1; c <= W; c++) { Panel *p = P(b, r, c); if (p->f[ISGARBAGE] && p->f[STATE] == FALLING) return 1; }
  return 0;
}
static int hasChainingPanels(Board *b) {
  for (int r = 1, n = rowsTo(b); r < n; r++)
    for (int c = 1; c <= W; c++) { Panel *p = P(b, r, c); if (p->f[CHAINING] && p->f[COLOR] != 0) return 1; }
  return 0;
}
static void countActivePanels(Board *b) {
  int32_t count = 0, swapping = 0;
  for (int r = 1, top = imin(b->height, rowsTo(b) - 1); r <= top; r++)
    for (int c = 1; c <= W; c++) {
      Panel *p = P(b, r, c);
      if (p->f[COLOR] == 0) continue;
      if (p->f[ISGARBAGE]) { if (p->f[STATE] != NORMAL) count++; }
      else if (p->f[STATE] != NORMAL && p->f[STATE] != LANDING) { count++; if (p->f[STATE] == SWAPPING) swapping++; }
    }
  b->nPrevActive = b->nActive;
  b->nActive = count;
  b->swappingCount = swapping;
}

// ---- matches. A match list holds cells (row * 8 + col); panels do not move
// while checkMatches runs.
typedef struct { int32_t n; int32_t at[MAXMATCH]; } Cells;
static void cellsPush(Board *b, Cells *l, int r, int c) {
  if (l->n < MAXMATCH) l->at[l->n++] = r * 8 + c; else b->err |= ERR_MATCH;
}
#define CR(x) ((x) >> 3)
#define CC(x) ((x) & 7)
static void markMatch(Board *b, Cells *out, int r, int c) {
  Panel *p = P(b, r, c);
  if (!p->f[MATCHING]) { p->f[MATCHING] = 1; cellsPush(b, out, r, c); }
}
// panel-rules.js scanRuns: horizontal runs, then vertical, each cell of a run
// of three or more marked in order.
static void getMatchingPanels(Board *b, Cells *out) {
  int32_t eff[(MAXROWS + 2) * 8];
  int H = imin(b->height, rowsTo(b) - 1), r, c, i, any = 0;
  out->n = 0;
  for (r = 1; r <= H; r++)
    for (c = 1; c <= W; c++) { Panel *p = P(b, r, c); eff[r * 8 + c] = canMatch(p) ? p->f[COLOR] : 0; }
  // Three in a line anywhere, or no run to mark.
  for (r = 1; r <= H && !any; r++)
    for (c = 1; c <= W - 2; c++) { int32_t v = eff[r * 8 + c]; if (v > 0 && v == eff[r * 8 + c + 1] && v == eff[r * 8 + c + 2]) { any = 1; break; } }
  for (c = 1; c <= W && !any; c++)
    for (r = 1; r <= H - 2; r++) { int32_t v = eff[r * 8 + c]; if (v > 0 && v == eff[(r + 1) * 8 + c] && v == eff[(r + 2) * 8 + c]) { any = 1; break; } }
  if (!any) return;
  for (r = 1; r <= H; r++) {
    int runStart = 0, runLen = 0, runColour = 0;
    for (c = 1; c <= W + 1; c++) {
      int colour = c <= W ? eff[r * 8 + c] : 0;
      if (colour > 0 && (runLen == 0 || runColour == colour)) {
        if (runLen == 0) { runStart = c; runColour = colour; }
        runLen++;
      } else {
        if (runLen >= 3) for (i = 0; i < runLen; i++) markMatch(b, out, r, runStart + i);
        if (colour > 0) { runStart = c; runLen = 1; runColour = colour; }
        else { runLen = 0; runColour = 0; }
      }
    }
  }
  for (c = 1; c <= W; c++) {
    int runStart = 0, runLen = 0, runColour = 0;
    for (r = 1; r <= H + 1; r++) {
      int colour = r <= H ? eff[r * 8 + c] : 0;
      if (colour > 0 && (runLen == 0 || runColour == colour)) {
        if (runLen == 0) { runStart = r; runColour = colour; }
        runLen++;
      } else {
        if (runLen >= 3) for (i = 0; i < runLen; i++) markMatch(b, out, runStart + i, c);
        if (colour > 0) { runStart = r; runLen = 1; runColour = colour; }
        else { runLen = 0; runColour = 0; }
      }
    }
  }
  for (i = 0; i < out->n; i++) { Panel *p = P(b, CR(out->at[i]), CC(out->at[i])); if (p->f[STATE] == HOVERING) p->f[CHAINING] = 0; }
}
// Matches pop top to bottom, left to right; garbage bottom to top, right to
// left. Cells are distinct, so the order is total and any sort agrees.
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
static int eligibleGarbage(Board *b, Panel *p) {
  return p->f[ISGARBAGE] && p->f[COLOR] == 9 && p->f[STATE] == NORMAL &&
         (p->f[ROW] - p->f[YOFF] <= b->height || p->f[GARBAGEID] <= b->highestGarbageIdMatched);
}
typedef struct { int32_t n, head; int32_t id[MAXMATCH]; } Ids;
static void addNeighbourGarbage(Board *b, Ids *ids, int row, int col) {
  static const int dr[4] = { 1, -1, 0, 0 }, dc[4] = { 0, 0, 1, -1 };
  for (int d = 0; d < 4; d++) {
    Panel *p = panelAt(b, row + dr[d], col + dc[d]);
    if (!p || !eligibleGarbage(b, p)) continue;
    int seen = 0;
    for (int i = 0; i < ids->n; i++) if (ids->id[i] == p->f[GARBAGEID]) { seen = 1; break; }
    if (seen) continue;
    if (ids->n < MAXMATCH) ids->id[ids->n++] = p->f[GARBAGEID]; else b->err |= ERR_MATCH;
  }
}
static void getConnectedGarbagePanels(Board *b, Cells *matching, Cells *found) {
  Ids ids; ids.n = 0; ids.head = 0; found->n = 0;
  for (int i = 0; i < matching->n; i++) addNeighbourGarbage(b, &ids, CR(matching->at[i]), CC(matching->at[i]));
  while (ids.head < ids.n) {
    int32_t id = ids.id[ids.head++];
    b->highestGarbageIdMatched = imax(b->highestGarbageIdMatched, id);
    int from = found->n;
    for (int r = 1, n = rowsTo(b); r < n; r++)
      for (int c = 1; c <= W; c++) {
        Panel *p = P(b, r, c);
        if (p->f[ISGARBAGE] && p->f[GARBAGEID] == id && p->f[COLOR] == 9) cellsPush(b, found, r, c);
      }
    for (int k = from; k < found->n; k++) addNeighbourGarbage(b, &ids, CR(found->at[k]), CC(found->at[k]));
  }
}
// The colours a break deals, as the search deals them (puyocpu.js unseenBreak).
static void convertGarbagePanels(Board *b, int isChain) {
  for (int r = 1, n = rowsTo(b); r < n; r++) {
    int cols[W], n = 0;
    for (int c = 1; c <= W; c++) { Panel *p = P(b, r, c); if (p->f[YOFF] == -1 && p->f[COLOR] == 9) cols[n++] = c; }
    if (!n) continue;
    int32_t k = ++b->unseenBreaks;
    for (int i = 0; i < n; i++) {
      Panel *p = P(b, r, cols[i]);
      p->f[COLOR] = 21 + ((i + 3 * k) % 6);
      if (isChain) p->f[CHAINING] = 1;
    }
  }
}
static void matchGarbagePanels(Board *b, Cells *g, int32_t garbageMatchTime, int isChain, int32_t onScreen) {
  sortByPopOrder(g, 1);
  for (int i = 0; i < g->n; i++) {
    Panel *p = P(b, CR(g->at[i]), CC(g->at[i]));
    p->f[YOFF] -= 1;
    p->f[GHEIGHT] -= 1;
    p->f[STATE] = MATCHED;
    p->f[TIMER] = garbageMatchTime + 1;
    p->f[INITIALTIME] = garbageMatchTime;
    p->f[POPTIME] = b->fPOP * (onScreen - (i + 1));
    p->f[POPINDEX] = imin(i + 1, 10);
  }
  convertGarbagePanels(b, isChain);
}
static void clearChainingFlags(Board *b) {
  int top = imin(rowsTo(b) - 1, b->height + 2);
  for (int r = 1; r <= top; r++)
    for (int c = 1; c <= W; c++) {
      Panel *p = P(b, r, c);
      if (!p->f[MATCHING] && p->f[CHAINING] && !p->f[MATCHANYWAY] && (canMatch(p) || p->f[COLOR] == 9)) {
        if (r > 1) { if (P(b, r - 1, c)->f[STATE] != SWAPPING) p->f[CHAINING] = 0; }
        else p->f[CHAINING] = 0;
      }
    }
}
static void awardStopTime(Board *b, int isChain, int32_t comboSize) {
  int32_t stopTime = 0;
  int toppedOut = b->wasToppedOut;
  if (comboSize > 3 || isChain) {
    if (toppedOut && isChain) {
      int32_t length = b->chainCounter > 4 ? 6 : b->chainCounter;
      stopTime = b->sDangerConstant + (length - 1) * b->sDangerCoefficient;
    } else if (toppedOut) stopTime = b->sCoefficient * (comboSize < 9 ? 2 : 3) + b->sChainConstant;
    else if (isChain) stopTime = b->sCoefficient * imin(b->chainCounter, 13) + b->sChainConstant;
    else stopTime = b->sCoefficient * comboSize + b->sComboConstant;
  }
  if (stopTime > b->stopTime) b->stopTime = stopTime;
}
static void pushOut(Board *b, Garb g) { if (b->nout < MAXOUT) b->out[b->nout++] = g; else b->err |= ERR_OUT; }
// The chain still growing is its own record (currentChain). When the board
// is the one that sent it, it is also an entry in out (chainAt), and every
// change is made to both; a copied board sends nothing and has no entry.
static void pushGarbage(Board *b, int orow, int ocol, int isChain, int32_t comboSize) {
  int32_t pieces[8]; int n = comboGarbage(comboSize, pieces);
  for (int i = 0; i < n; i++) { Garb g = { pieces[i], 1, 0, b->clock, 1, orow, ocol }; pushOut(b, g); }
  if (!isChain) return;
  if (!b->hasChain) {
    Garb g = { W, 1, 1, b->clock, 0, n > 0 ? orow + 1 : orow, ocol };
    b->chain = g; b->hasChain = 1;
    b->chainAt = b->nout < MAXOUT ? b->nout : -1;
    pushOut(b, g);
  } else {
    b->chain.height += 1; b->chain.frameEarned = b->clock;
    if (b->chainAt >= 0) b->out[b->chainAt] = b->chain;
  }
}
static void finalizeCurrentChain(Board *b) {
  if (!b->hasChain) return;
  b->chain.finalized = 1; b->chain.frameEarned = b->clock;
  if (b->chainAt >= 0) b->out[b->chainAt] = b->chain;
  b->hasChain = 0; b->chainAt = -1;
}
static void checkMatches(Board *b) {
  Cells matching, garbage;
  getMatchingPanels(b, &matching);
  int32_t comboSize = matching.n;
  if (comboSize > 0) {
    int isChainLink = 0, i;
    for (i = 0; i < matching.n; i++) if (P(b, CR(matching.at[i]), CC(matching.at[i]))->f[CHAINING]) isChainLink = 1;
    if (isChainLink) b->chainCounter = b->chainCounter == 0 ? 2 : b->chainCounter + 1;
    b->manualRaise = 0;
    b->riseLock = 1;
    sortByPopOrder(&matching, 0);
    for (i = 0; i < comboSize; i++) {
      Panel *p = P(b, CR(matching.at[i]), CC(matching.at[i]));
      p->f[STATE] = MATCHED;
      p->f[TIMER] = b->fFLASH + b->fFACE + 1;
      if (isChainLink) p->f[CHAINING] = 1;
      p->f[FELL] = 0;
      p->f[COMBOINDEX] = i + 1;
      p->f[COMBOSIZE] = comboSize;
    }
    int orow = CR(matching.at[0]), ocol = CC(matching.at[0]);
    getConnectedGarbagePanels(b, &matching, &garbage);
    int32_t onScreen = 0;
    for (i = 0; i < garbage.n; i++) if (CR(garbage.at[i]) <= b->height) onScreen++;
    if (garbage.n) matchGarbagePanels(b, &garbage, b->fFLASH + b->fFACE + b->fPOP * (comboSize + onScreen), isChainLink, onScreen);
    int32_t preStop = b->fFLASH + b->fFACE + b->fPOP * (comboSize + onScreen);
    b->preStopTime = imax(b->preStopTime, preStop);
    awardStopTime(b, isChainLink, comboSize);
    if (isChainLink || comboSize > 3) pushGarbage(b, orow, ocol, isChainLink, comboSize);
    int32_t chainBonus = b->chainCounter > 13 ? 0 : b->chainCounter;
    addScore(b, SCORE_CHAIN_TA[chainBonus]);
    if (comboSize > 3) addScore(b, SCORE_COMBO_TA[imin(30, comboSize)]);
  }
  clearChainingFlags(b);
}

// ---- incoming garbage
static int shouldDropGarbage(Board *b) {
  if (!b->ninc) return 0;
  if (isToppedOut(b)) return 0;
  if (hasFallingGarbage(b)) return 0;
  for (int r = b->height + 1, n = rowsTo(b); r < n; r++)
    for (int c = 1; c <= W; c++) if (P(b, r, c)->f[COLOR] != 0) return 0;
  if (!hasActivePanels(b)) return 1;
  return b->inc[0][1] > 1;
}
static int32_t garbageSpawnColumn(Board *b, int32_t width) {
  static const int cols[7][6] = { { 1 }, { 1, 2, 3, 4, 5, 6 }, { 1, 3, 5 }, { 1, 4 }, { 1, 2, 3 }, { 1, 2 }, { 1 } };
  static const int len[7] = { 1, 6, 3, 2, 3, 2, 1 };
  if (width < 1 || width > 6) { b->err |= ERR_WIDTH; return 1; }
  int32_t index = b->dropColumnIndex[width] < 0 ? 0 : b->dropColumnIndex[width];
  b->dropColumnIndex[width] = (index + 1) % len[width];
  return cols[width][index];
}
static void dropGarbage(Board *b, int32_t width, int32_t height) {
  b->quiet = 0;
  int32_t originRow = b->height + 1, originCol = garbageSpawnColumn(b, width);
  int32_t id = ++b->garbageCreatedCount, shake = shakeFramesFor(width, height);
  for (int r = originRow; r < originRow + height; r++) {
    while (r >= b->nrows) {
      if (b->nrows >= MAXROWS) { b->err |= ERR_ROWS; return; }
      makeEmptyRow(b, b->nrows); b->nrows++;
    }
    for (int c = originCol; c < originCol + width; c++) {
      Panel *p = P(b, r, c);
      clearPanel(p, 1, 1);
      p->f[GARBAGEID] = id; p->f[ISGARBAGE] = 1; p->f[COLOR] = 9; p->f[GWIDTH] = width; p->f[GHEIGHT] = height;
      p->f[YOFF] = r - originRow; p->f[XOFF] = c - originCol; p->f[SHAKETIME] = shake; p->f[STATE] = FALLING;
    }
  }
  b->hi = b->nrows;
}

// ---- rising. The row dealt is the search's unseen row (puyocpu.js unseenRow).
static void fillNewRow(Board *b) {
  int32_t k = ++b->unseenRows;
  for (int c = 1; c <= W; c++) {
    Panel *p = P(b, 0, c);
    clearPanel(p, 1, 1);
    p->f[COLOR] = 11 + ((c + 3 * k) % 6);
    p->f[STATE] = DIMMED;
  }
}
static void newRow(Board *b) {
  b->quiet = 0;
  int n = b->nrows, topOccupied = 0, r, c;
  for (c = 1; c <= W; c++) if (P(b, n - 1, c)->f[COLOR] != 0) topOccupied = 1;
  if (topOccupied) {
    if (n + 2 > MAXROWS) { b->err |= ERR_ROWS; return; }
    for (r = n - 1; r >= 0; r--) for (c = 1; c <= W; c++) b->p[r + 1][c] = b->p[r][c];
    makeEmptyRow(b, n + 1);
    b->nrows = n + 2;
  } else {
    for (r = n - 2; r >= 0; r--) for (c = 1; c <= W; c++) b->p[r + 1][c] = b->p[r][c];
  }
  makeEmptyRow(b, 0);
  for (r = 0; r < b->nrows; r++) for (c = 1; c <= W; c++) b->p[r][c].f[ROW] = r;
  for (c = 1; c <= W; c++) { P(b, 1, c)->f[STATE] = NORMAL; P(b, 1, c)->f[STATECHANGED] = 1; }
  b->hi = topOccupied ? b->nrows : imin(imax(b->hi + 1, 2), b->nrows);
  fillNewRow(b);
  if (b->curRow != 0) b->curRow = imin(b->curRow + 1, b->topCurRow);
  if (b->queuedSwapRow > 0) b->queuedSwapRow++;
  b->displacement = 16;
}
static int checkGameOver(Board *b) {
  if (b->health <= 0 && b->shakeTime <= 0) return 1;
  if (!b->riseLock && b->wasToppedOut && b->manualRaise) return 1;
  return 0;
}
static void setGameOver(Board *b) { b->gameOver = 1; }
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
        b->riseTimer += riseTime(b->speed);
      }
    }
    return 1;
  }
  return 0;
}
static void handleManualRaise(Board *b) {
  if (!b->manualRaise) return;
  if (!b->riseLock) {
    b->stopTime = 0;
    if (b->wasToppedOut) { if (checkGameOver(b)) setGameOver(b); }
    else {
      b->hasRisen = 1;
      b->displacement--;
      if (b->displacement == 1) {
        if (!b->preventManualRaise) addScore(b, 1);
        b->manualRaise = 0;
        b->riseTimer = 1;
        b->preventManualRaise = 1;
      }
      b->manualRaiseYet = 1;
    }
  } else if (!b->manualRaiseYet) b->manualRaise = 0;
  else if (hasFallingGarbage(b)) b->manualRaise = 0;
}
static void updateRiseLock(Board *b) {
  int previous = b->riseLock;
  b->riseLock = (b->queuedSwapRow > 0 || b->shakeTime > 0 || hasActivePanels(b)) ? 1 : 0;
  if (previous && !b->riseLock) b->preventManualRaise = 0;
}
static void updateSpeed(Board *b) {
  if (b->clock == b->nextSpeedIncreaseClock) { b->speed = imin(b->speed + 1, 99); b->nextSpeedIncreaseClock += DT_SPEED_INCREASE; }
}
static void decrementTimers(Board *b) {
  b->shakeTime = imax(imax(b->shakeTime - 1, b->shakeTimeOnFrame), 0);
  if (b->shakeTime == 0) b->peakShakeTime = 0;
  if (b->preStopTime != 0) b->preStopTime--;
  else if (b->stopTime != 0) b->stopTime--;
}

// ---- swapping
static int canSwap(Board *b, int row, int col) {
  if (b->clock <= 1) return 0;
  if (row < 1 || row > b->height || col < 1 || col >= W) return 0;
  Panel *left = P(b, row, col), *right = P(b, row, col + 1);
  if (left->f[COLOR] == 0 && right->f[COLOR] == 0) return 0;
  if (!allowsSwap(left) || !allowsSwap(right)) return 0;
  Panel *above1 = 0, *above2 = 0;
  if (row < b->height) {
    above1 = P(b, row + 1, col); above2 = P(b, row + 1, col + 1);
    if (above1->f[STATE] == HOVERING || above2->f[STATE] == HOVERING) return 0;
  }
  if (left->f[COLOR] == 0 || right->f[COLOR] == 0) {
    if (above1 && above2 && above1->f[STATE] == SWAPPING && above2->f[STATE] == SWAPPING &&
        (above1->f[COLOR] == 0 || above2->f[COLOR] == 0) && (above1->f[COLOR] != 0 || above2->f[COLOR] != 0)) return 0;
    if (row > 1) {
      Panel *below1 = P(b, row - 1, col), *below2 = P(b, row - 1, col + 1);
      if (below1->f[STATE] == SWAPPING && below2->f[STATE] == SWAPPING &&
          (below1->f[COLOR] == 0 || below2->f[COLOR] == 0) && (below1->f[COLOR] != 0 || below2->f[COLOR] != 0)) return 0;
    }
  }
  return 1;
}
static int wigglePayActive(Board *b) {
  return b->wasToppedOut && b->stopTime == 0 && b->shakeTime == 0 && (b->nActive - b->swappingCount) == 0;
}
static int applySwapStalling(Board *b, int row, int col) {
  if (!wigglePayActive(b)) { b->nstall = 0; return 1; }
  for (int i = 0; i < b->nstall; i++) {
    if (b->stall[i][0] == row && b->stall[i][1] == col) {
      if (b->health <= SWAP_STALLING_PUNISH) return 0;
      b->health -= SWAP_STALLING_PUNISH;
      return 1;
    }
  }
  if (b->nstall < MAXSTALL) { b->stall[b->nstall][0] = row; b->stall[b->nstall][1] = col; b->nstall++; }
  else b->err |= ERR_STALL;
  return 1;
}
static int tryQueueSwap(Board *b, int row, int col) {
  if (b->gameOver) return 0;
  if (!canSwap(b, row, col)) return 0;
  if (!applySwapStalling(b, row, col)) return 0;
  b->queuedSwapRow = row; b->queuedSwapCol = col;
  return 1;
}
static void startSwap(Panel *p, int fromLeft) {
  int32_t chaining = p->f[CHAINING];
  clearFlags(p, 0);
  p->f[STATECHANGED] = 1; p->f[STATE] = SWAPPING; p->f[CHAINING] = chaining; p->f[TIMER] = 4;
  p->f[SWAPFROMLEFT] = fromLeft; p->f[FELL] = 0;
}
static void doSwap(Board *b, int row, int col) {
  b->quiet = 0;
  b->hi = imax(b->hi, row + 1);
  startSwap(P(b, row, col), 1);
  startSwap(P(b, row, col + 1), 0);
  switchPanels(b, row, col, row, col + 1);
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

// ---- input
static void clampCursor(Board *b) {
  b->curRow = imax(1, imin(b->curRow, b->topCurRow));
  b->curCol = imax(1, imin(b->curCol, W - 1));
}
static void moveCursor(Board *b, int dir) {
  if (dir == DIR_UP) b->curRow++;
  else if (dir == DIR_DOWN) b->curRow--;
  else if (dir == DIR_LEFT) b->curCol--;
  else if (dir == DIR_RIGHT) b->curCol++;
  clampCursor(b);
}
static void applyInput(Board *b) {
  int32_t i = b->input, prev = b->prevInput;
  if ((i & IN_SWAP) && !(prev & IN_SWAP)) tryQueueSwap(b, b->curRow, b->curCol);
  if (!b->animatingCursor) {
    int dir = CD_NULL;
    if (i & IN_UP) dir = DIR_UP;
    else if (i & IN_DOWN) dir = DIR_DOWN;
    else if (i & IN_LEFT) dir = DIR_LEFT;
    else if (i & IN_RIGHT) dir = DIR_RIGHT;
    if (dir != b->cursorDirection) {
      b->cursorDirection = dir;
      b->cursorTimer = 0;
      if (dir != CD_NULL) moveCursor(b, dir);
    } else if (dir != CD_NULL) {
      b->cursorTimer++;
      if (b->cursorTimer >= DAS_DELAY) moveCursor(b, dir);
    }
  }
  if ((i & IN_RAISE) && !b->preventManualRaise) { b->manualRaise = 1; b->manualRaiseYet = 0; }
}

// ---- the frame
static void updatePanels(Board *b) {
  b->shakeTimeOnFrame = 0;
  int n = rowsTo(b), r;
  for (r = 1; r < n; r++)
    for (int c = 1; c <= W; c++) updatePanel(b, r, c);
  // Lowered to just above the highest row a panel is still unsettled in.
  for (r = n - 1; r >= 1; r--) {
    int c;
    for (c = 1; c <= W; c++) if (!settled(b->p[r][c].f)) break;
    if (c <= W) break;
  }
  b->hi = r + 1;
}
// QUIET: a board on which a frame moves no panel. Every panel is at rest
// (normal, no flag a neighbour reads, nothing chaining, garbage held up) and
// no match is on the board. A frame on it then changes only the stack's
// counters -- checkMatches finds nothing, every updatePanel clears flags
// already clear, and nothing is active -- until something moves a panel: a
// swap, a row, a drop, each of which ends it (the rest of that frame is
// played in full). Decided after a full frame; native.test.js plays every
// frame both ways.
static int anyMatch(Board *b) {
  int32_t eff[(MAXROWS + 2) * 8];
  int H = b->height, r, c;
  for (r = 1; r <= H; r++)
    for (c = 1; c <= W; c++) { Panel *p = P(b, r, c); eff[r * 8 + c] = canMatch(p) ? p->f[COLOR] : 0; }
  for (r = 1; r <= H; r++)
    for (c = 1; c <= W - 2; c++) { int32_t v = eff[r * 8 + c]; if (v > 0 && v == eff[r * 8 + c + 1] && v == eff[r * 8 + c + 2]) return 1; }
  for (c = 1; c <= W; c++)
    for (r = 1; r <= H - 2; r++) { int32_t v = eff[r * 8 + c]; if (v > 0 && v == eff[(r + 1) * 8 + c] && v == eff[(r + 2) * 8 + c]) return 1; }
  return 0;
}
static int isQuiet(Board *b) {
  if (b->nActive || b->nPrevActive || b->queuedSwapRow > 0 || b->chainCounter) return 0;
  for (int r = 0; r < b->nrows; r++)
    for (int c = 1; c <= W; c++) {
      const int32_t *f = b->p[r][c].f;
      if (f[STATE] != (r ? NORMAL : DIMMED) || f[STATECHANGED] || f[PROPCHAIN] || f[MATCHING] || f[CHAINING] ||
          f[MATCHANYWAY] || f[QUEUEDHOVER] || f[FELL]) return 0;
      if (r && f[PROPFALL] != 0) return 0;
      if (r && f[ISGARBAGE] && !supportedFromBelow(b, r, c)) return 0;
    }
  return !anyMatch(b);
}
static void runPhysics(Board *b) {
  b->nlanded = 0;
  b->wasToppedOut = isToppedOut(b);
  decrementTimers(b);
  updateRiseLock(b);
  updateSpeed(b);
  if (advancePassiveRaise(b)) { if (checkGameOver(b)) setGameOver(b); }
  if (!b->wasToppedOut && !hasFallingGarbage(b)) b->health = b->maxHealth;
  if (b->displacement % 16 != 0) b->topCurRow = b->height - 1;
  if (b->queuedSwapRow > 0) {
    doSwap(b, b->queuedSwapRow, b->queuedSwapCol);
    b->queuedSwapRow = 0; b->queuedSwapCol = 0;
  }
  if (b->quiet && !b->noQuiet) {
    b->shakeTimeOnFrame = 0;
    b->nPrevActive = b->nActive; b->nActive = 0; b->swappingCount = 0;
  } else {
    checkMatches(b);
    updatePanels(b);
    countActivePanels(b);
    if (b->chainCounter != 0 && !hasChainingPanels(b)) { b->chainCounter = 0; finalizeCurrentChain(b); }
    b->quiet = !b->noQuiet && isQuiet(b);
  }
  if (checkGameOver(b)) setGameOver(b);
}
// Stack.run, for a board past its countdown.
static void run(Board *b) {
  if (b->gameOver) return;
  if (b->stopWatchIsRunning) runPhysics(b);
  applyInput(b);
  handleManualRaise(b);
  if (b->stopWatchIsRunning && shouldDropGarbage(b)) {
    int32_t w = b->inc[0][0], h = b->inc[0][1];
    for (int i = 1; i < b->ninc; i++) { b->inc[i - 1][0] = b->inc[i][0]; b->inc[i - 1][1] = b->inc[i][1]; b->inc[i - 1][2] = b->inc[i][2]; }
    b->ninc--;
    dropGarbage(b, w, h);
  }
  clampCursor(b);
  b->prevInput = b->input;
  b->clock++;
}

#include "memory.h"

// ------------------------------------------------------------------ the wire
// A board travels as HEAD (float64: riseTimer, then the fields below in this
// order) and BODY (int32: every panel's fields for rows 0..nrows-1, columns
// 1..6; then incoming, outgoing, the stall backlog, garbage landed this frame
// and dropColumnIndex[1..6]). native.js reads the names from nb_head_name.
#define HEAD(X) \
  X(nrows) X(colors) X(maxHealth) X(height) X(fHOVER) X(fGARBAGE_HOVER) X(fFLASH) X(fFACE) X(fPOP) \
  X(sComboConstant) X(sChainConstant) X(sDangerConstant) X(sCoefficient) X(sDangerCoefficient) \
  X(panelIdCount) X(speed) X(nextSpeedIncreaseClock) X(clock) X(displacement) \
  X(riseLock) X(hasRisen) X(manualRaise) X(manualRaiseYet) X(preventManualRaise) \
  X(stopTime) X(preStopTime) X(shakeTime) X(shakeTimeOnFrame) X(peakShakeTime) X(health) X(wasToppedOut) \
  X(chainCounter) X(nActive) X(nPrevActive) X(swappingCount) X(panelsCleared) X(score) \
  X(curRow) X(curCol) X(topCurRow) X(queuedSwapRow) X(queuedSwapCol) X(garbageCreatedCount) X(highestGarbageIdMatched) \
  X(gameOver) X(cursorTimer) X(cursorDirection) X(input) X(prevInput) X(unseenRows) X(unseenBreaks) \
  X(stopWatchIsRunning) X(animatingCursor) X(hasChain) X(chainAt) X(err) \
  X(chain.width) X(chain.height) X(chain.isChain) X(chain.frameEarned) X(chain.finalized) X(chain.orow) X(chain.ocol) \
  X(ninc) X(nout) X(nstall) X(nlanded)
#define COUNT1(f) + 1
#define NHEAD (1 HEAD(COUNT1))
#define NBODY (MAXROWS * W * NF + MAXINC * 3 + MAXOUT * 7 + MAXSTALL * 2 + MAXLANDED + 6)
static double ioHead[NHEAD];
static int32_t ioBody[NBODY];
EXPORT(nb_io_head) double *nb_io_head(void) { return ioHead; }
EXPORT(nb_io_body) int32_t *nb_io_body(void) { return ioBody; }
EXPORT(nb_nhead) int nb_nhead(void) { return NHEAD; }
#define NAME1(f) #f,
static const char *headNames[] = { "riseTimer", HEAD(NAME1) };
EXPORT(nb_head_name) const char *nb_head_name(int i) { return i >= 0 && i < NHEAD ? headNames[i] : 0; }
static void garbIn(Garb *g, const int32_t *x) {
  g->width = x[0]; g->height = x[1]; g->isChain = x[2]; g->frameEarned = x[3]; g->finalized = x[4]; g->orow = x[5]; g->ocol = x[6];
}
static void garbOut(const Garb *g, int32_t *x) {
  x[0] = g->width; x[1] = g->height; x[2] = g->isChain; x[3] = g->frameEarned; x[4] = g->finalized; x[5] = g->orow; x[6] = g->ocol;
}
// Returns 0, or the Board.err bits for what does not fit.
EXPORT(nb_load) int nb_load(Board *b) {
  int k = 0, i, r, c, f;
  const int32_t *x = ioBody;
  b->riseTimer = ioHead[k++];
#define LOAD1(fl) b->fl = (int32_t)ioHead[k++];
  HEAD(LOAD1)
  int err = 0;
  if (b->nrows < 2 || b->nrows > MAXROWS) err |= ERR_ROWS;
  if (b->ninc < 0 || b->ninc > MAXINC) err |= ERR_INC;
  if (b->nout < 0 || b->nout > MAXOUT) err |= ERR_OUT;
  if (b->nstall < 0 || b->nstall > MAXSTALL) err |= ERR_STALL;
  if (b->nlanded < 0 || b->nlanded > MAXLANDED) err |= ERR_LANDED;
  if (err) return err;
  for (r = 0; r < b->nrows; r++) for (c = 1; c <= W; c++) for (f = 0; f < NF; f++) b->p[r][c].f[f] = *x++;
  for (i = 0; i < b->ninc; i++) { b->inc[i][0] = *x++; b->inc[i][1] = *x++; b->inc[i][2] = *x++; }
  for (i = 0; i < b->nout; i++) { garbIn(&b->out[i], x); x += 7; }
  for (i = 0; i < b->nstall; i++) { b->stall[i][0] = *x++; b->stall[i][1] = *x++; }
  for (i = 0; i < b->nlanded; i++) b->landed[i] = *x++;
  b->dropColumnIndex[0] = -1;
  b->quiet = 0; b->noQuiet = 0; b->hi = b->nrows;
  for (i = 1; i <= 6; i++) b->dropColumnIndex[i] = *x++;
  return b->err;
}
// Returns the number of body ints written.
EXPORT(nb_save) int nb_save(Board *b) {
  int k = 0, i, r, c, f;
  int32_t *x = ioBody;
  ioHead[k++] = b->riseTimer;
#define SAVE1(fl) ioHead[k++] = (double)b->fl;
  HEAD(SAVE1)
  for (r = 0; r < b->nrows; r++) for (c = 1; c <= W; c++) for (f = 0; f < NF; f++) *x++ = b->p[r][c].f[f];
  for (i = 0; i < b->ninc; i++) { *x++ = b->inc[i][0]; *x++ = b->inc[i][1]; *x++ = b->inc[i][2]; }
  for (i = 0; i < b->nout; i++) { garbOut(&b->out[i], x); x += 7; }
  for (i = 0; i < b->nstall; i++) { *x++ = b->stall[i][0]; *x++ = b->stall[i][1]; }
  for (i = 0; i < b->nlanded; i++) *x++ = b->landed[i];
  for (i = 1; i <= 6; i++) *x++ = b->dropColumnIndex[i];
  return (int)(x - ioBody);
}

// ------------------------------------------------------------------ the engine, one call at a time
EXPORT(nb_set_input) void nb_set_input(Board *b, int32_t bits) { b->input = bits; }
EXPORT(nb_run) int nb_run(Board *b) { run(b); return b->err; }
EXPORT(nb_try_queue_swap) int nb_try_queue_swap(Board *b, int r, int c) { return tryQueueSwap(b, r, c); }
EXPORT(nb_can_swap) int nb_can_swap(Board *b, int r, int c) { return canSwap(b, r, c); }
EXPORT(nb_push_incoming) void nb_push_incoming(Board *b, int32_t w, int32_t h, int32_t isChain, int32_t isMetal) {
  if (isMetal) { b->err |= ERR_WIDTH; return; }   // this game has no shock garbage
  if (b->ninc >= MAXINC) { b->err |= ERR_INC; return; }
  b->inc[b->ninc][0] = w; b->inc[b->ninc][1] = h; b->inc[b->ninc][2] = isChain; b->ninc++;
}
// Stack.takeDeliverableGarbage: the pieces written to the io body, 7 ints
// each; returns how many.
EXPORT(nb_take_deliverable) int nb_take_deliverable(Board *b) {
  int n = 0;
  while (n < b->nout && b->out[n].finalized && b->out[n].frameEarned + GARBAGE_FLIGHT <= b->clock) n++;
  for (int i = 0; i < n; i++) garbOut(&b->out[i], ioBody + 7 * i);
  for (int i = n; i < b->nout; i++) b->out[i - n] = b->out[i];
  b->nout -= n;
  if (b->chainAt >= 0) b->chainAt -= n;
  return n;
}
EXPORT(nb_game_over) int nb_game_over(Board *b) { return b->gameOver; }
EXPORT(nb_clock) int nb_clock(Board *b) { return b->clock; }
// cloneStack's copy: everything but the garbage this board has sent, which a
// copy never sends. A chain still growing is kept, as its own record.
static void cloneBoard(Board *dst, const Board *src) { copyBoard(dst, src); dst->nout = 0; dst->chainAt = -1; }
EXPORT(nb_clone) void nb_clone(Board *dst, Board *src) { cloneBoard(dst, src); }
// Every frame played in full (native.test.js compares the two).
EXPORT(nb_no_quiet) void nb_no_quiet(Board *b, int off) { b->noQuiet = off; if (off) b->quiet = 0; }
EXPORT(nb_quiet) int nb_quiet(Board *b) { return b->quiet; }

// ---- what the search needs from this engine (search.h)
#define KEY_COLOR(f) ((f)[ISGARBAGE] ? 255 : ((f)[COLOR] & 255))
#define SWAP_PRESSED 0

#include "search.h"
