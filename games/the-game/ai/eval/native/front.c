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
typedef struct {
  int id, reaction, reveal, allowRaise;
  int cooldown, raiseFrames, raiseStarted, wantRaise, wantRows;
  int walk, wRow, wCol, wTimer, wCooldown, wRetries, wDisp, wHasDisp;
  int park, pRow, pCol, pTimer, pTr, pTc, pDisp;
  int hasLast, lastR, lastC, held;
  double escapeWalk;
  u64 decidedOn;
  int lastKind, lastVia;
} Front;
#define MAXFRONTS 16
static Front FRONTS[MAXFRONTS];
static int nFronts;

// ---------------------------------------------------------------- the board, read
static Board *FB;
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
// The snapshot's grid value: -2 garbage, 0 empty or leaving, -1 dimmed, else the colour.
static int fGrid(const int32_t *f) {
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
      if (v < 0) { m[O_BAD] = 1; return; }
      if (v > m[O_N]) m[O_N] = v;
      m[SCOL + v * WMAX + c] |= (int32_t)b;
    }
  }
  // the slabs, in the order their first cell is met (row 0 up, column by column)
  int32_t ids[MAXSLAB]; int n = 0;
  for (r = 0; r <= top; r++) {
    for (c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      if (!f[ISGARBAGE]) continue;
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
        if (f[COLOR] > 0) { m[SCOL + f[COLOR] * WMAX + c] |= (int32_t)b; if (f[COLOR] > m[O_N]) m[O_N] = f[COLOR]; }
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
static int raiseRoom(void) {
  int top = FB->height;
  for (int r = top; r >= 1; r--)
    for (int c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      if (f[ISGARBAGE] ? fState(f) != FALLING : f[COLOR] != 0) return top - r;
    }
  return top;
}
static int raiseFits(int rows) { return raiseRoom() > 1 + rows; }
static int toppedNow(void) { return nb_topped(FB); }
static int canRaise(Front *F) {
  if (!F->allowRaise || F->raiseFrames > 0) return 0;
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
  d[IN_DRAIN] = drainBound();
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
  // a slab breaking: its bottom row already has the colours it turns into
  int nconv = 0, convTimer = -1, top = fTopRow();
  for (r = 1; r <= top; r++)
    for (c = 1; c <= W; c++) {
      const int32_t *f = fp(r, c);
      if (!fMoving(f) || !f[ISGARBAGE] || fState(f) != MATCHED || !(f[COLOR] > 0) || f[COLOR] == 9) continue;
      if (nconv < 80) { d[IN_CONV + 3 * nconv] = r; d[IN_CONV + 3 * nconv + 1] = c; d[IN_CONV + 3 * nconv + 2] = f[COLOR]; nconv++; }
      if (convTimer < 0 || fInt(f[TIMER]) < convTimer) convTimer = fInt(f[TIMER]);
    }
  int open = F->reveal && !nconv && flying > 0 && converted > 0;
  int conv = F->reveal && nconv;
  int timed = (moving || open) && fTimed(TMST, &TM);
  d[IN_HASRISEN] = hasRisen;
  d[IN_RAISEROOM] = raiseRoom();
  d[IN_INFLIGHT] = inFlight();
  d[IN_DRAINBOUND] = d[IN_TOPPED] ? drainBound() : 0;
  d[IN_LOCKLEFT] = lockLeft();
  d[IN_STACKTOPPED] = topped;
  d[IN_MOVING] = moving;
  if (moving) { nb_copy(paLibBoard(), FB); d[IN_HASPA] = 1; }
  d[IN_HASTIMED] = timed;
  d[IN_REVEALOPEN] = open;
  if (conv) { d[IN_CONVN] = nconv; d[IN_CONVTIMER] = convTimer; }
  else for (i = 0; i < 3 * nconv; i++) d[IN_CONV + i] = 0;
  d[IN_BCROW] = FB->curRow; d[IN_BCCOL] = FB->curCol;
  if (conv || open) {
    int nl = 0;
    for (r = 1; r <= FB->height; r++)
      for (c = 1; c < W; c++) {
        int a = fGrid(fp(r, c)), b = fGrid(fp(r, c + 1));
        if (a < 0 || b < 0 || (a == 0 && b == 0) || a == b) continue;
        d[IN_LEGAL + 2 * nl] = r; d[IN_LEGAL + 2 * nl + 1] = c; nl++;
      }
    d[IN_NLEGAL] = nl;
  }
  d[IN_HASINROW] = 1;
  for (c = 1; c <= W; c++) { const int32_t *f = fp(0, c); d[IN_INROW + c] = !f[ISGARBAGE] && f[COLOR] ? f[COLOR] : -1; }
  if (F->hasLast) { d[IN_HASLAST] = 1; d[IN_LASTR] = F->lastR; d[IN_LASTC] = F->lastC; }
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
static int fSend(Front *F, int input, int held) {
  int dir = input & IN_UP ? H_UP : input & IN_DOWN ? H_DOWN : input & IN_LEFT ? H_LEFT : input & IN_RIGHT ? H_RIGHT : H_NONE;
  if (dir && dir == held) {
    input &= ~(IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT);
    if (F->walk) F->wTimer = 0;
    if (F->park) F->pTimer = 0;
    dir = H_NONE;
  }
  F->held = dir;
  return input;
}
static int stepToward(int *timer, int row, int col, int input) {
  if (FB->curCol < col) input |= IN_RIGHT;
  else if (FB->curCol > col) input |= IN_LEFT;
  else if (FB->curRow < row) input |= IN_UP;
  else input |= IN_DOWN;
  *timer = MOVE_FRAMES - 1;
  return input;
}
static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }
static void beginWalk(Front *F, int r, int c, int cooldown) {
  F->walk = 1; F->wRow = r; F->wCol = c; F->wTimer = 0; F->wCooldown = cooldown; F->wRetries = 0; F->wHasDisp = 0;
}
static int nearestSwappable(int fromRow, int fromCol, int *br, int *bc) {
  int best = 0, bestD = 1 << 30;
  for (int r = 1; r <= FB->topCurRow; r++)
    for (int c = 1; c < W; c++) {
      if (r == fromRow && c == fromCol) continue;
      int d = (r > fromRow ? r - fromRow : fromRow - r) + (c > fromCol ? c - fromCol : fromCol - c);
      if (d >= bestD || !nb_can_swap(FB, r, c)) continue;
      *br = r; *bc = c; bestD = d; best = 1;
    }
  return best;
}
static int driveWalk(Front *F, int input) {
  if (F->wHasDisp && FB->displacement > F->wDisp) F->wRow++;
  F->wDisp = FB->displacement; F->wHasDisp = 1;
  int row = clampi(F->wRow, 1, FB->topCurRow), col = clampi(F->wCol, 1, W - 1);
  if (FB->curRow != row || FB->curCol != col) {
    if (F->wTimer > 0) { F->wTimer--; return input; }
    return stepToward(&F->wTimer, row, col, input);
  }
  int ok = nb_can_swap(FB, FB->curRow, FB->curCol) && nb_try_queue_swap(FB, FB->curRow, FB->curCol);
  F->walk = 0;
  if (ok) { F->hasLast = 1; F->lastR = FB->curRow; F->lastC = FB->curCol; F->cooldown = F->wCooldown; return input; }
  int ar, ac;
  if (F->wRetries < 2 && nearestSwappable(FB->curRow, FB->curCol, &ar, &ac)) {
    int retries = F->wRetries + 1;
    beginWalk(F, ar, ac, F->wCooldown);
    F->wRetries = retries;
    return input;
  }
  F->cooldown = F->wCooldown;
  return input;
}
static int parkStep(Front *F, int input) {
  if (FB->displacement > F->pDisp) F->pRow++;
  F->pDisp = FB->displacement;
  int row = clampi(F->pRow, 1, FB->topCurRow), col = clampi(F->pCol, 1, W - 1);
  if (FB->curRow == row && FB->curCol == col) return input;
  if (F->pTimer > 0) { F->pTimer--; return input; }
  return stepToward(&F->pTimer, row, col, input);
}
#define DIRS (IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT)

// The decision, out of the bot: K_HOLD / K_RAISE / K_SWAP, the move, the park.
typedef struct { int kind, hasMove, mr, mc, hasPark, pr, pc, via; } FDec;
static int fDecide(Front *F, FDec *out) {
  fPrepare(F);
  BOTS[F->id].tab[T_OPT + O_PRESS] = 1;
  if (bot_decide(F->id) != 0) return -1;
  double *o = BOUT;
  out->kind = (int)o[0]; out->hasMove = o[1] != 0; out->mr = (int)o[2]; out->mc = (int)o[3];
  out->hasPark = o[4] != 0; out->pr = (int)o[5]; out->pc = (int)o[6]; out->via = (int)o[7];
  F->wantRaise = o[12] != 0;
  F->wantRows = (int)o[13];
  if (o[14]) F->raiseFrames = 0;
  F->escapeWalk = o[15];
  F->hasLast = out->kind == K_SWAP && out->hasMove;
  if (F->hasLast) { F->lastR = out->mr; F->lastC = out->mc; }
  F->lastKind = out->kind; F->lastVia = out->via;
  return 0;
}

// One frame: the keys to press (the server's bits), the swap queued on the
// board itself as the walk arrives. -1: the bot failed.
EXPORT(front_frame) int front_frame(int fid, Board *b) {
  Front *F = &FRONTS[fid];
  FB = b;
  F->lastKind = -1;
  if (b->gameOverClock > 0) return 0;
  int held = F->held, input = 0;
  if (F->wantRaise && !raiseFits(F->wantRows)) { F->wantRaise = 0; F->raiseFrames = 0; }
  if (F->wantRaise && F->raiseFrames == 0 && !b->preventManualRaise && !b->manualRaise && !nb_falling_garbage(b)) {
    F->raiseFrames = 20; F->raiseStarted = 0;
  }
  if (F->raiseFrames > 0) {
    if (b->manualRaise) F->raiseStarted = 1;
    if (b->preventManualRaise || (F->raiseStarted && !b->manualRaise)) F->raiseFrames = 0;
    else { F->raiseFrames--; input |= IN_RAISE; }
  }
  if (F->walk) return fSend(F, driveWalk(F, input), held);
  if (F->park) input = parkStep(F, input);
  int sent = fSend(F, input, held);
  int urgent = b->stopTime > 0 || toppedNow();
  if (F->cooldown > 0) {
    int lift = (urgent || (F->reveal && windowOpen())) && !swapLanding();
    if (lift && toppedNow() && !(F->reveal && windowOpen()) && boardKey() == F->decidedOn && drainBound() > F->escapeWalk + 2) lift = 0;
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
    F->raiseFrames = 20; F->raiseStarted = 0; F->cooldown = F->reaction;
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
  beginWalk(F, d.mr, d.mc, F->reaction);
  return fSend(F, driveWalk(F, input & ~DIRS), held);
}

// A bot for the board `b` (its level's constants go into the bot's table).
EXPORT(front_new) int front_new(Board *b, int reaction, int allowRaise) {
  if (nFronts >= MAXFRONTS) return -1;
  Front *F = &FRONTS[nFronts];
  memset(F, 0, sizeof *F);
  F->reaction = reaction; F->reveal = 1; F->allowRaise = allowRaise; F->escapeWalk = INF;
  F->id = bot_new();
  if (F->id < 0) return -1;
  FB = b;
  fTable(F, BOTS[F->id].tab);
  return nFronts++;
}
EXPORT(front_last) int front_last(int fid) { Front *F = &FRONTS[fid]; return F->lastKind < 0 ? -1 : F->lastKind * 100 + F->lastVia; }
// What the bot is handed on board `b` (BIN, the masks, the timed board), as if
// the key `held` were down and (lastR, lastC) the last swap: front.test.js.
EXPORT(front_prepare) int front_prepare(int fid, Board *b, int held, int hasLast, int lastR, int lastC) {
  Front *F = &FRONTS[fid];
  FB = b;
  F->held = held; F->hasLast = hasLast; F->lastR = lastR; F->lastC = lastC;
  fPrepare(F);
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
