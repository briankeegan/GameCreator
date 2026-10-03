#define BW 6
#define BH 12
#define WORKING_ROWS 4
#define MOVE_FRAMES 4
#define INF (1.0 / 0.0)

enum { IN_TOPPED, IN_STOP, IN_INCOMING, IN_NEXTSLAB, IN_FALLING, IN_CROW, IN_CCOL, IN_HEALTH, IN_DRAIN, IN_FPR,
       IN_FTNR, IN_SPEED, IN_NEXTUP, IN_STARTSPEED, IN_CLOCK, IN_STACKCLOCK, IN_HASRISEN, IN_RAISEROOM, IN_INFLIGHT,
       IN_DRAINBOUND, IN_STACKTOPPED, IN_MOVING, IN_HASTIMED, IN_REVEALOPEN, IN_CONVN, IN_CONVTIMER, IN_BCROW, IN_BCCOL,
       IN_NLEGAL, IN_HASINROW, IN_INROW = 30, IN_HASLAST = 37, IN_LASTR, IN_LASTC, IN_SETTLING = 40, IN_HELD = 49, IN_SF = 50, IN_CONV = 60, IN_LEGAL = 300, IN_T = 560, IN_SLABW = 590, IN_SLABH, IN_SLABC, IN_INROWS, IN_POPLOW = IN_INROWS, IN_SIZE = 600 };
enum { TF_DEADLY = 1, TF_FORCE = 2, TF_REFUSE = 4, TF_RAISE = 8, TF_STUB = 16, TF_SLAB = 32 };
static int deadlyCalls;
#define TFLAG(f) (((int)BIN[IN_T]) & (f))
enum { T_RISE = 0, T_COMBO = 100, T_STOP = 200, T_LF = 210, T_W = 220, T_OPT = 250, T_SIZE = 270 };
enum { O_REACTION, O_REVEAL, O_ALLOWRAISE, O_REFRETURN, O_REFPAYLESS, O_BEAM, O_MAXDEPTH, O_HORIZON, O_PRESS };
enum { K_HOLD = 0, K_RAISE = 1, K_SWAP = 2 };
enum { V_NONE, V_RAISE_OPENING, V_RAISE_MATERIAL, V_RAISING, V_READYFIRST, V_AWAITLANDING, V_BREAK, V_LINEUPHOLD,
       V_LINEUP, V_BREAKREACH, V_BREAKSPEND, V_DIGPLAN, V_DIGWAIT, V_ATTACKWAIT, V_ATTACKPLAN, V_BESTATTACK,
       V_PLANWAIT, V_SURVIVALPLAN, V_FLATTENWAIT, V_FLATTEN, V_NOBEST, V_SETUP, V_WEIGHTS, V_RULED, V_PLANSAVE,
       V_KEEPSAVE, V_AWAITDRAIN, V_KEEPHEALTH };
enum { M_BUILD, M_DEFEND, M_ATTACK };
enum { C_REFUSEDDEADLY, C_ALLDEAD, C_REFUSEDRETURN, C_REFUSEDTOOSLOW, C_PLANNED, C_PLANDROPPED, C_ATTACKED,
       C_ATTACKDROPPED, C_CELLSPLANNED, C_REFUSEDPAYLESS, C_REFUSEDSTARVING, C_REFUSEDOTHER, C_REFUSEDATEXIT,
       C_RAISEDFORMATERIAL, C_WAITEDTORAISE, C_DUGFOR, C_DIGDROPPED, C_BROKENOW, C_FLATTENBLIND, C_OPENINGRAISES,
       C_SAVEKEPT, C_SAVEUNKEEPABLE, C_SAVEPLANNED, C_HELDTHEBREAK, C_FORCEDBREAK, C_FORCEDBOTH, C_REFUSEDEARLY,
       C_REVEALSWAPS, C_REVEALWINDOWS, C_DIGGING, C_FLATTENED, C_FLATTENDROPPED, C_REFUSEDSTRANDED,
       C_REFUSEDNOFAILSAFE, C_REFUSEDSAMESWAP, C_READIEDFIRST, C_HELDFORLANDING, C_BROKEREACHED, C_BROKEPREEMPT,
       C_BROKESPENDING, C_WAITEDFORDRAIN, C_KEPTHEALTH, C_DECISIONS, C_BYMODE, NCOUNT = C_BYMODE + 3 };

typedef struct { int scope, chain, total, rounds, biggest, broke, converts, voidAfter, garbage; } Rs;
struct Cand { int kind, sr, sc, moveFrames, future; const int32_t *masks; Rs res; };
typedef struct { int N; uint32_t occ[WMAX], garb[WMAX], col[NCOL][WMAX]; } Sig;
typedef struct { int has, n; int32_t mv[2 * MAXD]; double frames, gain, rate, startedAt; int spend, blind; } Route;
typedef struct {
  double tab[T_SIZE];
  Sig seen[4]; int nSeen;
  Route plan, dig, attack, flatten;
  int digIsBreak, opening, maxSlab, nRecent, wantRows, wantRaise;
  int32_t recent[4];
  double counts[NCOUNT];
} Bot;

static LOCAL int nScore, nLook, nSave, rScore, rMain, rLook, rSave, rCand, lookDepthLog;
#define MAXBOT 2048
static Bot BOTS[MAXBOT];
static int nBots = 0;
static Bot *BT;
static double BIN[IN_SIZE], BOUT[256];
static ST RISEN, TMST;
static double *TB;

__attribute__((export_name("bot_in"))) double *bot_in(void) { return BIN; }
__attribute__((export_name("bot_out"))) double *bot_out(void) { return BOUT; }
__attribute__((export_name("bot_risen"))) int32_t *bot_risen(void) { return RISEN; }
__attribute__((export_name("bot_tmst"))) int32_t *bot_tmst(void) { return TMST; }
__attribute__((export_name("bot_new"))) int32_t bot_new(void) {
  if (nBots >= MAXBOT) return -1;
  threadInit();
  Bot *b = &BOTS[nBots];
  memset(b, 0, sizeof(Bot));
  b->opening = 1;
  return nBots++;
}
__attribute__((export_name("bot_tab"))) double *bot_tab(int32_t id) { return BOTS[id].tab; }
__attribute__((export_name("bot_cur"))) int32_t bot_cur(void) { return (int32_t)(BT - BOTS); }
__attribute__((export_name("bot_counts"))) double *bot_counts(int32_t id) { return BOTS[id].counts; }

static double opt(int i) { return TB[T_OPT + i]; }
static int REACT, botFailed;
static double nz(double v) { return v != v ? 0 : v; }
static double dmax(double a, double b) { return a > b ? a : b; }
static double dmin(double a, double b) { return a < b ? a : b; }

static double riseTimeOf(double speed) {
  int s = (int)speed;
  if (s < 1) s = 1;
  if (s > 99) s = 99;
  return TB[T_RISE + s - 1];
}
static double cellsSent(int isChain, int size, int chain) {
  if (!isChain) return TB[T_COMBO + (size < 99 ? (size > 0 ? size : 0) : 99)];
  return chain > 1 ? BW * (chain - 1) : 0;
}
static double stopTimeOf(int isChain, int comboSize, int chainCounter, int toppedOut) {
  double *st = TB + T_STOP, t = 0;
  if (comboSize > 3 || isChain) {
    if (toppedOut && isChain) {
      int len = chainCounter > 4 ? 6 : chainCounter;
      t = st[2] + (len - 1) * st[4];
    } else if (toppedOut) {
      t = st[3] * (comboSize < 9 ? 2 : 3) + st[1];
    } else if (isChain) {
      t = st[3] * (chainCounter < 13 ? chainCounter : 13) + st[1];
    } else {
      t = st[3] * comboSize + st[0];
    }
  }
  return t;
}
static double resolveFramesOf(int size, int garbage) {
  double *f = TB + T_LF;
  return f[0] + f[1] + f[2] * (size + garbage);
}
static double heldFrames(double stopGain, double cleared, double garbagePanels) {
  double *f = BIN + IN_SF, popping = 0;
  if (cleared > 0 || garbagePanels > 0) popping = f[1] + f[2] + f[3] * (cleared + garbagePanels);
  return dmax(stopGain, popping);
}

static int tallestBoard(const int32_t *st) {
  int t = 0;
  for (int c = 1; c <= BW; c++) { int top = topRow(U(st, OCC + c)); if (top > t) t = top; }
  return t;
}
static double materialRows(const int32_t *st) {
  int n = 0;
  for (int c = 1; c <= BW; c++) n += popc(U(st, OCC + c) & ~U(st, GARB + c));
  return (double)n / BW;
}
static int bumpinessOf(const int32_t *st) {
  int h[WMAX], n = 0;
  for (int c = 1; c <= BW; c++) {
    uint32_t g = U(st, GARB + c), fl = g ? lowb(g) : 0, below = fl ? fl - 1u : 0xffffffffu;
    h[c] = popc(U(st, OCC + c) & ~g & below);
  }
  for (int c = 1; c < BW; c++) n += h[c] > h[c + 1] ? h[c] - h[c + 1] : h[c + 1] - h[c];
  return n;
}
static int matchWays(const int32_t *st) {
  uint32_t r[WMAX]; int n = 0;
  reachMask(st, r);
  for (int c = 1; c <= BW; c++) n += popc(r[c]);
  return n;
}
static int garbageRows(const int32_t *st) {
  int best = 0;
  for (int c = 1; c <= BW; c++) { int n = popc(U(st, GARB + c)); if (n > best) best = n; }
  return best;
}
static int hasGarbage(const int32_t *st) { for (int c = 1; c <= BW; c++) if (st[GARB + c]) return 1; return 0; }

static double framesToRise(double rows, double fpr, double startClock) {
  if (!(rows > 0)) return dmax(0, rows) * fpr;
  double speed = BIN[IN_SPEED], up = BIN[IN_NEXTUP], clock = startClock;
  if (!(speed > 0) || !(up > BIN[IN_CLOCK])) return rows * fpr;
  double ss = BIN[IN_STARTSPEED];
  if (!(ss == ss) || ss == 0) ss = speed;
  double steps = dmax(1, speed - ss + 1), every = up / steps;
  if (!(every > 0)) return rows * fpr;
  double frames = 0, left = rows;
  int guard = 0;
  while (up <= clock && guard++ < 128) { speed = dmin(speed + 1, 99); up += every; }
  guard = 0;
  while (left > 0 && guard++ < 128) {
    double f = riseTimeOf(speed) * 16;
    if (!(f > 0)) return frames + left * fpr;
    double until = up - clock, canDo = until / f;
    if (canDo >= left) return frames + left * f;
    frames += until;
    left -= canDo;
    clock = up;
    up += every;
    speed = dmin(speed + 1, 99);
  }
  return frames;
}
static double framesToDeathS(double stopTime, int tallest, double fpr) {
  double clock = stopTime;
  if (BIN[IN_TOPPED]) return dmax(0, (BIN[IN_DRAIN] ? BIN[IN_DRAIN] : 1) - 1);
  // Every queued slab drops as soon as the one before it lands, so the rows
  // still coming are the whole queue's, not the next slab's.
  double queued = dmax(__builtin_ceil(BIN[IN_NEXTSLAB] / BW), BIN[IN_INROWS]);
  return clock + framesToRise(dmax(0, BH - tallest - queued), fpr, nz(BIN[IN_CLOCK]) + clock);
}
static double framesToDeath(int tallest, double fpr) { return framesToDeathS(BIN[IN_STOP], tallest, fpr); }
static double lockNow(void) { return dmax(0, (BIN[IN_DRAIN] ? BIN[IN_DRAIN] : 1) - 1); }

static Rs summarise(const int32_t *r) {
  Rs o; o.scope = r[R_SCOPE]; o.chain = r[R_CHAIN]; o.total = r[R_TOTAL]; o.rounds = r[R_ROUNDS];
  o.biggest = r[R_ROUNDS] == 1 ? r[R_TOTAL] : 0; o.broke = r[R_SCOPE] == SC_BROKE;
  o.converts = o.broke ? r[R_CONVERTS] : 0; o.voidAfter = o.broke ? r[R_VOID] : 0; o.garbage = 0;
  return o;
}
static Rs raw(const int32_t *r) {
  Rs o = summarise(r);
  o.garbage = o.broke ? r[R_GARBAGE] : 0;
  return o;
}

static int deadly(const int32_t *st, const Rs *res, double horizon) {
  deadlyCalls++;
  if (TFLAG(TF_DEADLY)) return 1;
  int tallest = tallestBoard(st);
  double banked = BIN[IN_STOP];
  if (res && res->total > 0) {
    int isChain = res->chain >= 2;
    banked = dmax(banked, stopTimeOf(isChain, isChain ? 0 : res->total, isChain ? res->chain : 0, 1));
  }
  double rows = 0, ftnr = BIN[IN_FTNR], fpr = BIN[IN_FPR];
  if (opt(O_HORIZON)) {
    double spend = horizon - banked;
    if (spend >= ftnr && __builtin_isfinite(ftnr)) rows = 1 + (fpr > 0 ? __builtin_floor((spend - ftnr) / fpr) : 0);
  }
  if (tallest + rows < BH) return 0;
  double held = dmax(banked, BIN[IN_TOPPED] ? lockNow() : 0);
  if (res && (res->total > 0 || res->garbage > 0)) held += resolveFramesOf(res->total, res->garbage);
  return held <= MOVE_FRAMES;
}

static ST LK;
static int32_t LKSW[2 * 128];
static Res LKR;
typedef struct { int stranded, hasClear, hasBreak; } Ahead;
static Ahead lookahead(const int32_t *st0, double horizon) {
  nLook++;
  int r0 = nRes;
  Ahead out = { 1, 0, 0 };
  stcpy(LK, st0);
  Grid G;
  int n = legalG(LK, LKSW, &G), rest = settledRest(LK);
  for (int i = 0; i < n; i++) {
    if (quietSwapG(LK, &G, rest, LKSW[2 * i], LKSW[2 * i + 1])) {
      if (!out.stranded) continue;
      Rs zero; memset(&zero, 0, sizeof zero);
      swapIn(LK, LKSW[2 * i], LKSW[2 * i + 1]);
      int dead = deadly(LK, &zero, horizon);
      swapIn(LK, LKSW[2 * i], LKSW[2 * i + 1]);
      if (!dead) out.stranded = 0;
      if (out.hasBreak && !out.stranded) break;
      continue;
    }
    if (!swapIn(LK, LKSW[2 * i], LKSW[2 * i + 1])) continue;
    resolve(LK, LKR.r, 1);
    swapIn(LK, LKSW[2 * i], LKSW[2 * i + 1]);
    int sc = LKR.r[R_SCOPE];
    if (sc != SC_OK && sc != SC_BROKE) continue;
    if (sc == SC_BROKE) { out.hasBreak = 1; out.hasClear = 1; }
    else if (LKR.r[R_TOTAL] > 0) out.hasClear = 1;
    Rs rr = raw(LKR.r);
    if (out.stranded && !deadly(sc == SC_OK ? LKR.st : LK, &rr, horizon)) out.stranded = 0;
    if (out.hasBreak && !out.stranded) break;
  }
  rLook += nRes - r0;
  return out;
}

static LOCAL double PSCR[128];
static LOCAL int priceTopped = -1;
__attribute__((export_name("bit_price_dirty"))) void bit_price_dirty(void) { priceTopped = -1; }
static void timingParams(double *P, double fpr, double deadline, double stopTime, int toppedOut) {
  for (int i = 0; i < 128; i++) P[i] = 0;
  int frozen = stopTime > 0 || toppedOut;
  P[0] = fpr; P[1] = deadline; P[2] = INF; P[3] = 0; P[4] = 0; P[5] = 1;
  P[6] = resolveFramesOf(3, 0); P[7] = WORKING_ROWS; P[8] = MOVE_FRAMES + (frozen ? 0 : REACT);
  P[9] = P[8] ? P[8] : REACT; P[10] = 0; P[11] = 0;
  P[12] = BIN[IN_CROW]; P[13] = BIN[IN_CCOL]; P[14] = opt(O_PRESS);
  P[15] = 1; P[16] = toppedOut ? 1 : 2;
  if (priceTopped != toppedOut) {
    for (int i = 0; i < 64; i++) PCHAIN[i] = i >= 2 ? stopTimeOf(1, 0, i, toppedOut) : 0;
    for (int i = 0; i < 256; i++) PCOMBO[i] = stopTimeOf(0, i, 0, toppedOut);
    priceTopped = toppedOut;
  }
  double a = stopTimeOf(1, 0, 13, toppedOut), b = stopTimeOf(0, BW * 2, 0, toppedOut);
  P[17] = a > b ? a : b;
}

static void surface(const int32_t *st, double *bump, double *spread, double *tallest) {
  int h[WMAX], lo = 1 << 30, hi = 0, b = 0;
  for (int c = 1; c <= BW; c++) h[c] = popc(U(st, OCC + c));
  for (int c = 1; c <= BW; c++) {
    if (h[c] < lo) lo = h[c];
    if (h[c] > hi) hi = h[c];
    if (c < BW) b += h[c] > h[c + 1] ? h[c] - h[c + 1] : h[c + 1] - h[c];
  }
  *bump = b; *spread = hi - lo; *tallest = hi;
}
static double share(double v, double norm) {
  double s = v / norm;
  if (s > 1) return 1;
  return s < 0 ? 0 : s;
}
static const double FLOORW[20] = { -20, -10, -40, 1e300, 1e300, 1e300, 1e300, 1e300, 1e300, 1e300, 1e300,
                                   1e300, 1e300, 1e300, 1e300, 1e300, 1e300, 1e300, 1e300, 1e300 };

static double score(const int32_t *st, int moveFrames, const Rs *res) {
  nScore++;
  int r0 = nRes;
  int topped = BIN[IN_TOPPED] != 0;
  int isChain = res && res->chain >= 2;
  double earned = res ? stopTimeOf(isChain, isChain ? 0 : res->total, isChain ? res->chain : 0, topped) : 0;
  double afterStop = BIN[IN_STOP] + earned, fpr = BIN[IN_FPR];
  double lands = framesToDeathS(afterStop, tallestBoard(st), fpr);
  timingParams(PSCR, fpr, lands, afterStop, topped);
  PSCR[4] = 1; PSCR[11] = 2;
  double *keepOD = OD; int32_t *keepLD = LD;
  OD = ODS; LD = LDS;
  if (optionsRun(st, PSCR, 0, 0)) botFailed = 1;
  OD = keepOD; LD = keepLD;
  rScore += nRes - r0;
  int nNow = (int)ODS[1], nNext = (int)ODS[2];
  double *base = ODS + 64 + 4 * REC;
  double f[20], bump, spread, tallest;
  surface(st, &bump, &spread, &tallest);
  f[0] = share(bump, 20); f[1] = share(spread, 7); f[2] = share(tallest, 12);
  static const int CB[4] = { 2, 3, 4, 5 }, OB[4] = { 4, 5, 6, 7 };
  for (int k = 0; k < 4; k++) {
    int n = 0;
    for (int i = 0; i < nNow; i++) {
      double *o = base + i * REC;
      if (o[F_KIND] != 1) continue;
      if (CB[k] == 5 ? o[F_SIZE] >= 5 : o[F_SIZE] == CB[k]) n++;
    }
    f[3 + k] = share(n, 4);
  }
  for (int k = 0; k < 4; k++) {
    int n = 0;
    for (int i = 0; i < nNow; i++) {
      double *o = base + i * REC;
      if (o[F_KIND] != 0) continue;
      if (OB[k] == 7 ? o[F_SIZE] >= 7 : o[F_SIZE] == OB[k]) n++;
    }
    f[7 + k] = share(n, 4);
  }
  double near = INF;
  for (int i = 0; i < nNow; i++) if (base[i * REC + F_FRAMES] < near) near = base[i * REC + F_FRAMES];
  f[11] = near == INF ? 0 : 1 - share(near, 41);
  f[12] = 1 - share(moveFrames, 64);
  double bc = 0, bo = 0;
  for (int i = 0; i < nNext; i++) {
    double *o = base + (nNow + i) * REC;
    if (o[F_KIND] == 1 && o[F_SIZE] > bc) bc = o[F_SIZE];
    if (o[F_KIND] == 0 && o[F_SIZE] > bo) bo = o[F_SIZE];
  }
  f[13] = share(bc, 6); f[14] = share(bo, 8); f[15] = share(nNext, 220);
  f[16] = res && res->broke ? 1 : 0;
  int bw = 0;
  for (int i = 0; i < nNow + nNext; i++) if (base[i * REC + F_BREAKS] == 1) bw++;
  f[17] = share(bw, 56);
  double left = BIN[IN_STOP];
  double e2 = 0;
  if (res && res->total > 0) e2 = stopTimeOf(isChain, isChain ? 0 : res->total, isChain ? res->chain : 0, topped);
  double whenItLands = dmax(0, left - moveFrames);
  f[18] = share(dmax(0, e2 - whenItLands), 100);
  double budget = left, room = (BH - tallest) * fpr;
  if (room > budget) budget = room;
  double reachable = 0;
  for (int i = 0; i < nNow + nNext; i++) {
    double *o = base + i * REC;
    int oc = o[F_KIND] == 1;
    double pays = stopTimeOf(oc, oc ? 0 : (int)o[F_SIZE], oc ? (int)o[F_CHAIN] : 0, topped);
    if (pays > reachable && o[F_FRAMES] <= budget) reachable = pays;
  }
  f[19] = share(reachable, 100);
  double total = 0;
  for (int k = 0; k < 20; k++) {
    double wk = TB[T_W + k];
    if (FLOORW[k] < 1e299) wk = dmin(wk, FLOORW[k]);
    if (!wk) continue;
    total += wk * f[k];
  }
  return total;
}

static ST RZ;
static int risenMasks(const int32_t *st, int32_t *out) {
  if (st[O_BAD] || !BIN[IN_HASINROW]) return 0;
  int W2 = st[O_W];
  uint32_t lim = (1u << st[O_H]) - 1u;
  for (int c = 1; c <= W2; c++) { double v = BIN[IN_INROW + c]; if (!(v > 0) || v > 12) return 0; }
  for (int i = 0; i < SLAB; i++) out[i] = 0;
  out[O_W] = st[O_W]; out[O_H] = st[O_H]; out[O_N] = st[O_N];
  for (int c = 1; c <= W2; c++) {
    out[OCC + c] = ((U(st, OCC + c) << 1) | 1u) & lim;
    out[INERT + c] = (U(st, INERT + c) << 1) & lim;
    out[GARB + c] = (U(st, GARB + c) << 1) & lim;
    int v = (int)BIN[IN_INROW + c];
    if (v > out[O_N]) out[O_N] = v;
    for (int k = 1; k <= 12; k++) out[COL + k * WMAX + c] = (k <= st[O_N] ? (U(st, COL + k * WMAX + c) << 1) : 0) & lim;
    out[COL + v * WMAX + c] |= 1;
  }
  out[O_NSLAB] = st[O_NSLAB];
  for (int i = 0; i < st[O_NSLAB]; i++) {
    for (int c = 0; c < WMAX; c++) out[SM(i, c)] = 0;
    for (int c = 1; c <= W2; c++) out[SM(i, c)] = (U(st, SM(i, c)) << 1) & lim;
    out[SLK(i)] = st[SLK(i)]; out[SAIR(i)] = 0;
  }
  return 1;
}

static int slabReadyHook(const int32_t *st) {
  if (TFLAG(TF_SLAB)) return BIN[IN_T + 6] != 0;
  SLABW = (int)BIN[IN_SLABW]; SLABH = (int)BIN[IN_SLABH]; SLABC = (int)BIN[IN_SLABC];
  return slabReady(st);
}
static double idleScore(const Cand *cand, const int32_t *base) {
  const int32_t *m = cand->masks;
  double fpr = BIN[IN_FPR], perPanel = fpr / BW;
  Shape was, now;
  shapeOf(base, &was); shapeOf(m, &now);
  double s = (was.high - now.high) * fpr;
  if (slabReadyHook(m)) s += fpr;
  if (risenMasks(m, RZ) && slabReadyHook(RZ)) s += fpr;
  s += matchWays(m) * perPanel;
  s -= bumpinessOf(m) * perPanel;
  s -= dmax(0, WORKING_ROWS - now.mat) * fpr;
  double left = framesToDeath(tallestBoard(m), fpr);
  double affordable = __builtin_floor(left / (REACT > 1 ? REACT : 1));
  double gapNow = now.slabRowGap;
  if (gapNow <= affordable) s -= gapNow * perPanel;
  return s - cand->moveFrames;
}

static ST WS;
static int withSlab(const int32_t *masks, int32_t *out) {
  int t = tallestBoard(masks);
  if (t >= BH) return 0;
  if (masks[O_NSLAB] >= MAXSLAB) { botFailed = 1; return 0; }
  stcpy(out, masks);
  uint32_t b = 1u << t;
  int n = out[O_NSLAB];
  for (int c = 0; c < WMAX; c++) out[SM(n, c)] = 0;
  for (int c = 1; c <= BW; c++) { out[OCC + c] |= b; out[INERT + c] |= b; out[GARB + c] |= b; out[SM(n, c)] = b; }
  out[SLK(n)] = 0; out[SAIR(n)] = 0;
  out[O_NSLAB] = n + 1;
  return 1;
}
static Res SAR;
static ST SA0;
static void slabToAnswer(const int32_t *masks, int32_t *out) {
  const int32_t *m = masks;
  if (BIN[IN_INFLIGHT]) {
    resolve(masks, SAR.r, 1);
    if (SAR.r[R_SCOPE] == SC_OK) m = SAR.st;
  }
  if (hasGarbage(m)) { stcpy(out, m); return; }
  if (withSlab(m, out)) return;
  stcpy(out, m);
}
typedef struct { int sr, sc; double spent; int idx; } Setup;
static ST SAM;
static ST SETUPST[128];
static Setup SETUPS[128];
static int32_t SASW[2 * 128], SASW2[2 * 128], SAR2[R_INTS + ST_INTS];
static int saveAfter(const int32_t *masks0, int row, int col, int deep) {
  nSave++;
  double deadline = framesToDeath(tallestBoard(masks0), BIN[IN_FPR]);
  int frozen = BIN[IN_STOP] > 0 || BIN[IN_TOPPED];
  int step = MOVE_FRAMES + (frozen ? 0 : REACT);
  slabToAnswer(masks0, SAM);
  Grid G;
  int n = legalG(SAM, SASW, &G), best = 0, ns = 0, rest = settledRest(SAM);
  for (int i = 0; i < n; i++) {
    int sr = SASW[2 * i], sc = SASW[2 * i + 1];
    double walk = travelCost(row, col, sr, sc) + step;
    if (walk > deadline) continue;
    if (quietSwapG(SAM, &G, rest, sr, sc)) {
      if (deep && !best) {
        swapIn(SAM, sr, sc);
        stcpy(SETUPST[ns], SAM);
        swapIn(SAM, sr, sc);
        SETUPS[ns].sr = sr; SETUPS[ns].sc = sc; SETUPS[ns].spent = walk; SETUPS[ns].idx = ns;
        ns++;
      }
      continue;
    }
    if (!swapIn(SAM, sr, sc)) continue;
    int want = deep && !best;
    resolve(SAM, SAR.r, want);
    swapIn(SAM, sr, sc);
    if (SAR.r[R_SCOPE] == SC_BROKE) return 2;
    if (SAR.r[R_TOTAL] > 0) { best = 1; continue; }
    if (want && SAR.r[R_SCOPE] == SC_OK) {
      stcpy(SETUPST[ns], SAR.st);
      SETUPS[ns].sr = sr; SETUPS[ns].sc = sc; SETUPS[ns].spent = walk; SETUPS[ns].idx = ns;
      ns++;
    }
  }
  if (best) return best;
  if (!deep) return best;
  for (int i = 1; i < ns; i++) {
    Setup x = SETUPS[i]; int j = i - 1;
    while (j >= 0 && SETUPS[j].spent > x.spent) { SETUPS[j + 1] = SETUPS[j]; j--; }
    SETUPS[j + 1] = x;
  }
  for (int i = 0; i < ns && i < 6; i++) {
    int32_t *st2 = SETUPST[SETUPS[i].idx];
    double left = deadline - SETUPS[i].spent;
    if (left <= 0) continue;
    Grid G2;
    int n2 = legalG(st2, SASW2, &G2), rest2 = settledRest(st2);
    for (int j = 0; j < n2; j++) {
      int sr = SASW2[2 * j], sc = SASW2[2 * j + 1];
      if (travelCost(SETUPS[i].sr, SETUPS[i].sc, sr, sc) + step > left) continue;
      if (quietSwapG(st2, &G2, rest2, sr, sc)) continue;
      if (!swapIn(st2, sr, sc)) continue;
      resolve(st2, SAR2, 0);
      swapIn(st2, sr, sc);
      if (SAR2[R_SCOPE] == SC_BROKE) return 2;
      if (SAR2[R_TOTAL] > 0) best = 1;
    }
    if (best) return best;
  }
  return best;
}
static int hasFireable(const int32_t *masks, int r, int c) {
  if (anyOneSwapClear(masks)) return 1;
  return saveAfter(masks, r, c, 1) >= 1;
}

#define PMEMO 4096
typedef struct { u64 key; int kind; double val, t, lock, spend; int st; } PM;
static PM PMT[PMEMO];
static int pmN;
static ST PMST[1024];
static int pmStN;
static const int32_t *PBASE;
static Res PR;
static double planSpend(const int32_t *swaps, int n, const int32_t *base) {
  const int32_t *st = base;
  int ar = (int)BIN[IN_CROW], ac = (int)BIN[IN_CCOL];
  double t = 0, lock = lockNow(), spend = 0;
  u64 key = 1469598103934665603ull;
  for (int i = 0; i < n; i++) {
    int sr = swaps[2 * i], sc = swaps[2 * i + 1];
    key = (key ^ (uint32_t)(sr * 64 + sc + 1)) * 1099511628211ull;
    uint32_t slot = (uint32_t)(key ^ (key >> 32)) & (PMEMO - 1);
    PM *hit = 0;
    for (int q = 0; q < PMEMO; q++) {
      PM *p = &PMT[(slot + q) & (PMEMO - 1)];
      if (!p->key) break;
      if (p->key == key) { hit = p; break; }
    }
    PM tmp;
    if (!hit) {
      double t2 = t + travelCost(ar, ac, sr, sc) + (i ? 1 : 0);
      double paid = spend + dmax(0, t2 - lock), from = dmax(lock, t2);
      tmp.key = key; tmp.st = -1;
      if (!settleSwap(st, sr, sc, &PR)) { tmp.kind = 0; tmp.val = INF; }
      else {
        if (PR.r[R_SCOPE] == SC_BROKE) { tmp.kind = 0; tmp.val = paid; }
        else if (PR.r[R_SCOPE] != SC_OK) { tmp.kind = 0; tmp.val = INF; }
        else {
          tmp.kind = 1; tmp.t = t2; tmp.spend = paid;
          double l2 = t2 + 4, l3 = PR.r[R_TOTAL] > 0 ? t2 + 5 + resolveFramesOf(PR.r[R_TOTAL], 0) : 0;
          tmp.lock = dmax(dmax(from, l2), l3);
          if (pmStN < 1024) { stcpy(PMST[pmStN], PR.st); tmp.st = pmStN++; }
        }
      }
      hit = &tmp;
      if (pmN < PMEMO / 2 && (tmp.kind == 0 || tmp.st >= 0)) {
        for (int q = 0; q < PMEMO; q++) {
          PM *p = &PMT[(slot + q) & (PMEMO - 1)];
          if (!p->key) { *p = tmp; pmN++; break; }
        }
      }
    }
    if (hit->kind == 0) return hit->val;
    st = hit->st >= 0 ? PMST[hit->st] : PR.st;
    if (hit->st < 0) { stcpy(SA0, PR.st); st = SA0; }
    t = hit->t; lock = hit->lock; spend = hit->spend;
    ar = sr; ac = sc;
  }
  return spend;
}
static void planReset(const int32_t *base) {
  for (int i = 0; i < PMEMO; i++) PMT[i].key = 0;
  pmN = 0; pmStN = 0; PBASE = base;
}
static int planInTime(const int32_t *swaps, int n, double duration, const int32_t *base, double deadline) {
  return BIN[IN_TOPPED] ? planSpend(swaps, n, base) == 0 : duration <= deadline;
}

static double *PILE[MAXOPT], *PILE2[MAXOPT];
static int nPile, nPile2;
static double *TMPR[MAXOPT];
static int priceCmp(const double *x, const double *y) {
  if (x[F_FRAMES] != y[F_FRAMES]) return x[F_FRAMES] < y[F_FRAMES] ? -1 : 1;
  return x[F_SIZE] > y[F_SIZE] ? -1 : x[F_SIZE] < y[F_SIZE] ? 1 : 0;
}
static void sortRecs(double **a, int n) {
  for (int w = 1; w < n; w *= 2) {
    for (int lo = 0; lo < n; lo += 2 * w) {
      int mid = lo + w < n ? lo + w : n, hi = lo + 2 * w < n ? lo + 2 * w : n, i = lo, j = mid, k = lo;
      while (i < mid && j < hi) TMPR[k++] = priceCmp(a[i], a[j]) <= 0 ? a[i++] : a[j++];
      while (i < mid) TMPR[k++] = a[i++];
      while (j < hi) TMPR[k++] = a[j++];
    }
    for (int i = 0; i < n; i++) a[i] = TMPR[i];
  }
}
static int pileOf(double *od, double **out) {
  int nNow = (int)od[1], nNext = (int)od[2];
  double *base = od + 64 + 4 * REC;
  for (int i = 0; i < nNow; i++) out[i] = base + i * REC;
  for (int i = 0; i < nNext; i++) out[nNow + i] = base + (nNow + i) * REC;
  sortRecs(out, nNow);
  sortRecs(out + nNow, nNext);
  return nNow + nNext;
}
static double *recIn(double *od, int i) { return od + 64 + i * REC; }
static int haveRecIn(double *od, int i) { return od[7 + i] != 0; }

static double OPTP[128];
static int optsBuilt;
static void buildOptions(const int32_t *base, double deadline, int lookDepth, int digging, double spend) {
  int topped = BIN[IN_TOPPED] != 0;
  timingParams(OPTP, BIN[IN_FPR], deadline, BIN[IN_STOP], topped);
  OPTP[18] = BT->nRecent;
  for (int i = 0; i < BT->nRecent; i++) { OPTP[19 + 2 * i] = BT->recent[2 * i]; OPTP[20 + 2 * i] = BT->recent[2 * i + 1]; }
  if (topped) OPTP[2] = lockNow();
  OPTP[3] = spend; OPTP[10] = digging; OPTP[11] = lookDepth; OPTP[101] = 1;
  OPTP[102] = BIN[IN_SLABW]; OPTP[103] = BIN[IN_SLABH]; OPTP[104] = BIN[IN_SLABC];
  OPTP[105] = HELDR; OPTP[106] = HELDC; OPTP[107] = HELDDIR;
}
static void mainOptions(const int32_t *base, double deadline, int lookDepth, int digging) {
  if (optsBuilt) return;
  buildOptions(base, deadline, lookDepth, digging, 0);
  OD = ODATA; LD = LANDS;
  int r0 = nRes;
  if (optionsRun(base, OPTP, 0, 0)) botFailed = 1;
  rMain += nRes - r0;
  nPile = pileOf(ODATA, PILE);
  optsBuilt = 1;
  if (TFLAG(TF_STUB)) {
    nPile = 0;
    for (int i = 0; i < 4; i++) ODATA[7 + i] = 0;
    ODATA[7] = 1;
    double *fl = recIn(ODATA, 0);
    fl[F_NSW] = 1; fl[F_SW] = BIN[IN_T + 4]; fl[F_SW + 1] = BIN[IN_T + 5]; fl[F_DURATION] = 4; fl[F_FRAMES] = 0; fl[F_VALUE] = 1;
  }
}

static int ruinsShape(const double *o) { return o[F_OPENSHOLE] == 1 || o[F_CLOSESBREAK] == 1; }
static int has(double v) { return v == v; }
static double shortfallOf(const double *o) { return !has(o[F_MAT]) ? 0 : dmax(0, WORKING_ROWS - o[F_MAT]); }
static double durOf(const double *o) { return o[F_DURATION] ? o[F_DURATION] : o[F_FRAMES]; }
static void keepFilter(double **all, int n, double **out, int *nout) {
  int nl = 0;
  for (int i = 0; i < n; i++) if (all[i][F_LEVELS] == 1) nl++;
  double *tmp[1];
  (void)tmp;
  int k = 0;
  if (nl) { for (int i = 0; i < n; i++) if (all[i][F_LEVELS] == 1) out[k++] = all[i]; }
  else { for (int i = 0; i < n; i++) out[k++] = all[i]; }
  int nk = 0;
  for (int i = 0; i < k; i++) {
    double *o = out[i];
    if (has(o[F_TALL]) && o[F_TALL] >= BH - WORKING_ROWS && o[F_BREAKREADY] == 0) continue;
    nk++;
  }
  if (nk) {
    int j = 0;
    for (int i = 0; i < k; i++) {
      double *o = out[i];
      if (has(o[F_TALL]) && o[F_TALL] >= BH - WORKING_ROWS && o[F_BREAKREADY] == 0) continue;
      out[j++] = o;
    }
    k = j;
  }
  *nout = k;
}
static double *FILT[MAXOPT];
typedef struct { double rate, cells, gain, frames; double *option; } Pick;
static int bestAttack(double deadline, double ppf, Pick *best) {
  int n, have = 0;
  keepFilter(PILE, nPile, FILT, &n);
  for (int i = 0; i < n; i++) {
    double *o = FILT[i];
    if (!o[F_NSW]) continue;
    if (durOf(o) > deadline) continue;
    if (ruinsShape(o)) continue;
    int isChain = o[F_KIND] == 1;
    double cells = cellsSent(isChain, (int)o[F_SIZE], (int)o[F_CHAIN]);
    if (o[F_BREAKS] == 1 && ppf > 0) cells += heldFrames(0, o[F_TOTAL], o[F_GARBAGE] ? o[F_GARBAGE] : BW) / ppf;
    double sh = shortfallOf(o);
    cells -= sh * BW;
    cells += o[F_VOIDGAIN] * BW;
    if (ppf > 0) cells += o[F_SLABGAIN] / ppf;
    if (ppf > 0) cells += o[F_CONVERTS] * dmax(ppf, deadline / BW) / ppf;
    if (ppf > 0) cells += o[F_SLABWORTH] / ppf;
    if (has(o[F_MATNOW]) && o[F_MATNOW] < WORKING_ROWS) cells += dmax(0, o[F_DIGGAIN]);
    if (cells <= 0) continue;
    int key = isChain ? (o[F_CHAIN] >= 5 ? 6 : 3 + (int)dmax(2, dmin(4, o[F_CHAIN])) - 2) : 7 + (int)dmax(4, dmin(7, o[F_SIZE])) - 4;
    double taste = 1 + TB[T_W + key] / 100;
    if (taste < 0.1) taste = 0.1;
    double rate = (cells / dmax(1, durOf(o))) * taste;
    int win = !have || rate > best->rate;
    if (!win && have && rate == best->rate) {
      double ob = has(o[F_BUMPS]) ? o[F_BUMPS] : 1e9, bb = has(best->option[F_BUMPS]) ? best->option[F_BUMPS] : 1e9;
      win = ob < bb;
    }
    if (win) { have = 1; best->rate = rate; best->cells = cells; best->frames = o[F_FRAMES]; best->option = o; }
  }
  return have;
}
static int bestPlan(double clock, double deadline, int toppedOut, double fpr, int tallNow, const int32_t *base, Pick *bestOut) {
  int n, haveB = 0, haveO = 0;
  Pick best, over;
  keepFilter(PILE, nPile, FILT, &n);
  double perPanel = fpr / BW;
  for (int i = 0; i < n; i++) {
    double *o = FILT[i];
    if (!o[F_NSW]) continue;
    double took = durOf(o);
    int isChain = o[F_KIND] == 1;
    double pays = stopTimeOf(isChain, isChain ? 0 : (int)o[F_SIZE], isChain ? (int)o[F_CHAIN] : 0, toppedOut);
    double stopGain = dmax(0, pays - dmax(0, clock - took));
    double gain = heldFrames(stopGain, o[F_TOTAL], o[F_GARBAGE] ? o[F_GARBAGE] : (o[F_BREAKS] == 1 ? BW : 0));
    double perCell = dmax(perPanel, deadline / BW);
    double lowered = (tallNow && has(o[F_TALL])) ? dmax(0, tallNow - o[F_TALL]) : 0;
    if (has(o[F_MAT]) && o[F_MAT] < WORKING_ROWS && o[F_BREAKS] != 1 && o[F_TOTAL] > 0) continue;
    if (ruinsShape(o)) continue;
    int nsw = (int)o[F_NSW];
    int32_t sw[2 * MAXD];
    for (int j = 0; j < 2 * nsw; j++) sw[j] = (int32_t)o[F_SW + j];
    int fits = planInTime(sw, nsw, durOf(o), base, deadline);
    double shortfall = shortfallOf(o);
    double holds = (o[F_TOTAL] > 0 || o[F_GARBAGE] > 0) ? resolveFramesOf((int)o[F_TOTAL], (int)o[F_GARBAGE]) : 0;
    double digs = (has(o[F_MATNOW]) && o[F_MATNOW] < WORKING_ROWS) ? dmax(0, o[F_DIGGAIN]) * perPanel : 0;
    double bought = o[F_TOTAL] * perPanel + holds + o[F_CONVERTS] * perCell
                  + lowered * fpr + gain
                  - shortfall * fpr
                  + o[F_VOIDGAIN] * fpr
                  + o[F_SLABGAIN]
                  + digs
                  + o[F_SLABWORTH];
    double rate = bought / dmax(1, took);
    Pick *cur = fits ? &best : &over;
    int haveCur = fits ? haveB : haveO;
    int better = !haveCur || rate > cur->rate;
    if (!better && haveCur && rate == cur->rate) {
      double mb = has(o[F_BUMPS]) ? o[F_BUMPS] : 1e9, cb = has(cur->option[F_BUMPS]) ? cur->option[F_BUMPS] : 1e9;
      better = mb < cb || (mb == cb && took < cur->frames);
    }
    if (better) {
      cur->rate = rate; cur->gain = gain; cur->frames = took; cur->option = o;
      if (fits) haveB = 1; else haveO = 1;
    }
  }
  if (haveB) { *bestOut = best; return 1; }
  if (haveO) { *bestOut = over; return 1; }
  return 0;
}

static void sigOf(const int32_t *st, Sig *s) {
  memset(s, 0, sizeof(Sig));
  s->N = st[O_N];
  for (int c = 1; c <= BW; c++) { s->occ[c] = U(st, OCC + c); s->garb[c] = U(st, GARB + c); }
  for (int a = 1; a <= s->N && a < NCOL; a++) for (int c = 1; c <= BW; c++) s->col[a][c] = CL(st, a, c);
}
static int sigEq(const Sig *a, const Sig *b) {
  if (a->N != b->N) return 0;
  for (int c = 1; c <= BW; c++) if (a->occ[c] != b->occ[c] || a->garb[c] != b->garb[c]) return 0;
  for (int k = 1; k <= a->N && k < NCOL; k++) for (int c = 1; c <= BW; c++) if (a->col[k][c] != b->col[k][c]) return 0;
  return 1;
}

#define MAXCAND 96
static Cand POOL[MAXCAND];
static ST POOLST[MAXCAND];
static int nPool;
static Res CR, CR2;
static ST TMC;
static void candidates(int32_t *base) {
  nPool = 0;
  Cand *h = &POOL[nPool++];
  memset(h, 0, sizeof(Cand));
  h->kind = K_HOLD; h->masks = base;
  if (BIN[IN_HASRISEN]) {
    resolve(RISEN, CR.r, 1);
    const int32_t *rm = CR.r[R_SCOPE] == SC_OK ? CR.st : RISEN;
    int inRows = (int)__builtin_ceil(BIN[IN_INCOMING] / BW);
    if (tallestBoard(rm) + inRows + 1 < BH) {
      Cand *rc = &POOL[nPool];
      memset(rc, 0, sizeof(Cand));
      stcpy(POOLST[nPool], rm);
      rc->kind = K_RAISE; rc->masks = POOLST[nPool]; rc->res = summarise(CR.r);
      nPool++;
    }
  }
  int moving = BIN[IN_MOVING] != 0 && BIN[IN_HASTIMED] != 0;
  if (moving) { TM.hasSwap = 0; resolveT(TMST, CR.r, 0, &TM); }
  else resolve(base, CR.r, 0);
  h->res = summarise(CR.r);
  int32_t lg[2 * 128];
  int n = legal(base, lg);
  int cr = (int)BIN[IN_CROW], cc = (int)BIN[IN_CCOL];
  for (int i = 0; i < n; i++) {
    int r = lg[2 * i], c = lg[2 * i + 1];
    if (!swapIn(base, r, c)) continue;
    resolve(base, CR.r, 1);
    int haveSettled = CR.r[R_SCOPE] == SC_OK;
    Rs res = summarise(CR.r);
    if (moving) {
      TM.hasSwap = 1; TM.sr = r; TM.sc = c; TM.at = travelCost(cr, cc, r, c);
      resolveT(TMST, CR2.r, 0, &TM);
      TM.hasSwap = 0;
      if (CR2.r[R_SCOPE] == SC_REFUSED) { swapIn(base, r, c); continue; }
      int same = CR.r[R_SCOPE] == CR2.r[R_SCOPE];
      res.scope = CR2.r[R_SCOPE]; res.chain = CR2.r[R_CHAIN]; res.total = CR2.r[R_TOTAL]; res.rounds = CR2.r[R_ROUNDS];
      res.biggest = res.rounds == 1 ? res.total : 0; res.broke = res.scope == SC_BROKE; res.converts = 0; res.voidAfter = 0;
      haveSettled = haveSettled && same;
    }
    if (nPool >= MAXCAND) { botFailed = 1; swapIn(base, r, c); continue; }
    if (haveSettled) stcpy(POOLST[nPool], CR.st); else stcpy(POOLST[nPool], base);
    swapIn(base, r, c);
    if (!(res.total > 0 || res.broke)) {
      int skip = 0;
      for (int z = 0; z < BT->nRecent; z++) {
        if (BT->recent[2 * z] != r || BT->recent[2 * z + 1] != c) continue;
        uint32_t ub = 1u << (r - 1);
        if ((U(base, OCC + c) & ub) && (U(base, OCC + c + 1) & ub)) { skip = 1; break; }
      }
      if (skip) continue;
    }
    Cand *k = &POOL[nPool];
    k->kind = K_SWAP; k->sr = r; k->sc = c; k->masks = POOLST[nPool]; k->future = 0;
    k->moveFrames = travelCost(cr, cc, r, c); k->res = res;
    nPool++;
  }
}

typedef struct { int have, swap, sr, sc, broke, chain, total; double cost, score; } Line;
static ST LS1, LS2;
static Res LR1, LR2;
static int lineScore(int chain, int total) { return chain * 1000 + total; }
static int breakScore(int chain, int total, int spendLeast) { return spendLeast ? -total * 1000 + chain : lineScore(chain, total); }
static int outcomeConv(const int32_t *st, int has, int sr, int sc, int *scope, int *chain, int *total) {
  stcpy(LS1, st);
  if (has && !swapIn(LS1, sr, sc)) return 0;
  resolve(LS1, LR1.r, 1);
  if (LR1.r[R_SCOPE] == SC_BROKE) { *scope = SC_BROKE; *chain = LR1.r[R_CHAIN]; *total = LR1.r[R_TOTAL]; return 1; }
  if (LR1.r[R_SCOPE] != SC_OK) return 0;
  int32_t *out = LS2;
  stcpy(out, LR1.st);
  int nconv = (int)BIN[IN_CONVN], N = out[O_N];
  for (int i = 0; i < nconv; i++) if ((int)BIN[IN_CONV + 3 * i + 2] > N) N = (int)BIN[IN_CONV + 3 * i + 2];
  out[O_N] = N;
  for (int i = 0; i < nconv; i++) {
    int r = (int)BIN[IN_CONV + 3 * i], c = (int)BIN[IN_CONV + 3 * i + 1], col = (int)BIN[IN_CONV + 3 * i + 2];
    uint32_t b = 1u << (r - 1);
    out[INERT + c] &= ~b; out[GARB + c] &= ~b;
    out[COL + col * WMAX + c] |= b;
    for (int k = 0; k < out[O_NSLAB]; k++) if (out[SM(k, c)] & b) { out[SM(k, c)] &= ~b; out[SLK(k)] = 0; }
  }
  int j = 0;
  for (int k = 0; k < out[O_NSLAB]; k++) {
    int any = 0;
    for (int c = 1; c <= BW; c++) if (out[SM(k, c)]) { any = 1; break; }
    if (!any) continue;
    if (j != k) { for (int c = 0; c < SL; c++) out[SLAB + j * SL + c] = out[SLAB + k * SL + c]; }
    j++;
  }
  for (int k = j; k < out[O_NSLAB]; k++) for (int c = 0; c < SL; c++) out[SLAB + k * SL + c] = 0;
  out[O_NSLAB] = j;
  resolve(out, LR2.r, 0);
  *scope = LR2.r[R_SCOPE]; *chain = LR2.r[R_CHAIN]; *total = LR1.r[R_TOTAL] + LR2.r[R_TOTAL];
  return 1;
}
static int playTimed(int has, int sr, int sc, int at, int *scope, int *chain, int *total) {
  if (!BIN[IN_HASTIMED]) return 0;
  TM.hasSwap = has; TM.sr = sr; TM.sc = sc; TM.at = at;
  resolveT(TMST, LR1.r, 0, &TM);
  TM.hasSwap = 0;
  if (LR1.r[R_SCOPE] == SC_REFUSED) return 0;
  *scope = LR1.r[R_SCOPE]; *chain = LR1.r[R_CHAIN]; *total = LR1.r[R_TOTAL];
  return 1;
}
static int revealPick(const int32_t *base, Line *best) {
  if (!opt(O_REVEAL)) return 0;
  int spendLeast = BIN[IN_STACKTOPPED] != 0;
  int cr = (int)BIN[IN_BCROW], cc = (int)BIN[IN_BCCOL], nl = (int)BIN[IN_NLEGAL];
  Line bb = { 0 };
  int haveBroke = 0;
  int sc, ch, tot;
  if (BIN[IN_CONVN] > 0) {
    if (base[O_BAD]) return 0;
    double timer = BIN[IN_CONVTIMER], *f = BIN + IN_SF;
    int dn = outcomeConv(base, 0, 0, 0, &sc, &ch, &tot);
    int dnRounds = LR1.r[R_ROUNDS], dnTotal = LR1.r[R_TOTAL];
    (void)dnRounds; (void)dnTotal;
    best->have = 1; best->swap = 0; best->cost = 0;
    best->chain = dn && sc == SC_OK ? ch : 0; best->total = dn && sc == SC_OK ? tot : 0;
    best->score = lineScore(best->chain, best->total); best->broke = 0;
    if (dn && sc == SC_BROKE) { haveBroke = 1; bb.swap = 0; bb.cost = 0; bb.chain = ch; bb.total = tot; bb.score = breakScore(ch, tot, spendLeast); bb.broke = 1; }
    for (int i = 0; i < nl; i++) {
      int sr = (int)BIN[IN_LEGAL + 2 * i], sc2 = (int)BIN[IN_LEGAL + 2 * i + 1];
      double cost = travelCost(cr, cc, sr, sc2);
      if (cost > timer) continue;
      if (!outcomeConv(base, 1, sr, sc2, &sc, &ch, &tot)) continue;
      int ownRounds = LR1.r[R_ROUNDS], ownTotal = LR1.r[R_TOTAL];
      double busyFor = ownRounds ? ownRounds * (f[1] + f[2] + f[0]) + f[3] * ownTotal : 0;
      if (cost + busyFor > timer) continue;
      if (sc == SC_BROKE) {
        double bs = breakScore(ch, tot, spendLeast);
        if (!haveBroke || bs > bb.score) { haveBroke = 1; bb.swap = 1; bb.sr = sr; bb.sc = sc2; bb.cost = cost; bb.chain = ch; bb.total = tot; bb.score = bs; bb.broke = 1; }
        continue;
      }
      if (sc != SC_OK) continue;
      double s2 = lineScore(ch, tot);
      if (s2 > best->score) { best->swap = 1; best->sr = sr; best->sc = sc2; best->cost = cost; best->chain = ch; best->total = tot; best->score = s2; best->broke = 0; }
    }
  } else {
    if (!BIN[IN_REVEALOPEN]) return 0;
    int window = 0;
    if (BIN[IN_HASTIMED]) { TM.hasSwap = 0; resolveT(TMST, LR1.r, 0, &TM); window = LR1.r[R_FRAMES]; }
    int dn = playTimed(0, 0, 0, 0, &sc, &ch, &tot);
    int known = dn && sc == SC_OK;
    best->have = 1; best->swap = 0; best->cost = 0; best->chain = known ? ch : 0; best->total = known ? tot : 0;
    best->score = lineScore(best->chain, best->total); best->broke = 0;
    if (dn && sc == SC_BROKE) { haveBroke = 1; bb.swap = 0; bb.cost = 0; bb.chain = ch; bb.total = tot; bb.score = breakScore(ch, tot, spendLeast); bb.broke = 1; }
    for (int i = 0; i < nl; i++) {
      int sr = (int)BIN[IN_LEGAL + 2 * i], sc2 = (int)BIN[IN_LEGAL + 2 * i + 1];
      int cost = travelCost(cr, cc, sr, sc2);
      if (cost > window) continue;
      if (!playTimed(1, sr, sc2, cost, &sc, &ch, &tot)) continue;
      if (sc == SC_BROKE) {
        double bs = breakScore(ch, tot, spendLeast);
        if (!haveBroke || bs > bb.score) { haveBroke = 1; bb.swap = 1; bb.sr = sr; bb.sc = sc2; bb.cost = cost; bb.chain = ch; bb.total = tot; bb.score = bs; bb.broke = 1; }
        continue;
      }
      if (sc != SC_OK) continue;
      double s2 = lineScore(ch, tot);
      if (s2 <= best->score) continue;
      best->swap = 1; best->sr = sr; best->sc = sc2; best->cost = cost; best->chain = ch; best->total = tot; best->score = s2; best->broke = 0;
    }
  }
  if (haveBroke) { *best = bb; best->have = 1; }
  BT->counts[C_REVEALWINDOWS]++;
  if (BIN[IN_STACKTOPPED]) return best->broke;
  return best->swap;
}

typedef struct { int kind, sr, sc, hasMove, pr, pc, hasPark, via, spends, reveal, mode, alive; } Dec;
static Dec mk(int kind, int via, int mode, int alive) { Dec d; memset(&d, 0, sizeof d); d.kind = kind; d.via = via; d.mode = mode; d.alive = alive; return d; }
static Dec mkSwap(int sr, int sc, int via, int mode, int alive) { Dec d = mk(K_SWAP, via, mode, alive); d.sr = sr; d.sc = sc; d.hasMove = 1; return d; }
static Dec mkHold(int via, int mode, int alive, int hasPark, int pr, int pc) { Dec d = mk(K_HOLD, via, mode, alive); d.hasPark = hasPark; d.pr = pr; d.pc = pc; return d; }

static int raiseMode(const int32_t *base, int poolBreak) {
  if (TFLAG(TF_RAISE)) return (int)BIN[IN_T + 3];
  int topped = BIN[IN_TOPPED] != 0;
  if (!opt(O_ALLOWRAISE) || topped) { BT->opening = 0; return 0; }
  if (BIN[IN_FALLING]) return 0;
  int rows = (int)__builtin_ceil(BIN[IN_NEXTSLAB] / BW);
  int reserve = rows > BT->maxSlab ? rows : BT->maxSlab;
  int fits = BIN[IN_RAISEROOM] > 1 + reserve;
  BT->wantRows = rows;
  if (BT->opening && (BIN[IN_INCOMING] || !fits)) BT->opening = 0;
  if (!fits) return 0;
  if (!BT->opening && materialRows(base) >= 6) return 0;
  int stillComing = BIN[IN_INCOMING] > 0 || BIN[IN_FALLING];
  if (poolBreak && !stillComing) return 0;
  return BT->opening ? 1 : 2;
}
static int modeOf(int haveEscape, double escape, double deadline) {
  if (BIN[IN_TOPPED]) return M_DEFEND;
  if (haveEscape && deadline <= escape + REACT) return M_DEFEND;
  for (int i = 0; i < nPool; i++) {
    Rs *r = &POOL[i].res;
    if (!r->total) continue;
    if (cellsSent(r->chain >= 2, r->total, r->chain) > 0) return M_ATTACK;
  }
  return M_BUILD;
}
static Sig HERE;
static int hereSet;
static int32_t *DBASE;
static double DDEADLINE;
static int lastSurvivalNeeded, lastBreakOnPool, clearRaiseFrames;

static int slabOnScreen(void) { return hasGarbage(DBASE); }
static int spendsReserve(const Rs *r, const int32_t *after) {
  if (!r || !(r->total > 0) || r->broke) return 0;
  if (BIN[IN_TOPPED] && slabOnScreen()) return 1;
  Shape sh; shapeOf(after, &sh);
  return sh.mat < WORKING_ROWS;
}
static Cand *poolSwap(int r, int c) {
  for (int q = 0; q < nPool; q++) if (POOL[q].kind == K_SWAP && POOL[q].sr == r && POOL[q].sc == c) return &POOL[q];
  return 0;
}
static int returnsToSeen(int r, int c) {
  if (!opt(O_REFRETURN)) return 0;
  Cand *pc = poolSwap(r, c);
  if (!pc) return 0;
  Sig s; sigOf(pc->masks, &s);
  if (hereSet && sigEq(&s, &HERE)) return 1;
  for (int i = 0; i < BT->nSeen; i++) if (sigEq(&s, &BT->seen[i])) return 1;
  return 0;
}
static double horizonOf(const Cand *c) { return dmax(c->moveFrames + REACT, BIN[IN_FPR]); }
// WHERE THE NEXT SLAB LANDS, as a number to raise. It rests on the tallest of
// its columns and touches only the cells under it at that height and the
// cells beside it, so a break for it can only use those. More of them, then a
// lower resting row, is a landing a break is easier to build under.
static int landingOf(const int32_t *st) {
  int w = (int)BIN[IN_SLABW], c0 = (int)BIN[IN_SLABC], c1 = c0 + w - 1, W = st[O_W], bottom = 0, touch = 0;
  if (!w || !c0 || c1 > W) return 0;
  for (int c = c0; c <= c1; c++) { int t = topRow(U(st, OCC + c)); if (t > bottom) bottom = t; }
  for (int c = c0; c <= c1; c++) if (bottom && topRow(U(st, OCC + c)) == bottom) touch++;
  if (c0 > 1 && topRow(U(st, OCC + c0 - 1)) > bottom) touch++;
  if (c1 < W && topRow(U(st, OCC + c1 + 1)) > bottom) touch++;
  return touch * 32 - bottom;
}
// A BREAK IN HAND IS KEPT. While slabs are queued and the next one would
// land on a break, a swap that is not itself the break must leave one; and no
// swap but a break may make the next slab's landing worse.
static int baseReady;
static int baseLanding;
static int unreadies(const Cand *pc) {
  if (!pc || pc->kind != K_SWAP || pc->res.broke) return 0;
  if (BIN[IN_INCOMING] > 0 && landingOf(pc->masks) < baseLanding) return 1;
  if (!baseReady) return 0;
  return !slabReadyHook(pc->masks);
}
static int playable(int r, int c) {
  Cand *pc = poolSwap(r, c);
  if (!pc) return 0;
  if (unreadies(pc)) return 0;
  if (returnsToSeen(r, c)) return 0;
  if (spendsReserve(&pc->res, pc->masks)) return 0;
  return !deadly(pc->masks, &pc->res, horizonOf(pc));
}
static int playableSpending(int r, int c) {
  Cand *pc = poolSwap(r, c);
  if (!pc) return 0;
  return !unreadies(pc) && !returnsToSeen(r, c) && !spendsReserve(&pc->res, pc->masks);
}
static int settling(int r, int c) { (void)r; return BIN[IN_SETTLING + c] != 0 || BIN[IN_SETTLING + c + 1] != 0; }
static int tierOf(const Cand *cand) {
  const Rs *r = &cand->res;
  if (!r->total) return 3;
  double cells = cellsSent(r->chain >= 2, r->total, r->chain);
  if (cells > 0) return r->broke ? 0 : 1;
  return r->broke ? 2 : 4;
}
static int refuses(const Cand *cand, const int32_t *base, int survivalNeeded, int breakAvailable) {
  if (TFLAG(TF_REFUSE)) return cand && cand->kind == K_SWAP && cand->sr == (int)BIN[IN_T + 1] && cand->sc == (int)BIN[IN_T + 2] ? 3 : 0;
  if (!cand || cand->kind != K_SWAP) return 0;
  if (survivalNeeded) return 0;
  if (opt(O_REFPAYLESS) && tierOf(cand) == 4) return 1;
  if (cand->res.total > 0 && !cand->res.broke && materialRows(base) < WORKING_ROWS && breakAvailable) return 2;
  return 0;
}
static void routeSet(Route *rt, const double *o, int from, double frames, double startedAt) {
  int n = (int)o[F_NSW];
  rt->n = 0;
  for (int j = from; j < n; j++) { rt->mv[2 * rt->n] = (int32_t)o[F_SW + 2 * j]; rt->mv[2 * rt->n + 1] = (int32_t)o[F_SW + 2 * j + 1]; rt->n++; }
  rt->frames = frames; rt->startedAt = startedAt; rt->has = rt->n > 0; rt->spend = 0; rt->blind = 0;
}
static void routeShift(Route *rt) {
  for (int j = 1; j < rt->n; j++) { rt->mv[2 * (j - 1)] = rt->mv[2 * j]; rt->mv[2 * (j - 1) + 1] = rt->mv[2 * j + 1]; }
  rt->n--;
}

static Cand *ALLOWED[MAXCAND], *TMPC[MAXCAND], *RANKED[MAXCAND], *SPARE[MAXCAND];
static void scoreTask(int i) { Cand *c = pool.cands[i]; pool.out[i] = score(c->masks, c->moveFrames, &c->res); }
static void scoreAll(Cand **cs, int n, double *out, int idle, const int32_t *base) {
  if (idle) { for (int i = 0; i < n; i++) out[i] = idleScore(cs[i], base); return; }
  pool.cands = cs; pool.out = out;
  parRun(1, n);
}
typedef struct { Cand *c; double cheap; } Cheap;

static Dec decideCore(void) {
  int32_t *base = IN;
  DBASE = base;
  hereSet = 0;
  optsBuilt = 0;
  planReset(base);
  candidates(base);
  Line rev; memset(&rev, 0, sizeof rev);
  int haveRev = revealPick(base, &rev);
  double fpr = BIN[IN_FPR];
  int tallPool = tallestBoard(POOL[0].masks);
  double deadline = framesToDeath(tallPool, fpr);
  DDEADLINE = deadline;
  int landed = garbageRows(base);
  if (landed > BT->maxSlab) BT->maxSlab = landed;
  int poolBreak = 0;
  for (int i = 0; i < nPool; i++) if (POOL[i].res.broke) { poolBreak = 1; break; }
  int topped = BIN[IN_TOPPED] != 0;
  baseReady = BIN[IN_INCOMING] > 0 && slabReadyHook(base);
  baseLanding = landingOf(base);
  double dl2 = topped ? dmax(deadline, resolveFramesOf(3, 0)) : deadline;
  int lookDepth = (int)dmin(opt(O_MAXDEPTH), dmax(1, __builtin_floor(dl2 / (REACT > 1 ? REACT : 1))));
  lookDepthLog = lookDepth;
  int raising = raiseMode(base, poolBreak);
  BT->wantRaise = raising != 0;
  int digging = hasGarbage(base);
  if (digging) BT->counts[C_DIGGING]++;
  int haveSurvival = 0, sMove[2] = {0, 0}, havePlanWait = 0, pwMove[2] = {0, 0};
  double sRate = 0, sFrames = 0, planWaitEscape = INF;
  int swept = 0;
  double stackClock = BIN[IN_STACKCLOCK];
  if (raising) {
    BT->plan.has = 0; BT->attack.has = 0; BT->flatten.has = 0;
  } else if (topped || !(BIN[IN_STOP] > 0)) {
    swept = 1;
    if (BT->plan.has && BT->plan.n) {
      int nr = BT->plan.mv[0], nc = BT->plan.mv[1];
      int stillLegal = playable(nr, nc);
      double spent = dmax(0, stackClock - BT->plan.startedAt);
      double remains = dmax(0, BT->plan.frames - spent);
      int planFits = planInTime(BT->plan.mv, BT->plan.n, remains, base, deadline);
      if (stillLegal && planFits) {
        haveSurvival = 1; sMove[0] = nr; sMove[1] = nc; sFrames = remains; sRate = BT->plan.rate;
        routeShift(&BT->plan);
        if (!BT->plan.n) BT->plan.has = 0;
      } else if (planFits && settling(nr, nc)) {
        havePlanWait = 1; pwMove[0] = nr; pwMove[1] = nc;
        planWaitEscape = BT->plan.rate >= 1 ? remains : INF;
      } else {
        BT->plan.has = 0;
        BT->counts[C_PLANDROPPED]++;
      }
    }
    if (!haveSurvival && !havePlanWait) {
      mainOptions(base, deadline, lookDepth, digging);
      Pick plan;
      if (bestPlan(BIN[IN_STOP], deadline, topped, fpr, tallPool, base, &plan) && plan.rate > 0) {
        routeSet(&BT->plan, plan.option, 1, plan.frames, stackClock);
        BT->plan.gain = plan.gain; BT->plan.rate = plan.rate;
        haveSurvival = 1; sMove[0] = (int)plan.option[F_SW]; sMove[1] = (int)plan.option[F_SW + 1];
        sFrames = plan.frames; sRate = plan.rate;
      }
    }
  } else if (BT->plan.has) {
    BT->plan.has = 0;
  }
  int haveEscape = 0;
  double escape = 0;
  if (swept) { haveEscape = 1; escape = (haveSurvival && sRate >= 1) ? sFrames : INF; }
  if (swept && havePlanWait) escape = planWaitEscape;
  int mode = modeOf(haveEscape, escape, deadline);
  BT->counts[C_DECISIONS]++;
  BT->counts[C_BYMODE + mode]++;
  int survivalNeeded = mode == M_DEFEND;
  lastSurvivalNeeded = survivalNeeded;
  int breakOnPool = 0;
  for (int i = 0; i < nPool; i++) if (POOL[i].res.broke) { breakOnPool = 1; break; }
  lastBreakOnPool = breakOnPool;
  sigOf(base, &HERE); hereSet = 1;
  int na = 0;
  for (int i = 0; i < nPool; i++) {
    Cand *pc = &POOL[i];
    if (pc->kind == K_HOLD) continue;
    int why = refuses(pc, base, survivalNeeded, breakOnPool);
    if (why) {
      if (why == 1) BT->counts[C_REFUSEDPAYLESS]++;
      else if (why == 2) BT->counts[C_REFUSEDSTARVING]++;
      else BT->counts[C_REFUSEDOTHER]++;
      continue;
    }
    if (BIN[IN_STOP] > 0 && pc->kind == K_SWAP && pc->res.total > 0 && !pc->res.broke) {
      int isCh = pc->res.chain >= 2;
      double pays3 = stopTimeOf(isCh, isCh ? 0 : pc->res.total, isCh ? pc->res.chain : 0, topped);
      double left3 = BIN[IN_STOP] - pc->moveFrames;
      if (pays3 - dmax(0, left3) <= 0) { BT->counts[C_REFUSEDEARLY]++; continue; }
    }
    if (pc->kind == K_SWAP && pc->moveFrames > deadline) { BT->counts[C_REFUSEDTOOSLOW]++; continue; }
    ALLOWED[na++] = pc;
  }
  if (!na) { for (int i = 0; i < nPool; i++) ALLOWED[i] = &POOL[i]; na = nPool; }
  if (opt(O_REFRETURN)) {
    int nk = 0;
    for (int i = 0; i < na; i++) {
      Cand *ac = ALLOWED[i];
      if (ac->kind == K_SWAP) {
        Sig s; sigOf(ac->masks, &s);
        int seen = sigEq(&s, &HERE);
        for (int q = 0; !seen && q < BT->nSeen; q++) if (sigEq(&s, &BT->seen[q])) seen = 1;
        if (seen) { BT->counts[C_REFUSEDRETURN]++; continue; }
      }
      TMPC[nk++] = ac;
    }
    if (nk) { for (int i = 0; i < nk; i++) ALLOWED[i] = TMPC[i]; na = nk; }
    if (BIN[IN_HASLAST]) {
      int ns = 0;
      for (int i = 0; i < na; i++) {
        Cand *ac = ALLOWED[i];
        int cashes = ac->res.total > 0 || ac->res.broke;
        if (!cashes && ac->kind == K_SWAP && ac->sr == (int)BIN[IN_LASTR] && ac->sc == (int)BIN[IN_LASTC]) { BT->counts[C_REFUSEDSAMESWAP]++; continue; }
        TMPC[ns++] = ac;
      }
      if (ns) { for (int i = 0; i < ns; i++) ALLOWED[i] = TMPC[i]; na = ns; }
    }
  }
  {
    int nb = 0;
    for (int i = 0; i < na; i++) if (tierOf(ALLOWED[i]) == 0) TMPC[nb++] = ALLOWED[i];
    if (nb) { BT->counts[C_FORCEDBOTH]++; for (int i = 0; i < nb; i++) ALLOWED[i] = TMPC[i]; na = nb; }
  }
  BT->seen[BT->nSeen++] = HERE;
  if (BT->nSeen > 3) { for (int i = 1; i < BT->nSeen; i++) BT->seen[i - 1] = BT->seen[i]; BT->nSeen--; }
  if (materialRows(base) < 6) {
    int nd = 0;
    for (int i = 0; i < na; i++) if (ALLOWED[i]->res.broke) TMPC[nd++] = ALLOWED[i];
    if (nd) { BT->counts[C_FORCEDBREAK]++; for (int i = 0; i < nd; i++) ALLOWED[i] = TMPC[i]; na = nd; }
  }
  int beam = (int)opt(O_BEAM);
  if (beam > 0 && na > beam) {
    double pp2 = fpr / BW;
    Cheap sc[MAXCAND];
    for (int i = 0; i < na; i++) {
      Cand *ac = ALLOWED[i];
      sc[i].c = ac;
      sc[i].cheap = (ac->res.total ? ac->res.total * pp2 : 0) + (ac->res.garbage ? ac->res.garbage * pp2 : 0)
                  - tallestBoard(ac->masks) * 8 - ac->moveFrames * 0.5;
    }
    for (int i = 1; i < na; i++) {
      Cheap x = sc[i]; int j = i - 1;
      while (j >= 0 && sc[j].cheap < x.cheap) { sc[j + 1] = sc[j]; j--; }
      sc[j + 1] = x;
    }
    for (int i = 0; i < beam; i++) ALLOWED[i] = sc[i].c;
    na = beam;
  }

  int noneClear = 1;
  for (int i = 0; i < na; i++) if (ALLOWED[i]->res.total > 0) { noneClear = 0; break; }
  int buried = hasGarbage(base);
  int alive = 0, nRanked = 0, nSpare = 0;
  for (int i = 0; i < na; i++) {
    Cand *cand = ALLOWED[i];
    double horizon = horizonOf(cand);
    if (cand->kind == K_SWAP && spendsReserve(&cand->res, cand->masks)) continue;
    if (deadly(cand->masks, &cand->res, horizon)) { BT->counts[C_REFUSEDDEADLY]++; continue; }
    if (unreadies(cand)) { BT->counts[C_REFUSEDNOFAILSAFE]++; SPARE[nSpare++] = cand; continue; }
    int cashes = cand->res.total > 0 || cand->res.broke;
    Ahead ahead = { 0, 0, 0 };
    if (!cashes) ahead = lookahead(cand->masks, horizon);
    if (ahead.stranded) { BT->counts[C_REFUSEDSTRANDED]++; continue; }
    alive++;
    int held = buried ? ahead.hasBreak : ahead.hasClear;
    if (!cashes && !held) { BT->counts[C_REFUSEDNOFAILSAFE]++; SPARE[nSpare++] = cand; continue; }
    RANKED[nRanked++] = cand;
  }

  if (!poolBreak && !topped && !slabReadyHook(base)) {
    mainOptions(base, deadline, lookDepth, digging);
    if (haveRecIn(ODATA, 3)) {
      double *ready = recIn(ODATA, 3);
      int nsw = (int)ready[F_NSW];
      int32_t sw[2 * MAXD];
      for (int j = 0; j < 2 * nsw; j++) sw[j] = (int32_t)ready[F_SW + j];
      if (nsw && planInTime(sw, nsw, ready[F_DURATION], base, deadline)) {
        if (playable(sw[0], sw[1])) {
          BT->wantRaise = 0;
          clearRaiseFrames = 1;
          BT->counts[C_READIEDFIRST]++;
          return mkSwap(sw[0], sw[1], V_READYFIRST, mode, alive);
        }
      }
    }
  }

  if (raising) {
    int haveRc = 0;
    for (int i = 0; i < nPool; i++) if (POOL[i].kind == K_RAISE) haveRc = 1;
    if (haveRc) {
      if (raising == 1) BT->counts[C_OPENINGRAISES]++;
      else BT->counts[C_RAISEDFORMATERIAL]++;
      return mk(K_RAISE, raising == 1 ? V_RAISE_OPENING : V_RAISE_MATERIAL, mode, alive);
    }
    BT->counts[C_WAITEDTORAISE]++;
    return mkHold(V_RAISING, mode, alive, 0, 0, 0);
  }

  if (digging) {
    int haveBreak = 0;
    for (int i = 0; i < nPool; i++) if (POOL[i].res.broke) { haveBreak = 1; break; }
    int stillComing = BIN[IN_INCOMING] > 0 || BIN[IN_FALLING];
    Cand *bk = 0;
    for (int i = 0; i < nPool; i++) {
      Cand *bc = &POOL[i];
      if ((bc->kind != K_SWAP && bc->kind != K_HOLD) || !bc->res.broke) continue;
      if (bc->moveFrames > deadline) continue;
      if (deadly(bc->masks, &bc->res, horizonOf(bc))) continue;
      int cv = bc->res.converts, kv = bk ? bk->res.converts : -1;
      int vv = bc->res.voidAfter, kvv = bk ? bk->res.voidAfter : 0;
      if (!bk || cv > kv || (cv == kv && (vv < kvv || (vv == kvv && bc->moveFrames < bk->moveFrames)))) bk = bc;
    }
    if (bk && stillComing && !topped) {
      BT->counts[C_HELDFORLANDING]++;
      return mkHold(V_AWAITLANDING, mode, alive, bk->kind == K_SWAP, bk->sr, bk->sc);
    }
    if (bk) {
      BT->dig.has = 0; BT->digIsBreak = 0; BT->plan.has = 0;
      BT->counts[C_BROKENOW]++;
      if (bk->kind == K_HOLD) return mkHold(V_BREAK, mode, alive, 0, 0, 0);
      return mkSwap(bk->sr, bk->sc, V_BREAK, mode, alive);
    }
    if (haveBreak) { BT->dig.has = 0; BT->digIsBreak = 0; }
    if (haveRev && rev.broke) {
      BT->counts[C_REVEALSWAPS]++;
      if (!rev.swap) return mkHold(V_LINEUPHOLD, mode, alive, 0, 0, 0);
      Dec d = mkSwap(rev.sr, rev.sc, V_LINEUP, mode, alive); d.reveal = 1; return d;
    }
    double digLeft = INF;
    if (BT->dig.has && BT->dig.n) {
      double dspent0 = dmax(0, stackClock - BT->dig.startedAt);
      digLeft = dmax(0, BT->dig.frames - dspent0);
    }
    if (!haveBreak && !(BT->dig.has && BT->digIsBreak)) {
      mainOptions(base, deadline, lookDepth, digging);
      double *reach = 0;
      for (int i = 0; i < nPile; i++) {
        double *ro = PILE[i];
        if (ro[F_BREAKS] != 1 || !ro[F_NSW]) continue;
        int nsw = (int)ro[F_NSW];
        int32_t sw[2 * MAXD];
        for (int j = 0; j < 2 * nsw; j++) sw[j] = (int32_t)ro[F_SW + j];
        if (!planInTime(sw, nsw, ro[F_DURATION], base, deadline)) continue;
        double rc0 = ro[F_CONVERTS], kc0 = reach ? reach[F_CONVERTS] : -1;
        double rv0 = ro[F_VOID], kv0 = reach ? reach[F_VOID] : 0;
        if (!reach || rc0 > kc0 || (rc0 == kc0 && (rv0 < kv0 || (rv0 == kv0 && ro[F_DURATION] < reach[F_DURATION])))) reach = ro;
      }
      if (reach) {
        int rr = (int)reach[F_SW], rc = (int)reach[F_SW + 1];
        if (playable(rr, rc) && (digLeft == INF || mode == M_DEFEND)) {
          BT->plan.has = 0;
          if (reach[F_NSW] > 1) routeSet(&BT->dig, reach, 1, reach[F_DURATION], stackClock); else BT->dig.has = 0;
          BT->digIsBreak = BT->dig.has;
          BT->counts[C_BROKEREACHED]++;
          if (digLeft != INF) BT->counts[C_BROKEPREEMPT]++;
          return mkSwap(rr, rc, V_BREAKREACH, mode, alive);
        }
      }
      if (!reach && topped && nz(BIN[IN_HEALTH]) > 1 && digLeft == INF) {
        buildOptions(base, deadline, lookDepth, digging, BIN[IN_HEALTH] - 1);
        OD = ODSCR; LD = LANDSCR;
        if (optionsRun(base, OPTP, 0, 0)) botFailed = 1;
        OD = ODATA; LD = LANDS;
        nPile2 = pileOf(ODSCR, PILE2);
        double *lr = 0, lrSpend = INF;
        for (int i = 0; i < nPile2; i++) {
          double *lo = PILE2[i];
          if (lo[F_BREAKS] != 1 || !lo[F_NSW]) continue;
          int nsw = (int)lo[F_NSW];
          int32_t sw[2 * MAXD];
          for (int j = 0; j < 2 * nsw; j++) sw[j] = (int32_t)lo[F_SW + j];
          double sp = planSpend(sw, nsw, base);
          if (sp < lrSpend || (sp == lrSpend && lr && lo[F_CONVERTS] > lr[F_CONVERTS])) { lr = lo; lrSpend = sp; }
        }
        if (lr && lrSpend < BIN[IN_HEALTH] && playableSpending((int)lr[F_SW], (int)lr[F_SW + 1])) {
          BT->plan.has = 0;
          if (lr[F_NSW] > 1) { routeSet(&BT->dig, lr, 1, lr[F_DURATION], stackClock); BT->dig.spend = 1; } else BT->dig.has = 0;
          BT->digIsBreak = BT->dig.has;
          BT->counts[C_BROKESPENDING]++;
          Dec d = mkSwap((int)lr[F_SW], (int)lr[F_SW + 1], V_BREAKSPEND, mode, alive); d.spends = 1; return d;
        }
      }
    }
    if (!haveBreak && BT->dig.has && BT->dig.n) {
      int dr = BT->dig.mv[0], dc = BT->dig.mv[1];
      int dnOk = BT->dig.spend ? playableSpending(dr, dc) : playable(dr, dc);
      double dspent = dmax(0, stackClock - BT->dig.startedAt);
      int digOk = BT->dig.spend ? planSpend(BT->dig.mv, BT->dig.n, base) < nz(BIN[IN_HEALTH])
                                : planInTime(BT->dig.mv, BT->dig.n, dmax(0, BT->dig.frames - dspent), base, deadline);
      if (dnOk && digOk) {
        int digSpends = BT->dig.spend;
        routeShift(&BT->dig);
        if (!BT->dig.n) { BT->dig.has = 0; BT->digIsBreak = 0; }
        BT->plan.has = 0;
        BT->counts[C_DUGFOR]++;
        Dec d = mkSwap(dr, dc, V_DIGPLAN, mode, alive); d.spends = digSpends; return d;
      }
      if (!dnOk && settling(dr, dc) && digOk) return mkHold(V_DIGWAIT, mode, alive, 1, dr, dc);
      BT->dig.has = 0; BT->digIsBreak = 0;
      BT->counts[C_DIGDROPPED]++;
    }
    if (!haveBreak) {
      mainOptions(base, deadline, lookDepth, digging);
      if (haveRecIn(ODATA, 1)) {
        double *dp = recIn(ODATA, 1);
        int nsw = (int)dp[F_NSW];
        int32_t sw[2 * MAXD];
        for (int j = 0; j < 2 * nsw; j++) sw[j] = (int32_t)dp[F_SW + j];
        if (nsw && planInTime(sw, nsw, dp[F_DURATION], base, deadline) && playable(sw[0], sw[1])) {
          BT->digIsBreak = 0;
          routeSet(&BT->dig, dp, 1, dp[F_DURATION], stackClock);
          if (!BT->dig.n) { BT->dig.has = 0; BT->digIsBreak = 0; }
          BT->counts[C_DUGFOR]++;
          return mkSwap(sw[0], sw[1], V_DIGPLAN, mode, alive);
        }
      }
    }
  }

  if (!haveSurvival) {
    if (BT->attack.has && BT->attack.n) {
      int ar = BT->attack.mv[0], ac = BT->attack.mv[1];
      double aspent = dmax(0, stackClock - BT->attack.startedAt);
      int aFits = planInTime(BT->attack.mv, BT->attack.n, dmax(0, BT->attack.frames - aspent), base, deadline);
      int okNext = aFits && playable(ar, ac);
      if (!okNext && aFits && settling(ar, ac)) return mkHold(V_ATTACKWAIT, mode, alive, 1, ar, ac);
      if (okNext) {
        routeShift(&BT->attack);
        if (!BT->attack.n) BT->attack.has = 0;
        BT->counts[C_ATTACKED]++;
        return mkSwap(ar, ac, V_ATTACKPLAN, mode, alive);
      }
      BT->attack.has = 0;
      BT->counts[C_ATTACKDROPPED]++;
    }
    mainOptions(base, deadline, lookDepth, digging);
    Pick atk;
    int haveAtk = bestAttack(deadline, fpr / BW, &atk);
    if (haveAtk && !playable((int)atk.option[F_SW], (int)atk.option[F_SW + 1])) {
      haveAtk = 0; BT->attack.has = 0; BT->counts[C_REFUSEDRETURN]++;
    }
    if (haveAtk) {
      routeSet(&BT->attack, atk.option, 1, atk.option[F_DURATION], stackClock);
      BT->counts[C_ATTACKED]++;
      BT->counts[C_CELLSPLANNED] += atk.cells;
      return mkSwap((int)atk.option[F_SW], (int)atk.option[F_SW + 1], V_BESTATTACK, mode, alive);
    }
  }

  if (havePlanWait) return mkHold(V_PLANWAIT, mode, alive, 1, pwMove[0], pwMove[1]);
  if (haveSurvival) {
    if (!playable(sMove[0], sMove[1])) {
      BT->plan.has = 0;
      BT->counts[C_REFUSEDRETURN]++;
      haveSurvival = 0;
    } else {
      BT->counts[C_PLANNED]++;
      return mkSwap(sMove[0], sMove[1], V_SURVIVALPLAN, mode, alive);
    }
  }

  Shape bsh; shapeOf(base, &bsh);
  int shapeTime = noneClear || BIN[IN_STOP] > 0 || bsh.spread >= WORKING_ROWS;
  if (shapeTime && !(BT->flatten.has && BT->flatten.n)) mainOptions(base, deadline, lookDepth, digging);
  double shapeBudget = BIN[IN_STOP] > 0 ? dmin(BIN[IN_STOP], deadline) : deadline;
  int landsOk = 1;
  int haveFlat = optsBuilt && haveRecIn(ODATA, 0);
  double *flat = recIn(ODATA, 0);
  if (haveFlat && digging && !TFLAG(TF_STUB)) {
    int nsw = (int)flat[F_NSW];
    int er = nsw ? (int)flat[F_SW + 2 * (nsw - 1)] : (int)BIN[IN_CROW];
    int ec = nsw ? (int)flat[F_SW + 2 * (nsw - 1) + 1] : (int)BIN[IN_CCOL];
    landsOk = hasFireable(LANDS, er, ec);
    if (!landsOk) BT->counts[C_FLATTENBLIND]++;
  }
  if (shapeTime && landsOk && haveFlat && flat[F_NSW] && flat[F_DURATION] <= shapeBudget) {
    if (!(BT->flatten.has && BT->flatten.n)) {
      routeSet(&BT->flatten, flat, 0, flat[F_DURATION], stackClock);
      BT->flatten.blind = !digging;
    }
  }
  if (digging && BT->flatten.has && BT->flatten.blind) {
    BT->flatten.has = 0;
    BT->counts[C_FLATTENBLIND]++;
  }
  if (shapeTime && BT->flatten.has && BT->flatten.n) {
    int fr = BT->flatten.mv[0], fc = BT->flatten.mv[1];
    int fok = playable(fr, fc);
    double fspent = dmax(0, stackClock - BT->flatten.startedAt);
    int fFits = planInTime(BT->flatten.mv, BT->flatten.n, dmax(0, BT->flatten.frames - fspent), base, deadline);
    if (!fok && fFits && settling(fr, fc)) return mkHold(V_FLATTENWAIT, mode, alive, 1, fr, fc);
    fok = fok && fFits;
    if (fok) {
      routeShift(&BT->flatten);
      if (!BT->flatten.n) BT->flatten.has = 0;
      BT->counts[C_FLATTENED]++;
      return mkSwap(fr, fc, V_FLATTEN, mode, alive);
    }
    BT->flatten.has = 0;
    BT->counts[C_FLATTENDROPPED]++;
  }

  if (haveRev && rev.swap && !rev.broke && rev.total > 0) {
    if ((topped && slabOnScreen()) || bsh.mat - (double)rev.total / BW < WORKING_ROWS) haveRev = 0;
  }
  if (haveRev && rev.swap) {
    BT->counts[C_REVEALSWAPS]++;
    Dec d = mkSwap(rev.sr, rev.sc, V_LINEUP, mode, alive); d.reveal = 1; return d;
  }
  Cand *best = 0; double bestScore = 0, sc[MAXCAND];
  scoreAll(RANKED, nRanked, sc, noneClear, base);
  for (int i = 0; i < nRanked; i++) if (!best || sc[i] > bestScore) { best = RANKED[i]; bestScore = sc[i]; }
  if (!best && nSpare) {
    scoreAll(SPARE, nSpare, sc, noneClear, base);
    for (int i = 0; i < nSpare; i++) if (!best || sc[i] > bestScore) { best = SPARE[i]; bestScore = sc[i]; }
  }
  if (!best) {
    BT->counts[C_ALLDEAD]++;
    scoreAll(ALLOWED, na, sc, noneClear, base);
    for (int i = 0; i < na; i++) if (!best || sc[i] > bestScore) { best = ALLOWED[i]; bestScore = sc[i]; }
  }
  if (!best) return mkHold(V_NOBEST, mode, alive, 0, 0, 0);
  Dec d = mk(best->kind, noneClear ? V_SETUP : V_WEIGHTS, mode, alive);
  if (best->kind == K_SWAP) { d.hasMove = 1; d.sr = best->sr; d.sc = best->sc; }
  return d;
}

static int isArith(int via) { return via == V_SURVIVALPLAN || via == V_PLANSAVE || via == V_DIGPLAN || via == V_BREAK || via == V_KEEPSAVE; }
static Dec decideRuled(void) {
  Dec d = decideCore();
  if (TFLAG(TF_FORCE)) d = mkSwap((int)BIN[IN_T + 1], (int)BIN[IN_T + 2], V_BESTATTACK, d.mode, d.alive);
  int32_t *base = DBASE;
  if (d.kind != K_SWAP || !d.hasMove) return d;
  Cand *picked = poolSwap(d.sr, d.sc);
  if (picked && !isArith(d.via) && refuses(picked, base, lastSurvivalNeeded, lastBreakOnPool)) {
    Cand *sub = 0; double subScore = 0, sv[MAXCAND];
    int nq = 0;
    for (int i = 0; i < nPool; i++) {
      Cand *sc0 = &POOL[i];
      if (sc0 == picked || sc0->kind != K_SWAP) continue;
      if (refuses(sc0, base, lastSurvivalNeeded, lastBreakOnPool)) continue;
      if (sc0->moveFrames > DDEADLINE) continue;
      if (deadly(sc0->masks, &sc0->res, horizonOf(sc0))) continue;
      TMPC[nq++] = sc0;
    }
    scoreAll(TMPC, nq, sv, 0, base);
    for (int i = 0; i < nq; i++) if (!sub || sv[i] > subScore) { sub = TMPC[i]; subScore = sv[i]; }
    if (sub) {
      BT->counts[C_REFUSEDATEXIT]++;
      d = mkSwap(sub->sr, sub->sc, V_RULED, d.mode, d.alive);
    }
  }
  if (!saveAfter(base, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 1)) {
    if (isArith(d.via)) return d;
    double *route = 0;
    if (optsBuilt) {
      if (haveRecIn(ODATA, 1) && recIn(ODATA, 1)[F_NSW]) route = recIn(ODATA, 1);
      else if (haveRecIn(ODATA, 2) && recIn(ODATA, 2)[F_NSW]) route = recIn(ODATA, 2);
    }
    if (route) {
      int r0 = (int)route[F_SW], c0 = (int)route[F_SW + 1], ok0 = 0;
      int32_t lg[2 * 128];
      int n = legal(base, lg);
      for (int i = 0; i < n; i++) if (lg[2 * i] == r0 && lg[2 * i + 1] == c0) { ok0 = 1; break; }
      if (ok0 && route[F_DURATION] <= DDEADLINE) {
        BT->counts[C_SAVEPLANNED]++;
        return mkSwap(r0, c0, V_PLANSAVE, d.mode, d.alive);
      }
    }
    return d;
  }
  if (d.via == V_SURVIVALPLAN) return d;
  Cand *chosen = poolSwap(d.sr, d.sc);
  if (!chosen) return d;
  if (chosen->res.broke) {
    if (materialRows(base) < 6) return d;
    if (saveAfter(chosen->masks, chosen->sr, chosen->sc, 1)) return d;
    BT->counts[C_HELDTHEBREAK]++;
  } else if (saveAfter(chosen->masks, chosen->sr, chosen->sc, 1)) {
    return d;
  }
  Cand *keep = 0; double keepScore = 0, ks[MAXCAND]; int keepQ = 0, qs[MAXCAND], nk = 0;
  for (int i = 0; i < nPool; i++) {
    Cand *alt = &POOL[i];
    if (alt == chosen || alt->kind != K_SWAP) continue;
    if (deadly(alt->masks, &alt->res, horizonOf(alt))) continue;
    int q = saveAfter(alt->masks, alt->sr, alt->sc, 0);
    if (!q) continue;
    qs[nk] = q; TMPC[nk++] = alt;
  }
  scoreAll(TMPC, nk, ks, 0, base);
  for (int i = 0; i < nk; i++) {
    int q = qs[i]; double sc = ks[i];
    if (!keep || q > keepQ || (q == keepQ && sc > keepScore)) { keep = TMPC[i]; keepScore = sc; keepQ = q; }
  }
  if (!keep) { BT->counts[C_SAVEUNKEEPABLE]++; return d; }
  BT->counts[C_SAVEKEPT]++;
  return mkSwap(keep->sr, keep->sc, V_KEEPSAVE, d.mode, d.alive);
}

typedef struct { int kind, sr, sc, future, moveFrames; const int32_t *masks; Rs res; } Clr;
static Clr CLEARS[MAXCAND + 128];
static Res WD;
static ST WDA;
static int32_t WDSW[2 * 128], WDR[R_INTS + ST_INTS];
static int endsInBreak(int via) { return via == V_DIGPLAN || via == V_BREAKREACH || via == V_BREAK || via == V_LINEUP || via == V_LINEUPHOLD; }
// A SWAP HELD FOR LATER MUST STILL BE THERE LATER. A cell above one that is
// clearing falls when the clear ends — the moment a held swap is wanted.
static int steady(int r, int c) {
  for (int cc = c; cc <= c + 1; cc++) { int low = (int)BIN[IN_POPLOW + cc]; if (low > 0 && low < r) return 0; }
  return 1;
}
// FRAMES A QUIET SWAP HOLDS THE BOARD, from the engine: 5 when nothing
// falls; when panels drop, the swap (4), the hover (6), one frame to start and
// one per row fallen. base is the board before the swap, after the board it
// settles to.
static ST QSW;
static double quietSettle(const int32_t *base, int r, int c, const int32_t *after) {
  stcpy(QSW, base);
  if (!swapIn(QSW, r, c)) return 5;
  int fell = 0;
  for (int cc = c; cc <= c + 1; cc++) {
    int f = topRow(U(QSW, OCC + cc)) - topRow(U(after, OCC + cc));
    if (f > fell) fell = f;
  }
  return fell > 0 ? 11 + fell : 5;
}
static Dec waitForDrain(Dec d) {
  // Topped only: before the board tops, stayAlive keeps the time.
  if (!BIN[IN_TOPPED]) return d;
  double k = BIN[IN_DRAINBOUND];
  int32_t *base = DBASE;
  int nc = 0;
  Cand *picked = 0;
  for (int i = 0; i < nPool; i++) {
    Cand *pc = &POOL[i];
    if (pc->kind != K_SWAP) continue;
    if (d.kind == K_SWAP && d.hasMove && pc->sr == d.sr && pc->sc == d.sc) picked = pc;
    if (pc->res.total > 0 || pc->res.broke) {
      Clr *c = &CLEARS[nc++];
      c->kind = K_SWAP; c->sr = pc->sr; c->sc = pc->sc; c->future = 0; c->moveFrames = pc->moveFrames; c->masks = pc->masks; c->res = pc->res;
    }
  }
  if (!nc) {
    resolve(base, WD.r, 1);
    if (WD.r[R_SCOPE] == SC_OK) {
      int32_t *settled = WD.st;
      int n = legal(settled, WDSW);
      for (int i = 0; i < n; i++) {
        int sr = WDSW[2 * i], sc = WDSW[2 * i + 1];
        if (!swapIn(settled, sr, sc)) continue;
        resolve(settled, WDR, 0);
        swapIn(settled, sr, sc);
        if (!(WDR[R_TOTAL] > 0 || WDR[R_SCOPE] == SC_BROKE)) continue;
        Clr *c = &CLEARS[nc++];
        c->kind = K_SWAP; c->sr = sr; c->sc = sc; c->future = 1; c->masks = 0;
        c->moveFrames = travelCost((int)BIN[IN_CROW], (int)BIN[IN_CCOL], sr, sc);
        c->res = summarise(WDR);
      }
    }
  }
  if (!nc) return d;
  if (d.spends) return d;
  Rs *pr = picked ? &picked->res : 0;
  if (pr && pr->broke && picked->moveFrames + 1 <= k) return d;
  if (!picked && endsInBreak(d.via)) return d;
#define HOLDAT(r, c) mkHold(V_AWAITDRAIN, d.mode, d.alive, 1, r, c)
  if (pr && pr->total > 0 && !pr->broke && picked->moveFrames + 1 <= k) {
    if (picked->moveFrames + 2 > k || !steady(picked->sr, picked->sc)) return d;
    BT->counts[C_WAITEDFORDRAIN]++;
    return HOLDAT(picked->sr, picked->sc);
  }
  double nearest = INF;
  for (int i = 0; i < nc; i++) nearest = dmin(nearest, CLEARS[i].moveFrames);
  if (picked) {
    double back = INF;
    stcpy(WDA, picked->masks);
    int n = legal(WDA, WDSW);
    for (int i = 0; i < n; i++) {
      double cst = travelCost(picked->sr, picked->sc, WDSW[2 * i], WDSW[2 * i + 1]);
      if (cst >= back || !swapIn(WDA, WDSW[2 * i], WDSW[2 * i + 1])) continue;
      resolve(WDA, WDR, 0);
      swapIn(WDA, WDSW[2 * i], WDSW[2 * i + 1]);
      if (WDR[R_TOTAL] > 0 || WDR[R_SCOPE] == SC_BROKE) back = cst;
    }
    if (picked->moveFrames + quietSettle(base, picked->sr, picked->sc, picked->masks) + back + 1 <= k) return d;
  } else if (nearest + 2 <= k) {
    return d;
  }
  BT->counts[C_KEPTHEALTH]++;
  Clr *breakNow = 0, *clearNow = 0;
  double cnRate = 0, cnVd = 0; int cnTn = 0;
  double *f = BIN + IN_SF;
  for (int i = 0; i < nc; i++) {
    Clr *cl = &CLEARS[i];
    Rs *r = &cl->res;
    if (cl->moveFrames + 1 > k) continue;
    if (r->broke) {
      if (!breakNow || r->converts > breakNow->res.converts ||
          (r->converts == breakNow->res.converts && cl->moveFrames < breakNow->moveFrames)) breakNow = cl;
      continue;
    }
    int isCh = r->chain >= 2;
    double rate = (f[1] + f[2] + f[3] * r->total + stopTimeOf(isCh, isCh ? 0 : r->total, isCh ? r->chain : 0, 1)) / r->total;
    double vd = 0;
    if (cl->masks) { Shape sh; shapeOf(cl->masks, &sh); vd = sh.high - sh.mat; }
    int tn = r->total, st = cl->future || steady(cl->sr, cl->sc), cnSt = clearNow && (clearNow->future || steady(clearNow->sr, clearNow->sc));
    if (clearNow && st != cnSt) { if (st) { clearNow = cl; cnRate = rate; cnVd = vd; cnTn = tn; } continue; }
    if (!clearNow || tn < cnTn || (tn == cnTn && (vd < cnVd || (vd == cnVd && rate > cnRate)))) { clearNow = cl; cnRate = rate; cnVd = vd; cnTn = tn; }
  }
  if (breakNow && !breakNow->future) return mkSwap(breakNow->sr, breakNow->sc, V_BREAK, d.mode, d.alive);
  if (breakNow) return HOLDAT(breakNow->sr, breakNow->sc);
  Clr *esc = clearNow;
  if (!esc) for (int i = 0; i < nc; i++) if (!esc || CLEARS[i].moveFrames < esc->moveFrames) esc = &CLEARS[i];
  if (esc->future || (esc->moveFrames + 2 <= k && steady(esc->sr, esc->sc))) return HOLDAT(esc->sr, esc->sc);
  // No steady clear to hold: one that is falling apart is fired only when the
  // time is up; before that the choice stands and stayAlive judges it.
  if (esc->moveFrames + 2 <= k) return d;
  return mkSwap(esc->sr, esc->sc, V_KEEPHEALTH, d.mode, d.alive);
#undef HOLDAT
}
// IT MUST NOT DIE. Living is any line that presses a clear or a break before
// the time runs out: a break converts the garbage, a clear holds the lock and
// earns stop. Every first swap is marked living if it cashes in time itself,
// or if one more swap on the board it settles to does -- the walk to it, the
// frames it takes, then the walk on. The bot's own choice stands whenever it
// is living; a choice that is not is replaced by a living one.
#define LIVEHORIZON 60
static ST LVA, LVB;
static int32_t LVR[R_INTS + ST_INTS], LVS[2 * 128], LVS2[2 * 128];
static uint8_t LIVE[40][WMAX], LIVE1[40][WMAX], LIVEB[40][WMAX];
static double LIVET[40][WMAX];
static int liveAny;
static int cashes(const int32_t *r) { return r[R_TOTAL] > 0 || r[R_SCOPE] == SC_BROKE; }
// A CLEAR LIVES IF THE NEXT ONE IS IN TIME. It holds the lock while it flashes
// and pops, and earns stop on top; when both run out another clear must be
// pressed, from the board it settles to, walking from where it was made.
static ST CLA;
static int32_t CLR[R_INTS + ST_INTS], CLS[2 * 128];
static int clearLives(const Cand *pc, double k) {
  const Rs *r = &pc->res;
  int isCh = r->chain >= 2;
  double lock = resolveFramesOf(r->total, 0) + stopTimeOf(isCh, isCh ? 0 : r->total, isCh ? r->chain : 0, BIN[IN_TOPPED] != 0);
  double left = dmax(k, pc->moveFrames + lock) - pc->moveFrames - 2;
  stcpy(CLA, pc->masks);
  int n = legal(CLA, CLS);
  for (int i = 0; i < n; i++) {
    int r2 = CLS[2 * i], c2 = CLS[2 * i + 1];
    if (travelCost(pc->sr, pc->sc, r2, c2) > left) continue;
    if (!swapIn(CLA, r2, c2)) continue;
    resolve(CLA, CLR, 0);
    swapIn(CLA, r2, c2);
    if (cashes(CLR)) return 1;
  }
  return 0;
}
static void livingSet(const int32_t *base, double left) {
  int cr = (int)BIN[IN_CROW], cc = (int)BIN[IN_CCOL];
  // A press protects from the frame after it, and the drain falls on the
  // bound's last frame: a line lives if its press comes two frames before.
  left -= 2;
  memset(LIVE, 0, sizeof LIVE); memset(LIVE1, 0, sizeof LIVE1); memset(LIVEB, 0, sizeof LIVEB); liveAny = 0;
  stcpy(LVA, base);
  int n = legal(LVA, LVS);
  for (int i = 0; i < n; i++) {
    int r1 = LVS[2 * i], c1 = LVS[2 * i + 1];
    double t1 = travelCost(cr, cc, r1, c1);
    if (t1 > left || r1 >= 40) continue;
    if (!swapIn(LVA, r1, c1)) continue;
    resolve(LVA, LVR, 1);
    swapIn(LVA, r1, c1);
    int sc = LVR[R_SCOPE];
    if (sc != SC_OK && sc != SC_BROKE) continue;
    if (cashes(LVR)) {
      Cand *pc = sc == SC_BROKE ? 0 : poolSwap(r1, c1);
      if (pc && !clearLives(pc, left + 2)) continue;
      LIVE[r1][c1] = LIVE1[r1][c1] = 1; LIVEB[r1][c1] = sc == SC_BROKE; LIVET[r1][c1] = t1; liveAny = 1; continue;
    }
    double settle = quietSettle(LVA, r1, c1, LVR + R_INTS);
    stcpy(LVB, LVR + R_INTS);
    int n2 = legal(LVB, LVS2);
    for (int j = 0; j < n2; j++) {
      int r2 = LVS2[2 * j], c2 = LVS2[2 * j + 1];
      double t2 = t1 + settle + travelCost(r1, c1, r2, c2);
      if (t2 > left) continue;
      if (!swapIn(LVB, r2, c2)) continue;
      resolve(LVB, LVR, 0);
      swapIn(LVB, r2, c2);
      if (!cashes(LVR)) continue;
      int brk = LVR[R_SCOPE] == SC_BROKE;
      if (!LIVE[r1][c1] || (brk && !LIVEB[r1][c1])) { LIVE[r1][c1] = 1; LIVEB[r1][c1] = brk; LIVET[r1][c1] = t2; liveAny = 1; }
      if (brk) break;
    }
  }
}
static Dec stayAlive(Dec d) {
  double k = BIN[IN_TOPPED] ? BIN[IN_DRAINBOUND] : DDEADLINE;
  if (!(k < LIVEHORIZON)) return d;
  if (d.kind == K_SWAP && d.hasMove) {
    Cand *pc = poolSwap(d.sr, d.sc);
    if (pc && pc->res.broke && pc->moveFrames <= k) return d;
    if (pc && pc->res.total > 0 && pc->moveFrames + 2 <= k && clearLives(pc, k)) return d;
  } else if (d.kind != K_HOLD) return d;
  livingSet(DBASE, k);
  if (!liveAny) return d;
  if (d.kind == K_SWAP && d.hasMove) { if (d.sr < 40 && LIVE[d.sr][d.sc]) return d; }
  else {
    double wait = BIN[IN_TOPPED] ? 2 : REACT;
    for (int r = 1; r < 40; r++) for (int c = 1; c < WMAX; c++)
      if (LIVE[r][c] && LIVET[r][c] + wait <= k) return d;
  }
  // The choice dies. Take a living swap, breaking garbage first: a swap that
  // breaks, the first of a two-swap line that breaks, a swap that clears, the
  // first of a two-swap line that clears; the earliest within each.
  int br = 0, bc = 0, rank = -1; double bt = INF;
  for (int r = 1; r < 40; r++) for (int c = 1; c < WMAX; c++) {
    if (!LIVE[r][c]) continue;
    Cand *pc = poolSwap(r, c);
    int rk = LIVEB[r][c] ? (LIVE1[r][c] ? 3 : 2) : LIVE1[r][c] ? 1 : 0;
    if (!LIVE1[r][c] && (returnsToSeen(r, c) || (BIN[IN_HASLAST] && r == (int)BIN[IN_LASTR] && c == (int)BIN[IN_LASTC]))) continue;
    if (rk > rank || (rk == rank && LIVET[r][c] < bt)) { br = r; bc = c; bt = LIVET[r][c]; rank = rk; }
  }
  if (rank < 0) return d;
  BT->counts[C_KEPTHEALTH]++;
  BT->plan.has = 0; BT->attack.has = 0; BT->flatten.has = 0; BT->dig.has = 0; BT->digIsBreak = 0;
  return mkSwap(br, bc, V_KEEPHEALTH, d.mode, d.alive);
}
static Dec onePlan(Dec d) {
  if (d.kind != K_SWAP) return d;
  int keep = 0;
  if (d.via == V_DIGPLAN || d.via == V_BREAKREACH || d.via == V_BREAKSPEND) keep = 1;
  else if (d.via == V_ATTACKPLAN || d.via == V_BESTATTACK) keep = 2;
  else if (d.via == V_SURVIVALPLAN) keep = 3;
  else if (d.via == V_FLATTEN) keep = 4;
  if (keep != 1) { BT->dig.has = 0; BT->digIsBreak = 0; }
  if (keep != 2) BT->attack.has = 0;
  if (keep != 3) BT->plan.has = 0;
  if (keep != 4) BT->flatten.has = 0;
  return d;
}

__attribute__((export_name("bot_decide"))) int32_t bot_decide(int32_t id) {
  BT = &BOTS[id];
  TB = BT->tab;
  REACT = (int)opt(O_REACTION);
  PRESS = (int)opt(O_PRESS);
  HELDR = (int)BIN[IN_CROW]; HELDC = (int)BIN[IN_CCOL]; HELDDIR = (int)BIN[IN_HELD];
  botFailed = 0;
  clearRaiseFrames = 0;
  memoRoom();
  nSettle = nLandR = nFireR = nSavesR = nAnyR = 0;
  nRes = 0; nOptRuns = 0; nOptDepth = 0; nScore = 0; nLook = 0; nSave = 0; rScore = rMain = rLook = rSave = rCand = 0;
  Dec d = onePlan(stayAlive(waitForDrain(decideRuled())));
  if (d.kind == K_SWAP && d.hasMove) {
    BT->recent[2] = BT->nRecent ? BT->recent[0] : 0; BT->recent[3] = BT->nRecent ? BT->recent[1] : 0;
    BT->recent[0] = d.sr; BT->recent[1] = d.sc;
    BT->nRecent = BT->nRecent ? 2 : 1;
  }
  double *o = BOUT;
  for (int i = 0; i < 128; i++) o[i] = 0;
  o[0] = d.kind; o[1] = d.hasMove; o[2] = d.sr; o[3] = d.sc; o[4] = d.hasPark; o[5] = d.pr; o[6] = d.pc;
  o[7] = d.via; o[8] = d.spends; o[9] = d.reveal; o[10] = d.mode; o[11] = d.alive;
  o[12] = BT->wantRaise; o[13] = BT->wantRows; o[14] = clearRaiseFrames;
  double ew = INF;
  for (int i = 0; i < nPool; i++) {
    Cand *c = &POOL[i];
    if (c->kind == K_SWAP && (c->res.total > 0 || c->res.broke)) ew = dmin(ew, c->moveFrames);
  }
  o[15] = ew;
  int pb = 0;
  for (int i = 0; i < nPool; i++) if (POOL[i].kind == K_SWAP && POOL[i].res.broke) { if (!pb) { o[17] = POOL[i].sr; o[18] = POOL[i].sc; } pb++; }
  o[16] = pb;
  o[19] = optsBuilt;
  o[100] = nRes; o[101] = rMain; o[102] = nSettle; o[103] = nLandR; o[104] = nScore; o[105] = rScore; o[106] = lookDepthLog;
  if (optsBuilt) {
    int lines = 0;
    for (int i = 0; i < nPile; i++) {
      double *op = PILE[i];
      if (op[F_BREAKS] != 1 || !op[F_NSW]) continue;
      if (!lines) {
        int nsw = (int)op[F_NSW];
        int32_t sw[2 * MAXD];
        for (int j = 0; j < 2 * nsw; j++) { sw[j] = (int32_t)op[F_SW + j]; o[24 + j] = sw[j]; }
        o[22] = nsw;
        o[21] = planSpend(sw, nsw, DBASE);
      }
      lines++;
    }
    o[20] = lines;
  }
  return botFailed ? -1 : 0;
}

__attribute__((export_name("bot_deadly_calls"))) int32_t bot_deadly_calls(void) { return deadlyCalls; }
__attribute__((export_name("bot_opening"))) int32_t bot_opening(int32_t id, int32_t set) { if (set >= 0) BOTS[id].opening = set; return BOTS[id].opening; }
__attribute__((export_name("bot_pool"))) int32_t *bot_pool(int32_t i) { return POOLST[i]; }
static Rs argRes(int at) {
  Rs r; memset(&r, 0, sizeof r);
  r.chain = (int)BIN[at]; r.total = (int)BIN[at + 1]; r.garbage = (int)BIN[at + 2]; r.broke = (int)BIN[at + 3];
  r.converts = (int)BIN[at + 4]; r.voidAfter = (int)BIN[at + 5];
  return r;
}
__attribute__((export_name("bot_test"))) double bot_test(int32_t id, int32_t fn) {
  memoRoom();
  BT = &BOTS[id];
  TB = BT->tab;
  REACT = (int)opt(O_REACTION);
  PRESS = (int)opt(O_PRESS);
  HELDDIR = 0;
  double *a = BIN + IN_T + 8;
  Rs r = argRes(IN_T + 16);
  int hasRes = (int)a[0];
  switch (fn) {
    case 1: return deadly(IN, hasRes ? &r : 0, a[1]);
    case 2: return score(IN, (int)a[1], hasRes ? &r : 0);
    case 3: { Cand c; memset(&c, 0, sizeof c); c.masks = RISEN; c.moveFrames = (int)a[1]; return idleScore(&c, IN); }
    case 4: { Cand c; memset(&c, 0, sizeof c); c.kind = (int)a[2]; c.sr = (int)a[3]; c.sc = (int)a[4]; c.res = r;
              return refuses(&c, IN, (int)a[5], (int)a[6]); }
    case 5: return raiseMode(IN, (int)a[1]);
    case 6: return framesToRise(a[1], a[2], a[3]);
    case 7: return framesToDeath((int)a[1], a[2]);
    case 8: {
      DBASE = IN; optsBuilt = 0; planReset(IN);
      candidates(IN);
      for (int i = 0; i < nPool; i++) {
        Cand *c = &POOL[i]; double *o = BOUT + 8 * i;
        o[0] = c->kind; o[1] = c->sr; o[2] = c->sc; o[3] = c->moveFrames; o[4] = c->res.chain; o[5] = c->res.total;
        o[6] = c->res.broke; o[7] = c->masks == IN ? -1 : (double)(c->masks - POOLST[0]) / ST_INTS;
      }
      return nPool;
    }
    case 9: case 10: case 11: {
      int n = (int)a[1];
      for (int i = 0; i < n; i++) PILE[i] = recIn(ODATA, 4 + i);
      nPile = n;
      if (fn == 11) return ruinsShape(PILE[0]);
      Pick pk;
      int have = fn == 9 ? bestAttack(a[2], a[3], &pk) : bestPlan(a[2], a[3], (int)a[4], a[5], (int)a[6], IN, &pk);
      if (!have) return -1;
      BOUT[0] = pk.rate; BOUT[1] = pk.cells; BOUT[2] = pk.gain; BOUT[3] = pk.frames;
      return (double)((pk.option - ODATA - 64) / REC - 4);
    }
    case 13: {
      nPool = 0;
      for (int i = 0; i < (int)a[4] && i < MAXCAND; i++) {
        Cand *c = &POOL[nPool++]; memset(c, 0, sizeof *c);
        c->res.total = (int)BIN[IN_LEGAL + 2 * i]; c->res.chain = (int)BIN[IN_LEGAL + 2 * i + 1];
      }
      return modeOf((int)a[1], a[2], a[3]);
    }
    case 12: {
      buildOptions(IN, a[1], 0, 0, 0);
      for (int i = 0; i < 128; i++) BOUT[i] = OPTP[i];
      return 0;
    }
  }
  return 0;
}
__attribute__((export_name("bot_state"))) int32_t bot_state(int32_t id) { return (int32_t)(long)&BOTS[id]; }
__attribute__((export_name("bot_state_size"))) int32_t bot_state_size(void) { return (int32_t)sizeof(Bot); }
