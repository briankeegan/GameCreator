// THE ENGINE IN C, for the survival search. panel-engine.js line for line, on
// a board whose panels are plain structs, so a copy is one block of memory.
// The search's boards only: countdown over, no rng -- rows and breaks dealt
// in the search are the unseen colours puyocpu.js deals (unseenRow,
// unseenBreak) -- and events are not kept. native.test.js plays it beside
// panel-engine.js and compares every field after every frame.
typedef int int32_t;
typedef unsigned int uint32_t;
typedef unsigned char uint8_t;

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
  int32_t stopWatchIsRunning, animatingCursor, hasChain, chainAt, err;  // chainAt: the chain's entry in out, or -1
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

void *memcpy(void *d, const void *s, unsigned long n) {
  unsigned char *dd = d; const unsigned char *ss = s;
  if ((((unsigned long)dd | (unsigned long)ss | n) & 3) == 0) {
    uint32_t *d4 = (uint32_t *)dd; const uint32_t *s4 = (const uint32_t *)ss;
    for (unsigned long i = 0; i < (n >> 2); i++) d4[i] = s4[i];
  } else for (unsigned long i = 0; i < n; i++) dd[i] = ss[i];
  return d;
}
void *memset(void *d, int c, unsigned long n) { unsigned char *dd = d; for (unsigned long i = 0; i < n; i++) dd[i] = (unsigned char)c; return d; }

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

// ------------------------------------------------------------------ memory
// THREADS. engine-mt.wasm is this file on shared memory: every thread is an
// instance of it, with its own stack and its own copy of what is
// _Thread_local here. Memory is taken under a lock; each thread keeps its own
// free boards (a list per thread, so the main thread can hand boards over
// while the others wait).
extern unsigned char __heap_base;
static unsigned long heapTop;
static int32_t heapLock;
static void *grab(unsigned long n) {
  while (__atomic_exchange_n(&heapLock, 1, __ATOMIC_ACQUIRE)) {}
  if (!heapTop) heapTop = ((unsigned long)&__heap_base + 15) & ~15ul;
  n = (n + 15) & ~15ul;
  unsigned long at = heapTop, end = at + n, have = __builtin_wasm_memory_size(0) * 65536ul;
  void *r = (void *)at;
  if (end > have && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) == (unsigned long)-1) r = 0;
  else heapTop = end;
  __atomic_store_n(&heapLock, 0, __ATOMIC_RELEASE);
  return r;
}
#define MAXTHREADS 16
#ifdef THREADS
#define LOCAL _Thread_local
#else
#define LOCAL
#endif
static LOCAL int32_t thId;          // 0 on the thread that runs the search
static Board *freeOf[MAXTHREADS];
static int32_t freeCount[MAXTHREADS];
#define EXPORT(name) __attribute__((export_name(#name)))
EXPORT(nb_new) Board *nb_new(void) {
  Board *b = freeOf[thId];
  if (b) { freeOf[thId] = *(Board **)b; freeCount[thId]--; return b; }
  return (Board *)grab(sizeof(Board));
}
EXPORT(nb_free) void nb_free(Board *b) { *(Board **)b = freeOf[thId]; freeOf[thId] = b; freeCount[thId]++; }
static void copyBoard(Board *dst, const Board *src) { memcpy(dst, src, BOARD_BYTES(src)); }
EXPORT(nb_copy) void nb_copy(Board *dst, Board *src) { copyBoard(dst, src); }

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
EXPORT(nb_push_incoming) void nb_push_incoming(Board *b, int32_t w, int32_t h, int32_t isChain) {
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

// ================================================================== THE SEARCH
// puyocpu.js's survival search, on these boards: a node is a board at one of
// the bot's decision frames, a step is one decision played frame by frame
// (_engineAdvanceOn / _runFrom / _engineStep, with panel-cpu.js's walk), and
// the level loop is _survivalSearch's. Same order, same budget, same keys, so
// the same moves are proven. native.js puts nodes in front of puyocpu.js;
// native.test.js and GC_ENGINE_CHECK compare every step with the JS one.
typedef struct { int32_t at, width, height, isChain; } Arr;
#define MAXARR 16
#define KEYMAX (16 * W)
enum { MK_LONG, MK_HOLD, MK_RAISE, MK_SWAP };
typedef struct Node {
  Board *st;                   // 0 once freed: replayed from prev when asked for
  int32_t t, holdLeft, holdStarted, fresh, dead, fromPrev;   // fromPrev: a dead end, on its parent's board
  int32_t narr; Arr arr[MAXARR];
  int32_t tag, prev, mk, mr, mc, frames, seed, pins, err, live, kept;
  int32_t held, garb, top, pos0, pos1;
  int32_t stopTime, preStopTime, shakeTime, displacement, speed;
  double riseTimer;
  uint32_t hash;
  int32_t keyn; int32_t key[KEYMAX];
} Node;
typedef struct { int32_t *a; int32_t n, cap; } Vec;
typedef struct Ctx {
  Node *nodes; int32_t n, cap;
  int32_t reaction, cursorMoveFrames, surviveFrames, surviveRest;
  int32_t steps;
  // the level loop's own storage, kept from search to search
  Vec level, next, keep, tmp, moves;
  int32_t *seen; int32_t seenCap;
  int32_t ntags;
  int32_t *verdict, *proofs, *weak, *reach, *reachSet, *far, *per; int32_t tagCap;
  int32_t par;   // threads are making nodes: newNode takes a reserved slot
} Ctx;
#define NODE(x, i) (&(x)->nodes[i])

static Node *newNode(Ctx *x) {
  if (x->par) {
    int32_t i = __atomic_fetch_add(&x->n, 1, __ATOMIC_SEQ_CST);
    if (i >= x->cap) return 0;   // reserved before the threads start: never here
    Node *n = &x->nodes[i];
    memset(n, 0, sizeof(Node) - sizeof(n->key));
    n->prev = -1; n->tag = -1;
    return n;
  }
  if (x->n == x->cap) {
    int32_t cap = x->cap ? x->cap * 2 : 1024;
    Node *nn = (Node *)grab((unsigned long)cap * sizeof(Node));
    if (!nn) return 0;
    if (x->n) memcpy(nn, x->nodes, (unsigned long)x->n * sizeof(Node));
    x->nodes = nn; x->cap = cap;   // the old block is left behind: nodes grow rarely
  }
  Node *n = &x->nodes[x->n++];
  memset(n, 0, sizeof(Node) - sizeof(n->key));
  n->prev = -1; n->tag = -1;
  return n;
}
EXPORT(ns_ctx_new) Ctx *ns_ctx_new(void) { Ctx *x = (Ctx *)grab(sizeof(Ctx)); memset(x, 0, sizeof(Ctx)); return x; }
EXPORT(ns_ctx_set) void ns_ctx_set(Ctx *x, int reaction, int cursorMoveFrames, int surviveFrames, int surviveRest) {
  x->reaction = reaction; x->cursorMoveFrames = cursorMoveFrames; x->surviveFrames = surviveFrames; x->surviveRest = surviveRest;
}
// Every node gone and every board back in the pool.
EXPORT(ns_reset) void ns_reset(Ctx *x) {
  for (int i = 0; i < x->n; i++) if (x->nodes[i].st && !x->nodes[i].fromPrev) nb_free(x->nodes[i].st);
  x->n = 0;
}

// ---- what the search reads off a board (puyocpu.js _engineNode, FastStack.grid)
static const char STATE_KEY[9] = { 0, 1, 2, 3, 4, 4, 5, 6, 7 };   // 'popping' and 'popped' share their 'p'
static void readBoard(Node *n, Board *b) {
  int H = b->height, r, c, k = 0, g = 0, top = 0;
  uint32_t h = 2166136261u;
  for (r = 1; r <= H + 1 && r < b->nrows; r++)
    for (c = 1; c <= W; c++) {
      const int32_t *f = b->p[r][c].f;
      if (f[COLOR] != 0) { top = r; if (f[ISGARBAGE]) g++; }
      int32_t tm = f[TIMER];
      if (tm < 0 || tm >= (1 << 19)) n->err |= 1;
      int32_t v = (f[ISGARBAGE] ? 255 : (f[COLOR] & 255)) | (STATE_KEY[f[STATE]] << 8) | (tm << 12);
      if (k < KEYMAX) n->key[k++] = v;
      h = (h ^ (uint32_t)v) * 16777619u;
    }
  n->keyn = k; n->hash = h; n->garb = g; n->top = top;
  n->pos0 = b->curRow; n->pos1 = b->curCol;
  n->stopTime = b->stopTime; n->preStopTime = b->preStopTime; n->shakeTime = b->shakeTime;
  n->displacement = b->displacement; n->riseTimer = b->riseTimer; n->speed = b->speed;
  n->held = b->stopTime + b->preStopTime + b->shakeTime;
}
static int legalSwaps(Board *b, int32_t *out) {
  int n = 0;
  for (int r = 1; r <= b->height; r++)
    for (int c = 1; c < W; c++) {
      Panel *a = P(b, r, c), *d = P(b, r, c + 1);
      if (a->f[ISGARBAGE] || d->f[ISGARBAGE]) continue;
      if (a->f[COLOR] == 0 && d->f[COLOR] == 0) continue;
      if (a->f[COLOR] == d->f[COLOR]) continue;
      if (!canSwap(b, r, c)) continue;
      out[n++] = r * 8 + c;
    }
  return n;
}

// ---- the bot's hands (panel-cpu.js beginWalk / driveWalk / nearestSwappable, puyocpu.js raiseStep)
typedef struct { int32_t active, row, col, timer, cooldown, retries, disp; } Walk;
typedef struct { Walk w; int32_t cooldown, lastSwap, raiseFrames, raiseStarted; } Bot;
static void beginWalk(Bot *bot, int row, int col, int cooldown) {
  Walk w = { 1, row, col, 0, cooldown, 0, UND };
  bot->w = w;
}
static int nearestSwappable(Board *b, int fromRow, int fromCol, int *out) {
  int found = 0, bestD = 0x7fffffff;
  for (int r = 1; r <= b->topCurRow; r++)
    for (int c = 1; c < W; c++) {
      if (r == fromRow && c == fromCol) continue;
      int d = (r > fromRow ? r - fromRow : fromRow - r) + (c > fromCol ? c - fromCol : fromCol - c);
      if (d >= bestD) continue;
      if (!canSwap(b, r, c)) continue;
      out[0] = r; out[1] = c; bestD = d; found = 1;
    }
  return found;
}
static void driveWalk(Ctx *x, Bot *bot, Board *b, int32_t *input) {
  Walk *w = &bot->w;
  if (w->disp != UND && b->displacement > w->disp) w->row++;
  w->disp = b->displacement;
  int row = imax(1, imin(w->row, b->topCurRow)), col = imax(1, imin(w->col, W - 1));
  if (b->curRow != row || b->curCol != col) {
    if (w->timer > 0) { w->timer--; return; }
    if (b->curCol < col) *input |= IN_RIGHT;
    else if (b->curCol > col) *input |= IN_LEFT;
    else if (b->curRow < row) *input |= IN_UP;
    else *input |= IN_DOWN;
    w->timer = x->cursorMoveFrames - 1;
    return;
  }
  int ok = tryQueueSwap(b, b->curRow, b->curCol);
  Walk old = *w;
  w->active = 0;
  if (ok) { bot->lastSwap = 1; bot->cooldown = old.cooldown; return; }
  int alt[2];
  if (old.retries < 2 && nearestSwappable(b, b->curRow, b->curCol, alt)) {
    beginWalk(bot, alt[0], alt[1], old.cooldown);
    bot->w.retries = old.retries + 1;
    return;
  }
  bot->cooldown = old.cooldown;
}
static void raiseStep(Bot *h, Board *st, int32_t *input) {
  if (h->raiseFrames > 0) {
    if (st->manualRaise) h->raiseStarted = 1;
    if (st->preventManualRaise || (h->raiseStarted && !st->manualRaise)) h->raiseFrames = 0;
    else { h->raiseFrames--; *input |= IN_RAISE; }
  }
}

// ---- one step
#define STEP_NULL (-1)
#define STEP_DEAD (-2)
#define STEP_ERR (-3)
static LOCAL int32_t deadAt;   // the frame a STEP_DEAD died on
static int runFrame(Board *st, Arr *arr, int32_t *narr, int32_t input, int32_t *f) {
  st->input = input;
  run(st);
  (*f)++;
  int k = 0;
  for (int i = 0; i < *narr; i++) {
    if (arr[i].at <= *f) nb_push_incoming(st, arr[i].width, arr[i].height, arr[i].isChain);
    else arr[k++] = arr[i];
  }
  *narr = k;
  return st->gameOver;
}
static Board *ensureBoard(Ctx *x, int i);
// _engineAdvanceOn + _runFrom. Returns the child's index, STEP_NULL (refused)
// or STEP_DEAD (deadAt set).
static int advance(Ctx *x, int pi, int kind, int mr, int mc, int32_t frames) {
  Board *pb = ensureBoard(x, pi);
  if (!pb) return STEP_ERR;
  Node *par = NODE(x, pi);
  Board *st = nb_new();
  if (!st) return STEP_ERR;
  cloneBoard(st, pb);
  Bot bot; memset(&bot, 0, sizeof bot);
  bot.raiseFrames = par->holdLeft; bot.raiseStarted = par->holdStarted;
  Arr arr[MAXARR]; int32_t narr = par->narr;
  for (int i = 0; i < narr; i++) arr[i] = par->arr[i];
  int32_t input = par->fresh ? st->input : 0, f = 0, t0 = par->t;
  if (!par->fresh) raiseStep(&bot, st, &input);
  if (kind == MK_SWAP) { beginWalk(&bot, mr, mc, x->reaction); driveWalk(x, &bot, st, &input); }
  else if (kind == MK_RAISE) { bot.raiseFrames = 20; bot.raiseStarted = 0; bot.cooldown = x->reaction; }
  else if (kind == MK_HOLD) bot.cooldown = x->reaction;
#define REFUSED (kind == MK_SWAP && !bot.w.active && !bot.lastSwap)
#define GIVE(code) do { nb_free(st); return (code); } while (0)
#define FRAME() do { int over_ = runFrame(st, arr, &narr, input, &f); if (st->err) GIVE(STEP_ERR); \
                      if (over_) { deadAt = t0 + f; GIVE(STEP_DEAD); } } while (0)
  if (REFUSED || (bot.w.active && bot.w.retries)) GIVE(STEP_NULL);
  FRAME();
  for (int guard = 0; guard < 4000; guard++) {
    if (kind == MK_LONG && f >= frames) break;
    input = 0;
    raiseStep(&bot, st, &input);
    if (bot.w.active) {
      driveWalk(x, &bot, st, &input);
      if (REFUSED || (bot.w.active && bot.w.retries)) GIVE(STEP_NULL);
      FRAME();
      continue;
    }
    if (kind != MK_LONG) {
      if (bot.cooldown > 0) { bot.cooldown--; FRAME(); continue; }
      break;
    }
    FRAME();
  }
#undef FRAME
  if (st->err) GIVE(STEP_ERR);
  Node *n = newNode(x);
  if (!n) GIVE(STEP_ERR);
  par = NODE(x, pi);   // nodes may have moved
  n->st = st; n->t = t0 + f; n->holdLeft = bot.raiseFrames; n->holdStarted = bot.raiseStarted; n->fresh = 0;
  n->narr = narr;
  for (int i = 0; i < narr; i++) { n->arr[i] = arr[i]; n->arr[i].at -= f; }
  n->prev = pi; n->mk = kind; n->mr = mr; n->mc = mc; n->frames = frames;
  readBoard(n, st);
  if (n->err) return STEP_ERR;
  return (int)(n - x->nodes);
#undef REFUSED
#undef GIVE
}
// _engineStep: a wait to `until` in whole beats (reaction + 1), a raise, a
// hold or a swap. A wait that dies after the horizon is a dead end on the
// parent's board.
static int lineStep(Ctx *x, int pi, int kind, int mr, int mc, int32_t until) {
  int32_t frames = 0;
  if (kind == MK_LONG) {
    int32_t beat = x->reaction + 1, fr = imax(1, until - NODE(x, pi)->t);
    frames = ((fr + beat - 1) / beat) * beat;
  }
  int r = advance(x, pi, kind, mr, mc, frames);
  if (r != STEP_DEAD) return r;
  if (kind == MK_LONG && deadAt >= x->surviveFrames) {
    Node *n = newNode(x);
    if (!n) return STEP_ERR;
    Node *par = NODE(x, pi);
    int32_t keep[KEYMAX]; int32_t keyn = par->keyn;
    for (int i = 0; i < keyn; i++) keep[i] = par->key[i];
    *n = *par;
    for (int i = 0; i < keyn; i++) n->key[i] = keep[i];
    n->fresh = 0;
    n->st = 0; n->fromPrev = 1; n->t = deadAt; n->dead = 1; n->prev = pi; n->mk = kind; n->mr = mr; n->mc = mc;
    n->frames = frames; n->pins = 0; n->tag = -1; n->seed = 0;
    return (int)(n - x->nodes);
  }
  return STEP_NULL;
}
// A node whose board was let go is played again from its parent. The replay
// must land on the same frame, or the port is not deterministic.
static Board *ensureBoard(Ctx *x, int i) {
  Node *n = NODE(x, i);
  if (n->fromPrev) return ensureBoard(x, n->prev);   // never kept: the parent's may be let go
  if (n->st) return n->st;
  if (n->prev < 0) return 0;
  int32_t t = n->t, mk = n->mk, mr = n->mr, mc = n->mc, frames = n->frames, prev = n->prev;
  int r = advance(x, prev, mk, mr, mc, frames);
  if (r < 0) return 0;
  Node *m = NODE(x, r), *o = NODE(x, i);
  Board *b = m->st;
  m->st = 0; x->n--;   // the replay was the last node made
  if (m->t != t) { nb_free(b); return 0; }
  o->st = b;
  return b;
}
static void dropBoard(Ctx *x, int i) {
  Node *n = NODE(x, i);
  if (n->prev < 0 || n->pins) return;          // the root and pinned nodes keep theirs
  if (n->fromPrev) return;
  if (n->st) { nb_free(n->st); n->st = 0; }
}

// ---- nodes from JS
// The root: the board in the io buffers (nb_load's wire), a raise in hand,
// garbage on its way (io body after the board: at, width, height, isChain).
EXPORT(ns_root) int ns_root(Ctx *x, int holdLeft, int holdStarted, int narr, int fresh) {
  Board *b = nb_new();
  if (!b || nb_load(b)) { if (b) nb_free(b); return STEP_ERR; }
  Node *n = newNode(x);
  if (!n) return STEP_ERR;
  int32_t used = nb_save(b);   // the body's length, to find the arrivals after it
  if (narr > MAXARR) return STEP_ERR;
  n->st = b; n->t = 0; n->holdLeft = holdLeft; n->holdStarted = holdStarted; n->fresh = fresh; n->narr = narr;
  for (int i = 0; i < narr; i++) {
    const int32_t *a = ioBody + used + 4 * i;
    n->arr[i].at = a[0]; n->arr[i].width = a[1]; n->arr[i].height = a[2]; n->arr[i].isChain = a[3];
  }
  readBoard(n, b);
  return n->err ? STEP_ERR : (int)(n - x->nodes);
}
EXPORT(ns_step) int ns_step(Ctx *x, int pi, int kind, int mr, int mc, int until) { x->steps++; return lineStep(x, pi, kind, mr, mc, until); }
EXPORT(ns_advance) int ns_advance(Ctx *x, int pi, int kind, int mr, int mc, int frames) { return advance(x, pi, kind, mr, mc, frames); }
EXPORT(ns_dead_at) int ns_dead_at(void) { return deadAt; }
EXPORT(ns_node) Node *ns_node(Ctx *x, int i) { return NODE(x, i); }
EXPORT(ns_board) Board *ns_board(Ctx *x, int i) { return ensureBoard(x, i); }
EXPORT(ns_legal) int ns_legal(Ctx *x, int i) { Board *b = ensureBoard(x, i); return b ? legalSwaps(b, ioBody) : -1; }
EXPORT(ns_steps) int ns_steps(Ctx *x) { int s = x->steps; x->steps = 0; return s; }
EXPORT(ns_pin) void ns_pin(Ctx *x, int i, int d) { NODE(x, i)->pins += d; }
// Where each field of a Node is, for native.js to read them in place.
#define NODE_FIELDS(X) X(t) X(holdLeft) X(holdStarted) X(fresh) X(dead) X(fromPrev) X(narr) X(tag) X(prev) X(mk) X(mr) X(mc) \
  X(seed) X(pins) X(held) X(garb) X(top) X(pos0) X(pos1) X(stopTime) X(preStopTime) X(shakeTime) X(displacement) X(speed) X(keyn)
#define NOFF1(f) (int)(unsigned long)&((Node *)0)->f,
#define NNAME1(f) #f,
static const int nodeOffs[] = { NODE_FIELDS(NOFF1) (int)(unsigned long)&((Node *)0)->riseTimer, (int)(unsigned long)&((Node *)0)->arr, (int)(unsigned long)&((Node *)0)->key, (int)sizeof(Node) };
static const char *nodeNames[] = { NODE_FIELDS(NNAME1) "riseTimer", "arr", "key", "size", 0 };
EXPORT(ns_field_off) int ns_field_off(int i) { return nodeOffs[i]; }
EXPORT(ns_field_name) const char *ns_field_name(int i) { return nodeNames[i]; }
// The node's grid (puyocpu.js engineGrid): rows 0..height+1, columns 0..6,
// 0 empty, -2 garbage, else the colour; into the io body.
EXPORT(ns_grid) int ns_grid(Ctx *x, int i) {
  Board *b = ensureBoard(x, i);
  if (!b) return -1;
  int k = 0;
  for (int r = 0; r <= b->height + 1; r++)
    for (int c = 0; c <= W; c++) {
      int32_t v = 0;
      if (c && r < b->nrows) { const int32_t *f = b->p[r][c].f; v = f[COLOR] == 0 ? 0 : f[ISGARBAGE] ? -2 : f[COLOR]; }
      ioBody[k++] = v;
    }
  return b->height;
}

// ---- the level loop (puyocpu.js _survivalSearch, breadth first)
extern int abort_poll(void) __attribute__((import_module("env"), import_name("abort_poll")));
static int vreserve(Vec *v, int32_t n) {
  if (n <= v->cap) return 1;
  int32_t cap = v->cap ? v->cap : 256;
  while (cap < n) cap *= 2;
  int32_t *a = (int32_t *)grab((unsigned long)cap * 4);
  if (!a) return 0;
  if (v->n) memcpy(a, v->a, (unsigned long)v->n * 4);
  v->a = a; v->cap = cap;
  return 1;
}
static int vpush(Vec *v, int32_t x) { if (!vreserve(v, v->n + 1)) return 0; v->a[v->n++] = x; return 1; }
EXPORT(ns_tags) int32_t *ns_tags(Ctx *x, int ntags) {
  if (ntags > x->tagCap) {
    int32_t cap = ntags < 64 ? 64 : ntags * 2;
    int32_t *m = (int32_t *)grab((unsigned long)cap * 4 * 7);
    if (!m) return 0;
    x->verdict = m; x->proofs = m + cap; x->weak = m + 2 * cap; x->reach = m + 3 * cap; x->reachSet = m + 4 * cap;
    x->far = m + 5 * cap; x->per = m + 6 * cap; x->tagCap = cap;
  }
  x->ntags = ntags;
  return x->verdict;
}
EXPORT(ns_tag_stride) int ns_tag_stride(Ctx *x) { return x->tagCap; }
EXPORT(ns_level) int32_t *ns_level(Ctx *x, int n) { if (!vreserve(&x->level, n)) return 0; x->level.n = n; return x->level.a; }
EXPORT(ns_level_n) int ns_level_n(Ctx *x) { return x->level.n; }
EXPORT(ns_set_tag) void ns_set_tag(Ctx *x, int i, int tag, int seed) { NODE(x, i)->tag = tag; NODE(x, i)->seed = seed; }
// A node's board is let go when nothing holds it: not in the level being
// expanded or the one being built, not the proof, the fallback or the
// furthest line of its move.
static void release(Ctx *x, int i) { Node *n = NODE(x, i); if (!n->pins && !n->live) dropBoard(x, i); }
static void pin(Ctx *x, int32_t *slot, int i) {
  int old = *slot;
  *slot = i;
  if (i >= 0) NODE(x, i)->pins++;
  if (old >= 0) { NODE(x, old)->pins--; release(x, old); }
}
static int better(Ctx *x, int32_t a, int32_t b) {
  Node *p = NODE(x, a), *q = NODE(x, b);
  int32_t d = (q->t + q->held) - (p->t + p->held);
  if (d) return d;
  if (p->garb != q->garb) return p->garb - q->garb;
  return p->top - q->top;
}
// Stable, as Array.prototype.sort is.
static int sortBetter(Ctx *x, int32_t *a, int32_t n) {
  if (n < 2) return 1;
  if (!vreserve(&x->tmp, n)) return 0;
  int32_t *t = x->tmp.a;
  for (int32_t w = 1; w < n; w *= 2) {
    for (int32_t lo = 0; lo < n; lo += 2 * w) {
      int32_t mid = lo + w < n ? lo + w : n, hi = lo + 2 * w < n ? lo + 2 * w : n, i = lo, j = mid, k = lo;
      while (i < mid && j < hi) t[k++] = better(x, a[j], a[i]) < 0 ? a[j++] : a[i++];
      while (i < mid) t[k++] = a[i++];
      while (j < hi) t[k++] = a[j++];
    }
    for (int32_t i = 0; i < n; i++) a[i] = t[i];
  }
  return 1;
}
static int sameKey(Node *a, Node *b) {
  if (a->hash != b->hash || a->tag != b->tag || a->held != b->held || a->pos0 != b->pos0 || a->pos1 != b->pos1 || a->keyn != b->keyn) return 0;
  for (int i = 0; i < a->keyn; i++) if (a->key[i] != b->key[i]) return 0;
  return 1;
}
static uint32_t seenHash(Node *n) {
  uint32_t h = n->hash;
  h = (h ^ (uint32_t)n->tag) * 16777619u; h = (h ^ (uint32_t)n->held) * 16777619u;
  h = (h ^ (uint32_t)n->pos0) * 16777619u; h = (h ^ (uint32_t)n->pos1) * 16777619u;
  return h ^ (h >> 15);
}
// Returns 1 if an equal node was seen this level, else records i.
static int seenBefore(Ctx *x, int i, int32_t *count) {
  if (2 * (*count + 1) > x->seenCap) {
    int32_t cap = x->seenCap ? x->seenCap * 2 : 4096;
    int32_t *t = (int32_t *)grab((unsigned long)cap * 4);
    if (!t) return -1;
    for (int32_t k = 0; k < cap; k++) t[k] = -1;
    for (int32_t k = 0; k < x->seenCap; k++) {
      int32_t v = x->seen[k];
      if (v < 0) continue;
      uint32_t s = seenHash(NODE(x, v)) & (uint32_t)(cap - 1);
      while (t[s] >= 0) s = (s + 1) & (uint32_t)(cap - 1);
      t[s] = v;
    }
    x->seen = t; x->seenCap = cap;
  }
  Node *n = NODE(x, i);
  uint32_t s = seenHash(n) & (uint32_t)(x->seenCap - 1);
  while (x->seen[s] >= 0) {
    if (sameKey(NODE(x, x->seen[s]), n)) return 1;
    s = (s + 1) & (uint32_t)(x->seenCap - 1);
  }
  x->seen[s] = i; (*count)++;
  return 0;
}
static void clearSeen(Ctx *x) { for (int32_t k = 0; k < x->seenCap; k++) x->seen[k] = -1; }
#define LOOP_ABORTED (-10)
#define LOOP_ERR (-11)
#define NOTRUN (-99)
// ---- the other threads. A phase is a list of steps (parent, move), each
// written to its own slot; the threads take them in any order, and the level
// loop reads them in its own. What a step makes does not depend on which
// thread made it or when.
static struct {
  int32_t gen, next, ntasks, ack, nworkers;
  Ctx *ctx; int32_t *tasks, *res;
} pool;
static void runTasks(void) {
  Ctx *x = pool.ctx;
  int32_t n = pool.ntasks;
  for (;;) {
    int32_t i = __atomic_fetch_add(&pool.next, 1, __ATOMIC_SEQ_CST);
    if (i >= n) break;
    const int32_t *t = pool.tasks + 4 * i;
    int32_t mv = t[1];
    pool.res[t[3]] = mv == -1 ? lineStep(x, t[0], MK_LONG, 0, 0, t[2])
                   : mv == -2 ? lineStep(x, t[0], MK_HOLD, 0, 0, 0)
                   : lineStep(x, t[0], MK_SWAP, CR(mv), CC(mv), 0);
  }
}
#ifdef THREADS
extern void __wasm_init_tls(void *);
// Every instance, the searching one included, before anything else.
EXPORT(ns_thread_init) void ns_thread_init(int id) {
  void *tls = grab(__builtin_wasm_tls_size() + __builtin_wasm_tls_align());
  unsigned long a = __builtin_wasm_tls_align();
  __wasm_init_tls((void *)(((unsigned long)tls + a - 1) & ~(a - 1)));
  thId = id;
}
EXPORT(ns_grab) void *ns_grab(int n) { return grab((unsigned long)n); }
// A worker's life: wait for a phase, take steps until there are none, say so.
EXPORT(ns_worker_loop) void ns_worker_loop(void) {
  int32_t last = __atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST);
  __atomic_add_fetch(&pool.nworkers, 1, __ATOMIC_SEQ_CST);
  __builtin_wasm_memory_atomic_notify(&pool.nworkers, 1);
  for (;;) {
    while (__atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST) == last) __builtin_wasm_memory_atomic_wait32(&pool.gen, last, -1);
    last = __atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST);
    runTasks();
    __atomic_add_fetch(&pool.ack, 1, __ATOMIC_SEQ_CST);
    __builtin_wasm_memory_atomic_notify(&pool.ack, 1);
  }
}
EXPORT(ns_workers) int ns_workers(void) { return __atomic_load_n(&pool.nworkers, __ATOMIC_SEQ_CST); }
#endif
static int reserveNodes(Ctx *x, int32_t more) {
  if (x->n + more <= x->cap) return 1;
  int32_t cap = x->cap ? x->cap : 1024;
  while (cap < x->n + more) cap *= 2;
  Node *nn = (Node *)grab((unsigned long)cap * sizeof(Node));
  if (!nn) return 0;
  if (x->n) memcpy(nn, x->nodes, (unsigned long)x->n * sizeof(Node));
  x->nodes = nn; x->cap = cap;
  return 1;
}
// Runs the phase's steps on every thread; back when all are done.
static int runPhase(Ctx *x, Vec *tasks, int32_t *res) {
  int32_t n = tasks->n / 4, w = pool.nworkers;
  if (!n) return 1;
  if (!reserveNodes(x, n)) return 0;
  // Boards for the workers, from this thread's spares, so memory goes round.
  int32_t each = n / (w + 1) + 4;
  for (int k = 1; k <= w && k < MAXTHREADS; k++)
    while (freeCount[k] < each && freeOf[0]) {
      Board *b = freeOf[0]; freeOf[0] = *(Board **)b; freeCount[0]--;
      *(Board **)b = freeOf[k]; freeOf[k] = b; freeCount[k]++;
    }
  pool.ctx = x; pool.tasks = tasks->a; pool.res = res; pool.ntasks = n; pool.ack = 0;
  x->par = 1;
  __atomic_store_n(&pool.next, 0, __ATOMIC_SEQ_CST);
  __atomic_add_fetch(&pool.gen, 1, __ATOMIC_SEQ_CST);
  __builtin_wasm_memory_atomic_notify(&pool.gen, (unsigned)-1);
  runTasks();
  int32_t a;
  while ((a = __atomic_load_n(&pool.ack, __ATOMIC_SEQ_CST)) < w) __builtin_wasm_memory_atomic_wait32(&pool.ack, a, -1);
  x->par = 0;
  if (x->n > x->cap) x->n = x->cap;
  return 1;
}
#define CHUNK 96
// The level loop. In: the level (ns_level), each level node's tag and seed
// (ns_set_tag), and per move (ns_tags): verdict (1 proven), proofs, weak,
// reach/reachSet and far, nodes as indices, -1 for none. Out: the same, and
// the level still open. Returns the budget left.
//
// It reads the level a chunk of parents at a time. With threads, a chunk's
// waits are played first, then the other moves of every parent whose wait
// did not prove its move; then the chunk is read in order, exactly as the
// single-threaded loop reads it, a step not played yet being played then.
// Steps played but not read are dropped.
EXPORT(ns_loop) int ns_loop(Ctx *x, int budget, int until, int full, int beam, int quota, int seedsMax) {
  int32_t *verdict = x->verdict, *proofs = x->proofs, *weak = x->weak, *reach = x->reach, *reachSet = x->reachSet, *far = x->far;
  int polled = 0, i, j;
  static Vec poff, res, tasks, proven;
  for (i = 0; i < x->ntags; i++) {
    if (proofs[i] >= 0) NODE(x, proofs[i])->pins++;
    if (weak[i] >= 0) NODE(x, weak[i])->pins++;
    if (far[i] >= 0) NODE(x, far[i])->pins++;
  }
  for (i = 0; i < x->level.n; i++) NODE(x, x->level.a[i])->live = 1;
  if (!vreserve(&proven, x->ntags)) return LOOP_ERR;
  while (x->level.n && budget > 0) {
    int32_t seenN = 0;
    x->next.n = 0;
    clearSeen(x);
    int32_t at = 0;
    while (at < x->level.n && budget > 0) {
      // the chunk: parents at..e, their moves at poff[k]..poff[k+1]
      int32_t e = at, est = 0;
      x->moves.n = 0; poff.n = 0;
      while (e < x->level.n && e - at < CHUNK && (e == at || est < budget)) {
        int ni = x->level.a[e];
        if (!vpush(&poff, x->moves.n)) return LOOP_ERR;
        if (!verdict[NODE(x, ni)->tag]) {
          Board *nb = ensureBoard(x, ni);
          if (!nb || !vreserve(&x->moves, x->moves.n + 2 + 6 * MAXROWS)) return LOOP_ERR;
          int32_t *m = x->moves.a + x->moves.n;
          int nm = 2 + legalSwaps(nb, m + 2);
          m[0] = -1; m[1] = -2;
          x->moves.n += nm; est += nm;
        }
        e++;
      }
      if (!vpush(&poff, x->moves.n) || !vreserve(&res, x->moves.n)) return LOOP_ERR;
      for (j = 0; j < x->moves.n; j++) res.a[j] = NOTRUN;
      if (pool.nworkers) {
        tasks.n = 0;
        for (int k = 0; k < e - at; k++) {
          if (poff.a[k + 1] == poff.a[k]) continue;
          int32_t t[4] = { x->level.a[at + k], -1, until, poff.a[k] };
          for (j = 0; j < 4; j++) if (!vpush(&tasks, t[j])) return LOOP_ERR;
        }
        if (!runPhase(x, &tasks, res.a)) return LOOP_ERR;
        tasks.n = 0;
        for (i = 0; i < x->ntags; i++) proven.a[i] = verdict[i];
        int32_t cum = 0;
        for (int k = 0; k < e - at && cum < budget; k++) {
          int32_t o = poff.a[k], nm = poff.a[k + 1] - o, tag = NODE(x, x->level.a[at + k])->tag;
          if (!nm || proven.a[tag]) continue;
          cum++;
          int32_t r = res.a[o];
          if (r >= 0 && NODE(x, r)->t >= full && !NODE(x, r)->dead) { proven.a[tag] = 1; continue; }
          for (j = 1; j < nm; j++) {
            int32_t t[4] = { x->level.a[at + k], x->moves.a[o + j], 0, o + j };
            for (int q = 0; q < 4; q++) if (!vpush(&tasks, t[q])) return LOOP_ERR;
          }
          cum += nm - 1;
        }
        if (!runPhase(x, &tasks, res.a)) return LOOP_ERR;
      }
      for (int k = 0; k < e - at && budget > 0; k++) {
        int ni = x->level.a[at + k];
        int32_t tag = NODE(x, ni)->tag, o = poff.a[k], nm = poff.a[k + 1] - o;
        if (verdict[tag]) { NODE(x, ni)->live = 0; release(x, ni); continue; }
        for (j = 0; j < nm && budget > 0; j++) {
          budget--;
          if (++polled >= 64) { polled = 0; if (abort_poll()) return LOOP_ABORTED; }
          int32_t mv = x->moves.a[o + j];
          int c = res.a[o + j];
          if (c == NOTRUN)
            c = mv == -1 ? lineStep(x, ni, MK_LONG, 0, 0, until)
              : mv == -2 ? lineStep(x, ni, MK_HOLD, 0, 0, 0)
              : lineStep(x, ni, MK_SWAP, CR(mv), CC(mv), 0);
          res.a[o + j] = NOTRUN;   // read: nothing to drop
          if (c == STEP_NULL) continue;
          if (c < 0) return LOOP_ERR;
          Node *cn = NODE(x, c), *pn = NODE(x, ni);
          cn->tag = tag; cn->seed = pn->seed;
          if (!reachSet[tag] || cn->t > reach[tag]) { reach[tag] = cn->t; reachSet[tag] = 1; pin(x, &far[tag], c); }
          if (cn->t >= full && !cn->dead) { verdict[tag] = 1; pin(x, &proofs[tag], c); break; }
          if (cn->t >= x->surviveFrames && weak[tag] < 0) pin(x, &weak[tag], c);
          if (cn->dead) continue;
          int sb = seenBefore(x, c, &seenN);
          if (sb < 0) return LOOP_ERR;
          if (sb) { release(x, c); continue; }
          if (!vpush(&x->next, c)) return LOOP_ERR;
          cn = NODE(x, c); cn->live = 1;
        }
        NODE(x, ni)->live = 0;
        release(x, ni);
      }
      for (j = 0; j < x->moves.n; j++) if (res.a[j] >= 0) dropBoard(x, res.a[j]);
      at = e;
    }
    // Parents the budget did not reach are let go too.
    for (; at < x->level.n; at++) { NODE(x, x->level.a[at])->live = 0; release(x, x->level.a[at]); }
    // the level left unexpanded when the budget ran out stays open
    int32_t k = 0;
    for (j = 0; j < x->next.n; j++) {
      int c = x->next.a[j];
      if (verdict[NODE(x, c)->tag]) { NODE(x, c)->live = 0; release(x, c); }
      else x->next.a[k++] = c;
    }
    x->next.n = k;
    if (!sortBetter(x, x->next.a, x->next.n)) return LOOP_ERR;
    if (!vreserve(&x->keep, x->next.n)) return LOOP_ERR;
    int32_t *keep = x->keep.a, nk = 0, seeds = 0;
    for (i = 0; i < x->ntags; i++) x->per[i] = 0;
    for (j = 0; j < x->next.n; j++) NODE(x, x->next.a[j])->kept = 0;
    for (j = 0; j < x->next.n && seeds < seedsMax; j++) {
      Node *cn = NODE(x, x->next.a[j]);
      if (cn->seed) { keep[nk++] = x->next.a[j]; cn->kept = 1; seeds++; }
    }
    for (j = 0; j < x->next.n; j++) {
      Node *cn = NODE(x, x->next.a[j]);
      if (cn->kept) continue;
      if (x->per[cn->tag] < quota) { x->per[cn->tag]++; keep[nk++] = x->next.a[j]; cn->kept = 1; }
    }
    for (j = 0; j < x->next.n && nk < beam; j++) {
      Node *cn = NODE(x, x->next.a[j]);
      if (!cn->kept && weak[cn->tag] < 0) { keep[nk++] = x->next.a[j]; cn->kept = 1; }
    }
    for (j = 0; j < x->next.n; j++) {
      Node *cn = NODE(x, x->next.a[j]);
      if (!cn->kept) { cn->live = 0; release(x, x->next.a[j]); }
    }
    if (!sortBetter(x, keep + seeds, nk - seeds)) return LOOP_ERR;
    if (!vreserve(&x->level, nk)) return LOOP_ERR;
    for (j = 0; j < nk; j++) x->level.a[j] = keep[j];
    x->level.n = nk;
  }
  for (i = 0; i < x->level.n; i++) NODE(x, x->level.a[i])->live = 0;
  for (i = 0; i < x->ntags; i++) {
    if (proofs[i] >= 0) NODE(x, proofs[i])->pins--;
    if (weak[i] >= 0) NODE(x, weak[i])->pins--;
    if (far[i] >= 0) NODE(x, far[i])->pins--;
  }
  return budget;
}
