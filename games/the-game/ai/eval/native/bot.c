#define BW 6
#define BH 12
#define WORKING_ROWS 4
#define MOVE_FRAMES 4
#define INF (1.0 / 0.0)
static void frontCalm(int calm);

enum { IN_TOPPED, IN_STOP, IN_INCOMING, IN_NEXTSLAB, IN_FALLING, IN_CROW, IN_CCOL, IN_HEALTH, IN_DRAIN, IN_FPR,
       IN_FTNR, IN_SPEED, IN_NEXTUP, IN_STARTSPEED, IN_CLOCK, IN_STACKCLOCK, IN_HASRISEN, IN_RAISING, IN_INFLIGHT,
       IN_DRAINBOUND, IN_STACKTOPPED, IN_MOVING, IN_HASTIMED, IN_REVEALOPEN, IN_CONVN, IN_CONVTIMER, IN_BCROW, IN_BCCOL,
       IN_NLEGAL, IN_HASINROW, IN_INROW = 30, IN_HASLAST = 37, IN_LASTR, IN_LASTC, IN_SETTLING = 40, IN_LOCKLEFT = 47, IN_HASPA = 48, IN_HELD = 49, IN_SF = 50, IN_CANSWAP = 54, IN_CONV = 60, IN_LEGAL = 300, IN_T = 560, IN_SLABW = 590, IN_SLABH, IN_SLABC, IN_INROWS, IN_POPLOW = IN_INROWS, IN_PRESSES = 600, IN_PHANTOM, IN_RISEN, IN_SIZE = 608 };   // IN_POPLOW + 1..W runs to 599
enum { TF_DEADLY = 1, TF_FORCE = 2, TF_REFUSE = 4, TF_RAISE = 8, TF_STUB = 16, TF_SLAB = 32 };
static int deadlyCalls;
#define TFLAG(f) (((int)BIN[IN_T]) & (f))
enum { T_RISE = 0, T_COMBO = 100, T_STOP = 200, T_LF = 210, T_W = 220, T_OPT = 250, T_SIZE = 270 };
enum { O_REACTION, O_REVEAL, O_ALLOWRAISE, O_REFRETURN, O_REFPAYLESS, O_BEAM, O_MAXDEPTH, O_HORIZON, O_PRESS };
enum { K_HOLD = 0, K_RAISE = 1, K_SWAP = 2 };
enum { V_NONE, V_RAISE_OPENING, V_RAISE_MATERIAL, V_RAISING, V_READYFIRST, V_AWAITLANDING, V_BREAK, V_LINEUPHOLD,
       V_LINEUP, V_BREAKREACH, V_BREAKSPEND, V_DIGPLAN, V_DIGWAIT, V_ATTACKWAIT, V_ATTACKPLAN, V_BESTATTACK,
       V_PLANWAIT, V_SURVIVALPLAN, V_FLATTENWAIT, V_FLATTEN, V_NOBEST, V_SETUP, V_WEIGHTS, V_RULED, V_PLANSAVE,
       V_KEEPSAVE, V_AWAITDRAIN, V_KEEPHEALTH, V_FILL };
enum { M_BUILD, M_DEFEND, M_ATTACK };
// the line a bot plays (Bot.line): what it is for, and the most steps it holds
enum { LINE_BREAK = 1, LINE_CASH = 2, LINE_PLAN = 3 };
#define LINEMAX 16   // the most steps a line holds: storage, never a limit on what is searched -- a line that does not fit is refused, never cut
#define LNOLEN 17
// THE HOLLOW of a judged line: the gaps under garbage on the board it ends on
// ([10]) and the gaps the slabs to come would leave over its towers ([13]). A
// tower lowered also lets a pile perched on it down onto panels it can break on.
// THE HOLLOW THAT MATTERS: what the next slab perches over, read on the frame
// it has landed (out[15]: the standing hollow under all garbage then); with no
// slab landing within the horizon, the gaps under garbage and the level the
// board ends on
#define HOLLOW(a) ((a)[15] >= 0 ? (a)[15] : (a)[10] + (a)[13])
int lineLanded(const int32_t *steps, int n, int32_t *masks, int32_t *t);   // the engine judge's out: [0] die ... [11] end board hash, [12] panels it ends with
// THE CUT, past which the decision fails and the game with it: the game's
// think budget (ThinkBudget.lua) is 8 ms a frame for a computer player's whole
// thinking. A decision's work is counted in units, and a unit takes longer or
// shorter by machine and by what the decision does: a full decision of
// combo_storm seed 18 (4,000 frames, 33,000 units) takes 3.5 ms at the median,
// a median of 9,400 units per ms (drill seed 9 p5 7,148, Lua seed 9 p1 6,027).
// 8 ms at the median rate is 75,000 units; a decision is cut at 72,000. Below
// the median rate a full decision overruns the game's 8 ms (train.lua counts
// the frames over it), so the rate is what to raise, not the budget to cut:
// half the work (42,800) leaves a stage nothing to judge with and the bot dies
// in its first wave. lua_budget_check and budget_check measure the time it
// actually takes.
#define WORKBUDGET 72000   // natively and in the browser alike
// WHERE OPTIONAL WORK STOPS: the engine refuses work past it, and every judge,
// replay, search and batch is declined that would not fit. What was under way
// finishes past it: at most 6,688 units over 3,446 decisions of seed 16 under
// the charges of the 4,963-a-ms rate, 9,630 at today's 7,148, so the line
// stands that far under the cut.
#define OPTWORK 62400   // WORKBUDGET less the 9,600 under way when the line is crossed
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
typedef struct { int has, n; int32_t mv[2 * MAXD]; double frames, gain, rate, startedAt, stamp; int spend, blind; } Route;   // stamp: the press count when its first step was last decided (-1: not decided)
typedef struct {
  double tab[T_SIZE];
  Sig seen[4]; int nSeen;
  int prR[8], prC[8], prA[8], prB[8], nPr; double prN[8], lineBorn, nNotes, seenPresses;   // each press's number in the bot's own count, and the count when the line was set   // the last presses, and the colours each left in its pair
  double linePresses;   // the front's press count when the line was set (IN_PRESSES): a step counts as made only by a press since
  Route plan, dig, attack, flatten;
  int digIsBreak, opening, maxSlab, nRecent, wantRows, wantRaise;
  int32_t line[2 * LINEMAX]; int nLine, lineKind, lineWaitAll;   // the line being played, its steps still to play: LINE_BREAK or LINE_CASH
  int32_t recent[4];
  double risenSeen;   // the rows risen (IN_RISEN) when the stored rows were last moved up
  int32_t tgt[2 * LINEMAX]; int tgtN, tgtKind, tgtWait, tgtVia; double tgtPresses;   // the target being walked to (arbitrate): its line, the rule that chose it, the presses when it was chosen
  double counts[NCOUNT];
  int lastVia;   // the route the last decision took
} Bot;

static LOCAL int nScore, nLook, nSave, rScore, rMain, rLook, rSave, rCand, lookDepthLog;
#define MAXBOT 2048
static Bot BOTS[MAXBOT];
static int nBots = 0;
static Bot *BT;
static double BIN[IN_SIZE], BOUT[256];
// the game's ThinkBudget is the only clock: the bot reads none
#define NOWMS2() 0.0
#ifndef __wasm__
extern char *getenv(const char *);
extern int atoi(const char *);
#endif
int botTraceOn;   // the native drill's GC_BOTLOG: the pool, as the engine plays it
void *botLogTo;    // where the bot log goes: stderr, or a run's own buffer (train.lua's death report)
#define BLOG (botLogTo ? botLogTo : stderr)
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
static JLOCAL double scoreEnd;   // a scored candidate's share of the work ends here (score, scoreAll); 0: none
static double scoreShare;        // the share each candidate scoreAll scores gets
static double rdW0;              // the work done when the decision began
static double optLine(void);
static double nz(double v) { return v != v ? 0 : v; }
static double dmax(double a, double b) { return a > b ? a : b; }
static double dmin(double a, double b) { return a < b ? a : b; }

// ---------------------------------------------------------------- the clock
// EVERYTHING IS TIME, NEVER SWAPS: a line is as good as the frame it is done,
// however many swaps it takes. ONE CLOCK, every search's -- the option search
// (bit.c, through OVERHEAD), the lines, the walks, readiness -- read from how
// the front plays a line (front.c linePlay): after a press the next walk waits
// out the swap landing and, unless the board is stopped or topped, the bot's
// reaction (stepGap); the walk is travelCost (taps MOVE_FRAMES apart, then the
// press); a pair whose panels still move is pressed the frame they have settled.
// The front waits from the frame a press is made, the clock counts the frame
// it is seen (PRESS later): the gap from one seen press to the next walk is
// the wait less PRESS. Measured against the engine: clock.test.sh.
static double stepGap(int frozen) { double land = MOVE_FRAMES + 1; return (frozen || REACT < land ? land : REACT) - PRESS; }
// the frame a step is pressed: walked from (pr, pc) starting at `start`, and
// no sooner than its pair is still (`ready`, 0: it already is)
static double stepPress(double start, int pr, int pc, int r, int c, double ready) {
  double at = start + travelCost(pr, pc, r, c);
  return at > ready ? at : ready;
}
// an option's whole time on the clock (F_DURATION: its walks and the gaps between its presses)
static double recTime(const double *x) { return x[F_DURATION] ? x[F_DURATION] : x[F_FRAMES]; }
// HOW DEEP THE TIME GOES: an option search grows a line as far as there is
// time for its presses -- the time there is (`left`) over the clock's gap --
// up to what an option holds (O_MAXDEPTH)
static int depthIn(double left, int frozen) {
  double d = __builtin_floor(left / stepGap(frozen)), most = opt(O_MAXDEPTH);
  return d < 1 ? 1 : d > most ? (int)most : (int)d;
}
// THE SEARCH IN TIME (searchInTime, below): what its accept says of a line --
// SIT_TAKE (the one wanted: the search ends), SIT_END (kept or not, it is not
// grown on), SIT_GROW -- given the step's resolve record (R ints and the board
// it settles to), the line so far, and the frame its last step is pressed
enum { SIT_GROW = 0, SIT_TAKE = 1, SIT_END = 2 };
typedef int (*SitAccept)(const int32_t *res, const int32_t *sw, int n, double at, void *ctx);
static int searchInTime(const int32_t *st0, int cr, int cc, double t0, double notBefore, double left, int frozen,
                        const uint32_t *can0, uint8_t (*wait0)[WMAX], double work, SitAccept accept, void *ctx,
                        int32_t *sw, int *nOut, double *atOut);
// THE CLOCK COUNTS A PRESS ON THE FRAME IT IS SEEN (travelCost's PRESS: the
// frame after it is made); the engine's judge (LNO[1]) on the frame it is
// made. An engine press time meets the clock only through pressSeen.
static double pressSeen(double made) { return made + PRESS; }
// the frame a line's last step is pressed, its first walk starting at t0 from (cr, cc)
static double lineFrames(const int32_t *sw, int n, int cr, int cc, double t0, int frozen) {
  double at = t0;
  for (int k = 0; k < n; k++) {
    at = stepPress(k ? at + stepGap(frozen) : at, cr, cc, sw[2 * k], sw[2 * k + 1], 0);
    cr = sw[2 * k]; cc = sw[2 * k + 1];
  }
  return at;
}

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
// MATERIAL: the panels whose colours are known. A break's cells are not
// material until their colours are dealt -- unseen, they match nothing and
// may cascade away when they show (leavesSixRows reads the judge's count of
// the same).
static double materialRows(const int32_t *st) {
  int n = 0;
  for (int c = 1; c <= BW; c++) {
    uint32_t known = 0;
    for (int a = 1; a <= st[O_N]; a++) known |= CL(st, a, c);
    n += popc(known & U(st, OCC + c) & ~U(st, GARB + c));
  }
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
  int room = BH - tallest;
  if (queued >= room && room > 0) {
    // THE QUEUE FILLS THE ROOM, one slab at a time: each drops at row BH + 1
    // and falls a row a frame onto the last, and the next drops only once it
    // has landed. Topped by the last, the board drains when its shake ends.
    double fill = 0;
    for (int i = 0; i < room; i++) fill += BH - (tallest + i) + 1;
    return dmax(fill + BIN[IN_SF + 4], clock);
  }
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
typedef struct { int stranded; } Ahead;
static Ahead lookahead(const int32_t *st0, double horizon) {
  nLook++;
  int r0 = nRes;
  Ahead out = { 1 };
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
      if (!out.stranded) break;
      continue;
    }
    if (!swapIn(LK, LKSW[2 * i], LKSW[2 * i + 1])) continue;
    resolve(LK, LKR.r, 1);
    swapIn(LK, LKSW[2 * i], LKSW[2 * i + 1]);
    int sc = LKR.r[R_SCOPE];
    if (sc != SC_OK && sc != SC_BROKE) continue;
    Rs rr = raw(LKR.r);
    if (out.stranded && !deadly(sc == SC_OK ? LKR.st : LK, &rr, horizon)) out.stranded = 0;
    if (!out.stranded) break;
  }
  rLook += nRes - r0;
  return out;
}

// A FAILSAFE IN TIME: after a quiet candidate, a break (the board buried)
// or a clear pressed before the board loses health -- any length, walked
// from where the candidate leaves the cursor, once it is pressed
#define FAILSAFEWORK 240
static int sitBreaks(const int32_t *res, const int32_t *sw, int n, double at, void *ctx);
static int sitFires(const int32_t *res, const int32_t *sw, int n, double at, void *ctx);
static int failsafeIn(const Cand *c, int wantBreak) {
  int frozen = BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0;
  return searchInTime(c->masks, c->sr, c->sc, c->moveFrames + stepGap(frozen), 0, framesToDeath(tallestBoard(c->masks), BIN[IN_FPR]), frozen,
                      0, 0, FAILSAFEWORK, wantBreak ? sitBreaks : sitFires, 0, 0, 0, 0);
}
static LOCAL double PSCR[128];
static LOCAL int priceTopped = -1;
__attribute__((export_name("bit_price_dirty"))) void bit_price_dirty(void) { priceTopped = -1; }
static void timingParams(double *P, double fpr, double deadline, double stopTime, int toppedOut) {
  for (int i = 0; i < 128; i++) P[i] = 0;
  int frozen = stopTime > 0 || toppedOut;
  P[0] = fpr; P[1] = deadline; P[2] = INF; P[3] = 0; P[4] = 0; P[5] = 1;
  P[6] = resolveFramesOf(3, 0); P[7] = WORKING_ROWS; P[8] = stepGap(frozen);   // the clock's gap between presses (stepGap): every search's
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
  // as deep as the time there is (depthIn), never a count fixed in swaps
  PSCR[4] = 1; PSCR[11] = depthIn(lands, topped || afterStop > 0);
  double *keepOD = OD; int32_t *keepLD = LD;
  OD = ODS; LD = LDS;
  { extern PATLS double paWork; double keepEnd = scoreEnd;
    scoreEnd = scoreShare > 0 ? paWork + scoreShare : 0;   // 0: scored on its own (bot_call), unshared
    if (optionsRun(st, PSCR, 0, 0)) botFailed = 1;
    scoreEnd = keepEnd; }
  OD = keepOD; LD = keepLD;
  rScore += nRes - r0;
  int nAll = (int)ODS[1] + (int)ODS[2];
  double *base = ODS + 64 + 4 * REC;
  double f[20], bump, spread, tallest;
  surface(st, &bump, &spread, &tallest);
  f[0] = share(bump, 20); f[1] = share(spread, 7); f[2] = share(tallest, 12);
  // THE OPTIONS IN TIME: every option the board offers that is done (recTime,
  // the clock) before it loses health (lands) -- however many swaps it takes
  static const int CB[4] = { 2, 3, 4, 5 }, OB[4] = { 4, 5, 6, 7 };
  int inTime = 0, bw = 0; double near = INF, bc = 0, bo = 0;
  int nc[4] = { 0 }, no[4] = { 0 };
  for (int i = 0; i < nAll; i++) {
    double *o = base + i * REC, t = recTime(o);
    if (t > lands) continue;
    inTime++;
    if (t < near) near = t;
    if (o[F_BREAKS] == 1) bw++;
    if (o[F_KIND] == 1) { if (o[F_SIZE] > bc) bc = o[F_SIZE]; for (int k = 0; k < 4; k++) if (CB[k] == 5 ? o[F_SIZE] >= 5 : o[F_SIZE] == CB[k]) nc[k]++; }
    else { if (o[F_SIZE] > bo) bo = o[F_SIZE]; for (int k = 0; k < 4; k++) if (OB[k] == 7 ? o[F_SIZE] >= 7 : o[F_SIZE] == OB[k]) no[k]++; }
  }
  for (int k = 0; k < 4; k++) { f[3 + k] = share(nc[k], 4); f[7 + k] = share(no[k], 4); }
  f[11] = near == INF ? 0 : 1 - share(near, 41);
  f[12] = 1 - share(moveFrames, 64);
  f[13] = share(bc, 6); f[14] = share(bo, 8); f[15] = share(inTime, 220);
  f[16] = res && res->broke ? 1 : 0;
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
    for (int k = 1; k <= 12; k++) out[SCOL + k * WMAX + c] = (k <= st[O_N] ? (U(st, SCOL + k * WMAX + c) << 1) : 0) & lim;
    out[SCOL + v * WMAX + c] |= 1;
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
#define READYWORK 2500   // the readiness search's share of a decision's work
// THE BOARD'S OWN READINESS, asked once a decision: the same question as an
// option's (slabReady), with the readiness search's share of the decision's
// work (READYWORK) -- an option's small share finds no break of two swaps
static int inTimeOfWork(const int32_t *st, SitAccept want, double work);
static int sitBreaks(const int32_t *res, const int32_t *sw, int n, double at, void *ctx);
static int slabReadyBoard(const int32_t *st) {
  if (TFLAG(TF_SLAB)) return BIN[IN_T + 6] != 0;
  SLABW = (int)BIN[IN_SLABW]; SLABH = (int)BIN[IN_SLABH]; SLABC = (int)BIN[IN_SLABC];
  int placed = slabPlace(st, SLABST);
  if (placed < 0) return slabReadyFast(st);
  return inTimeOfWork(placed ? SLABST : st, sitBreaks, READYWORK);
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
static ST SAM;
// A SAVE IN TIME: after a move pressed at (row, col), on the board it leaves
// (with the next slab placed, slabToAnswer), the soonest break -- or else a
// clear -- of any length pressed before that board loses health; the shared
// search's (searchInTime). 2 a break, 1 a clear, 0 none. `deep`: the work it
// may spend -- one board's swaps, or more.
#define SAVEWORK 1500
#define SAVEWORK1 240
typedef struct { int best; } SaveCtx;
static int sitSave(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  SaveCtx *x = ctx; (void)sw; (void)n; (void)at;
  if (res[R_SCOPE] == SC_BROKE) { x->best = 2; return SIT_TAKE; }
  if (res[R_TOTAL] > 0) { if (!x->best) x->best = 1; return SIT_END; }
  return SIT_GROW;
}
static int saveAfter(const int32_t *masks0, int row, int col, int deep) {
  nSave++;
  double deadline = framesToDeath(tallestBoard(masks0), BIN[IN_FPR]);
  int frozen = BIN[IN_STOP] > 0 || BIN[IN_TOPPED];
  slabToAnswer(masks0, SAM);
  SaveCtx x = { 0 };
  searchInTime(SAM, row, col, stepGap(frozen), 0, deadline, frozen, 0, 0, deep ? SAVEWORK : SAVEWORK1, sitSave, &x, 0, 0, 0);
  return x.best;
}
static int fireInTimeOf(const int32_t *st);
static int hasFireable(const int32_t *masks, int r, int c) {
  if (fireInTimeOf(masks)) return 1;
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
// THE PILE IN TIME: an option's whole time on the clock (recTime), never its
// swaps -- a one-swap option across the board goes after a three-swap one
// beside the cursor that is done sooner
static int priceCmp(const double *x, const double *y) {
  if (recTime(x) != recTime(y)) return recTime(x) < recTime(y) ? -1 : 1;
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
  sortRecs(out, nNow + nNext);   // one pile, in time
  return nNow + nNext;
}
static double *recIn(double *od, int i) { return od + 64 + i * REC; }
static int haveRecIn(double *od, int i) { return od[7 + i] != 0; }

static double OPTP[128];
static int optsBuilt;
// the records this decision reads (OPTP[108] skips the rest): the fire-ready only
// when no save holds and no saves record exists, so it is built on demand
static int optSkip, optSkipBuilt;
static const int32_t *moBase; static double moDeadline; static int moDepth, moDigging;
static double saMs, moMs; static int saN;   // GC_WORKSTAT: scoring, the main option search
static void buildOptions(const int32_t *base, double deadline, int lookDepth, int digging, double spend) {
  int topped = BIN[IN_TOPPED] != 0;
  timingParams(OPTP, BIN[IN_FPR], deadline, BIN[IN_STOP], topped);
  OPTP[18] = BT->nRecent;
  for (int i = 0; i < BT->nRecent; i++) { OPTP[19 + 2 * i] = BT->recent[2 * i]; OPTP[20 + 2 * i] = BT->recent[2 * i + 1]; }
  if (topped) OPTP[2] = lockNow();
  OPTP[3] = spend; OPTP[10] = digging; OPTP[11] = lookDepth; OPTP[101] = 1;
  OPTP[102] = BIN[IN_SLABW]; OPTP[103] = BIN[IN_SLABH]; OPTP[104] = BIN[IN_SLABC];
  OPTP[105] = HELDR; OPTP[106] = HELDC; OPTP[107] = HELDDIR;
  OPTP[108] = optSkip; OPTP[109] = 1;
}
static void breakAheadStart(void), breakAheadEnd(void);   // front.c
static void parallelJoin(void);
// THE OPTION SEARCH'S QUESTIONS IN TIME (bit.c: the breaks and clears each
// option's board offers, its slab readiness) are searches, each with a small
// share; together they get QUESTWORK of the decision, past which they answer
// no -- the option search's own work and the stages after it keep theirs
#define QUESTWORK 15000
static double stageEnd;   // below: where optional work stops while a stage runs
static int optionsShared(const int32_t *base) {
  extern PATLS double paWork;
  double keep = stageEnd, e = paWork + QUESTWORK;
  if (e < stageEnd) stageEnd = e;
  int failed = optionsRun(base, OPTP, 0, 0);
  stageEnd = keep;
  return failed;
}
static void mainOptions(const int32_t *base, double deadline, int lookDepth, int digging) {
  if (optsBuilt) return;
  moBase = base; moDeadline = deadline; moDepth = lookDepth; moDigging = digging; optSkipBuilt = optSkip;
  buildOptions(base, deadline, lookDepth, digging, 0);
  OD = ODATA; LD = LANDS;
  int r0 = nRes;
  double mo0 = NOWMS2();
  breakAheadStart();   // the workers, idle while this search runs, find the pool's break times
  if (optionsShared(base)) botFailed = 1;
  parallelJoin(); breakAheadEnd();
  moMs += NOWMS2() - mo0;
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

// an option's break readiness, and whether it closes the break, asked of its board when first read
static double readyOf(double *o) {
  if (o[F_BREAKREADY] == -4) {
    const int32_t *st = OPTSET[(o - (ODATA + 64)) / REC];
    o[F_BREAKREADY] = !hasGarb(st) ? -1 : anyBreakOf(st) ? 1 : 0;
  }
  return o[F_BREAKREADY];
}
// THE READINESS OF MANY OPTIONS, ASKED TOGETHER: those not yet known are
// scanned in parallel natively and kept as readyOf would keep them.
static void parallelDo(int count, void (*task)(int));
#define RBN 512
static double *RBO[RBN]; static u64 RBK[RBN]; static int RBV[RBN], rbN;
static void rbTask(int t) {   // eight boards a task
  for (int j = 8 * t; j < 8 * t + 8 && j < rbN; j++) RBV[j] = breakInTimeOf(OPTSET[(RBO[j] - (ODATA + 64)) / REC]);
}
static void readyBatch(double **opts, int count) {
  // each distinct board scanned once: lines in another order often reach the same one
  static double *same[RBN]; static int sameOf[RBN]; static int slot[2 * RBN];
  int nj = 0, ns = 0;
  for (int i = 0; i < 2 * RBN; i++) slot[i] = -1;
  for (int i = 0; i < count && nj < RBN; i++) {
    double *o = opts[i];
    if (o[F_BREAKREADY] != -4) continue;
    const int32_t *st = OPTSET[(o - (ODATA + 64)) / REC];
    if (!hasGarb(st)) { o[F_BREAKREADY] = -1; continue; }
    u64 k = breakKey(st); double v;
    if (tget(&ANYB, k, &v)) { o[F_BREAKREADY] = v ? 1 : 0; continue; }
    unsigned h = (unsigned)(k ^ (k >> 32)) & (2 * RBN - 1);
    while (slot[h] >= 0 && RBK[slot[h]] != k) h = (h + 1) & (2 * RBN - 1);
    if (slot[h] >= 0) { same[ns] = o; sameOf[ns++] = slot[h]; continue; }
    slot[h] = nj; RBO[nj] = o; RBK[nj] = k; nj++;
  }
  if (nj < 1) return;
  rbN = nj;
  parallelDo((nj + 7) / 8, rbTask);
  for (int j = 0; j < nj; j++) { tput(&ANYB, RBK[j], RBV[j]); RBO[j][F_BREAKREADY] = RBV[j] ? 1 : 0; }
  for (int j = 0; j < ns; j++) same[j][F_BREAKREADY] = RBV[sameOf[j]] ? 1 : 0;
}
static int closesOf(double *o) {
  if (o[F_CLOSESBREAK] == -2) o[F_CLOSESBREAK] = readyOf(o) == 0;
  return o[F_CLOSESBREAK] == 1;
}
static int ruinsShape(double *o) { return o[F_OPENSHOLE] == 1 || closesOf(o); }
static int has(double v) { return v == v; }
static double shortfallOf(const double *o) { return !has(o[F_MAT]) ? 0 : dmax(0, WORKING_ROWS - o[F_MAT]); }
static double durOf(const double *o) { return o[F_DURATION] ? o[F_DURATION] : o[F_FRAMES]; }
// THE LEVELLING OPTIONS, when there are any; and, unless every option is a
// tall one without a break, the tall ones without a break are not taken.
// Which tall ones those are is asked only of one about to be taken (kept).
static int dropTallUnready;
static int tallOpt(const double *o) { return has(o[F_TALL]) && o[F_TALL] >= BH - WORKING_ROWS; }
static void keepFilter(double **all, int n, double **out, int *nout) {
  int nl = 0;
  for (int i = 0; i < n; i++) if (all[i][F_LEVELS] == 1) nl++;
  int k = 0;
  if (nl) { for (int i = 0; i < n; i++) if (all[i][F_LEVELS] == 1) out[k++] = all[i]; }
  else { for (int i = 0; i < n; i++) out[k++] = all[i]; }
  int nk = 0;
  for (int i = 0; i < k && !nk; i++) if (!tallOpt(out[i])) nk = 1;
  for (int at = 0; at < k && !nk; at += RBN) {   // in batches, until one is ready
    int end = at + RBN < k ? at + RBN : k;
    readyBatch(out + at, end - at);
    for (int i = at; i < end && !nk; i++) if (readyOf(out[i]) != 0) nk = 1;
  }
  dropTallUnready = nk;
  *nout = k;
}
static int kept(double *o) { return !(dropTallUnready && tallOpt(o) && readyOf(o) == 0); }
static double *FILT[MAXOPT];
typedef struct { double rate, cells, gain, frames; double *option; } Pick;
static int bestAttack(double deadline, double ppf, Pick *best) {
  int n, have = 0;
  keepFilter(PILE, nPile, FILT, &n);
  for (int i = 0; i < n; i++) {
    double *o = FILT[i];
    if (!o[F_NSW]) continue;
    if (durOf(o) > deadline) continue;
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
    // one that ruins the shape is never taken: asked only of one that would be
    if (win && kept(o) && !ruinsShape(o)) { have = 1; best->rate = rate; best->cells = cells; best->frames = o[F_FRAMES]; best->option = o; }
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
    // topped, whether it fits is a replay: a ruinous one is dropped first
    int ruinAsked = BIN[IN_TOPPED] != 0;
    if (ruinAsked && (!kept(o) || ruinsShape(o))) continue;
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
    if (better && !ruinAsked && (!kept(o) || ruinsShape(o))) better = 0;
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
// A RAISE IS WANTED AND OFFERED ONLY IF IT LIVES. A board loses health only
// topped, with no stop time and nothing holding the rise lock; a manual raise
// zeroes the stop time, and one pressed topped is game over (Stack.lua
// handleManualRaise, checkDeath). So topped, never. Otherwise the passive rise
// tops the raised board out in (free rows - queued garbage rows) rows, each
// FPR frames, and the raise lives if the quickest clear the pool holds --
// stop time earned, the rise held -- can be made before then.
// ROOM TO RAISE: the rows left free above the tallest column once the next
// slab has landed and a raise already moving is up. Slabs land one at a time,
// each with time to break it before the next; a storm's queue never empties. One rule,
// asked by the decision (raiseSafe) and by the front every frame it holds a
// raise (front.c raiseRoomNow): no room, no raise.
static int raiseRoom(int tallest, int queued, int raising) { return BH - tallest - 1 - queued - (raising != 0); }
static JLOCAL int raiseShort;   // raiseSafe refused for room (1) or for a clear in time (0), for the trace
static int raiseSafe(const int32_t *base) {
  raiseShort = 1;
  if (BIN[IN_TOPPED] || BIN[IN_STACKTOPPED]) return 0;
  int queued = BIN[IN_PHANTOM] > 0 ? 0 : (int)BIN[IN_SLABH];   // the real next slab, never the phantom
  int free = raiseRoom(tallestBoard(base), queued, BIN[IN_RAISING] != 0);
  if (free <= 0) return 0;
  raiseShort = 0;
  double clear = INF;
  for (int q = 0; q < nPool; q++)
    if (POOL[q].kind == K_SWAP && POOL[q].res.total > 0 && POOL[q].moveFrames < clear) clear = POOL[q].moveFrames;
  // no clear the board holds now: the raised board's own, in time (the shared search, fireInTimeOf)
  if (clear == INF) return risenMasks(base, RZ) && fireInTimeOf(RZ);
  return free * BIN[IN_FPR] > clear + REACT;
}
// WHAT A SWAP CAUSES. On a board in motion the clear already resolving is in
// every result the resolver gives, the board left alone included. A swap is
// credited only with what it adds: the cells past the board's own, and a break
// the board was not already making. Every route reads the pool, so every
// route sees what the swap does.
static Rs causedBy(Rs r, const Rs *alone) {
  if (!(alone->total > 0 || alone->broke)) return r;
  r.total = r.total > alone->total ? r.total - alone->total : 0;
  r.broke = r.broke && !alone->broke;
  if (r.scope == SC_BROKE && !r.broke) r.scope = SC_OK;
  if (!r.total && !r.broke) { r.chain = 0; r.rounds = 0; r.biggest = 0; r.converts = 0; r.garbage = 0; }
  else r.biggest = r.rounds == 1 ? r.total : 0;
  return r;
}
// The engine's answer (pa.c paOutcome): out = cells matched, garbage cells
// converted, clears, highest chain counter, most stop one clear paid, frames.
int paOutcome(int r, int c, int at, int horizon, int32_t *out);
static void parallelDo(int count, void (*task)(int));
// the pool's outcomes, one per legal swap, played in parallel
static int32_t PORC[128], POOUT[128][8]; static const int32_t *poLg; static int poCr, poCc;
#define PAHORIZON 600
static void poTask(int i) { PORC[i] = paOutcome(poLg[2 * i], poLg[2 * i + 1], travelCost(poCr, poCc, poLg[2 * i], poLg[2 * i + 1]), PAHORIZON, POOUT[i]); }
static int32_t PALONE[8], PAOUT[8];
static Rs paRes(const int32_t *o, const int32_t *alone) {
  Rs r; memset(&r, 0, sizeof r);
  int cells = o[0] - (alone ? alone[0] : 0), conv = o[1] - (alone ? alone[1] : 0);
  r.total = cells > 0 ? cells : 0;
  r.broke = conv > 0;
  r.converts = conv > 0 ? conv : 0; r.garbage = r.converts;
  r.chain = r.total || r.broke ? (o[3] > 1 ? o[3] : 1) : 0;
  r.rounds = r.total || r.broke ? (o[2] - (alone ? alone[2] : 0) > 0 ? o[2] - (alone ? alone[2] : 0) : 1) : 0;
  r.biggest = r.rounds == 1 ? r.total : 0;
  r.scope = r.broke ? SC_BROKE : SC_OK;
  return r;
}
static ST TMC;
static void candidates(int32_t *base) {
  nPool = 0;
  Cand *h = &POOL[nPool++];
  memset(h, 0, sizeof(Cand));
  h->kind = K_HOLD; h->masks = base;
  if (BIN[IN_HASRISEN]) {
    resolve(RISEN, CR.r, 1);
    const int32_t *rm = CR.r[R_SCOPE] == SC_OK ? CR.st : RISEN;
    {
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
  // A BOARD IN MOTION IS PLAYED ON THE ENGINE. The server's engine (pa.c) is
  // linked in and holds this board: each swap is pressed when the walk
  // arrives and run until nothing moves, against the board left alone, so a
  // swap's result is what the game does.
  int onEngine = moving && BIN[IN_HASPA] != 0 && paOutcome(0, 0, 0, PAHORIZON, PALONE) == 0;
  if (onEngine) h->res = paRes(PALONE, 0);
  int32_t lg[2 * 128];
  int n = legal(base, lg);
  int cr = (int)BIN[IN_CROW], cc = (int)BIN[IN_CCOL];
  // every swap's outcome on the engine, played together (parallelDo), then taken one by one
  if (onEngine) {
    extern void paPrefix(const int *ats, int n, int horizon);
    int ats[128]; for (int i = 0; i < n && i < 128; i++) ats[i] = travelCost(cr, cc, lg[2 * i], lg[2 * i + 1]);
    paPrefix(ats, n < 128 ? n : 128, PAHORIZON);
    poLg = lg; poCr = cr; poCc = cc; parallelDo(n, poTask);
  }
  for (int i = 0; i < n; i++) {
    int r = lg[2 * i], c = lg[2 * i + 1];
    if (!swapIn(base, r, c)) continue;
    resolve(base, CR.r, 1);
    int haveSettled = CR.r[R_SCOPE] == SC_OK;
    Rs res = summarise(CR.r);
    if (onEngine) {
      int rc = PORC[i];
      for (int k = 0; k < 8; k++) PAOUT[k] = POOUT[i][k];
#ifndef __wasm__
      if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr;
        fprintf(BLOG, "POOL %d,%d at %d rc %d cells %d conv %d clears %d chain %d stop %d frames %d | alone cells %d\n", r, c, travelCost(cr, cc, r, c), rc,
                PAOUT[0], PAOUT[1], PAOUT[2], PAOUT[3], PAOUT[4], PAOUT[5], PALONE[0]); }
#endif
      if (rc == -2) { swapIn(base, r, c); continue; }
      if (rc == 0) {
        res = paRes(PAOUT, PALONE);
        if (nPool >= MAXCAND) { botFailed = 1; swapIn(base, r, c); continue; }
        if (haveSettled) stcpy(POOLST[nPool], CR.st); else stcpy(POOLST[nPool], base);
        swapIn(base, r, c);
        goto pooled;
      }
    }
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
    res = causedBy(res, &h->res);
  pooled:
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
    out[SCOL + col * WMAX + c] |= b;
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

typedef struct { int kind, sr, sc, hasMove, pr, pc, hasPark, via, spends, reveal, mode, alive, waitAll; } Dec;
static Dec mk(int kind, int via, int mode, int alive) { Dec d; memset(&d, 0, sizeof d); d.kind = kind; d.via = via; d.mode = mode; d.alive = alive; return d; }
static Dec mkSwap(int sr, int sc, int via, int mode, int alive) { Dec d = mk(K_SWAP, via, mode, alive); d.sr = sr; d.sc = sc; d.hasMove = 1; return d; }
static Dec mkHold(int via, int mode, int alive, int hasPark, int pr, int pc) { Dec d = mk(K_HOLD, via, mode, alive); d.hasPark = hasPark; d.pr = pr; d.pc = pc; return d; }

// THE FRAMES A WANTED RAISE STILL WAITS ON THE STOP (0: it waits on nothing
// but the rise lock)
static double raiseAfter;
static JLOCAL int raiseGate;   // the gate that decided raiseMode, for the trace
// READY FOR THE WAVE: the slab queued, placed where it rests (slabReadyHook);
// with none queued yet -- the opening, before the first wave is seen -- a slab
// the width of the board on the stack, wherever the wave lands
static int waveReady(const int32_t *st) {
  if (BIN[IN_INCOMING] > 0) return slabReadyHook(st);
  if (TFLAG(TF_SLAB)) return BIN[IN_T + 6] != 0;
  SLABW = st[O_W]; SLABH = 1; SLABC = 1;
  return slabReady(st);
}
static int raiseModeOf(const int32_t *base, int poolBreak) {
  raiseAfter = 0;
  double realIn = BIN[IN_INCOMING] - BIN[IN_PHANTOM];   // the raise reads the real queue, never the phantom first wave
  if (TFLAG(TF_RAISE)) { raiseGate = 1; return (int)BIN[IN_T + 3]; }
  int topped = BIN[IN_TOPPED] != 0;
  if (!opt(O_ALLOWRAISE) || topped) { BT->opening = 0; { raiseGate = 2; return 0; } }
  if (BIN[IN_FALLING]) { raiseGate = 3; return 0; }
  // THE LOCK THAT WILL NOT END: panels or garbage in motion hold the rise
  // (pa.c riseLock), and while garbage is still queued to drop it holds again
  // as soon as it lifts -- in a storm, nearly every frame. No raise is wanted
  // that the board cannot take: material comes from what breaks.
  if (BIN[IN_LOCKLEFT] > 0 && realIn > 0) { raiseGate = 11; return 0; }
  int rows = BIN[IN_PHANTOM] > 0 ? 0 : (int)__builtin_ceil(BIN[IN_NEXTSLAB] / BW);
  int fits = raiseSafe(base);
  // A QUEUE THAT FILLS THE ROOM KILLS A BOARD WITH NO BREAK READY, raised or
  // not: only material builds the break, and the raise costs its row -- it
  // fits while the next slab still lands under the top.
  if (!fits && realIn > 0 && !BIN[IN_TOPPED] && !BIN[IN_STACKTOPPED] && !slabReadyHook(base))
    fits = BH - tallestBoard(base) - 1 - rows - (BIN[IN_RAISING] != 0) > 0;
  BT->wantRows = rows;
  if (BT->opening && realIn > 0) BT->opening = 0;   // the opening ends with the first real garbage, not a raise refused for a moment
  if (!fits) { raiseGate = raiseShort ? 4 : 10; return 0; }
  // READY BEFORE IT RAISES: with garbage to come -- the first wave too, before
  // it is seen (waveReady) -- a raise may not cost the
  // break ready for the slab that lands -- the risen board keeps it. A board
  // with none ready loses nothing by rising, and gains the material to build one.
  // A break line being played is a break ready: the raise would move the
  // board under it.
  if (BT->nLine && BT->lineKind == LINE_BREAK) { raiseGate = 5; return 0; }
  if ((BIN[IN_INCOMING] > 0 || BT->opening) && !(risenMasks(base, RZ) && waveReady(RZ)) && waveReady(base)) { raiseGate = 6; return 0; }
  // THE OPENING RAISES WITH A BREAK READY: as high as it can, each row only
  // onto a board the first wave can land on and be broken (waveReady, the
  // phantom first wave). A board not ready is made ready first, then raised.
  if ((BT->opening || BIN[IN_PHANTOM] > 0) && !(risenMasks(base, RZ) && waveReady(RZ))) { raiseGate = 12; return 0; }
  // AS HIGH AS IT CAN: after the opening the rise is locked nearly every
  // frame (garbage in motion), so the opening's raise is the material the
  // board gets besides what breaks -- raised while the next slab still has
  // room (raiseSafe)
  int stillComing = BIN[IN_INCOMING] > 0 || BIN[IN_FALLING];
  if (poolBreak && !stillComing) { raiseGate = 8; return 0; }
  // UNDER SIX ROWS A RAISE DOES NOT WAIT ON THE STOP: a break needs panels
  // under and beside where the slab lands, and a raise is the only way to them
  // besides breaking. A short board's stop protects nothing -- it is far from
  // the top -- so the raise is pressed in it (raiseAfter 0), ending it.
  raiseAfter = 0;
  { raiseGate = 9; return BT->opening ? 1 : 2; }
}
static int raiseMode(const int32_t *base, int poolBreak) {
  int r = raiseModeOf(base, poolBreak);
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "RAISEGATE %d mode %d\n", raiseGate, r); }
#endif
  return r;
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
// READY IS THE ENGINE'S WORD: the masks say a break meets the next slab; the
// engine landing it on the board held says whether one is in reach when it
// does. Where no engine holds the board, or nothing is queued, the masks stand.
static int readyInTime(const int32_t *sw, int n, int *br, int *bc);
static int heldReady(void) {
  int r, c;
  return !BIN[IN_HASPA] || !(BIN[IN_INCOMING] > 0) || readyInTime(0, 0, &r, &c);
}
static int unreadies(const Cand *pc) {
  if (!pc || pc->kind != K_SWAP || pc->res.broke) return 0;
  if (BIN[IN_INCOMING] > 0 && landingOf(pc->masks) < baseLanding) return 1;
  if (!baseReady) return 0;
  return !slabReadyHook(pc->masks);
}
static int undoesPress(int r, int c), undoesOld(int r, int c);
// THE LINE IS SET IN ONE PLACE: every route that keeps a line to play on
// writes it here, never by hand
static void lineSet(const int32_t *sw, int n, int kind, int waitAll) {
  if (n > LINEMAX) { BT->nLine = 0; return; }   // a line cut short is half a plan: none is kept
  // A NEW LINE IS STAMPED WHEN IT IS SET with the presses made before it, so
  // a press made before it never counts as its first step (playOn); the same
  // line set again keeps its stamp, so a press made since still counts
  if (n != BT->nLine || __builtin_memcmp(BT->line, sw, (unsigned long)n * 8)) { BT->linePresses = BIN[IN_PRESSES]; BT->lineBorn = BT->nNotes; }
  for (int k = 0; k < 2 * n; k++) BT->line[k] = sw[k];
  BT->nLine = n; BT->lineKind = kind; BT->lineWaitAll = waitAll;
}
static int routeLives(const int32_t *sw, int n);
static int playable(int r, int c) {
  Cand *pc = poolSwap(r, c);
  if (!pc) return 0;
  if (unreadies(pc)) return 0;
  if (returnsToSeen(r, c) || undoesPress(r, c)) return 0;
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
  rt->frames = frames; rt->startedAt = startedAt; rt->has = rt->n > 0; rt->spend = 0; rt->blind = 0; rt->stamp = -1;
}
static void routeShift(Route *rt) {
  for (int j = 1; j < rt->n; j++) { rt->mv[2 * (j - 1)] = rt->mv[2 * j]; rt->mv[2 * (j - 1) + 1] = rt->mv[2 * j + 1]; }
  rt->n--;
}
// A ROUTE'S STEP IS MADE WHEN IT IS PRESSED, not when it is decided: the step
// followed is the route's first, stamped with the presses so far (routeFollow);
// at the next decision it comes off only if the press since was that step (routeAdvance)
static void routeFollow(Route *rt) { rt->stamp = BT->nNotes; }
static void routeAdvance(Route *rt, int *isBreak) {
  if (!rt->has || !rt->n || rt->stamp < 0 || !(BT->nNotes > rt->stamp)) return;
  if (BT->nPr && BT->prR[0] == rt->mv[0] && BT->prC[0] == rt->mv[1]) routeShift(rt);
  rt->stamp = -1;
  if (!rt->n) { rt->has = 0; if (isBreak) *isBreak = 0; }
}

static Cand *ALLOWED[MAXCAND], *TMPC[MAXCAND], *RANKED[MAXCAND], *SPARE[MAXCAND];
static void scoreTask(int i) { Cand *c = pool.cands[i]; pool.out[i] = score(c->masks, c->moveFrames, &c->res); }
// THE SCORES' SHARE: every candidate scored in a decision together get
// SCOREWORK of it (each scoreAll an even part each of what is left of it), so
// a look as deep as the time leaves the stages after it theirs
#define SCOREWORK 30000
static void scoreAll(Cand **cs, int n, double *out, int idle, const int32_t *base) {
  if (idle) { for (int i = 0; i < n; i++) out[i] = idleScore(cs[i], base); return; }
  { extern PATLS double paWork; double e = rdW0 + SCOREWORK; if (e > optLine()) e = optLine();
    scoreShare = n > 0 && e > paWork ? (e - paWork) / n : 1e-9; }   // spent: no deeper look, never a cut decision
  pool.cands = cs; pool.out = out;
  double t0 = NOWMS2();
  parRun(1, n);
  saMs += NOWMS2() - t0; saN += n;
}
typedef struct { Cand *c; double cheap; } Cheap;

static int raiseWaiting;
// the frames until a waiting raise can fire: the rise lock, or the stop it waits on
static double raiseWaitLeft(void) { return dmax(BIN[IN_LOCKLEFT], raiseAfter); }
static double dcCandMs;   // GC_WORKSTAT: the pool's share of decideRuled
// A POOL SWAP THAT BREAKS: the pool's claim asked of the engine (swapBreaks), as
// every stage asks it; a hold's claim is the board's own and stands
static int swapBreaks(Dec d);
static int poolBreaks(const Cand *pc) { return pc->res.broke && (pc->kind != K_SWAP || swapBreaks(mkSwap(pc->sr, pc->sc, V_BREAKREACH, 0, 0))); }
static Dec decideCore(void) {
  raiseWaiting = 0;
  int32_t *base = IN;
  DBASE = base;
  hereSet = 0;
  optsBuilt = 0;
  planReset(base);
  double dc0 = NOWMS2();
  candidates(base);
  dcCandMs = NOWMS2() - dc0;
  // the raise the pool offers is one that lives
  if (!raiseSafe(base))
    for (int q = 0; q < nPool; q++)
      if (POOL[q].kind == K_RAISE) { POOL[q] = POOL[--nPool]; break; }
  Line rev; memset(&rev, 0, sizeof rev);
  int haveRev = revealPick(base, &rev);
  double fpr = BIN[IN_FPR];
  int tallPool = tallestBoard(POOL[0].masks);
  double deadline = framesToDeath(tallPool, fpr);
  DDEADLINE = deadline;
  int landed = garbageRows(base);
  if (landed > BT->maxSlab) BT->maxSlab = landed;
  int poolBreak = 0;
  for (int i = 0; i < nPool; i++) if (poolBreaks(&POOL[i])) { poolBreak = 1; break; }
  int topped = BIN[IN_TOPPED] != 0;
  int readyBase = slabReadyBoard(base) && heldReady();
  int readyFirst = !poolBreak && !topped && !readyBase;   // the slab-ready record is read
  optSkip = 4 | (readyFirst ? 0 : 8);
  baseReady = BIN[IN_INCOMING] > 0 && readyBase;
  baseLanding = landingOf(base);
  double dl2 = topped ? dmax(deadline, resolveFramesOf(3, 0)) : deadline;
  int lookDepth = depthIn(dl2, topped || BIN[IN_STOP] > 0);
  lookDepthLog = lookDepth;
  int raising = raiseMode(base, poolBreak);
  // a raise waiting on the stop is not pressed: the front presses a wanted
  // raise as soon as nothing locks it, and the stop does not
  BT->wantRaise = raising != 0 && !(raiseAfter > 0);
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
        routeFollow(&BT->plan);
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
        routeSet(&BT->plan, plan.option, 0, plan.frames, stackClock); routeFollow(&BT->plan);
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
  for (int i = 0; i < nPool; i++) if (poolBreaks(&POOL[i])) { breakOnPool = 1; break; }
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
        int seen = sigEq(&s, &HERE) || undoesPress(ac->sr, ac->sc);
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
    for (int i = 0; i < na; i++) if (poolBreaks(ALLOWED[i])) TMPC[nd++] = ALLOWED[i];
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
    Ahead ahead = { 0 };
    if (!cashes) ahead = lookahead(cand->masks, horizon);
    if (ahead.stranded) { BT->counts[C_REFUSEDSTRANDED]++; continue; }
    alive++;
    if (!cashes && !failsafeIn(cand, buried)) { BT->counts[C_REFUSEDNOFAILSAFE]++; SPARE[nSpare++] = cand; continue; }
    RANKED[nRanked++] = cand;
  }

#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "READY base %d readyFirst %d incoming %g slab %d,%d,%d\n", baseReady, readyFirst, BIN[IN_INCOMING], (int)BIN[IN_SLABW], (int)BIN[IN_SLABH], (int)BIN[IN_SLABC]); }
#endif
  if (readyFirst) {
    mainOptions(base, deadline, lookDepth, digging);
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "READYFIRST found %d\n", haveRecIn(ODATA, 3) ? (int)recIn(ODATA, 3)[F_NSW] : -1); }
#endif
    if (haveRecIn(ODATA, 3)) {
      double *ready = recIn(ODATA, 3);
      int nsw = (int)ready[F_NSW];
      int32_t sw[2 * MAXD];
      for (int j = 0; j < 2 * nsw; j++) sw[j] = (int32_t)ready[F_SW + j];
      // a first step the pool does not hold is judged as the line it starts:
      // the engine plays it whole, and it is played if it lives
      if (nsw && planInTime(sw, nsw, ready[F_DURATION], base, deadline)) {
        if (poolSwap(sw[0], sw[1]) ? playable(sw[0], sw[1]) : routeLives(sw, nsw)) {
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
    if (haveRc && !(raiseAfter > 0)) {
      if (raising == 1) BT->counts[C_OPENINGRAISES]++;
      else BT->counts[C_RAISEDFORMATERIAL]++;
      return mk(K_RAISE, raising == 1 ? V_RAISE_OPENING : V_RAISE_MATERIAL, mode, alive);
    }
    // The raise cannot happen yet: wantRaise stays set so it fires when it
    // can, and the frames until the rise lock ends go to the board (raiseHold).
    BT->counts[C_WAITEDTORAISE]++;
    raiseWaiting = 1;
  }

  if (digging) {
    int haveBreak = 0;
    for (int i = 0; i < nPool; i++) if (poolBreaks(&POOL[i])) { haveBreak = 1; break; }
    // BREAK ONCE IT LANDS: the hold is for garbage in the air, landing now --
    // not for the queue, which in a storm never empties, so waiting on it
    // only grows the pile until the board tops out
    int stillComing = BIN[IN_FALLING] != 0;
    Cand *bk = 0;
    for (int i = 0; i < nPool; i++) {
      Cand *bc = &POOL[i];
      if ((bc->kind != K_SWAP && bc->kind != K_HOLD) || !poolBreaks(bc)) continue;
      if (bc->moveFrames > deadline) continue;
      if (deadly(bc->masks, &bc->res, horizonOf(bc))) continue;
      int cv = bc->res.converts, kv = bk ? bk->res.converts : -1;
      int vv = bc->res.voidAfter, kvv = bk ? bk->res.voidAfter : 0;
      if (!bk || cv > kv || (cv == kv && (vv < kvv || (vv == kvv && bc->moveFrames < bk->moveFrames)))) bk = bc;
    }
    // and only while it lands before the cursor would reach the break anyway:
    // a slab hovering over a clear is not landing, and waiting on it only
    // lets the next ones come
    if (bk && stillComing) { static ST HLL; int32_t tl; if (lineLanded(0, 0, HLL, &tl) != 0 || tl > bk->moveFrames) stillComing = 0; }
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
          routeSet(&BT->dig, reach, 0, reach[F_DURATION], stackClock); routeFollow(&BT->dig);
          BT->digIsBreak = BT->dig.has;
          BT->counts[C_BROKEREACHED]++;
          if (digLeft != INF) BT->counts[C_BROKEPREEMPT]++;
          return mkSwap(rr, rc, V_BREAKREACH, mode, alive);
        }
      }
      if (!reach && topped && nz(BIN[IN_HEALTH]) > 1 && digLeft == INF) {
        buildOptions(base, deadline, lookDepth, digging, BIN[IN_HEALTH] - 1);
        OD = ODSCR; LD = LANDSCR;
        if (optionsShared(base)) botFailed = 1;
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
          routeSet(&BT->dig, lr, 0, lr[F_DURATION], stackClock); BT->dig.spend = 1; routeFollow(&BT->dig);
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
        routeFollow(&BT->dig);
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
          routeSet(&BT->dig, dp, 0, dp[F_DURATION], stackClock); routeFollow(&BT->dig);
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
        routeFollow(&BT->attack);
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
      routeSet(&BT->attack, atk.option, 0, atk.option[F_DURATION], stackClock); routeFollow(&BT->attack);
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
      routeFollow(&BT->flatten);
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
static int routeLives(const int32_t *sw, int n);   // the engine plays a route through and it lives
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
    if (optsBuilt && (optSkipBuilt & 4) && !(haveRecIn(ODATA, 1) && recIn(ODATA, 1)[F_NSW])) {
      optSkip = optSkipBuilt & ~4; optsBuilt = 0;
      mainOptions(moBase, moDeadline, moDepth, moDigging);
    }
    if (optsBuilt) {
      if (haveRecIn(ODATA, 1) && recIn(ODATA, 1)[F_NSW]) route = recIn(ODATA, 1);
      else if (haveRecIn(ODATA, 2) && recIn(ODATA, 2)[F_NSW]) route = recIn(ODATA, 2);
    }
    if (route) {
      int r0 = (int)route[F_SW], c0 = (int)route[F_SW + 1], ok0 = 0;
      int32_t lg[2 * 128];
      int n = legal(base, lg);
      for (int i = 0; i < n; i++) if (lg[2 * i] == r0 && lg[2 * i + 1] == c0) { ok0 = 1; break; }
      if (ok0 && route[F_DURATION] <= DDEADLINE && !undoesPress(r0, c0)) {
        BT->counts[C_SAVEPLANNED]++;
        // the route is a line: kept and played on while it lives (playOn)
        int n = (int)route[F_NSW];
        if (n > LINEMAX) return d;   // a route longer than a line holds is not cut short: half a plan
        int32_t rl[2 * LINEMAX];
        for (int k = 0; k < 2 * n; k++) rl[k] = (int32_t)route[F_SW + k];
        // a route the engine cannot play, or that dies, is not started: its
        // first step pressed alone is half a plan
        if (!routeLives(rl, n)) return d;
        lineSet(rl, n, LINE_PLAN, 0);
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
static int32_t WDSW[2 * 128], WDR[R_INTS + ST_INTS];
static int breakLabel(int via) { return via == V_DIGPLAN || via == V_BREAKREACH || via == V_BREAK || via == V_LINEUP || via == V_LINEUPHOLD; }
static int breaksOnEngine(Dec d);
// A SWAP THAT ENDS IN A BREAK is one whose line breaks on the engine: a label
// is the plan's claim, and the plan's masks do not know that garbage still
// falling is not converted (getConnectedGarbagePanels takes only resting blocks).
static int endsInBreak(Dec d) { return breakLabel(d.via) && breaksOnEngine(d); }
// A SWAP HELD FOR LATER MUST STILL BE THERE LATER. A cell above one that is
// clearing falls when the clear ends — the moment a held swap is wanted.
// A CLEAR HELD IS ONE STILL THERE WHEN IT IS PRESSED. The engine holds the
// board (HASPA): the swap is pressed `at` frames from now on its copy, and
// must still match. Without it, a clear is taken to stay while nothing below
// its cells is popping.
static int32_t STO[8], STA[8];
static int steady(int r, int c, double at) {
  if (BIN[IN_HASPA]) {
    // the swap's own: more matched or converted than the board left alone
    if (paOutcome(0, 0, 0, PAHORIZON, STA) != 0 || paOutcome(r, c, (int)at, PAHORIZON, STO) != 0) return 0;
    return STO[0] > STA[0] || STO[1] > STA[1];
  }
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
static int lineLast;   // what the line rules last did (playOn below)
enum { LV_LIVES = 1, LV_PAYS = 2, LV_BREAKS = 4, LV_GAINS = 8, LV_DROPS = 16, LV_FILLS = 32 };
static int lineJudge(const int32_t *sw, int n, int waitAll);
static int routeLives(const int32_t *sw, int n) { return (lineJudge(sw, n, 0) & LV_LIVES) != 0; }
static JLOCAL int32_t LNO[LNOLEN];
// FRAMES FROM A SWAP TO THE SOONEST CLEAR ON THE BOARD IT LEAVES (INF: none):
// the shared search in time from where the swap leaves the cursor, the first
// line it takes that clears or breaks -- any length
static double clearBack(Cand *pc) {
  double at;
  int frozen = BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0;
  return searchInTime(pc->masks, pc->sr, pc->sc, 0, 0, INF, frozen, 0, 0, FAILSAFEWORK, sitFires, 0, 0, 0, &at) ? at : INF;
}
static int breakWithin(const int32_t *st, double left);
#define BREAKWORK 2500   // a break-in-reach question's share of the work
extern PATLS double paWork;
static int roomForBreak(const int32_t *st);
static Dec waitForDrain(Dec d) {
  // Topped only: before the board tops, stayAlive keeps the time.
  if (!BIN[IN_TOPPED]) return d;
  // a line played on lives by the engine's own replay, which this estimate does not override
  if (lineLast == 1) return d;
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
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr;
    fprintf(BLOG, "DRAIN k %g d kind %d via %d @%d,%d clears %d:", k, d.kind, d.via, d.sr, d.sc, nc);
    for (int i = 0; i < nc; i++) fprintf(BLOG, " %d,%d(mf %d tot %d brk %d fut %d)", CLEARS[i].sr, CLEARS[i].sc, (int)CLEARS[i].moveFrames, CLEARS[i].res.total, CLEARS[i].res.broke, CLEARS[i].future);
    fprintf(BLOG, "\n"); }
#endif
  if (!nc) return d;
  if (d.spends) return d;
  Rs *pr = picked ? &picked->res : 0;
  if (pr && pr->broke && picked->moveFrames + 1 <= k) return d;
  if (!picked && endsInBreak(d)) return d;
#define HOLDAT(r, c) mkHold(V_AWAITDRAIN, d.mode, d.alive, 1, r, c)
  if (pr && pr->total > 0 && !pr->broke && picked->moveFrames + 1 <= k) {
    if (picked->moveFrames + 2 > k || !steady(picked->sr, picked->sc, k - 2)) return d;
    // a clear that, played now, leaves a board that loses no health within the horizon is played, not held
    { int32_t sw[2] = { picked->sr, picked->sc }; if ((lineJudge(sw, 1, 0) & LV_LIVES) && LNO[0] == 0) return d; }
    // A CLEAR SETS THE STOP, IT DOES NOT ADD TO IT: played with k frames of
    // stop left, those k are lost. So a clear is held to the drain -- unless
    // the board after it has a break now or after one more move, which ends
    // the wait it would buy.
    // Nor while there is no room for a break: time is worth nothing to a
    // board that cannot take the next slab, and the clear makes the room.
    if (breakWithin(picked->masks, k) || !roomForBreak(base)) return d;
    BT->counts[C_WAITEDFORDRAIN]++;
    return HOLDAT(picked->sr, picked->sc);
  }
  double nearest = INF;
  for (int i = 0; i < nc; i++) nearest = dmin(nearest, CLEARS[i].moveFrames);
  if (picked) {
    double back = clearBack(picked);
    if (picked->moveFrames + quietSettle(base, picked->sr, picked->sc, picked->masks) + back + 1 <= k) return d;
  } else if (nearest + 2 <= k) {
    return d;
  }
  BT->counts[C_KEPTHEALTH]++;
  Clr *breakNow = 0, *clearNow = 0;
  double cnRate = 0, cnVd = 0; int cnTn = 0, cnBk = 0;
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
    double stop = stopTimeOf(isCh, isCh ? 0 : r->total, isCh ? r->chain : 0, 1);
    double rate = (f[1] + f[2] + f[3] * r->total + stop) / r->total;
    double vd = 0;
    if (cl->masks) { Shape sh; shapeOf(cl->masks, &sh); vd = sh.high - sh.mat; }
    // THE TIME BOUGHT IS FOR A BREAK: of the clears that buy it, one after
    // which a break comes within the stop it buys goes first
    int bk = cl->masks && hasGarbage(cl->masks) && paWork + BREAKWORK < optLine() && breakWithin(cl->masks, stop);
    int tn = r->total, st = cl->future || steady(cl->sr, cl->sc, dmax(cl->moveFrames, k - 2)),
        cnSt = clearNow && (clearNow->future || steady(clearNow->sr, clearNow->sc, dmax(clearNow->moveFrames, k - 2)));
    if (clearNow && st != cnSt) { if (st) { clearNow = cl; cnRate = rate; cnVd = vd; cnTn = tn; cnBk = bk; } continue; }
    if (clearNow && bk != cnBk) { if (bk) { clearNow = cl; cnRate = rate; cnVd = vd; cnTn = tn; cnBk = bk; } continue; }
    if (!clearNow || tn < cnTn || (tn == cnTn && (vd < cnVd || (vd == cnVd && rate > cnRate)))) { clearNow = cl; cnRate = rate; cnVd = vd; cnTn = tn; cnBk = bk; }
  }
  if (breakNow && !breakNow->future) return mkSwap(breakNow->sr, breakNow->sc, V_BREAK, d.mode, d.alive);
  if (breakNow) return HOLDAT(breakNow->sr, breakNow->sc);
  Clr *esc = clearNow;
  if (!esc) for (int i = 0; i < nc; i++) if (!esc || CLEARS[i].moveFrames < esc->moveFrames) esc = &CLEARS[i];
  if (esc->future || (esc->moveFrames + 2 <= k && steady(esc->sr, esc->sc, k - 2))) return HOLDAT(esc->sr, esc->sc);
  // No steady clear to hold: one that is falling apart is fired only when the
  // time is up; before that the choice stands and stayAlive judges it.
  if (esc->moveFrames + 2 <= k) return d;
  return mkSwap(esc->sr, esc->sc, V_KEEPHEALTH, d.mode, d.alive);
#undef HOLDAT
}
// ---------------------------------------------------------------- lines
// A LINE is swaps, each played on the board the one before it settles to,
// as many as the time holds. The masks find lines (fast, and with the time
// only estimated; their first REROOTS steps are replayed on the engine, the
// rest proposed from there);
// the ENGINE JUDGES them (lineOnEngine, front.c): the line played as the
// front plays it -- walk, press, the swap landing, the next walk -- on a copy
// of the board. A line LIVES if every step is taken and the board has not
// lost health until NEXTMOVE frames after its last press, the time the next
// decision needs; it PAYS if it matches more panels or converts more garbage
// than the board left alone, and BREAKS if it converts more garbage.
//
// IT MUST NOT DIE: a choice that does not live, while the time is short
// (LIVEHORIZON), is replaced by a line that lives and pays -- breaking first.
// BREAKING COMES FIRST: a line that breaks and lives is played over a choice
// that does not break. A BREAK IS KEPT IN REACH: topped, a choice that leaves
// no break in time is replaced by a living, paying line that
// keeps one. And A LINE ONCE PLAYED IS PLAYED TO ITS END: the bot keeps the
// line (BT->line) and plays its next step while the engine says it still
// lives and still pays (breaks, for a break line) -- whatever chose it.
#define REROOTS 3   // a line's first steps replayed on the engine before the masks propose the rest: precision, never reach
#define LIVEHORIZON 60
// A MATCH IS THREE: more than that cleared at once, past what the board clears alone, is a combo or a chain
#define COMBOMIN 4
#define LINEHORIZON 240
#define UNSETTLEMOST 180   // the most frames a board is followed while it settles (front.c's settle sim and the judge's busy tail)
// THE JUDGE'S REACH: it plays to LINEHORIZON, and on while the board is busy
// for up to UNSETTLEMOST more; a line that loses no health (LNO[0] 0) is
// counted as losing none within it, never as losing it at LINEHORIZON
#define LINEREACH (LINEHORIZON + UNSETTLEMOST)
#define NEXTMOVE 6
#define MAXLINES 512
#define MAXJUDGED 96
int lineOnEngine(const int32_t *steps, int n, int horizon, int waitAll, int32_t *out);
int lineState(const int32_t *steps, int n, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t);
// LIVES: no health lost before the next decision after its last step. PAYS:
// clears more than the board left alone, BREAKS: converts more. GAINS: the
// board left alone loses health within the horizon and the line loses it
// later or not at all -- the only thing a clear that breaks nothing buys.
// DROPS: more garbage at rest starts to fall than left alone. FILLS: less
// hollow under the garbage that lands than left alone (pa.c HOLLOW).

typedef struct { int n, brk, ok, grown, waitAll, hollow, conv, die; int32_t sw[2 * LINEMAX]; double est, life; int verdict; } LineC;
// A LINE'S LIFE, what survival RANKS by: the frame it loses health, less what
// its hollow costs. (The floors -- arbitrate, the kept line -- stay on the
// frame itself: no choice may lose health sooner, whatever its shape.) A
// hollow cell under what lands is stack spent on nothing -- BW of them are a
// row, and a row is FPR frames of rise -- so a line that dies a few frames
// later but leaves the next slab propped over a gap lives less.
// A LINE'S LIFE IS WHAT IT BUYS ONCE IT IS DONE: the frame it loses health
// less the frame of its last press (last; -1, none), less what it spends of
// the stack -- its hollow, and the material it ends without that the board
// left alone keeps (spent): a cell is a sixth of a row, a row FPR frames of rise
static double lifeOf(int die, int last, int hollow, int spent) { return (double)die - (double)(last > 0 ? last : 0) - (double)(hollow + (spent > 0 ? spent : 0)) * BIN[IN_FPR] / BW; }
// a thread's lines: the decision's, or a grown subtree's on a worker (growAt)
static LineC LINES_MAIN[MAXLINES];
static JLOCAL LineC *LNS = LINES_MAIN;
#define LINES LNS
static JLOCAL int nLines;
static int nJudged;
static int32_t LNA[LNOLEN];
static JLOCAL int32_t LNO[LNOLEN];
static int aloneOnEngine(void);
// THE MATERIAL A JUDGED LINE (LNO) SPENDS against the board left alone: the
// panels it ends with and the garbage it converted, less the board left alone's
static int spentOf(void) { return aloneOnEngine() ? (LNA[12] + LNA[2]) - (LNO[12] + LNO[2]) : 0; }
static int lnAlone;
static int cashes(const int32_t *r) { return r[R_TOTAL] > 0 || r[R_SCOPE] == SC_BROKE; }
static double timeLeft(void);
static int btDecision;   // counts decisions: what is cached is cached for one
static char lastStages[400];   // the last decision's stages: ms/judges each
__attribute__((visibility("default"))) const char *bot_last_stages(void) { return lastStages; }
__attribute__((visibility("default"))) int bot_decisions(void) { return btDecision; }
static int lfDecision = -1, lfDepth, lfBreaks;   // the lines linesFind last found, and for what
static void linesReset(void) { nLines = 0; nJudged = 0; lfDecision = -1; }
// The board left alone, on the engine: 0 if it cannot be played.
static int aloneOnEngine(void) {
  // the board left alone is this decision's board left alone: judged once
  if (lnAlone != btDecision + 1 && BIN[IN_HASPA] && lineOnEngine(0, 0, LINEHORIZON, 0, LNA) == 0) lnAlone = btDecision + 1;
  return lnAlone == btDecision + 1;
}
static int fillJudges, fillMargins; static double fillJudgeMs, fillMarginMs;   // GC_FILLSTAT
static int lineJudgeIn(const int32_t *sw, int n, int waitAll);
// ONE JUDGEMENT PER LINE PER DECISION: a line's verdict, and what the engine
// saw playing it (LNO), depend only on the line and this decision's board, so
// every search that asks again is answered from the first asking.
#define JMN 2048
typedef struct { int dec, n, waitAll, v; int32_t sw[2 * LINEMAX], lno[LNOLEN]; } JMemo;
static JMemo JM[JMN];
static int btDecisionJ;   // the decision the memo is for (set by bot_decide)
static unsigned jmHash(const int32_t *sw, int n, int waitAll) {
  unsigned h = 2166136261u ^ (unsigned)(n * 31 + waitAll);
  for (int k = 0; k < 2 * n; k++) h = (h ^ (unsigned)sw[k]) * 16777619u;
  return h;
}
// the memo's entry for a line: 1 found (verdict in *v, LNO in lno), 0 not
static int jmFind(const int32_t *sw, int n, int waitAll, int *v, int32_t *lno) {
  unsigned h = jmHash(sw, n, waitAll);
  for (int probe = 0; probe < 8; probe++) {
    JMemo *m = &JM[(h + (unsigned)probe) & (JMN - 1)];
    if (m->dec != btDecisionJ) return 0;
    if (m->n == n && m->waitAll == waitAll && !__builtin_memcmp(m->sw, sw, (unsigned long)n * 8)) {
      *v = m->v; for (int k = 0; k < LNOLEN; k++) lno[k] = m->lno[k];
      return 1;
    }
  }
  return 0;
}
static void jmPut(const int32_t *sw, int n, int waitAll, int v, const int32_t *lno) {
  unsigned h = jmHash(sw, n, waitAll);
  for (int probe = 0; probe < 8; probe++) {
    JMemo *m = &JM[(h + (unsigned)probe) & (JMN - 1)];
    if (m->dec == btDecisionJ && !(m->n == n && m->waitAll == waitAll && !__builtin_memcmp(m->sw, sw, (unsigned long)n * 8))) continue;
    m->dec = btDecisionJ; m->n = n; m->waitAll = waitAll; m->v = v;
    for (int k = 0; k < 2 * n; k++) m->sw[k] = sw[k];
    for (int k = 0; k < LNOLEN; k++) m->lno[k] = lno[k];
    return;
  }
}
// A JUDGE ONLY WHERE THE BUDGET HOLDS ONE: the work the decision has spent
// (from its start, rdW0) and what a judge costs (jdCost, the most one has
// taken) must fit in OPTWORK; past that the line is not judged, and a line
// not judged is no option -- the decision is never cut
static double jdCost, btCost;
static int budgetRefused;
// THE LINE OPTIONAL WORK STOPS AT: the decision's (OPTWORK from its start), or
// lower while a stage runs that must leave a later stage its share (stageEnd)
static double stageEnd = 1e300;
// bgReserve: a background batch's work, held back until it is folded in (front.c parallelBg)
static double bgReserve;
static double optLine(void) { double e = rdW0 + OPTWORK; return (stageEnd < e ? stageEnd : e) - bgReserve; }
// THE STAGES AFTER KEEP THEIRS: a stage's optional work stops where the
// stages after it keep the most they have taken lately (LATER[i]: measured
// as each decision ends, a hundredth less each decision, so one heavy
// decision does not shut a stage out for the game). stageOpen lowers where
// optional work stops for the stage, stageClose puts it back.
#define NSTAGES 9   // decideRuled, playOn/waitForDrain/raiseHold, breakFirst, stayAlive, lineup, spend, breakSoon, fillFirst, the steps after it
static double LATER[NSTAGES];
// THE CLOSING KEEPS ITS OWN: whatever the stages measured, the decision's end
// (the arbiter's judges of its candidates, the readiness asked of them) keeps
// FINALJUDGES judges' work -- measured from what they took, they would learn
// none while a stage before them took the rest, and that stage take it again
#define FINALJUDGES 6
// EVERY STAGE HAS A SHARE OF OPTWORK (percent), and the stages before it leave
// at least the shares of the stages after it: a stage that takes nothing for
// lack of work is measured at nothing, and would be left nothing again
static const int STAGESHARE[NSTAGES] = { 30, 0, 25, 5, 20, 5, 5, 5, 5 };
static double stageLeaves(int i) {
  double keep = LATER[i] > FINALJUDGES * jdCost ? LATER[i] : FINALJUDGES * jdCost;
  int after = 0; for (int j = i + 1; j < NSTAGES; j++) after += STAGESHARE[j];
  if (keep < OPTWORK * after / 100) keep = OPTWORK * after / 100;
  return rdW0 + OPTWORK - keep;
}
static double stageOpen(int i) { double keep = stageEnd, e = stageLeaves(i); if (e < stageEnd) stageEnd = e; return keep; }
static void stageClose(double keep) { stageEnd = keep; }
static void stagesMeasured(const double *ws, int k) {
  for (int i = 0; i + 1 < k && i < NSTAGES; i++) { LATER[i] *= 0.99; if (ws[k - 1] - ws[i] > LATER[i]) LATER[i] = ws[k - 1] - ws[i]; }
}
// A BATCH ONLY AS FAR AS THE BUDGET HOLDS IT: of `count` tasks costing at
// most `cost` each, the number that fit in what is left; the rest are not done
static int fitTasks(int count, double cost) {
  extern PATLS double paWork;
  double left = optLine() - paWork;
  int k = left <= 0 ? 0 : cost <= 0 ? count : (int)(left / cost);
  if (k < count) budgetRefused += count - k;
  return k < count ? k : count;
}
static double rpCost;   // a replay's (prereplay)
static JLOCAL int judgeRefused;   // the last judge was refused for the budget: no verdict, never one to keep
static int lineJudgeIn2(const int32_t *sw, int n, int waitAll) {
  extern PATLS double paWork;
  judgeRefused = 0;
  // the work this thread has left -- the decision's, or a parallel task's own share (workLeft)
  if (jdCost > workLeft()) { budgetRefused++; judgeRefused = 1; return 0; }
  double w = paWork;
  int v = lineJudgeIn(sw, n, waitAll);
  if (paWork - w > jdCost) jdCost = paWork - w;
#ifndef __wasm__
  // GC_CLOCKCHECK: the clock's frame for the line's last press beside the
  // engine's (clock.test.sh); the log does no work of its own
  static int clockCheck = -1;
  if (clockCheck < 0) clockCheck = getenv("GC_CLOCKCHECK") != 0;
  if (clockCheck && n >= 1 && LNO[1] > 0) { extern int fprintf(void *, const char *, ...); extern void *stderr;
    int frozen = BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0;
    fprintf(BLOG, "CLOCK %d %d %.0f %.0f %d\n", n, frozen, lineFrames(sw, n, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 0, frozen), pressSeen(LNO[1]), waitAll); }
#endif
  return v;
}
// THE FRAME THE JUDGED LINE (LNO) OR THE BOARD LEFT ALONE (LNA) LOSES HEALTH,
// the one read of the judge's first number: 1 << 20 when it is not within the
// horizon. Rules compare this, never LNO[0] (0 there means none).
static int lnoDie(const int32_t *a) { return a[0] ? a[0] : 1 << 20; }
// THE FRAME THE BOARD LEFT ALONE LOSES HEALTH on the engine (lnoDie of LNA;
// 1 << 20: not within the horizon), or `unknown` when the engine has no
// board to say -- what that means is the asking rule's own
static int aloneOnEngine(void);
static int aloneDie(int unknown) { return aloneOnEngine() ? lnoDie(LNA) : unknown; }
// THE FRAME A JUDGED LINE LOSES HEALTH, read the one way every rule reads it
// (1 << 20: not within the judge's reach; 0: it dies now). A verdict without
// LV_LIVES is three things: the budget refused the judge (no verdict: -1),
// the line ends where the board left alone ends (it dies when that does), or
// a step is refused or it loses health before the next move (0). Call it
// right after the judge, with judgeRefused cleared before it.
static int judgedDie(int v) {
  if (v & LV_LIVES) return lnoDie(LNO);
  if (judgeRefused) return -1;
  if (LNO[1] >= 0 && !(LNO[0] && LNO[0] <= LNO[1] + NEXTMOVE)) return lnoDie(LNO);
  return 0;
}
static int lineJudge(const int32_t *sw, int n, int waitAll) {
  if (n < 1 || n > LINEMAX) return lineJudgeIn2(sw, n, waitAll);
  unsigned h = 2166136261u ^ (unsigned)(n * 31 + waitAll);
  for (int k = 0; k < 2 * n; k++) h = (h ^ (unsigned)sw[k]) * 16777619u;
  for (int probe = 0; probe < 8; probe++) {
    JMemo *m = &JM[(h + (unsigned)probe) & (JMN - 1)];
    if (m->dec != btDecisionJ) {   // free: judge, and keep it unless the budget refused it
      double t = NOWMS2();
      int v = lineJudgeIn2(sw, n, waitAll);
      fillJudges++; fillJudgeMs += NOWMS2() - t;
      extern int paBudgetOut(void);
      if (!paBudgetOut() && !judgeRefused) {
        m->dec = btDecisionJ; m->n = n; m->waitAll = waitAll; m->v = v;
        for (int k = 0; k < 2 * n; k++) m->sw[k] = sw[k];
        for (int k = 0; k < LNOLEN; k++) m->lno[k] = LNO[k];
      }
      return v;
    }
    if (m->n == n && m->waitAll == waitAll && !__builtin_memcmp(m->sw, sw, (unsigned long)n * 8)) {
      for (int k = 0; k < LNOLEN; k++) LNO[k] = m->lno[k];
      return m->v;
    }
  }
  double t = NOWMS2();
  int v = lineJudgeIn2(sw, n, waitAll);
  fillJudges++; fillJudgeMs += NOWMS2() - t;
  return v;
}
static int lineJudgeIn(const int32_t *sw, int n, int waitAll) {
  if (!BIN[IN_HASPA]) return 0;
  if (!aloneOnEngine()) return 0;
  if (lineOnEngine(sw, n, LINEHORIZON, waitAll, LNO) != 0 || LNO[1] < 0) return 0;
  if (LNO[0] && LNO[0] <= LNO[1] + NEXTMOVE) return 0;
  // a line that ends on the board the board left alone ends on has done nothing
  if (LNO[0] == LNA[0] && LNO[11] == LNA[11]) return 0;
  int v = LV_LIVES;
  if (LNO[2] > LNA[2]) v |= LV_PAYS | LV_BREAKS;
  else if (LNO[3] > LNA[3]) v |= LV_PAYS;
  if (LNA[0] && (!LNO[0] || LNO[0] > LNA[0])) v |= LV_GAINS;
  if (LNO[9] > LNA[9]) v |= LV_DROPS;
  if (HOLLOW(LNO) < HOLLOW(LNA)) v |= LV_FILLS;
  return v;
}
// THE NEXT LINES BY RANK, JUDGED TOGETHER: before a line is judged, it and
// the unjudged lines ranked after it (not skipped) are judged at once, in
// parallel natively, into the decision's memo judged() reads.
#define AHEAD 8
static void prejudgeLinesW(LineC *const *ls, int count, int waitAll);
static void prejudgeLines(LineC *const *ls, int count) { prejudgeLinesW(ls, count, 0); }
static int lineBefore(const LineC *a, const LineC *b);
static void judgeAhead(LineC *first, const unsigned char *skip, int useOk) {
  if (first->verdict >= 0 || nJudged >= MAXJUDGED) return;
  LineC *sel[AHEAD]; int ns = 0, cap = MAXJUDGED - nJudged < AHEAD ? MAXJUDGED - nJudged : AHEAD;
  sel[ns++] = first;
  while (ns < cap) {
    LineC *nx = 0;
    for (int i = 0; i < nLines; i++) {
      LineC *l = &LINES[i];
      if (l->verdict >= 0 || (skip && skip[i]) || (useOk && !l->ok)) continue;
      int in = 0;
      for (int j = 0; j < ns && !in; j++) in = sel[j] == l;
      if (in) continue;
      if (!nx || lineBefore(l, nx)) nx = l;
    }
    if (!nx) break;
    sel[ns++] = nx;
  }
  prejudgeLines(sel, ns);
  // and the second judgement judged() makes of a break that pays but does not break: pressed once the board settles
  LineC *wsel[AHEAD]; int nw = 0;
  for (int j = 0; j < ns; j++) {
    int v; int32_t lno[LNOLEN];
    if (sel[j]->brk && jmFind(sel[j]->sw, sel[j]->n, 0, &v, lno) && (v & LV_PAYS) && !(v & LV_BREAKS)) wsel[nw++] = sel[j];
  }
  if (nw) prejudgeLinesW(wsel, nw, 1);
}
static int judged(LineC *l) {
  if (l->verdict < 0) {
    l->verdict = nJudged < MAXJUDGED ? lineJudge(l->sw, l->n, 0) : 0; nJudged++;
    l->hollow = l->verdict ? HOLLOW(LNO) : 1 << 20;
    l->conv = l->verdict ? LNO[2] - LNA[2] : 0;
    l->die = l->verdict ? lnoDie(LNO) : 0;   // the frame it loses health (1 << 20: not within the horizon)
    l->life = l->verdict ? lifeOf(l->die, LNO[1], l->hollow, spentOf()) : 0;
    // A BREAK PRESSED ONCE THE BOARD HAS SETTLED: a break needs garbage at
    // rest beside the match, and a press made while the slab still lands
    // matches beside it in vain. The last press then waits for the garbage to land (breakWait).
    if (l->brk && (l->verdict & LV_PAYS) && !(l->verdict & LV_BREAKS) && nJudged < MAXJUDGED) {
      int v = lineJudge(l->sw, l->n, 1); nJudged++;
      if (v & LV_BREAKS) { l->verdict = v; l->waitAll = 1; l->hollow = HOLLOW(LNO); l->conv = LNO[2] - LNA[2]; l->die = lnoDie(LNO); l->life = lifeOf(l->die, LNO[1], l->hollow, spentOf()); }
    }
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr;
      fprintf(BLOG, "JUDGE n%d %d,%d", l->n, l->sw[0], l->sw[1]);
      if (l->n > 1) fprintf(BLOG, " %d,%d", l->sw[2], l->sw[3]);
      if (l->n > 2) fprintf(BLOG, " %d,%d", l->sw[4], l->sw[5]);
      fprintf(BLOG, " brk %d est %g -> v%d | drain %d last %d conv %d/%d match %d/%d k %g refused step %d at %d inc %d->%d\n", l->brk, l->est, l->verdict, LNO[0], LNO[1], LNO[2], LNA[2], LNO[3], LNA[3], timeLeft(), LNO[5], LNO[6], (int)BIN[IN_INCOMING] / 4, LNO[7]); }
#endif
  }
  return l->verdict;
}
// The line a decision's swap belongs to, played on the engine: the swap and
// what its plan or kept line has left; a press made while the slab lands is
// tried again with its last press waiting for every block.
static int breaksOnEngine(Dec d) {
  if (d.kind != K_SWAP || !d.hasMove || !BIN[IN_HASPA]) return 0;
  int32_t ln[2 * LINEMAX]; int n = 0;
  if (BT->nLine && BT->line[0] == d.sr && BT->line[1] == d.sc) {
    for (int k = 0; k < 2 * BT->nLine && n < LINEMAX; k += 2) { ln[2 * n] = BT->line[k]; ln[2 * n + 1] = BT->line[k + 1]; n++; }
  } else {
    ln[0] = d.sr; ln[1] = d.sc; n = 1;
    if (d.via == V_DIGPLAN && BT->dig.has) {
      if (1 + BT->dig.n > LINEMAX) return 0;   // judged whole or not at all
      for (int k = 0; k < BT->dig.n; k++) { ln[2 * n] = BT->dig.mv[2 * k]; ln[2 * n + 1] = BT->dig.mv[2 * k + 1]; n++; }
    }
  }
  int v = lineJudge(ln, n, 0);
  if ((v & LV_PAYS) && !(v & LV_BREAKS)) v = lineJudge(ln, n, 1);
  return (v & LV_BREAKS) != 0;
}
// A SWAP THAT BREAKS, the one answer: on the engine, as the line it belongs to
// is judged (breaksOnEngine: the decision's horizon, the whole line, pressed
// when the clock says). The pool's own claim (res.broke) is the one swap
// pressed at its travel time over a longer horizon -- a cascade many frames on
// counts -- and a stage that skips its own work on that claim never looks for
// the break. With no engine the pool's claim stands.
static int swapBreaks(Dec d) {
  if (d.kind != K_SWAP || !d.hasMove) return 0;
  if (BIN[IN_HASPA]) return breaksOnEngine(d);
  Cand *pc = poolSwap(d.sr, d.sc);
  return pc && pc->res.broke;
}
// THE LINES' SETTINGS (linesFrom): topped, breaks only, the engine's board
static JLOCAL int lsTopped, lsBreaks;
static JLOCAL uint8_t (*ENGINE_WAITS)[WMAX];   // a grown board's pairs: the frame each settles
static JLOCAL Rs lsAlone;
// lines grown on the engine: the steps already played (pfx) and the frames they took
static JLOCAL int32_t pfx[2 * REROOTS]; static JLOCAL int nPfx; static JLOCAL double pfxT;
// A STEP NEVER TARGETS PANELS STILL MOVING: the cells a swap disturbs -- the
// pair, what falls, what clears -- are unsettled until it settles, and a next
// step that touches one before then is not a step the engine will take.
static void disturbed(const int32_t *a, const int32_t *b, uint32_t *out) {
  for (int c = 0; c < WMAX; c++) {
    uint32_t m = (U(a, OCC + c) ^ U(b, OCC + c)) | (U(a, GARB + c) ^ U(b, GARB + c));
    for (int k = 1; k < NCOL; k++) m |= CL(a, k, c) ^ CL(b, k, c);
    out[c] = m;
  }
}
// ---------------------------------------------------------------- the search in time
// THE SEARCH IN TIME, every search's that grows lines: on the masks, the
// soonest line first -- lines are taken from a heap by the frame their last
// press comes on the clock (stepGap, stepPress; a pair the step before
// disturbed is pressed once it is still), and `accept` is asked of each as it
// is taken, so the first it takes is the soonest there is; a board reached
// again by a later line is that line's no more. A step is kept only while it
// is pressed by `left`, and none is pressed before `notBefore` (a break waits
// for the garbage to rest). Nothing is cut by a count of swaps: the search
// ends when `accept` takes a line, when nothing left can be pressed in time,
// or when its work (`work`, paWork's units) is spent.
// A STEP IS PLAYED WHEN IT IS TAKEN, never when it is offered: growing a line
// offers each step with only the frame it is pressed on (which needs no
// board), and a step's board is resolved when the heap gives it up -- so the
// work goes to the lines asked, not to the many offered and never reached.
// LINEMAX, SITCAP (lines played) and SITKIDS (steps offered) are only how
// much a line and the heap hold.
#define SITCAP 1024
#define SITKIDS 32768
// WHAT THE SEARCH'S OWN BOOKKEEPING COSTS, as work: each step taken off the
// heap (its board copied out, played, hashed) and each line kept (its board
// copied in, its disturbed cells and settle found). Calibrated on drill seed 4 so the
// search's milliseconds per work match the rest of the decision's (GC_WORKSTAT
// CAL): uncounted, it ran 0.178 ms/kwork against the rest's 0.146; at 1 and
// 1, 0.121-0.136 against 0.138. Each step offered (its press frame found and
// heaped) is SITOFFERWORK: on combo_storm seed 9 uncounted, breakFirst ran
// 0.202 ms/kwork and the whole decision 0.147, against 0.146 and 0.128 before
// steps were played when taken; at 0.1, 0.144 and 0.125.
// TAKEN, A STEP IS PLAYED (swapped in, resolved, hashed, sorted off the
// heap): callgrind over drill seed 4's first 3,000 frames counted 4,466,270
// steps taken, 1,809,026 lines kept and 39,664,141 steps offered; the
// search's own instructions beyond the resolve (19.32e9) at the decisions'
// mean of 1,196 instructions a unit leave 3.2 a step taken once a line kept
// has its 1.
#define SITPOPWORK 3.2
#define SITOFFERWORK 0.1
// LISTING A LINE'S LEGAL STEPS (legal, once per line kept, before its steps
// are offered): 2,179 instructions a listing over 1,187,942 listings
// (callgrind, drill seed 4, 3,000 frames), at the decisions' mean of 1,134
// instructions a unit there (26.58e9 over 23.43e6 units)
#define SITLEGALWORK 1.9
#define SITNODEWORK 1
#define SITHASH 2048
typedef struct { int parent, n, r, c, stopped; double t, settled, left; uint32_t dist[WMAX]; int32_t rh[R_INTS]; } SitNode;   // stopped: a step before cleared, so the board is stopped; rh: the step's resolve record
typedef struct { int parent, r, c; double t; } SitKid;   // a step offered: the line it grows (a SitNode) and when it is pressed
typedef struct { double t; int k; } SitHeap;   // the heap holds each step's press frame beside it, so it sorts without reading the steps
// THE BOUND, LOWERED AS IT GOES: an accept that only wants something sooner
// than what it has (the soonest break) lowers it, and the search prunes to it
static JLOCAL double sitLeft;

// A SEARCH INSIDE A SEARCH: an accept may ask a question that searches again
// (is this board ready?), so each level of nesting has its own memory, the
// current level's set in place on entry and the caller's put back on exit
#define SITLEVELS 4
typedef struct { ST *st; SitNode *nd; SitKid *kd; SitHeap *hp; u64 *hk; uint32_t *hg, gen; int32_t *t, *r, *l; double left; } SitMem;
static JLOCAL SitMem SITM[SITLEVELS];
static JLOCAL int sitLevel;
static JLOCAL ST *SITST; static JLOCAL SitNode *SITND; static JLOCAL SitKid *SITKD; static JLOCAL SitHeap *SITHP; static JLOCAL u64 *SITHK;
// A BOARD SEEN IS STAMPED WITH ITS SEARCH: an entry another search wrote reads
// as empty, so a search starts without clearing the table
static JLOCAL uint32_t *SITHG, SITGEN;
static JLOCAL int32_t *SITT, *SITR, *SITL;

static int sitLine(int i, int32_t *sw) {
  int n = SITND[i].n;
  for (int j = i; SITND[j].n > 0; j = SITND[j].parent) { sw[2 * (SITND[j].n - 1)] = SITND[j].r; sw[2 * (SITND[j].n - 1) + 1] = SITND[j].c; }
  return n;
}
static void sitPush(int *nh, int i) {   // the heap of steps offered: the soonest press on top
  int k = (*nh)++;
  double t = SITKD[i].t;
  while (k > 0) { int p = (k - 1) / 2; if (SITHP[p].t <= t) break; SITHP[k] = SITHP[p]; k = p; }
  SITHP[k].t = t; SITHP[k].k = i;
}
static int sitPop(int *nh) {
  int top = SITHP[0].k; SitHeap last = SITHP[--(*nh)]; int k = 0;
  for (;;) {
    int a = 2 * k + 1, b = a + 1, m = k;
    double tm = last.t;
    if (a < *nh && SITHP[a].t < tm) { m = a; tm = SITHP[a].t; }
    if (b < *nh && SITHP[b].t < tm) m = b;
    if (m == k) break;
    SITHP[k] = SITHP[m]; k = m;
  }
  if (*nh > 0) SITHP[k] = last;
  return top;
}
static int sitSeen(u64 h) {   // 1 if the board was grown already; else noted
  unsigned k = (unsigned)(h ^ (h >> 31)) & (SITHASH - 1);
  for (int probe = 0; probe < SITHASH; probe++, k = (k + 1) & (SITHASH - 1)) {
    if (SITHG[k] != SITGEN) { SITHK[k] = h ? h : 1; SITHG[k] = SITGEN; return 0; }
    if (SITHK[k] == h) return 1;
  }
  return 1;
}
static void disturbed(const int32_t *a, const int32_t *b, uint32_t *out);
static int sitRun(const int32_t *st0, int cr, int cc, double t0, double notBefore, double left, int frozen,
                  const uint32_t *can0, uint8_t (*wait0)[WMAX], double work, SitAccept accept, void *ctx,
                  int32_t *sw, int *nOut, double *atOut);
static JLOCAL int inWorker;   // a parallelDo task: shared caches are read, never written
static JLOCAL double taskEnd;   // a parallelDo task: where its share of the decision's work ends (front.c pjShareOf)
// THE WORK THIS THREAD HAS LEFT before optional work stops: the decision's
// (optLine), or a parallel task's own share (taskEnd). Every search and every
// replay that is optional stops at it, or the decision is cut.
static double workLeft(void) {
  extern PATLS double paWork;
  double e = inWorker ? taskEnd : optLine();
  if (scoreEnd > 0 && scoreEnd < e) e = scoreEnd;
  return e - paWork;
}
// a nesting level's memory, made the first time it is asked for (0: none to be had)
static SitMem *sitMem(int level) {
  SitMem *m = &SITM[level];
  if (!m->st) {
    m->st = grab(sizeof(ST) * SITCAP); m->nd = grab(sizeof(SitNode) * SITCAP); m->kd = grab(sizeof(SitKid) * SITKIDS); m->hp = grab(sizeof(SitHeap) * SITKIDS); m->hk = grab(sizeof(u64) * SITHASH); m->hg = grab(sizeof(uint32_t) * SITHASH);
    m->t = grab(sizeof(ST)); m->r = grab(sizeof(int32_t) * (R_INTS + ST_INTS)); m->l = grab(sizeof(int32_t) * 2 * 128);
    if (!m->st || !m->nd || !m->kd || !m->hp || !m->hk || !m->hg || !m->t || !m->r || !m->l) { m->st = 0; return 0; }
  }
  return m;
}
// EVERY LEVEL'S MEMORY TOUCHED BEFORE THE GAME (front.c frontWarm, on every
// thread): a page first touched mid-decision faults in on the decision's time
static void sitWarm(void) {
  for (int level = 0; level < SITLEVELS; level++) {
    SitMem *m = sitMem(level);
    if (!m) return;
    __builtin_memset(m->st, 0, sizeof(ST) * SITCAP); __builtin_memset(m->nd, 0, sizeof(SitNode) * SITCAP);
    __builtin_memset(m->kd, 0, sizeof(SitKid) * SITKIDS); __builtin_memset(m->hp, 0, sizeof(SitHeap) * SITKIDS); __builtin_memset(m->hk, 0, sizeof(u64) * SITHASH); __builtin_memset(m->hg, 0, sizeof(uint32_t) * SITHASH);
  }
}
static int searchInTime(const int32_t *st0, int cr, int cc, double t0, double notBefore, double left, int frozen,
                        const uint32_t *can0, uint8_t (*wait0)[WMAX], double work, SitAccept accept, void *ctx,
                        int32_t *sw, int *nOut, double *atOut) {
  if (sitLevel >= SITLEVELS) return 0;   // nested past its memory: no answer, never a corrupted one
#ifndef __wasm__
  // GC_WORKSTAT: the search's milliseconds per work, beside the decision's (WORK lines) -- SITPOPWORK's calibration
  static int calOn = -1; if (calOn < 0) calOn = 0;
  static double calMs, calW; static int calN; double cal0 = calOn ? NOWMS2() : 0; extern PATLS double paWork; double calw0 = paWork; int calTop = calOn && sitLevel == 0;
#endif
  // EVERY SEARCH INSIDE THE DECISION'S BUDGET: its share, never past where
  // optional work stops (optLine; a parallel task's own share, taskEnd) -- a
  // search that ran on would cut the decision
  { double room = workLeft(); if (work > room) work = room; }
  if (!(work > 0)) return 0;
  SitMem *m = sitMem(sitLevel);
  if (!m) return 0;
  // the caller's level, kept to be put back
  ST *pst = SITST; SitNode *pnd = SITND; SitKid *pkd = SITKD; SitHeap *php = SITHP; u64 *phk = SITHK; uint32_t *phg = SITHG, pgen = SITGEN; int32_t *pt = SITT, *pr = SITR, *pl = SITL; double pleft = sitLeft;
  SITST = m->st; SITND = m->nd; SITKD = m->kd; SITHP = m->hp; SITHK = m->hk; SITT = m->t; SITR = m->r; SITL = m->l;
  if (++m->gen == 0) { __builtin_memset(m->hg, 0, sizeof(uint32_t) * SITHASH); m->gen = 1; }
  SITHG = m->hg; SITGEN = m->gen;
  sitLevel++;
  int got = sitRun(st0, cr, cc, t0, notBefore, left, frozen, can0, wait0, work, accept, ctx, sw, nOut, atOut);
  sitLevel--;
#ifndef __wasm__
  if (calTop && !inWorker) { calMs += NOWMS2() - cal0; calW += paWork - calw0; if (++calN % 20000 == 0) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "CAL sit %.3f ms/kwork over %.0f kwork\n", calMs / (calW / 1000), calW / 1000); } }
#endif
  SITST = pst; SITND = pnd; SITKD = pkd; SITHP = php; SITHK = phk; SITHG = phg; SITGEN = pgen; SITT = pt; SITR = pr; SITL = pl; sitLeft = pleft;
  return got;
}
// a kept line's steps offered: each legal pair, pressed when the clock says
// (from the line's last press and cursor; a pair the line disturbed once it is
// still), kept only if pressed in time
static void sitOffer(int i, int *nk, int *nh, double notBefore, int frozen, const uint32_t *can0, uint8_t (*wait0)[WMAX]) {
  extern PATLS double paWork;
  SitNode *nd = &SITND[i];
  int root = nd->n == 0;
  double start = root ? nd->t : nd->t + stepGap(frozen || nd->stopped);   // a clear's stop time: no reaction to wait out
  double bound = nd->left < sitLeft ? nd->left : sitLeft;
  int m = legal(SITST[i], SITL);
  paWork += SITLEGALWORK;
  for (int q = 0; q < m && *nk < SITKIDS; q++) {
    int r = SITL[2 * q], c = SITL[2 * q + 1];
    if (r > 31) continue;
    uint32_t bit = 1u << (r - 1);
    if (root && can0 && !(can0[c] & bit)) continue;
    double ready = notBefore;
    if (root && wait0 && nd->t + wait0[r][c] > ready) ready = nd->t + wait0[r][c];
    if (!root && ((nd->dist[c] | nd->dist[c + 1]) & bit) && nd->settled > ready) ready = nd->settled;
    double at = stepPress(start, nd->r, nd->c, r, c, ready);
    if (at > bound) continue;
    int k = (*nk)++;
    paWork += SITOFFERWORK;
    SITKD[k].parent = i; SITKD[k].r = r; SITKD[k].c = c; SITKD[k].t = at;
    sitPush(nh, k);
  }
}
static int sitRun(const int32_t *st0, int cr, int cc, double t0, double notBefore, double left, int frozen,
                  const uint32_t *can0, uint8_t (*wait0)[WMAX], double work, SitAccept accept, void *ctx,
                  int32_t *sw, int *nOut, double *atOut) {
  extern PATLS double paWork;
  double w0 = paWork;
  stcpy(SITST[0], st0);
  SITND[0].parent = -1; SITND[0].n = 0; SITND[0].r = cr; SITND[0].c = cc; SITND[0].t = t0; SITND[0].settled = 0; SITND[0].left = left; SITND[0].stopped = 0;
  sitLeft = INF;   // lowered only by a break found (time mode); each line keeps its own time (left)
  for (int c = 0; c < WMAX; c++) SITND[0].dist[c] = 0;
  sitSeen(hashOf(SITST[0]));
  int nn = 1, nk = 0, nh = 0;
  sitOffer(0, &nk, &nh, notBefore, frozen, can0, wait0);
  int32_t line[2 * LINEMAX];
  while (nh > 0 && paWork - w0 < work) {
    SitKid kd = SITKD[sitPop(&nh)];
    paWork += SITPOPWORK;
    if (kd.t > sitLeft) continue;   // past a bound lowered since it was offered
    SitNode *pa = &SITND[kd.parent];
    // the step played on its line's board
    stcpy(SITT, SITST[kd.parent]);
    if (!swapIn(SITT, kd.r, kd.c)) continue;
    resolve(SITT, SITR, 1);
    int scope = SITR[R_SCOPE];
    if (scope != SC_OK && scope != SC_BROKE) continue;
    // the soonest line to reach its board is the one asked; a later one is no
    // more. A break leaves no board (resolve writes none for it: what it
    // converts is unseen) and ends its line, so it is never a repeat.
    if (scope != SC_BROKE && sitSeen(hashOf(SITR + R_INTS))) continue;
    int n = pa->n + 1;
    sitLine(kd.parent, line);
    line[2 * (n - 1)] = kd.r; line[2 * (n - 1) + 1] = kd.c;
    // kept before it is asked (the ask may use the resolve's buffer): a break
    // ends a line (what it converts is unseen), and the storage ends it too
    int j = scope != SC_BROKE && n < LINEMAX && nn < SITCAP ? nn++ : -1;
    if (j >= 0) {
      paWork += SITNODEWORK;
      stcpy(SITST[j], SITR + R_INTS);
      for (int k = 0; k < R_INTS; k++) SITND[j].rh[k] = SITR[k];
      SITND[j].parent = kd.parent; SITND[j].n = n; SITND[j].r = kd.r; SITND[j].c = kd.c; SITND[j].t = kd.t;
      SITND[j].stopped = pa->stopped || SITR[R_TOTAL] > 0;
      SITND[j].settled = kd.t + (SITR[R_TOTAL] > 0 ? SITR[R_FRAMES] : quietSettle(SITST[kd.parent], kd.r, kd.c, SITR + R_INTS));
      // A LINE'S OWN CLEARS MOVE THE TIME THERE IS: topped, a clear holds the
      // board while it settles; and a clear that lowers the stack moves its
      // loss of health later -- the break looked for while it resolves
      SITND[j].left = frozen && SITND[j].settled - 2 > pa->left ? SITND[j].settled - 2 : pa->left;
      if (SITR[R_TOTAL] > 0) { double own = framesToDeath(tallestBoard(SITST[j]), BIN[IN_FPR]); if (own > SITND[j].left) SITND[j].left = own; }
      disturbed(SITST[kd.parent], SITR + R_INTS, SITND[j].dist);
    }
    int say = accept(SITR, line, n, kd.t, ctx);
    if (say == SIT_TAKE) {
      if (sw) for (int k = 0; k < 2 * n; k++) sw[k] = line[k];
      if (nOut) *nOut = n;
      if (atOut) *atOut = kd.t;
      return 1;
    }
    if (say == SIT_END || j < 0) continue;
    sitOffer(j, &nk, &nh, notBefore, frozen, 0, 0);
  }
  return 0;
}
// the line wanted: one that breaks
static int sitBreaks(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) { (void)sw; (void)n; (void)at; (void)ctx; return res[R_SCOPE] == SC_BROKE ? SIT_TAKE : SIT_GROW; }
// A BREAK IN TIME, ON THE MASKS: a break -- any length -- pressed before the
// board loses health (framesToDeath), walked from the cursor: soonest first,
// with a small share of work, since it is asked of every option and
// candidate (bit.c anyBreakOf, and through it slabReady's slab placed where it rests)
#define BREAKOFWORK 240
static int inTimeOfWork(const int32_t *st, SitAccept want, double work) {
  return searchInTime(st, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 0, 0, framesToDeath(tallestBoard(st), BIN[IN_FPR]),
                      BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0, 0, 0, work, want, 0, 0, 0, 0);
}
static int inTimeOf(const int32_t *st, SitAccept want) { return inTimeOfWork(st, want, BREAKOFWORK); }
static int breakInTimeOf(const int32_t *st) { return inTimeOf(st, sitBreaks); }
// A CLEAR IN TIME (fire ready): the same, a clear or a break
static int sitFires(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) { (void)sw; (void)n; (void)at; (void)ctx; return res[R_TOTAL] > 0 || res[R_SCOPE] == SC_BROKE ? SIT_TAKE : SIT_GROW; }
static int fireInTimeOf(const int32_t *st) { return inTimeOf(st, sitFires); }
// WHAT A BOARD OFFERS IN TIME, in one search: its breaks (the distinct boards
// they leave) and the most a clear pays (priceOf), among the lines pressed
// before the board loses health. The same search, work and order as inTimeOf,
// so a break or a clear is found here exactly when inTimeOf finds one.
static int sitOffers(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  Offers *o = ctx; (void)sw; (void)n; (void)at;
  if (res[R_SCOPE] == SC_BROKE) {
    u64 h = hashOf(res + R_INTS); int k = 0;
    while (k < o->nb && o->seen[k] != h) k++;
    if (k == o->nb && o->nb < OFFERSEEN) o->seen[o->nb++] = h;
    o->fire = 1;
  }
  if (res[R_TOTAL] > 0) {
    double p = priceOf(res[R_CHAIN], res[R_TOTAL]);
    if (p == p && p > o->pay) o->pay = p;
    o->fire = 1;
  }
  return SIT_GROW;
}
static void offersOf(const int32_t *st, Offers *o) {
  o->nb = 0; o->fire = 0; o->pay = 0;
  searchInTime(st, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 0, 0, framesToDeath(tallestBoard(st), BIN[IN_FPR]),
               BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0, 0, 0, BREAKOFWORK, sitOffers, o, 0, 0, 0);
}
// what that answer depends on: the board, the cursor, the stop and topping
static u64 breakKey(const int32_t *st) {
  u64 m = ((u64)BIN[IN_CROW] << 40) ^ ((u64)BIN[IN_CCOL] << 32) ^ ((u64)(BIN[IN_STOP] > 0 ? BIN[IN_STOP] : 0) << 8) ^ (u64)(BIN[IN_TOPPED] != 0);
  return (hashOf(st) ^ (m * 0x9E3779B97F4A7C15ull)) | 1;
}
// THE TIME A LINE LEAVES: the frame the board loses health after it (the
// engine's judgement), else -- the board left alone -- its own, else the
// judge's reach; `last`: the frame its last step is pressed (0: no steps)
static double lineEnds(const int32_t *sw, int n, int *last) {
  *last = 0;
  if (!n) return aloneOnEngine() && LNA[0] ? LNA[0] : LINEREACH;
  int32_t keep[LNOLEN]; for (int q = 0; q < LNOLEN; q++) keep[q] = LNO[q];
  lineJudge(sw, n, 0);
  double die = LNO[0] ? LNO[0] : LINEREACH;
  *last = LNO[1] > 0 ? pressSeen(LNO[1]) : 0;
  for (int q = 0; q < LNOLEN; q++) LNO[q] = keep[q];
  return die;
}
// time mode: the searches only note the soonest break (tTimeMin), proposing nothing
static JLOCAL int tTimeMode; static JLOCAL double tTimeMin;
// OUT FROM THE CURSOR, every search alike: swaps (r, c pairs `stride` ints
// apart) in order of the moves from (cr, cc), at the same distance up, right,
// left, down; far[] the moves of each in that order. GC_NOORDER keeps the
// order given, to check the order never changes an answer.
static int nfNoOrder = -1;
static void nearestFirst(const int32_t *sw, int stride, int n, int cr, int cc, int *ord, double *far) {
#ifndef __wasm__
  if (nfNoOrder < 0) nfNoOrder = getenv("GC_NOORDER") != 0;
#else
  nfNoOrder = 0;
#endif
  // one integer each: the moves, the direction, the index -- sorted as integers
  uint32_t key[256];
  for (int k = 0; k < n; k++) {
    int r = sw[stride * k], c = sw[stride * k + 1];
    uint32_t t = (uint32_t)travelCost(cr, cc, r, c);
    uint32_t dr = r > cr ? 0 : c > cc ? 1 : c < cc ? 2 : 3;
    uint32_t x = nfNoOrder ? (uint32_t)k : (t << 10) | (dr << 8) | (uint32_t)k;
    int j = k;
    while (j > 0 && key[j - 1] > x) { key[j] = key[j - 1]; j--; }
    key[j] = x;
  }
  for (int k = 0; k < n; k++) {
    int i = (int)(key[k] & 0xff);
    ord[k] = i; far[k] = travelCost(cr, cc, sw[stride * i], sw[stride * i + 1]);
  }
}
// ONE SEARCH, EVERY SEARCH. The candidates are walked out from the cursor
// (outBegin / outNext, in nearestFirst's order); the best is kept by one
// order -- the higher score, then the sooner time, then the swaps
// (bestTake); and the walk ends once nothing at this distance or beyond can
// win (outPast: a candidate is never sooner than the walk to it, and no
// better than `most`). Each search says only how it scores.
typedef struct { int ord[256]; double far[256]; int n, k, bounded; } Out;
// `bounded`: the walk may stop on distance, so it is worth ordering; a walk
// that visits every candidate whatever their distance takes them as they come
// (the answer never depends on the order: every tie is broken by the swaps)
static void outBeginB(Out *o, const int32_t *sw, int stride, int n, int cr, int cc, int bounded) {
  if (n > 256) n = 256;
  if (bounded) nearestFirst(sw, stride, n, cr, cc, o->ord, o->far);
  else for (int k = 0; k < n; k++) { o->ord[k] = k; o->far[k] = travelCost(cr, cc, sw[stride * k], sw[stride * k + 1]); }
  o->bounded = bounded; o->n = n; o->k = 0;
}
static void outBegin(Out *o, const int32_t *sw, int stride, int n, int cr, int cc) { outBeginB(o, sw, stride, n, cr, cc, 1); }
static int outNext(Out *o, int *i, double *far) {
  if (o->k >= o->n) return 0;
  *i = o->ord[o->k]; *far = o->far[o->k]; o->k++;
  return 1;
}
typedef struct { int has, n; double score, t; int32_t sw[2 * LINEMAX]; } Best;
static int swapsBeforeN(const int32_t *a, int na, const int32_t *b, int nb) {
  for (int k = 0; k < 2 * na && k < 2 * nb; k++) if (a[k] != b[k]) return a[k] < b[k];
  return na < nb;
}
// would (score, t, sw) win over the best kept
static int bestBeats(const Best *b, double score, double t, const int32_t *sw, int n) {
  if (!b->has) return 1;
  if (score != b->score) return score > b->score;
  if (t != b->t) return t < b->t;
  return swapsBeforeN(sw, n, b->sw, b->n);
}
static int bestTake(Best *b, double score, double t, const int32_t *sw, int n) {
  if (!bestBeats(b, score, t, sw, n)) return 0;
  b->has = 1; b->score = score; b->t = t; b->n = n;
  for (int k = 0; k < 2 * n; k++) b->sw[k] = sw[k];
  return 1;
}
// nothing arriving at `t` or later, scoring at most `most`, can win
static int outPast(const Best *b, double most, double t) {
  if (nfNoOrder || !b->has) return 0;
  return most < b->score || (most == b->score && t > b->t);
}
static double timeLeft(void) { return BIN[IN_TOPPED] ? BIN[IN_DRAINBOUND] : DDEADLINE; }
// LINES GROWN ON THE ENGINE. The masks propose lines from the board as it
// is; each proposed first step is then played on the engine up to the frame
// the front would decide again (lineState), and the rest of the line is
// chosen on that board -- the real one, with only the pairs the engine would
// take there and whose panels have settled. A later step never targets a
// panel the masks only guessed was still.
#define GROWCAP 8
static int lineBefore(const LineC *a, const LineC *b);
// THE LINES, IN TIME: every line whose last swap clears or breaks (only
// breaks when lsBreaks), found soonest first by the shared search
// (searchInTime) and kept in LINES -- a first step counted by what it adds to
// what the board does alone (it is pressed on the board as it is, moving);
// in tTimeMode only the soonest break is noted (tTimeMin), the bound lowered
// to it as it is found. Nothing bounds a line but the time and the work.
#define LINESWORK 12000   // the line search's share of a decision's work: the root and the lines it grows, together
static JLOCAL double lfEnd;   // where the line search being run stops (linesFind; a worker's grown subtree, its own)
#define TIMEWORK 4000     // a timing search's (tTimeMode)
static int sitCollect(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  (void)ctx;
  int brk, cash;
  if (n == 1) { Rs mine = causedBy(summarise(res), &lsAlone); brk = mine.broke; cash = mine.total > 0 || mine.broke; }
  else { brk = res[R_SCOPE] == SC_BROKE; cash = cashes(res); }
  if (tTimeMode) {
    if (brk && pfxT + at < tTimeMin) { tTimeMin = pfxT + at; sitLeft = tTimeMin - pfxT; }
    return brk ? SIT_END : SIT_GROW;
  }
  if (!(brk || (!lsBreaks && cash))) return SIT_GROW;
  if (nLines >= MAXLINES) return SIT_TAKE;   // full: the search ends
  if (nPfx + n > LINEMAX) return SIT_END;    // longer than a line holds: not kept, not grown
  LineC *l = &LINES[nLines++];
  l->n = nPfx + n; l->brk = brk; l->est = pfxT + at; l->verdict = -1; l->grown = nPfx; l->waitAll = 0;
  for (int k = 0; k < 2 * nPfx; k++) l->sw[k] = pfx[k];
  for (int k = 0; k < 2 * n; k++) l->sw[2 * nPfx + k] = sw[k];
  return SIT_END;   // a line ends at its first clear or break
}
static void linesFrom(const int32_t *st, int cr, int cc, int depth, double limit) {
  (void)depth;
  static JLOCAL int32_t LFR[R_INTS + ST_INTS];
  resolve(st, LFR, 0);
  lsAlone = summarise(LFR);
  if (tTimeMode && tTimeMin - pfxT < limit) limit = tTimeMin - pfxT;
  // a search a share: half the line search's, so the lines it grows have the rest
  extern PATLS double paWork;
  double work = tTimeMode ? TIMEWORK : LINESWORK / 2;
  if (!tTimeMode && lfEnd > 0 && work > lfEnd - paWork) work = lfEnd - paWork;
  searchInTime(st, cr, cc, 0, 0, limit, lsTopped, ENGINE_BASE ? ENGINE_CAN : 0, ENGINE_WAITS,
               work, sitCollect, 0, 0, 0, 0);
}
// Grow the lines that start with `pre` (np steps, played on the engine to
// the board `st` the front next decides on): the masks propose up to
// `depthLeft` more steps there, and each proposed next step that is not the
// last is played on the engine in turn, to choose the one after it on the
// board that gives.
static JLOCAL double growRootMs, growKidMs, growStateMs; static JLOCAL int growKids;   // GC_WORKSTAT
static void prereplayN(const int32_t *sws, int stride, int count, int n);
static int parAvailable(void), parTasks(void);
static void growAt(const int32_t *pre, int np, double preT, int depthLeft, const int32_t *st, int cr, int cc,
                   const uint32_t *can, uint8_t (*waits)[WMAX], double limit);
// the line search's work is spent: its share (lfEnd) or the thread's (workLeft)
static int growSpent(void) { extern PATLS double paWork; return workLeft() <= 0 || (lfEnd > 0 && lfEnd - paWork <= 0); }
static void growAt(const int32_t *pre, int np, double preT, int depthLeft, const int32_t *st, int cr, int cc,
                   const uint32_t *can, uint8_t (*waits)[WMAX], double limit) {
  int from = nLines;
  for (int k = 0; k < 2 * np; k++) pfx[k] = pre[k];
  nPfx = np; pfxT = preT;
  ENGINE_BASE = st; ENGINE_WAITS = waits;
  for (int c = 0; c < WMAX; c++) ENGINE_CAN[c] = can[c];
  double gt0 = NOWMS2();
  linesFrom(st, cr, cc, depthLeft, limit);
  if (np == 0) growRootMs += NOWMS2() - gt0; else { growKidMs += NOWMS2() - gt0; growKids++; }
  if (depthLeft < 2 || !BIN[IN_HASPA] || growSpent()) return;
  int32_t nexts[2 * GROWCAP]; int nn = 0;
  for (;;) {
    LineC *best = 0;
    for (int i = from; i < nLines; i++) {
      LineC *l = &LINES[i];
      if (l->n <= np + 1 || l->verdict == 0) continue;
      if (!best || lineBefore(l, best)) best = l;
    }
    if (!best) break;
    int r = best->sw[2 * np], c = best->sw[2 * np + 1], seen = 0;
    for (int j = 0; j < nn; j++) if (nexts[2 * j] == r && nexts[2 * j + 1] == c) seen = 1;
    if (!seen && nn < GROWCAP) { nexts[2 * nn] = r; nexts[2 * nn + 1] = c; nn++; }
    best->verdict = 0;   // a guess: its grown form replaces it
  }
  int32_t pre2[2 * REROOTS], st2[ST_INTS], cur[2], t;
  uint32_t can2[WMAX];
  uint8_t waits2[32][WMAX];
  for (int k = 0; k < 2 * np; k++) pre2[k] = pre[k];
  // the next steps' boards, replayed together
  if (nn > 1 && np + 1 <= REROOTS && !growSpent()) {
    int32_t all[GROWCAP][2 * REROOTS];
    for (int j = 0; j < nn; j++) {
      for (int k = 0; k < 2 * np; k++) all[j][k] = pre[k];
      all[j][2 * np] = nexts[2 * j]; all[j][2 * np + 1] = nexts[2 * j + 1];
    }
    prereplayN(&all[0][0], 2 * REROOTS, nn, np + 1);
  }
  // ONE AT A TIME, BEST FIRST: the next steps are grown in rank order, each
  // taking what the line search has left, so the best is grown fullest (an
  // even share starves it -- seed 7 at combo_storm: dies 1638 shared, lives
  // to 60000 best first)
  for (int j = 0; j < nn && !growSpent(); j++) {
    pre2[2 * np] = nexts[2 * j]; pre2[2 * np + 1] = nexts[2 * j + 1];
    double st0t = NOWMS2();
    int lsr = lineState(pre2, np + 1, st2, can2, waits2, cur, &t);
    growStateMs += NOWMS2() - st0t;
    if (lsr != 0) continue;
    growAt(pre2, np + 1, t, depthLeft - 1, st2, cur[0], cur[1], can2, waits2, INF);
  }
}
// BREAKS BY DISTANCE. A break is three of a colour in a line beside garbage,
// and a panel moves along its row one swap a column. So for every colour and
// every three cells in a row or a column beside garbage, on the board as it
// settles, the swaps that make the match are the nearest panels of that
// colour walked along their rows to it: a line as long as their distances
// add up to, however deep that is. Each is proposed, as the masks' lines are,
// and the engine judges it.
#define TGRID 18
static JLOCAL int tCell[TGRID + 2][WMAX + 1];   // colour; 0 empty; -1 garbage; -2 a panel that cannot move
static JLOCAL int tW, tH;
static int tSupported(int r, int c) { return r == 1 || tCell[r - 1][c] != 0; }
static int tBeside(int r, int c) {
  return (r + 1 <= tH && tCell[r + 1][c] == -1) || (r > 1 && tCell[r - 1][c] == -1) ||
         (c > 1 && tCell[r][c - 1] == -1) || (c < tW && tCell[r][c + 1] == -1);
}
// Walk the panel at (r, s) to column t along row r in `row` (a copy of the
// row), appending the swaps; 0 if something on the way cannot be passed.
static int tWalk(int *row, int r, int s, int t, int32_t *sw, int *n) {
  while (s != t) {
    int a = s < t ? s : s - 1, b = a + 1;
    if (row[a] < 0 || row[b] < 0 || *n >= LINEMAX) return 0;
    if ((row[a] == 0 && !tSupported(r, a)) || (row[b] == 0 && !tSupported(r, b))) return 0;
    int x = row[a]; row[a] = row[b]; row[b] = x;
    sw[2 * *n] = r; sw[2 * *n + 1] = a; (*n)++;
    s = s < t ? s + 1 : s - 1;
  }
  return 1;
}
// tTimeMode: the search only measures -- the frames to the soonest break it finds.
// the swaps played before the search's board (targetAfterDrops): every line found starts with them
static JLOCAL int32_t tPfx[2 * LINEMAX]; static JLOCAL int tPfxN;
static void tProposeIn(const int32_t *sw, int n, int cr, int cc, double t0, double limit);
static int tDupes;   // proposals already in the table (the trace's)
static void tPropose(const int32_t *sw0, int n0, int cr, int cc, double t0, double limit) {
  if (!tPfxN) { tProposeIn(sw0, n0, cr, cc, t0, limit); return; }
  if (n0 < 1 || n0 + tPfxN > LINEMAX) return;
  int32_t sw[2 * LINEMAX];
  for (int k = 0; k < 2 * tPfxN; k++) sw[k] = tPfx[k];
  for (int k = 0; k < 2 * n0; k++) sw[2 * tPfxN + k] = sw0[k];
  // the prefix's own time is in t0; the line's first step is costed from where it leaves the cursor
  int n = n0 + tPfxN;
  if (!tTimeMode && nLines >= MAXLINES) return;
  for (int i = 0; i < nLines; i++)
    if (LINES[i].n == n && !__builtin_memcmp(LINES[i].sw, sw, (unsigned long)n * 8)) { tDupes++; return; }
  double at = lineFrames(sw0, n0, cr, cc, t0, lsTopped);   // the clock, from the frame the prefix leaves the front deciding
  if (tTimeMode) { if (at < tTimeMin) tTimeMin = at; return; }
  if (at > limit) return;
  LineC *l = &LINES[nLines++];
  l->n = n; l->brk = 1; l->est = at; l->verdict = -1; l->grown = 0; l->waitAll = 0;
  for (int k = 0; k < 2 * n; k++) l->sw[k] = sw[k];
}
static void tProposeIn(const int32_t *sw, int n, int cr, int cc, double t0, double limit) {
  if (n < 1 || (!tTimeMode && nLines >= MAXLINES)) return;
  if (!tTimeMode)
    for (int i = 0; i < nLines; i++)
      if (LINES[i].n == n && !__builtin_memcmp(LINES[i].sw, sw, (unsigned long)n * 8)) { tDupes++; return; }
  double at = lineFrames(sw, n, cr, cc, t0, lsTopped);   // the clock
  if (tTimeMode) { if (at < tTimeMin) tTimeMin = at; return; }
  if (at > limit) return;
  LineC *l = &LINES[nLines++];
  l->n = n; l->brk = 1; l->est = at; l->verdict = -1; l->grown = 0; l->waitAll = 0;
  for (int k = 0; k < 2 * n; k++) l->sw[k] = sw[k];
}
// The grid the distance searches read; 1 if it holds garbage.
static int tGrid(const int32_t *st) {
  tW = st[O_W]; tH = st[O_H] < TGRID ? st[O_H] : TGRID;
  int N = st[O_N], any = 0;
  for (int r = 1; r <= tH + 1; r++)
    for (int c = 0; c <= WMAX; c++) tCell[r][c] = 0;
  for (int r = 1; r <= tH; r++)
    for (int c = 1; c <= tW; c++) {
      uint32_t b = 1u << (r - 1);
      int v = 0;
      if (U(st, GARB + c) & b) { v = -1; any = 1; }
      else if (U(st, INERT + c) & b) v = -2;
      else for (int a = 1; a <= N; a++) if (CL(st, a, c) & b) v = a;
      if (!v && (U(st, OCC + c) & b)) v = -2;   // a colour not yet dealt: there, matching nothing
      tCell[r][c] = v;
    }
  return any;
}
// A SWAP AND WHAT FALLS AFTER IT: a panel pulled out of a column drops what
// stood on it; a panel swapped into the air falls. On the grid: the swap, the
// panels fallen to rest, then every run of three or more, either way, that
// touches garbage and was not there before. However it forms, it breaks.
static int tGarbRun(int g[][WMAX + 2], int h, int r, int c, int vert) {
  int a = g[r][c], lo, hi;
  if (a <= 0) return 0;
  if (vert) {
    lo = hi = r;
    while (lo > 1 && g[lo - 1][c] == a) lo--;
    while (hi < h && g[hi + 1][c] == a) hi++;
    if (hi - lo + 1 < 3) return 0;
    for (int k = lo; k <= hi; k++)
      if ((c > 1 && g[k][c - 1] == -1) || (c < tW && g[k][c + 1] == -1) || g[k + 1][c] == -1 || (k == lo && k > 1 && g[k - 1][c] == -1)) return 1;
  } else {
    lo = hi = c;
    while (lo > 1 && g[r][lo - 1] == a) lo--;
    while (hi < tW && g[r][hi + 1] == a) hi++;
    if (hi - lo + 1 < 3) return 0;
    for (int k = lo; k <= hi; k++)
      if (g[r + 1][k] == -1 || (r > 1 && g[r - 1][k] == -1) || (k == lo && k > 1 && g[r][k - 1] == -1) || (k == hi && k < tW && g[r][k + 1] == -1)) return 1;
  }
  return 0;
}
static void tDrops(int cr, int cc, double t0, double limit) {
  static JLOCAL int g[TGRID + 2][WMAX + 2];
  for (int r = 1; r <= tH && workLeft() > 0; r++)
    for (int c = 1; c < tW; c++) {
      int x = tCell[r][c], y = tCell[r][c + 1];
      if (x < 0 || y < 0 || x == y) continue;
      // an empty cell under a hovering panel is not swapped into; one in the air is
      if ((x == 0 && !tSupported(r, c) && tCell[r + 1][c] > 0) || (y == 0 && !tSupported(r, c + 1) && tCell[r + 1][c + 1] > 0)) continue;
      for (int k = 1; k <= tH + 1; k++) for (int q = 0; q <= tW + 1; q++) g[k][q] = k <= tH && q <= tW ? tCell[k][q] : 0;
      g[r][c] = y; g[r][c + 1] = x;
      int moved = 0;
      for (int q = c; q <= c + 1; q++)
        for (int k = 2; k <= tH; k++) {
          if (g[k][q] <= 0) continue;
          int to = k;
          while (to > 1 && g[to - 1][q] == 0) to--;
          if (to != k) { g[to][q] = g[k][q]; g[k][q] = 0; moved = 1; }
        }
      int hit = 0;
      for (int q = c; q <= c + 1 && !hit; q++)
        for (int k = 1; k <= tH && !hit; k++) {
          if (!moved && k != r) continue;
          if (g[k][q] <= 0 || (g[k][q] == tCell[k][q] && k != r)) continue;
          hit = tGarbRun(g, tH, k, q, 1) || tGarbRun(g, tH, k, q, 0);
        }
      if (!hit) continue;
      int32_t sw[2] = { r, c };
#ifndef __wasm__
      if (botTraceOn && !tTimeMode) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "  DROP %d,%d\n", r, c); }
#endif
      tPropose(sw, 1, cr, cc, t0, limit);
    }
}
// A THREE STACKED BY DROPS: garbage breaks from a column of three beside it,
// and a column is filled from above as much as along a row -- a panel walked
// over it falls into it. Each cell of the three, bottom first, is filled by
// the panel of the colour, in its row or any row above, that gets there in
// the fewest swaps; every walk is played on a copy of the grid with what
// falls after it, and the line is proposed only if the grid it leaves holds
// the three against the garbage. The engine judges it like any other line.
#define TSTACKWORK 1.7   // a grid step (a swap and its fall, a clear round, a copy): the planner (targetLines) charges 6,933 units per ms at 1.7 (8,926 at 2.5; seed 9, 6,000 frames) against the 6,027 a ms is worth
#define TSTACKNEAR 3     // the nearest panels of the colour tried for each cell
// the distance grid (tCell) copied onto a grid with a column either side of the board
static void gLoad(int g[][WMAX + 2]) {
  for (int k = 0; k < TGRID + 2; k++)
    for (int q = 0; q < WMAX + 2; q++) g[k][q] = k <= tH && q >= 1 && q <= tW ? tCell[k][q] : 0;
}
static void gSettle(int g[][WMAX + 2], int c) {
  int to = 1;
  for (int k = 1; k <= tH; k++) {
    int v = g[k][c];
    if (v == 0) continue;
    if (v < 0) { to = k + 1; continue; }   // garbage and the inert hold; a panel (or the walker's mark) falls
    if (to != k) { g[to][c] = v; g[k][c] = 0; }
    to++;
  }
}
// the panel at (*r, s) walked along its row to column t, falling wherever it
// is not held up and going on from where it lands; 0 if garbage is in the way
static int gWalk(int g[][WMAX + 2], int *r, int s, int t, int32_t *sw, int *n) {
  int rr = *r;
  while (s != t) {
    int a = s < t ? s : s - 1, to = s < t ? s + 1 : s - 1;
    if (g[rr][a] < 0 || g[rr][a + 1] < 0 || *n >= LINEMAX) return 0;
    int x = g[rr][a]; g[rr][a] = g[rr][a + 1]; g[rr][a + 1] = x;
    sw[2 * *n] = rr; sw[2 * *n + 1] = a; (*n)++;
    paWork += TSTACKWORK;
    int v = g[rr][to]; g[rr][to] = 100;   // the walker, marked through the fall
    gSettle(g, a); gSettle(g, a + 1);
    for (rr = 1; rr <= tH && g[rr][to] != 100; rr++) ;
    g[rr][to] = v; s = to;
  }
  *r = rr;
  return 1;
}
static void tStacks(int N, int cr, int cc, double t0, double limit) {
  static JLOCAL int g[TGRID + 2][WMAX + 2], h[TGRID + 2][WMAX + 2], b[TGRID + 2][WMAX + 2];
  int32_t sw[2 * LINEMAX], sb[2 * LINEMAX];
  for (int a = 1; a <= N && workLeft() > 0; a++)
    for (int c = 1; c <= tW; c++)
      for (int r = 1; r + 2 <= tH; r++) {
        if (!tBeside(r, c) && !tBeside(r + 1, c) && !tBeside(r + 2, c)) continue;
        if ((r > 1 && tCell[r - 1][c] == 0) || tCell[r][c] < 0 || tCell[r + 1][c] < 0 || tCell[r + 2][c] < 0) continue;
        gLoad(g);
        int n = 0, ok = 1;
        for (int i = 0; i < 3 && ok; i++) {
          int rr = r + i;
          if (g[rr][c] == a) continue;
          int bn = -1;
          // the panels of the colour in this row or above, nearest first (columns away, then rows up)
          int cand[3 * TSTACKNEAR][2], nc = 0;
          for (int d = 1; d <= tW + tH && nc < TSTACKNEAR; d++)
            for (int rh = rr; rh <= tH && nc < TSTACKNEAR; rh++) {
              int dc = d - (rh - rr);
              if (dc < 1) continue;
              for (int sgn = -1; sgn <= 1 && nc < TSTACKNEAR; sgn += 2) {
                int sc = c + sgn * dc;
                if (sc >= 1 && sc <= tW && g[rh][sc] == a) { cand[nc][0] = rh; cand[nc][1] = sc; nc++; }
              }
            }
          for (int k = 0; k < nc; k++) {
            __builtin_memcpy(h, g, sizeof h);
            int m = n, pr = cand[k][0];
            for (int q = 0; q < 2 * n; q++) sw[q] = sb[q];
            paWork += TSTACKWORK;
            if (!gWalk(h, &pr, cand[k][1], c, sw, &m) || pr != rr) continue;
            int kept = 1;
            for (int q = r; q < rr; q++) if (h[q][c] != a) kept = 0;
            if (!kept || (bn >= 0 && m >= bn)) continue;
            bn = m; __builtin_memcpy(b, h, sizeof b);
            for (int q = 2 * n; q < 2 * m; q++) sb[q] = sw[q];
          }
          if (bn < 0) { ok = 0; break; }
          n = bn; __builtin_memcpy(g, b, sizeof g);
        }
        if (!ok || n == 0) continue;
        int hit = 0;
        for (int q = r; q <= r + 2 && !hit; q++) hit = tGarbRun(g, tH, q, c, 1);
        if (hit) tPropose(sb, n, cr, cc, t0, limit);
      }
}
// A THREE IN A ROW BUILT BY DROPS: the row under or beside the garbage is
// filled as a column is (tStacks) -- each of three side-by-side cells, left
// first, by the panel of the colour in its row or any row above that gets
// there in the fewest swaps, walked on a copy of the grid with what falls
// after it; a cell is filled only where its column stands one short of it.
// Proposed only if the grid it leaves holds the three against the garbage.
static void tRows(int N, int cr, int cc, double t0, double limit) {
  static JLOCAL int g[TGRID + 2][WMAX + 2], h[TGRID + 2][WMAX + 2], b[TGRID + 2][WMAX + 2];
  int32_t sw[2 * LINEMAX], sb[2 * LINEMAX];
  for (int a = 1; a <= N && workLeft() > 0; a++)
    for (int r = 1; r <= tH; r++)
      for (int c = 1; c + 2 <= tW; c++) {
        if (!tBeside(r, c) && !tBeside(r, c + 1) && !tBeside(r, c + 2)) continue;
        int any = 0;
        for (int q = c; q <= c + 2; q++) { if (tCell[r][q] < 0) any = -1; else if (tCell[r][q] == a) any += any >= 0; }
        if (any < 0 || any == 3) continue;   // garbage in the way; or a run already (no board at rest has one)
        gLoad(g);
        int n = 0, ok = 1;
        for (int i = 0; i < 3 && ok; i++) {
          int q = c + i;
          if (g[r][q] == a) continue;
          if (r > 1 && g[r - 1][q] == 0) { ok = 0; break; }   // nothing to hold a panel there
          int bn = -1;
          int cand[TSTACKNEAR][2], nc = 0;
          for (int d = 1; d <= tW + tH && nc < TSTACKNEAR; d++)
            for (int rh = r; rh <= tH && nc < TSTACKNEAR; rh++) {
              int dc = d - (rh - r);
              if (dc < 1) continue;
              for (int sgn = -1; sgn <= 1 && nc < TSTACKNEAR; sgn += 2) {
                int sc = q + sgn * dc;
                if (sc >= 1 && sc <= tW && !(rh == r && sc >= c && sc < q) && g[rh][sc] == a) { cand[nc][0] = rh; cand[nc][1] = sc; nc++; }
              }
            }
          for (int k = 0; k < nc; k++) {
            __builtin_memcpy(h, g, sizeof h);
            int m = n, pr = cand[k][0];
            for (int z = 0; z < 2 * n; z++) sw[z] = sb[z];
            paWork += TSTACKWORK;
            if (!gWalk(h, &pr, cand[k][1], q, sw, &m) || pr != r) continue;
            int kept = 1;
            for (int z = c; z < q; z++) if (h[r][z] != a) kept = 0;
            if (!kept || (bn >= 0 && m >= bn)) continue;
            bn = m; __builtin_memcpy(b, h, sizeof b);
            for (int z = 2 * n; z < 2 * m; z++) sb[z] = sw[z];
          }
          if (bn < 0) { ok = 0; break; }
          n = bn; __builtin_memcpy(g, b, sizeof g);
        }
        if (!ok || n == 0) continue;
        if (tGarbRun(g, tH, r, c, 0) || tGarbRun(g, tH, r, c + 1, 0) || tGarbRun(g, tH, r, c + 2, 0)) tPropose(sb, n, cr, cc, t0, limit);
      }
}
// A SWAP THAT DROPS INTO A BREAK: a swap takes panels out from under a
// column -- clearing them, or moving one aside into the air -- the column
// falls, and what it falls into can be three against the garbage: at once,
// as a chain, or after one more swap, near the garbage, on the board it
// leaves. On a copy of the grid: every run of three or more is cleared and
// what stood on it falls, round after round; a run touching garbage is a break.
static int gResolve(int g[][WMAX + 2], int *cleared) {
  static JLOCAL unsigned char mk[TGRID + 2][WMAX + 2];
  int broke = 0;
  *cleared = 0;
  for (;;) {
    int any = 0;
    __builtin_memset(mk, 0, sizeof mk);
    paWork += TSTACKWORK;
    for (int r = 1; r <= tH; r++)
      for (int c = 1; c <= tW; c++) {
        int a = g[r][c];
        if (a <= 0 || a > 99) continue;
        int e = c; while (e + 1 <= tW && g[r][e + 1] == a) e++;
        if (e - c >= 2) { for (int k = c; k <= e; k++) mk[r][k] = 1; any = 1; }
        int t = r; while (t + 1 <= tH && g[t + 1][c] == a) t++;
        if (t - r >= 2) { for (int k = r; k <= t; k++) mk[k][c] = 1; any = 1; }
      }
    if (!any) return broke;
    for (int r = 1; r <= tH; r++)
      for (int c = 1; c <= tW; c++) {
        if (!mk[r][c]) continue;
        if (g[r + 1][c] == -1 || (r > 1 && g[r - 1][c] == -1) || (c > 1 && g[r][c - 1] == -1) || (c < tW && g[r][c + 1] == -1)) broke = 1;
        g[r][c] = 0; (*cleared)++;
      }
    if (broke) return 1;
    for (int c = 1; c <= tW; c++) gSettle(g, c);
  }
}
// the swap (r, c) played on a copy of the grid and resolved: -1 not a swap,
// else 1 if it breaks; *cleared the panels its clears took
static int gSwapResolve(int dst[][WMAX + 2], int src[][WMAX + 2], int r, int c, int *cleared) {
  int x = src[r][c], y = src[r][c + 1];
  *cleared = 0;
  if (x < 0 || y < 0 || x == y) return -1;
  __builtin_memcpy(dst, src, sizeof(int) * (TGRID + 2) * (WMAX + 2));
  paWork += TSTACKWORK;
  dst[r][c] = y; dst[r][c + 1] = x;
  gSettle(dst, c); gSettle(dst, c + 1);
  return gResolve(dst, cleared);
}
#define TNEARG 3   // a second swap is tried this near garbage (cells, either way)
static int gNearGarbage(int g[][WMAX + 2], int r, int c) {
  for (int k = r - TNEARG; k <= r + TNEARG; k++)
    for (int q = c - TNEARG; q <= c + 1 + TNEARG; q++)
      if (k >= 1 && k <= tH && q >= 1 && q <= tW && g[k][q] == -1) return 1;
  return 0;
}
static void tClears(int cr, int cc, double t0, double limit) {
  static JLOCAL int g0[TGRID + 2][WMAX + 2], g[TGRID + 2][WMAX + 2], h[TGRID + 2][WMAX + 2];
  static JLOCAL unsigned char alone[TGRID + 2][WMAX + 2];   // the swaps that break on their own
  gLoad(g0);
  for (int r = 1; r <= tH; r++)
    for (int c = 1; c < tW; c++) {
      if (workLeft() <= 0) return;
      int cl, b = gSwapResolve(g, g0, r, c, &cl);
      alone[r][c] = b == 1;
      if (b == 1) { int32_t sw[2] = { r, c }; tPropose(sw, 1, cr, cc, t0, limit); }
    }
  for (int r = 1; r <= tH; r++)
    for (int c = 1; c < tW; c++) {
      if (workLeft() <= 0) return;
      int cl, b = gSwapResolve(g, g0, r, c, &cl);
      if (b != 0) continue;
      int32_t sw[4] = { r, c, 0, 0 };
      // the board it leaves: one more swap, near the garbage, that breaks on it
      // and not on its own (that one is a line of one already)
      for (int r2 = 1; r2 <= tH; r2++)
        for (int c2 = 1; c2 < tW; c2++) {
          int cl2;
          if (alone[r2][c2] || !gNearGarbage(g, r2, c2) || gSwapResolve(h, g, r2, c2, &cl2) != 1) continue;
          sw[2] = r2; sw[3] = c2;
          tPropose(sw, 2, cr, cc, t0, limit);
        }
    }
}
static void targetLines(const int32_t *st, int cr, int cc, double t0, double limit) {
  // the planner's work stops where the decision's does (workLeft): at the
  // head of every loop that proposes, so no one call runs past it
  if (workLeft() <= 0 || !tGrid(st)) return;
  int N = st[O_N];
  int32_t sw[2 * LINEMAX]; int row[WMAX + 1];
  tDrops(cr, cc, t0, limit);
  for (int a = 1; a <= N && workLeft() > 0; a++) {
    // three in a column: each row's nearest panel of the colour walked to it
    for (int c = 1; c <= tW; c++)
      for (int r = 1; r + 2 <= tH; r++) {
        if (!tSupported(r, c) && tCell[r][c] == 0) continue;
        if (!tBeside(r, c) && !tBeside(r + 1, c) && !tBeside(r + 2, c)) continue;
        int n = 0, ok = 1;
        for (int i = 0; i < 3 && ok; i++) {
          int rr = r + i, best = -1;
          for (int s = 1; s <= tW; s++)
            if (tCell[rr][s] == a && (best < 0 || (s > c ? s - c : c - s) < (best > c ? best - c : c - best))) best = s;
          if (best < 0) { ok = 0; break; }
          for (int x = 1; x <= tW; x++) row[x] = tCell[rr][x];
          ok = tWalk(row, rr, best, c, sw, &n);
        }
        if (ok && n > 0) tPropose(sw, n, cr, cc, t0, limit);
      }
    // three in a row: the colour's panels in the row, the nearest three walked together
    for (int r = 1; r <= tH; r++) {
      int pos[WMAX], np = 0;
      for (int s = 1; s <= tW; s++) if (tCell[r][s] == a) pos[np++] = s;
      if (np < 3) continue;
      for (int c = 1; c + 2 <= tW; c++) {
        if (!tSupported(r, c) || !tSupported(r, c + 1) || !tSupported(r, c + 2)) continue;
        if (!tBeside(r, c) && !tBeside(r, c + 1) && !tBeside(r, c + 2)) continue;
        for (int j = 0; j + 2 < np; j++) {
          int n = 0, ok = 1;
          for (int x = 1; x <= tW; x++) row[x] = tCell[r][x];
          int at[3] = { pos[j], pos[j + 1], pos[j + 2] };
          // the panels left of their targets walk right, rightmost first; then the rest
          for (int i = 2; i >= 0 && ok; i--) if (at[i] < c + i) { ok = tWalk(row, r, at[i], c + i, sw, &n); at[i] = c + i; }
          for (int i = 0; i < 3 && ok; i++) if (at[i] > c + i) { ok = tWalk(row, r, at[i], c + i, sw, &n); at[i] = c + i; }
          if (ok && n > 0) tPropose(sw, n, cr, cc, t0, limit);
        }
      }
    }
  }
  tStacks(N, cr, cc, t0, limit);
  tRows(N, cr, cc, t0, limit);
  tClears(cr, cc, t0, limit);
}
// A PILE LET DOWN FIRST. Garbage perched on a column or two touches little; a
// line that pulls its support -- however many swaps -- lets it down onto the
// panels beside. The shared search finds those lines soonest first, each
// ending at the step that lets garbage fall; the breaks by distance are
// searched again on the board each settles to, every line found starting with it.
#define TADTRIES 8
#define TADWORK 4000
static double garbSum(const int32_t *st) { double g = 0; for (int c = 1; c <= BW; c++) g += U(st, GARB + c); return g; }
typedef struct { double g0; int n, len[TADTRIES]; int32_t sw[TADTRIES][2 * LINEMAX]; } DropCtx;
static int sitDrops(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  DropCtx *x = ctx; (void)at;
  if (res[R_SCOPE] != SC_OK) return SIT_END;
  if (!(garbSum(res + R_INTS) < x->g0)) return SIT_GROW;
  x->len[x->n] = n; for (int k = 0; k < 2 * n; k++) x->sw[x->n][k] = sw[k];
  return ++x->n >= TADTRIES ? SIT_TAKE : SIT_END;
}
static void targetAfterDrops(const int32_t *st, int cr, int cc, double t0, double limit) {
  if (tPfxN) return;
  static DropCtx x;
  x.g0 = garbSum(st); x.n = 0;
  if (!(x.g0 > 0)) return;
  searchInTime(st, cr, cc, t0, 0, limit, lsTopped, ENGINE_BASE ? ENGINE_CAN : 0, ENGINE_WAITS, TADWORK, sitDrops, &x, 0, 0, 0);
  // soonest drop first; timing wants only the soonest break, so it stops at the first board that gives one
  double bound0 = tTimeMin;
  for (int i = 0; i < x.n && workLeft() > 0 && !(tTimeMode && tTimeMin < bound0); i++) {
    int32_t st1[ST_INTS], cur[2], t; uint32_t can[WMAX]; uint8_t wt[32][WMAX];
    int ls = lineState(x.sw[i], x.len[i], st1, can, wt, cur, &t), n0 = nLines;
    if (ls == 0 && t <= limit) { for (int k = 0; k < 2 * x.len[i]; k++) tPfx[k] = x.sw[i][k]; tPfxN = x.len[i]; targetLines(st1, cur[0], cur[1], t, limit); tPfxN = 0; }
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "  TAD"); for (int k = 0; k < x.len[i]; k++) fprintf(BLOG, " %d,%d", x.sw[i][2 * k], x.sw[i][2 * k + 1]); fprintf(BLOG, " drops: state %d t %d limit %g lines +%d\n", ls, t, limit, nLines - n0); }
#endif
  }
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "  TAD drops found %d\n", x.n); }
#endif
}
// EVERY LINE THAT BREAKS BY DISTANCE, whoever asks: the planner's shapes on
// the board (targetLines), and on each board a perched pile is let down to
// (targetAfterDrops), within the time there is
static void breakLines(const int32_t *st, int cr, int cc, double t0, double limit) {
  targetLines(st, cr, cc, t0, limit);
  targetAfterDrops(st, cr, cc, t0, limit < INF ? limit : LINEHORIZON);
}
// THE TIME THERE IS: topped, the drain; else the judge's horizon -- a line
// whose last press comes later is one the engine never finishes playing, so
// it can never be judged to live
static double linesLimit(int breaks) { (void)breaks; return lsTopped ? timeLeft() - 2 : LINEHORIZON; }
static void linesFind(int depth, int breaks) {
  // the same lines asked for twice in a decision are found once
  if (lfDecision == btDecision && lfDepth == depth && lfBreaks == breaks) return;
  linesReset();
  lfDecision = btDecision; lfDepth = depth; lfBreaks = breaks;
  extern PATLS double paWork;
  lfEnd = paWork + LINESWORK;
  lsTopped = BIN[IN_TOPPED] != 0; lsBreaks = breaks;
  double lsLimit = linesLimit(breaks);
  const int32_t *saveBase = ENGINE_BASE;
  uint32_t saveCan[WMAX];
  for (int c = 0; c < WMAX; c++) saveCan[c] = ENGINE_CAN[c];
  // Every step alike, the first too: proposed on the board the engine
  // settles to, each pair pressed once its panels settle. The masks propose,
  // the engine judges: only the lock (topped) bounds the proposals.
  int32_t st0[ST_INTS], cur[2], t;
  uint32_t can0[WMAX];
  uint8_t waits0[32][WMAX];
  if (BIN[IN_HASPA] && lineState(0, 0, st0, can0, waits0, cur, &t) == 0) {
    growAt(0, 0, t, depth, st0, cur[0], cur[1], can0, waits0, lsLimit);
    if (breaks) breakLines(st0, cur[0], cur[1], t, lsTopped ? timeLeft() - 2 : INF);
  } else {
    growAt(0, 0, 0, depth, DBASE, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], saveCan, 0, lsLimit);
    if (breaks) breakLines(DBASE, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 0, lsTopped ? timeLeft() - 2 : INF);
  }
  ENGINE_BASE = saveBase; ENGINE_WAITS = 0;
  for (int c = 0; c < WMAX; c++) ENGINE_CAN[c] = saveCan[c];
  nPfx = 0; pfxT = 0; lfEnd = 0;
}
// A line's rank: a break before a clear, then the sooner done (est, on the
// clock) -- never the fewer swaps. Equal: by the swaps themselves, so the rank
// never depends on the order found.
static int lineBefore(const LineC *a, const LineC *b) {
  if (a->brk != b->brk) return a->brk;
  if (a->est != b->est) return a->est < b->est;
  int m = a->n < b->n ? a->n : b->n;
  for (int k = 0; k < 2 * m; k++) if (a->sw[k] != b->sw[k]) return a->sw[k] < b->sw[k];
  return a->n < b->n;
}
// The first line, by rank, the engine finds does all of `need` and none of `avoid`.
static LineC *bestLineAvoid(int need, int avoid, int (*ok)(const LineC *)) {
  for (int i = 0; i < nLines; i++) LINES[i].ok = !ok || ok(&LINES[i]);
  for (;;) {
    LineC *cand = 0;
    for (int i = 0; i < nLines; i++) {
      LineC *l = &LINES[i];
      if (!l->ok || (l->verdict >= 0 && ((l->verdict & need) != need || (l->verdict & avoid)))) continue;
      if (!cand || lineBefore(l, cand)) cand = l;
    }
    if (!cand) return 0;
    judgeAhead(cand, 0, 1);
    int v = judged(cand);
    if ((v & need) == need && !(v & avoid)) return cand;
  }
}
static LineC *bestLine(int need, int (*ok)(const LineC *)) { return bestLineAvoid(need, 0, ok); }
// A line that lives, one that leaves the garbage at rest first.
// A line that lives: of the first LIVINGS that do, by rank, the one that
// loses health last; then the one that drops no garbage at rest, then the one
// that leaves the least hollow under what lands.
#define LIVINGS 12
// THE BREAK THAT TAKES THE MOST. Of the first LIVINGS breaks that live, by
// rank, the one that converts the most garbage on the engine -- a pile broken
// whole, not its bottom slab with the rest left propped above a gap.
static int bbFound, bbLastN; static double bbLastEst;   // bestBreak: how many living breaks it took, the last one's length and time
// A BREAK THAT LEAVES THE BOARD READY: of the breaks that lose health
// latest, with more garbage to come, a living break after which the next slab
// lands with a break in reach (readyInTime) is taken over one that leaves the
// pile it does not convert out of reach; among the same, the one that
// converts the most.
static int readyInTime(const int32_t *sw, int n, int *br, int *bc);
// THE ONE ORDER LINES ARE RANKED IN, best first: the one that leaves a break in
// reach when the next slab lands (rdy; the slab it is ready for is what
// kills), then the one that loses health later (life: hollow costed), then the
// one that converts more garbage, then the less hollow, then the sooner done.
// 1: a is better, -1: b is; two different lines are never equal.
static int lineRank(const LineC *a, int ra, const LineC *b, int rb) {
  if (ra != rb) return ra > rb ? 1 : -1;
  if (a->life != b->life) return a->life > b->life ? 1 : -1;
  if (a->conv != b->conv) return a->conv > b->conv ? 1 : -1;
  if (a->hollow != b->hollow) return a->hollow < b->hollow ? 1 : -1;
  return lineBefore(a, b) ? 1 : -1;
}
// THE BAR A READY LINE CLEARS: it loses health no sooner than the board left
// alone (any death, when that does not; 0 with no engine). Not later: a line
// that only readies the break is replayed without the break, and against a
// queue that fills the room it dies when the board left alone does -- the
// break it readies is what saves it. Every route that plays a line for its
// readiness asks this.
static int readyBar(void) { return aloneDie(0); }
// whether a line counts as ready: asked only with garbage to come, and only of
// a line that loses health no sooner than the board left alone
static int readyCounts(const LineC *l, int alone) {
  if (!(BIN[IN_INCOMING] > 0) || (alone && l->die < alone)) return 0;
  int32_t keep[LNOLEN]; int r, c;
  for (int k = 0; k < LNOLEN; k++) keep[k] = LNO[k];
  int rdy = readyInTime(l->sw, l->n, &r, &c);
  for (int k = 0; k < LNOLEN; k++) LNO[k] = keep[k];
  return rdy;
}
static int bbReady;   // the break bestBreak picked leaves the board ready for the next slab
static LineC bbDeferred; static int bbHasDeferred;   // a living break held for a better time, this decision
static LineC *bestBreak(void) {
  static unsigned char taken[MAXLINES];
  const int need = LV_LIVES | LV_BREAKS;
  int ask = BIN[IN_INCOMING] > 0, pickReady = 0, alone = aloneOnEngine() ? LNA[0] : 0;
  LineC *pick = 0;
  bbFound = 0; bbLastN = 0;
  for (int i = 0; i < nLines; i++) taken[i] = 0;
  for (int found = 0; found < LIVINGS;) {
    int at = -1;
    for (int i = 0; i < nLines; i++) {
      LineC *l = &LINES[i];
      if (taken[i] || (l->verdict >= 0 && (l->verdict & need) != need)) continue;
      if (at < 0 || lineBefore(l, &LINES[at])) at = i;
    }
    if (at < 0) break;
    taken[at] = 1;
    LineC *l = &LINES[at];
    judgeAhead(l, taken, 0);
    if ((judged(l) & need) != need) continue;
    found++; bbFound = found; bbLastN = l->n; bbLastEst = l->est;
    if (pick && pickReady && lineRank(l, 1, pick, pickReady) < 0) continue;   // not better even if ready: not asked
    int rdy = ask ? readyCounts(l, alone) : 0;
    if (!pick || lineRank(l, rdy, pick, pickReady) > 0) { pick = l; pickReady = rdy; }
  }
  bbReady = !ask || pickReady;
  return pick;
}
static int blReady, blAlone;
static LineC *bestLiving(int (*ok)(const LineC *)) {
  static unsigned char taken[MAXLINES]; int pickRdy = 0;
  const int need = LV_LIVES | LV_GAINS;
  LineC *pick = 0;
  for (int i = 0; i < nLines; i++) taken[i] = ok && !ok(&LINES[i]);
  for (int found = 0; found < LIVINGS;) {
    int at = -1;
    for (int i = 0; i < nLines; i++) {
      LineC *l = &LINES[i];
      if (taken[i] || (l->verdict >= 0 && (l->verdict & need) != need)) continue;
      if (at < 0 || lineBefore(l, &LINES[at])) at = i;
    }
    if (at < 0) break;
    taken[at] = 1;
    LineC *l = &LINES[at];
    judgeAhead(l, taken, 0);
    if ((judged(l) & need) != need) continue;
    found++;
    // ready first when asked (stayAlive), then by the one order (lineRank)
    int rdy = blReady ? readyCounts(l, blAlone) : 0;
    if (!pick || lineRank(l, rdy, pick, pickRdy) > 0) { pick = l; pickRdy = rdy; }
  }
  return pick;
}
static void lineKeep(const LineC *l, int kind) { lineSet(l->sw, l->n, kind, l->waitAll); }
// The first step of a line, as a swap; its last waits for the board to settle when the line says.
static Dec lineSwap(const LineC *l, int via, Dec d) {
  Dec s = mkSwap(l->sw[0], l->sw[1], via, d.mode, d.alive);
  s.waitAll = l->n == 1 && l->waitAll;
  return s;
}
static void plansDrop(void) { BT->plan.has = 0; BT->attack.has = 0; BT->flatten.has = 0; BT->dig.has = 0; BT->digIsBreak = 0; }
// lineLast: what the line rules last did, for the drill's trace: 1 played on
// with the line kept, 2 a dying choice replaced, 3 a break line played, 4 a
// choice that lost the break replaced, 5 a lineup played.
static int lineLast;
__attribute__((export_name("bot_breakfirst"))) int32_t bot_breakfirst(void) { return lineLast; }
__attribute__((export_name("bot_keepbreak"))) int32_t bot_keepbreak(void) { return 0; }

// A LINE ONCE PLAYED IS PLAYED TO ITS END.
static int readyAfterSpend(const int32_t *sw, int n);
static int aloneOnEngine(void);
static int nonSpendLives(void);
// SIX ROWS LEFT: the panels the judged line ends with (LNO[12]: those whose
// colours are known -- a converted cell's colour is unseen until it shows,
// and may cascade away) make six rows. The one test of whether a spend leaves
// the board its working material.
static int leavesSixRows(void) { return (double)LNO[12] / BW >= 6; }
// A SPEND THAT KEEPS A WAITING RAISE OUT: a clear holds the rise lock and
// renews the stop, so while a raise for material waits on either, a spend
// under six rows with no break ready may only if the board left alone loses
// health before the wait would end -- the raise could not come in time to
// save it anyway
static int playDie;   // the frame the line played on loses health (1 << 20: not within the horizon)
static double playLife;   // and its life (lifeOf)
static int spendKeepsRaiseOut(void) {
  if (!raiseWaiting || !aloneOnEngine()) return 0;
  return !(LNA[0] && LNA[0] <= raiseWaitLeft());
}
static Dec playOn(Dec d) {
  lineLast = 0;
  if (!BT->nLine) return d;
  // A STEP IS MADE BY A PRESS SINCE THE LINE WAS SET: the last swap pressed
  // may be older than the line (seed 9: 5,2 pressed, then a line set starting
  // 5,2 -- its first step taken as made, the rest judged without it, dropped).
  // A front that counts its presses (IN_PRESSES) says which; one that does
  // not is read as before.
  if (BIN[IN_HASLAST] && (int)BIN[IN_LASTR] == BT->line[0] && (int)BIN[IN_LASTC] == BT->line[1] && (!(BIN[IN_PRESSES] > 0) || BIN[IN_PRESSES] > BT->linePresses)) {
    for (int k = 2; k < 2 * BT->nLine; k++) BT->line[k - 2] = BT->line[k];
    BT->nLine--;
    BT->linePresses = BIN[IN_PRESSES];
  }
  if (!BT->nLine) return d;
  // NOR BY GOING BACK: a line whose next step undoes a press is dropped here,
  // where it is chosen, so the choice falls to the next best and not to a hold
  if (undoesOld(BT->line[0], BT->line[1])) { BT->nLine = 0; return d; }
  linesReset();
  int v = lineJudge(BT->line, BT->nLine, BT->lineWaitAll);
  int need = LV_LIVES | (BT->lineKind == LINE_BREAK ? LV_BREAKS : BT->lineKind == LINE_CASH ? LV_GAINS : 0);
  if ((v & need) != need) {
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "DROPLINE kind %d n %d", BT->lineKind, BT->nLine); for (int k = 0; k < BT->nLine; k++) fprintf(BLOG, " %d,%d", BT->line[2 * k], BT->line[2 * k + 1]); fprintf(BLOG, " | v %d need %d die %d last %d refused step %d at %d\n", v, need, LNO[0], LNO[1], LNO[5], LNO[6]); }
#endif
    BT->nLine = 0; return d; }
  playDie = lnoDie(LNO); playLife = lifeOf(playDie, LNO[1], HOLLOW(LNO), spentOf());
  // A PLAN SPENDS AS EVERY CHOICE DOES: what is left of a plan line that
  // clears, leaves under six rows and no break ready is dropped -- unless the
  // board left alone dies and the line buys time: it loses health later. A
  // spend that dies as soon only spends the material the next break needs.
  if (BT->lineKind == LINE_PLAN && (v & LV_PAYS) && !(v & LV_BREAKS) && !leavesSixRows()) {
    int32_t keepO[LNOLEN]; for (int q = 0; q < LNOLEN; q++) keepO[q] = LNO[q];
    int buys = aloneOnEngine() && LNA[0] && (!keepO[0] || keepO[0] > LNA[0]);
    int ok = readyAfterSpend(BT->line, BT->nLine) || (buys && !nonSpendLives() && !spendKeepsRaiseOut());
    for (int q = 0; q < LNOLEN; q++) LNO[q] = keepO[q];
    if (!ok) { BT->nLine = 0; return d; }
  }
  lineLast = 1;
  plansDrop();
  Dec s = mkSwap(BT->line[0], BT->line[1], BT->lineKind == LINE_BREAK ? V_BREAKREACH : BT->lineKind == LINE_PLAN ? V_PLANSAVE : V_KEEPHEALTH, d.mode, d.alive);
  s.waitAll = BT->nLine == 1 && BT->lineWaitAll;
  return s;
}

// IT MUST NOT DIE.
// AN UNDO: a swap at a pair the bot pressed, whose two cells still hold what
// that press left there, puts them back as they were. Two presses undone in
// turn swap the board around while it waits (seed 9: 3,2 and 4,1; seed 4:
// 6,5 and 4,5, each line the other's undo by two frames of life). A swap that
// clears or breaks is no undo. Returns how many presses back (0: none).
static int pairColour(const int32_t *st, int r, int c) {
  uint32_t b = 1u << (r - 1);
  if (r < 1 || r > 31 || !(U(st, OCC + c) & b) || (U(st, GARB + c) & b)) return 0;
  return colourFirst(st, c, b);
}
// the presses, as they come: the last one pressed, and the colours it left
static void notePresses(void) {
  if (!BIN[IN_HASLAST]) return;
  int r = (int)BIN[IN_LASTR], c = (int)BIN[IN_LASTC];
  // a press is new by the front's count (IN_PRESSES), or, from a front that
  // does not count, by a pair other than the last noted
  if (BIN[IN_PRESSES] > 0 ? !(BIN[IN_PRESSES] > BT->seenPresses) : (BT->nPr && BT->prR[0] == r && BT->prC[0] == c)) return;
  BT->seenPresses = BIN[IN_PRESSES];
  for (int i = (BT->nPr < 8 ? BT->nPr : 7); i > 0; i--) { BT->prR[i] = BT->prR[i - 1]; BT->prC[i] = BT->prC[i - 1]; BT->prA[i] = BT->prA[i - 1]; BT->prB[i] = BT->prB[i - 1]; BT->prN[i] = BT->prN[i - 1]; }
  BT->prR[0] = r; BT->prC[0] = c; BT->prA[0] = pairColour(DBASE, r, c); BT->prB[0] = pairColour(DBASE, r, c + 1); BT->prN[0] = ++BT->nNotes;
  if (BT->nPr < 8) BT->nPr++;
}
static int undoesPress(int r, int c) {
  Cand *pc = poolSwap(r, c);
  if (pc && (pc->res.total > 0 || pc->res.broke)) return 0;
  int a = pairColour(DBASE, r, c), b = pairColour(DBASE, r, c + 1);
  if (a == b) return 0;
  for (int i = 0; i < BT->nPr; i++) if (BT->prR[i] == r && BT->prC[i] == c && BT->prA[i] == a && BT->prB[i] == b) return i + 1;
  return 0;
}
// A LINE'S OWN PRESS IS ITS PLAN: the step of the line being played that
// presses a pair back undoes a press only if that press came before the line
// was set -- one the line made itself was judged with it, the line whole
static int undoesOld(int r, int c) {
  int back = undoesPress(r, c);
  if (back && BT->nLine && BT->prN[back - 1] > BT->lineBorn) return 0;
  return back;
}
// A LINE MAY NOT START BY GOING BACK: not by undoing a press, and (longer)
// not by repeating the last swap or returning to a board seen
static int notLastSwap(const LineC *l) {
  if (undoesPress(l->sw[0], l->sw[1])) return 0;
  if (l->n == 1) return 1;
  int r = l->sw[0], c = l->sw[1];
  return !(returnsToSeen(r, c) || (BIN[IN_HASLAST] && r == (int)BIN[IN_LASTR] && c == (int)BIN[IN_LASTC]));
}
static int dR, dC;
static int fromChoice(const LineC *l) { return l->sw[0] == dR && l->sw[1] == dC; }
// WHAT STAYALIVE CHOSE TO LIVE: the decision, the frame it loses health
// (1 << 20: not within reach) and its line -- no later stage may put a choice
// that loses health sooner in its place (arbitrate, at the decision's end)
static Dec saDec; static int saSet, saN, saKind, saWait; static int32_t saLine[2 * LINEMAX];
static Dec saKeep(Dec d) {
  saSet = 1; saDec = d; saN = BT->nLine; saKind = BT->lineKind; saWait = BT->lineWaitAll;
  for (int k = 0; k < 2 * saN; k++) saLine[k] = BT->line[k];
  return d;
}
static Dec stayAlive(Dec d) {
  saSet = 0;
  if (d.kind != K_SWAP && d.kind != K_HOLD) return d;
  if (d.kind == K_SWAP && !d.hasMove) return d;
  // a break that lives, and a break line played on, are kept; a plan or cash
  // line played on is kept only if no line lives longer (below)
  if (lineLast == 3) return d;
  // a line played on is what the guard holds the decision to (arbitrate)
  if (lineLast == 1 && BT->lineKind == LINE_BREAK) return saKeep(d);
  // the engine, not the estimate, says whether the board is dying: health
  // lost within LIVEHORIZON frames, left alone
  linesReset();
  if (!aloneOnEngine() || !LNA[0] || LNA[0] > LIVEHORIZON) return lineLast == 1 ? saKeep(d) : d;
  linesFind(2, 0);
  // NEVER DYING FIRST: the choice is kept only if it lives as long as the line that lives longest
  blReady = 1; blAlone = LNA[0];
  LineC *l = bestLiving(notLastSwap);
  blReady = 0;
  if (lineLast == 1) {
    if (!l || l->life <= playLife) return saKeep(d);
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "SA leaves the line played (dies %d) for", playDie); for (int k = 0; k < l->n; k++) fprintf(BLOG, " %d,%d", l->sw[2 * k], l->sw[2 * k + 1]); fprintf(BLOG, " (dies %d)\n", l->die); }
#endif
    lineLast = 0; }
  if (d.kind == K_SWAP) {
    dR = d.sr; dC = d.sc;
    LineC *mine = bestLineAvoid(LV_LIVES | LV_GAINS, 0, fromChoice);
    if (mine && (!l || mine->life >= l->life)) { if (mine->n > 1) lineKeep(mine, LINE_CASH); return saKeep(d); }
  }
  // A HOLD IS NOT A LINE STARTED LATER: a line is judged pressed from now, and
  // every frame the board waits is a frame garbage drops on it -- the line that
  // lives longest is played now
  if (!l) return d;
  lineLast = 2;
  BT->counts[C_KEPTHEALTH]++;
  plansDrop();
  if (l->n > 1) lineKeep(l, l->brk ? LINE_BREAK : LINE_CASH); else BT->nLine = 0;
  return saKeep(lineSwap(l, V_KEEPHEALTH, d));
}
// THE ONE CHOICE. The decision the stages made, the target the walk was on
// (no press since it was chosen) and what stayAlive chose -- with none, the
// board left alone -- are weighed in one order, and the best is the decision:
// a break in time (it lives), then a line that lives, then a break in reach
// when the next slab lands (readyInTime), then the later loss of health
// (hollow costed), then the more garbage converted, then the less hollow.
// Equal: the target, the decision, the alternative, in that order -- a
// decision turns from its target only for a better one -- except a decision
// that puts back the last press (undoesPress), which the alternative keeps
// the board of unless it is better. More hollow under the garbage (and under
// the slab to come) is life lost, so the rank holds a clear that digs under a pile. Each is judged on the
// engine (lineJudge, which keeps to the work there is); one it cannot judge is
// not weighed, and a decision it cannot judge stands.
typedef struct { Dec d; int32_t sw[2 * LINEMAX]; int n, wait, rdy, rdyKnown, soonKnown, lives, breaks, cash, die, conv, hollow, pri; double life, soon; } Opt;
static int optJudge(Opt *o) {
  int last = 0, spent = 0;
  o->rdy = o->rdyKnown = o->soonKnown = o->breaks = o->conv = o->cash = 0;
  if (o->d.kind == K_HOLD) {
    o->die = aloneDie(1 << 20);
    o->hollow = aloneOnEngine() ? HOLLOW(LNA) : 0;
    o->lives = o->die > NEXTMOVE;
  } else {
    judgeRefused = 0;
    int v = lineJudge(o->sw, o->n, o->wait), die = judgedDie(v);
    if (die < 0) return 0;   // no verdict: nothing to weigh
    o->die = die; o->lives = die > 0; o->breaks = (v & LV_BREAKS) != 0;
    o->conv = LNO[2] - LNA[2]; o->hollow = HOLLOW(LNO); last = LNO[1]; spent = spentOf();
    // a combo or a chain: it clears more than the board left alone, and digs under no pile (more hollow than the hold)
    o->cash = LNO[3] - LNA[3] >= COMBOMIN && (!aloneOnEngine() || o->hollow <= HOLLOW(LNA));
  }
  o->life = lifeOf(o->die, last, o->hollow, spent);
  return 1;
}
// READY FOR THE NEXT WAVE: a break in reach when the queued slab lands
// (readyInTime); with none queued, the board the option leaves ready for a
// slab the width of the board on the stack (waveReady), as the next wave lands
static int optReady(Opt *o) {
  if (!o->rdyKnown) {
    int r, c, hold = o->d.kind == K_HOLD;
    o->rdy = 0;
    if (o->lives && BIN[IN_HASPA]) {
      if (BIN[IN_INCOMING] > 0) o->rdy = hold ? readyInTime(0, 0, &r, &c) : readyInTime(o->sw, o->n, &r, &c);
      else { int32_t st[ST_INTS], cur[2], t; uint32_t can[WMAX]; uint8_t w[32][WMAX];
             if (lineState(hold ? 0 : o->sw, hold ? 0 : o->n, st, can, w, cur, &t) == 0) o->rdy = waveReady(st); }
    }
    o->rdyKnown = 1;
  }
  return o->rdy;
}
// THE FRAMES FROM NOW TO THE SOONEST BREAK after the candidate (breakTime: the
// shared question; INF: none within the work there is), asked only of
// candidates that tie on everything above it
static double breakTime(const int32_t *steps, int n);
static double optSoon(Opt *o) {
  if (!o->soonKnown) { o->soon = breakTime(o->d.kind == K_HOLD ? 0 : o->sw, o->d.kind == K_HOLD ? 0 : o->n); o->soonKnown = 1; }
  return o->soon;
}
// 1: a is better, -1: b is, 0: the same
static int optRank(Opt *a, Opt *b) {
  int ka = a->lives ? 1 + a->breaks : 0, kb = b->lives ? 1 + b->breaks : 0;
  if (ka != kb) return ka > kb ? 1 : -1;
  if (ka && BIN[IN_INCOMING] > 0) { int ra = optReady(a), rb = optReady(b); if (ra != rb) return ra > rb ? 1 : -1; }
  // dying within LIVEHORIZON, the later loss of health is the time there is: a
  // line that takes longer to finish still outlives a hold that dies first
  int da = a->die < LIVEHORIZON ? a->die : LIVEHORIZON, db = b->die < LIVEHORIZON ? b->die : LIVEHORIZON;
  if (da != db) return da > db ? 1 : -1;
  // no break to make yet: the one that brings the break soonest (setup), then a
  // combo or a chain, the break looked for while it resolves
  // a break sooner by more than NEXTMOVE: less is the walk's own movement, and the target stands
  if (ka) { double sa = optSoon(a), sb = optSoon(b), gap = sa > sb ? sa - sb : sb - sa; if (sa != sb && !(gap <= NEXTMOVE)) return sa < sb ? 1 : -1; }
  if (a->cash != b->cash) return a->cash > b->cash ? 1 : -1;
  if (a->life != b->life) return a->life > b->life ? 1 : -1;
  if (a->conv != b->conv) return a->conv > b->conv ? 1 : -1;
  if (a->hollow != b->hollow) return a->hollow < b->hollow ? 1 : -1;
  return 0;
}
static Dec arbitrate(Dec d) {
  if (!((d.kind == K_SWAP && d.hasMove) || d.kind == K_HOLD)) return d;   // a raise: raiseMode's own rules
  Opt O[4]; int n = 0, at = -1;
  // the target the walk was on, still ahead of the decision
  int hasT = d.kind == K_SWAP && BT->tgtN && BT->nNotes == BT->tgtPresses && !(d.sr == BT->tgt[0] && d.sc == BT->tgt[1]);
  if (hasT) {
    Opt *o = &O[n]; o->d = mkSwap(BT->tgt[0], BT->tgt[1], BT->tgtVia, d.mode, d.alive); o->d.waitAll = BT->tgtN == 1 && BT->tgtWait;
    o->n = BT->tgtN; o->wait = BT->tgtWait; for (int k = 0; k < 2 * o->n; k++) o->sw[k] = BT->tgt[k];
    o->pri = 0;
    if (optJudge(o)) n++;
  }
  // the decision
  { Opt *o = &O[n]; o->d = d; at = n;
    o->pri = d.kind == K_SWAP && (BT->nLine && BT->line[0] == d.sr && BT->line[1] == d.sc ? undoesOld(d.sr, d.sc) : undoesPress(d.sr, d.sc)) ? 3 : 1;
    if (d.kind == K_SWAP) {
      int line = BT->nLine && BT->line[0] == d.sr && BT->line[1] == d.sc;
      o->n = line ? BT->nLine : 1; o->wait = line ? BT->lineWaitAll : 0;
      if (line) for (int k = 0; k < 2 * o->n; k++) o->sw[k] = BT->line[k]; else { o->sw[0] = d.sr; o->sw[1] = d.sc; }
    } else o->n = 0;
    if (!optJudge(o)) return d;
    n++; }
  // what stayAlive chose
  int ia = -1, ih = -1;
  if (saSet && !(d.kind == saDec.kind && d.hasMove == saDec.hasMove && d.sr == saDec.sr && d.sc == saDec.sc)) {
    Opt *o = &O[n];
    o->d = saDec; o->n = saN; o->wait = saWait; for (int k = 0; k < 2 * saN; k++) o->sw[k] = saLine[k];
    if (!saN && saDec.kind == K_SWAP) { o->n = 1; o->wait = 0; o->sw[0] = saDec.sr; o->sw[1] = saDec.sc; }
    o->pri = 2;
    if (optJudge(o)) ia = n++;
  }
  // the board left alone: weighed when stayAlive chose nothing, and against a swap-back, which must beat doing nothing
  if (d.kind == K_SWAP && aloneOnEngine() && (!saSet || O[at].pri == 3) && !(ia >= 0 && O[ia].d.kind == K_HOLD)) {
    Opt *o = &O[n];
    o->d = mkHold(V_KEEPHEALTH, d.mode, d.alive, 0, 0, 0); o->n = 0;
    o->pri = 2;
    if (optJudge(o)) ih = n++;
  }
  if (n < 2) return d;
  int best = 0;
  for (int i = 1; i < n; i++) { int c = optRank(&O[i], &O[best]); if (c > 0 || (c == 0 && O[i].pri < O[best].pri)) best = i; }
  if (best == at) return d;
  Opt *b = &O[best];
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "ARBITER %s %d,%d over via %d %d,%d | keys (lives breaks ready die soon cash life hollow; -1 unasked) won %d %d %d %d %g %d %g %d | lost %d %d %d %d %g %d %g %d\n", best == ia || best == ih ? "the alternative" : "the target", b->d.sr, b->d.sc, d.via, d.sr, d.sc,
      b->lives, b->breaks, b->rdyKnown ? b->rdy : -1, b->die, b->soonKnown ? b->soon : -1.0, b->cash, b->life, b->hollow,
      O[at].lives, O[at].breaks, O[at].rdyKnown ? O[at].rdy : -1, O[at].die, O[at].soonKnown ? O[at].soon : -1.0, O[at].cash, O[at].life, O[at].hollow); }
#endif
  if (best == ia) lineSet(saLine, saN, saKind, saWait);
  else if (best == ih) BT->nLine = 0;
  else if (BT->tgtN > 1) lineSet(BT->tgt, BT->tgtN, BT->tgtKind, BT->tgtWait);
  else BT->nLine = 0;
  return b->d;
}

#define BATCH 8
#define ROOMLEFT 4
// BREAKING COMES FIRST.
static Dec breakDeeper(Dec d);
static Dec makeRoom(Dec d);
static int roomForBreak(const int32_t *st);
static Dec breakFirst(Dec d) {
  bbHasDeferred = 0;
  // a line played on is kept only if it is itself a break
  int playing = lineLast == 1 && BT->lineKind != LINE_BREAK;
  if ((lineLast && !playing) || d.kind == K_RAISE || !hasGarbage(DBASE)) {
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "BREAKFIRST skipped: lineLast %d line kind %d nLine %d raise %d garbage on board %d\n", lineLast, BT->lineKind, BT->nLine, d.kind == K_RAISE, hasGarbage(DBASE)); }
#endif
    return d;
  }
  if (d.kind == K_SWAP && d.hasMove && !playing && swapBreaks(d)) return d;
  // THE BREAKS, IN TIME: the lines are found soonest first, as long as time
  // and work allow (linesFind, searchInTime); the first LIVINGS living breaks,
  // by rank, are the ones weighed (bestBreak)
  LineC *l = 0;
  { growRootMs = growKidMs = growStateMs = 0; growKids = 0;
    double lf0 = NOWMS2();
    linesFind(REROOTS, 1);
#ifndef __wasm__
    if (0) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "LINESFIND %.2f ms | root %.2f kids %d %.2f states %.2f | lines %d\n", NOWMS2() - lf0, growRootMs, growKids, growKidMs, growStateMs, nLines); }
#endif
    l = bestBreak(); }
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; int g = 0, live = 0;
    for (int i = 0; i < nLines; i++) { if (LINES[i].grown) g++; if (LINES[i].verdict != 0) live++; }
    fprintf(BLOG, "BREAKFIRST lines %d grown %d open %d k %g\n", nLines, g, live, timeLeft()); }
#endif
  if (!l) return breakDeeper(d);
  // ROOM FIRST: a break whose panels the board cannot hold tops it out with
  // them; while a clear can make the room and lives, it goes first
  if (!roomForBreak(DBASE)) {
    Dec m = makeRoom(d);
    if (m.kind == K_SWAP && m.hasMove && !(d.kind == K_SWAP && m.sr == d.sr && m.sc == d.sc) && m.via == V_KEEPHEALTH) return m;
  }
  // BREAK AT THE RIGHT TIME: a break after which the next slab lands with no
  // break in reach waits while the board left alone does not die -- the
  // other routes ready the board meanwhile, and the break is still there
  // -- and only while the board can still hold what the break makes, the next
  // slab on the pile included: past that, waiting only grows the pile
  if (!bbReady && roomForBreak(DBASE) && aloneOnEngine() && !LNA[0]) { bbDeferred = *l; bbHasDeferred = 1; return d; }
  lineLast = 3;
  plansDrop();
  if (l->n > 1) lineKeep(l, LINE_BREAK); else BT->nLine = 0;
  return lineSwap(l, V_BREAKREACH, d);
}

// A BREAK KEPT IN REACH.
static ST KBA;
static JLOCAL int32_t KBR[R_INTS + ST_INTS];
// THE DEEPER SEARCH'S SHARE: what the decision has left once the stages
// after breakFirst keep theirs (stageLeaves); the search stops there with what it found
static double kbEnd;
extern PATLS double paWork;
// A BREAK IN REACH, IN TIME: a break -- however many swaps -- on the board st
// settles to (st breaking counts), its last press by `left`, walked from the
// cursor. The shared search's (searchInTime): soonest first.
static int breakWithin(const int32_t *st, double left) {
  resolve(st, KBR, 1);
  if (KBR[R_SCOPE] == SC_BROKE) return 1;
  if (KBR[R_SCOPE] != SC_OK) return 0;
  static JLOCAL ST kb0; stcpy(kb0, KBR + R_INTS);
  return searchInTime(kb0, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 0, 0, left, BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0,
                      0, 0, BREAKWORK, sitBreaks, 0, 0, 0, 0);
}
// PAST THE LINES: when none of the lines breaks, the shared search is asked
// again for a break with what the decision has left of its work, and the line
// it finds is played if the engine says it lives and breaks -- in the time there is.
static Dec breakDeeper(Dec d) {
  if (!BIN[IN_HASPA]) return d;
  resolve(DBASE, KBR, 1);
  if (KBR[R_SCOPE] != SC_OK) return d;
  static ST kb0; stcpy(kb0, KBR + R_INTS);
  kbEnd = stageLeaves(2);
  if (paWork >= kbEnd) return d;
  int32_t sw[2 * LINEMAX]; int n = 0;
  if (!searchInTime(kb0, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 0, 0, timeLeft(), BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0,
                    0, 0, kbEnd - paWork, sitBreaks, 0, sw, &n, 0)) return d;
  if ((lineJudge(sw, n, 0) & (LV_LIVES | LV_BREAKS)) != (LV_LIVES | LV_BREAKS)) return d;
  LineC l = { 0 }; l.n = n; l.brk = 1; for (int k = 0; k < 2 * n; k++) l.sw[k] = sw[k];
  lineLast = 3;
  plansDrop();
  lineKeep(&l, LINE_BREAK);
  return mkSwap(sw[0], sw[1], V_BREAKREACH, d.mode, d.alive);
}
static int keepsBreak(int r, int c) {
  stcpy(KBA, DBASE);
  if (!swapIn(KBA, r, c)) return 0;
  return breakWithin(KBA, timeLeft());
}
static int keepsIt(const LineC *l) { return l->brk || (notLastSwap(l) && keepsBreak(l->sw[0], l->sw[1])); }
static Dec keepBreak(Dec d) {
  if (lineLast || !BIN[IN_TOPPED] || d.kind != K_SWAP || !d.hasMove) return d;
  if (!breakWithin(DBASE, timeLeft()) || keepsBreak(d.sr, d.sc)) return d;
  linesFind(2, 0);
  LineC *l = bestLine(LV_LIVES | LV_PAYS, keepsIt);
  if (!l) return d;
  lineLast = 4;
  plansDrop();
  if (l->n > 1) lineKeep(l, l->brk ? LINE_BREAK : LINE_CASH); else BT->nLine = 0;
  return lineSwap(l, V_KEEPHEALTH, d);
}
// LINE UP THE NEXT BREAK. With nothing to break now and garbage still to
// drop, the bot arranges the board for the slab coming: a swap is played on
// the engine, the board left alone until the next slab has dropped and
// landed. Best is a lineup that breaks it -- the engine converts garbage the
// board alone would not; next, one after which a break is pressed in time on
// the board it settles to (readyAfter). A lineup must live, and spends no panels when one
// that spends none will do.
int lineLanded(const int32_t *steps, int n, int32_t *masks, int32_t *t);
int lineLandedFull(const int32_t *steps, int n, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t);
static ST LUM;
static int lineupLast;
static int luStates, luRanks, luReady; static double luStateMs, luRankMs, luReadyMs;   // GC_WORKSTAT
static int readyAfterIn(const int32_t *sw, int n);
static int maskBreaks(const int32_t *st, const int32_t *sw, int n);
static void parallelDo(int count, void (*task)(int));
// a lineup's readiness, once a decision
#define RAN 512
typedef struct { int dec, n, v; int32_t sw[2 * LINEMAX]; } RAMemo;
static RAMemo RAM[RAN];
// the decision's memos, touched before the game (frontWarm)
static void botWarm(void) { __builtin_memset(JM, 0, sizeof JM); __builtin_memset(RAM, 0, sizeof RAM); }
static RAMemo *raSlot(const int32_t *sw, int n) {
  unsigned h = 2166136261u ^ (unsigned)n;
  for (int k = 0; k < 2 * n; k++) h = (h ^ (unsigned)sw[k]) * 16777619u;
  return &RAM[h & (RAN - 1)];
}
static int raFind(const int32_t *sw, int n, int *v) {
  RAMemo *m = raSlot(sw, n);
  if (m->dec != btDecision || m->n != n || __builtin_memcmp(m->sw, sw, (unsigned long)n * 8)) return 0;
  *v = m->v; return 1;
}
static void raPut(const int32_t *sw, int n, int v) {
  RAMemo *m = raSlot(sw, n);
  m->dec = btDecision; m->n = n; m->v = v;
  for (int k = 0; k < 2 * n; k++) m->sw[k] = sw[k];
}
static int readyAfter(const int32_t *sw, int n) {
  int v;
  if (n >= 1 && n <= LINEMAX && raFind(sw, n, &v)) return v;
  double t0 = NOWMS2(); v = readyAfterIn(sw, n); luReady++; luReadyMs += NOWMS2() - t0;
  extern int paBudgetOut(void);
  if (n >= 1 && n <= LINEMAX && !paBudgetOut()) raPut(sw, n, v);
  return v;
}
// THE MASKS PROPOSE, THE ENGINE JUDGES: the lineup's readiness read off the
// masks (a break in reach when the next slab lands), the arbiter's on the engine (readyInTime)
static int readyAfterIn(const int32_t *sw, int n) {
  int32_t t; ST lum; int last;
  if (lineLanded(sw, n, lum, &t) != 0) return 0;
  double die = lineEnds(sw, n, &last);
  int frozen = BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0;
  int cr = n ? sw[2 * (n - 1)] : (int)BIN[IN_CROW], cc = n ? sw[2 * (n - 1) + 1] : (int)BIN[IN_CCOL];
  return searchInTime(lum, cr, cc, n ? last + stepGap(frozen) : 0, t, die - 1, frozen, 0, 0, READYWORK, sitBreaks, 0, 0, 0, 0);
}
// Where a lineup can matter: the rows up to the one the next slab lands on,
// in its columns and one either side.
static int lineupNear(const int32_t *st, int r, int c) {
  int w = (int)BIN[IN_SLABW], c0 = (int)BIN[IN_SLABC];
  if (w <= 0 || c0 <= 0) return 1;
  int land = 0;
  for (int cc = c0; cc < c0 + w && cc <= BW; cc++) { int top = topRow(U(st, OCC + cc)); if (top > land) land = top; }
  land++;
  return r >= land - 2 && r <= land && c + 1 >= c0 - 1 && c <= c0 + w;
}
#define LUBEST 5   // a break that spends nothing
// A LINEUP'S SCORE: its rank, then -- among lineups of one rank -- the less
// hollow it leaves the slabs to come (HOLLOW: the gaps under garbage and over
// towers), a share of a rank that never reaches the next: rank + 0.5/(1+hollow)
#define LUMOST (LUBEST + 0.5)
static int luHollow;   // the hollow of the line lineupRank judged last
static double luScore(int rank) { return rank ? rank + 0.5 / (1 + luHollow) : 0; }
#define MEANWHILE 30   // frames before a swap is pressed, past which a clear may go first
#define MEANWHILES 6   // clears asked, at most
// the rank of a lineup, asked only for ranks of at least `need`: a lineup
// that is only ready ranks 2 or 3, so past 3 readiness is not looked for
// The masks propose, the engine judges: a lineup the masks show breaking
// nothing is sent to the engine only if being ready could rank it, and then
// readiness is asked before survival, as the cheaper of the two.
static ST LUK; static int32_t LUKR[R_INTS + ST_INTS];
static int maskBreaks(const int32_t *st, const int32_t *sw, int n) {
  stcpy(LUK, st);
  for (int k = 0; k < n; k++) {
    if (!swapIn(LUK, sw[2 * k], sw[2 * k + 1])) return 0;
    resolve(LUK, LUKR, 1);
    if (LUKR[R_SCOPE] == SC_BROKE) return 1;
    if (LUKR[R_SCOPE] != SC_OK) return 0;
    stcpy(LUK, LUKR + R_INTS);
  }
  return 0;
}
static int lineupRank(const int32_t *st, const int32_t *sw, int n, int need) {
  if (need > LUBEST) return 0;
  int mb = maskBreaks(st, sw, n);
  if (!mb && need > 3) return 0;
  if (!mb && !readyAfter(sw, n)) return 0;
  int v = lineJudge(sw, n, 0);
  if (!(v & LV_LIVES)) return 0;
  luHollow = HOLLOW(LNO);
  int spends = LNO[3] > LNA[3];
  int rank = (v & LV_BREAKS) ? 4 : 0;
  if (!rank && need <= 3 && (!mb || readyAfter(sw, n))) rank = 2;
  return rank ? rank + !spends : 0;
}
// THE LINEUP'S LINES: the shared search in time grows every line near the
// slab, soonest first; each is judged on the engine (lineupRank) at a rank
// that can still win, and a line is ended once it breaks, leaves the slab, or
// arrives too late to win (outPast: what follows it is later still)
typedef struct { Best *B; const int32_t *st0; } LuCtx;
static int sitLineup(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  LuCtx *x = ctx;
  if (outPast(x->B, LUMOST, at) || !lineupNear(res + R_INTS, sw[2 * n - 2], sw[2 * n - 1])) return SIT_END;
  double rk = NOWMS2();
  int rank = lineupRank(x->st0, sw, n, !x->B->has ? 0 : (int)x->B->score);
  luRanks++; luRankMs += NOWMS2() - rk;
  if (rank) bestTake(x->B, luScore(rank), at, sw, n);
  return rank >= 4 ? SIT_END : SIT_GROW;
}
static Dec lineupFirst(Dec d) {
  lineupLast = 0;
  // a lineup is for a board with time: topped with death in sight, staying alive comes first
  if (lineLast || d.kind == K_RAISE || !(BIN[IN_INCOMING] > 0) || !BIN[IN_HASPA]) return d;
  if (BIN[IN_TOPPED] && (!aloneOnEngine() || (LNA[0] && LNA[0] <= LIVEHORIZON))) return d;
  if (swapBreaks(d)) return d;
  linesReset();
  int32_t st0[ST_INTS], cur[2], t;
  uint32_t can0[WMAX];
  uint8_t waits0[32][WMAX];
  if (lineState(0, 0, st0, can0, waits0, cur, &t) != 0) return d;
  luStates = luRanks = luReady = 0; luStateMs = luRankMs = luReadyMs = 0;
  Best B = { 0 };
  // THE LINEUP'S SHARE: what the decision has left once the stages after it keep theirs
  double luEnd = stageLeaves(4);
  int last;
  LuCtx x = { &B, st0 };
  if (paWork < luEnd)
    searchInTime(st0, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 0, 0, lineEnds(0, 0, &last), BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0,
                 can0, waits0, luEnd - paWork, sitLineup, &x, 0, 0, 0);
#ifndef __wasm__
  if (0) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "LINEUP states %d %.2f ms | ranks %d %.2f ms (ready %d %.2f ms)\n", luStates, luStateMs, luRanks, luRankMs, luReady, luReadyMs); }
#endif
  if (!B.has) return d;
  if (B.n == 1 && d.kind == K_SWAP && d.hasMove && d.sr == B.sw[0] && d.sc == B.sw[1]) return d;
  // the masks propose the lineup, the engine judges it, as every line
  if (!(lineJudge(B.sw, B.n, 0) & LV_LIVES)) return d;
  lineupLast = (int)B.score;
  lineLast = 5;
  plansDrop();
  BT->nLine = 0;
  if (B.n >= 2) lineSet(B.sw, B.n, LINE_PLAN, 0);
  return mkSwap(B.sw[0], B.sw[1], V_LINEUP, d.mode, d.alive);
}
// READY WHEN IT LANDS: a slab one row high drops the first frame no panel
// is active (pa.c shouldDropGarbage). Whatever route chose it, a choice that
// is not a break and lets the slab land with no break the cursor reaches in
// time is replaced by a swap after which it does (readyInTime), if one lives
// as long. The landing is never put off for its own sake: the queue does not
// shrink while the board is kept busy, it lands later all at once.
#define READYTRIES 8
// ROOM FOR WHAT A BREAK MAKES: broken, the garbage on the board and the next
// slab turn into panels; ready needs the board to hold them and the slab after
static int roomForBreak(const int32_t *st) {
  int occ = 0;   // the panels and every garbage cell: all of it panels once broken
  for (int c = 1; c <= BW; c++) occ += popc(U(st, OCC + c));
  return (occ + BIN[IN_NEXTSLAB]) / BW + 1 <= BH;
}
// READY IN TIME: after `sw`, the slab lands, and a swap breaks it that the
// cursor reaches by then -- from where the line leaves it, in the frames
// between the line's last press and the landing -- so the press comes the
// frame the slab lands, before the board goes quiet and the slab after it
// drops too. The nearest such swap (none: 0); the cursor waits on it.
static ST RBL, RBS; static int32_t RBR[R_INTS + ST_INTS], RBSW[2 * 128];
int lineLandedFull(const int32_t *steps, int n, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t);
// each line's answer is the decision's: asked again, it is not replayed again
#define RMEMO 512
static struct { int dec, n, ok, r, c; int32_t sw[2 * LINEMAX]; } RMEM[RMEMO];   // asked of a line once a decision, whoever asks
static int readyInTimeRaw(const int32_t *sw, int n, int *br, int *bc);
// A REPLAY ONLY WHERE THE BUDGET HOLDS ONE: the work the decision has spent
// (from its start, rdW0) and what a replay costs (rdCost, the most one has
// taken) must fit in OPTWORK; past that a board is not called ready.
static double rdCost;
static int readyInTime(const int32_t *sw, int n, int *br, int *bc) {
  extern PATLS double paWork;
  unsigned h = 2166136261u ^ (unsigned)n;
  for (int k = 0; k < 2 * n; k++) h = (h ^ (unsigned)sw[k]) * 16777619u;
  int slot = n <= LINEMAX ? (int)(h & (RMEMO - 1)) : -1;
  if (slot >= 0 && RMEM[slot].dec == btDecision && RMEM[slot].n == n && (!n || !__builtin_memcmp(RMEM[slot].sw, sw, (unsigned long)n * 8))) {
    *br = RMEM[slot].r; *bc = RMEM[slot].c; return RMEM[slot].ok; }
  if (rdCost > workLeft()) return 0;   // the work this thread has left (workLeft)
  double w = paWork;
  int ok = readyInTimeRaw(sw, n, br, bc);
  if (paWork - w > rdCost) rdCost = paWork - w;
  extern int paBudgetOut(void);
  if (slot >= 0 && !paBudgetOut() && !inWorker) {
    RMEM[slot].dec = btDecision; RMEM[slot].n = n; RMEM[slot].ok = ok; RMEM[slot].r = ok ? *br : 0; RMEM[slot].c = ok ? *bc : 0;
    for (int k = 0; k < 2 * n; k++) RMEM[slot].sw[k] = sw[k];
  }
  return ok;
}
#ifndef __wasm__
// THE BOARD A PREDICTION RESTS ON, for the bot log: masks read, nothing
// written, rows top to bottom as the trace prints them ('g' garbage)
static void traceMasks(const int32_t *st) {
  extern int fprintf(void *, const char *, ...); extern void *stderr;
  int w = st[O_W], h = st[O_H] < 31 ? st[O_H] : 31, N = st[O_N];
  for (int r = h; r >= 1; r--) {
    fprintf(BLOG, " ");
    for (int c = 1; c <= w; c++) {
      uint32_t b = 1u << (r - 1); char ch = '.';
      if (U(st, GARB + c) & b) ch = 'g';
      else for (int a = 1; a <= N; a++) if (CL(st, a, c) & b) ch = (char)('0' + a);
      fprintf(BLOG, "%c", ch);
    }
  }
}
#endif
// READY ACROSS THE DUMP: on a quiet board the queue drops slab after slab,
// each once the one before it has landed, until a break makes the board busy
// -- so a break pressed as ANY of them lands stops the dump, and every slab
// down gives the break more garbage to touch. The k-th landing is asked in
// turn (lineLandedK) until one has a break in reach or the dump tops the board.
int lineLandedK(const int32_t *steps, int n, int k, int32_t *masks, uint32_t *can, uint8_t (*wait)[WMAX], int32_t *cur, int32_t *t);
// READY, BY TIME: once a slab has landed, a break -- however many swaps --
// whose last press comes after the garbage rests and before the board loses
// health (the line's own judged loss, else the board left alone's, else the
// judge's reach), walked from where the line leaves the cursor. Searched
// soonest first (searchInTime); `br, bc` its first step.
static int readyInTimeRaw(const int32_t *sw, int n, int *br, int *bc) {
  uint32_t can[WMAX]; uint8_t wt[32][WMAX]; int32_t cur[2], t;
  int last = -1, found = 0; double die = LINEREACH;
  for (int k = 1; !found; k++) {
    // A SLAB THAT DOES NOT COME DOWN waits on the pile until a break makes it
    // room: ready is then a break in time against the garbage the board holds
    // where the line leaves it
    int landed = lineLandedK(sw, n, k, RBL, can, wt, cur, &t) == 0;
    if (!landed && (k > 1 || lineState(sw, n, RBL, can, wt, cur, &t) != 0 || !hasGarbage(RBL))) return 0;
    // a slab that tops the board out as it lands leaves no time for the break:
    // topped with no stop, the board dies the next frame
    if (landed && tallestBoard(RBL) >= BH) return 0;
    if (last < 0) die = lineEnds(sw, n, &last);
    // THE BOARD AS THE SLAB RESTS: the replay stops the frame it lands, its
    // cells still busy with the landing, and a busy cell takes no swap -- the
    // search waits for the rest (not before t) and reads the board settled
    if (landed) RBL[O_BUSYF] = 0;
    { int32_t bsw[2 * LINEMAX]; int bn; double bat;
      int frozen = BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0;
      double start = n ? last + stepGap(frozen) : 0;
      if (searchInTime(RBL, cur[0], cur[1], start, t, die - 1, frozen, 0, 0, READYWORK, sitBreaks, 0, bsw, &bn, &bat)) { *br = bsw[0]; *bc = bsw[1]; found = 1; } }
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr;
      fprintf(BLOG, "  LANDS after");
      for (int q = 0; q < n; q++) fprintf(BLOG, " %d,%d", sw[2 * q], sw[2 * q + 1]);
      fprintf(BLOG, " slab %d at %d, cursor %d,%d, break %d,%d |", k, t, cur[0], cur[1], found ? *br : 0, found ? *bc : 0);
      traceMasks(RBL); fprintf(BLOG, "\n"); }
#endif
    if (!landed) break;
  }
  return found;
}
// A PILE LET DOWN IS GARBAGE ARRIVING. A swap that sets garbage at rest
// falling (DROPS) and leaves no break in reach where it lands (readyInTime)
// gives way to the soonest living line that does and clears the readiness
// bar (readyBar; readiesLine, clears allowed). With none, the drop is played: standing still readies
// nothing, and the pile let down lowers the stack.
static int readiesLine(Dec d, int dieRef, int spare, int32_t *sw, int *n, int *r, int *c);
static Dec dropReady(Dec d) {
  if (d.kind != K_SWAP || !d.hasMove || !BIN[IN_HASPA] || !hasGarbage(DBASE)) return d;
  if (lineLast == 3 || (lineLast == 1 && BT->lineKind == LINE_BREAK) || endsInBreak(d)) return d;
  if (swapBreaks(d)) return d;
  int32_t sw[2] = { d.sr, d.sc };
  int v = lineJudge(sw, 1, 0);
  if (!(v & LV_DROPS) || (v & LV_BREAKS)) return d;
  int dieRef = readyBar(), r, c;
  if (readyInTime(sw, 1, &r, &c)) return d;
  int32_t rl[2 * LINEMAX]; int rn;
  if (readiesLine(d, dieRef, 1, rl, &rn, &r, &c) != 1) return d;
  if (rn > 1) lineSet(rl, rn, LINE_PLAN, 0); else BT->nLine = 0;
  lineLast = 8;
  return mkSwap(rl[0], rl[1], V_LINEUP, d.mode, d.alive);
}
// NO ROOM FOR A BREAK: the panels a break makes would top the board out, so
// before the next slab is readied there must be room for it. Material is
// spent then: a choice that clears less than the living clear that clears
// most, and dies no sooner, gives way to it.
// THE SHARED SEARCH IN TIME, from the board the engine settles to now, the
// lines pressed before `left`, within what the decision's work has left (and
// at most `cap` of it)
static void waitSearchW(double left, SitAccept accept, void *ctx, double cap);
static void waitSearch(double left, SitAccept accept, void *ctx) { waitSearchW(left, accept, ctx, 1e300); }
static void waitSearchW(double left, SitAccept accept, void *ctx, double cap) {
  static ST w0; int32_t cur0[2], t0; uint32_t can0[WMAX]; uint8_t wt0[32][WMAX];
  extern PATLS double paWork;
  int32_t keepO[LNOLEN]; for (int k = 0; k < LNOLEN; k++) keepO[k] = LNO[k];
  double work = optLine() - paWork; if (work > cap) work = cap;
  if (lineState(0, 0, w0, can0, wt0, cur0, &t0) == 0 && work > 0)
    searchInTime(w0, cur0[0], cur0[1], t0, 0, left, BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0, can0, wt0, work, accept, ctx, 0, 0, 0);
  for (int k = 0; k < LNOLEN; k++) LNO[k] = keepO[k];
}
// ROOM's accept: a line ending in a clear that lives, loses health no sooner
// than the choice (die0), and clears more than any before it (MAXCAND asked)
typedef struct { int die0, most, tried, bn; int32_t bsw[2 * LINEMAX]; } RoomCtx;
static int sitRoom(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  RoomCtx *x = ctx; (void)at;
  if (res[R_SCOPE] != SC_OK) return SIT_END;
  if (!(res[R_TOTAL] > 0)) return SIT_GROW;
  if (x->tried >= MAXCAND) return SIT_TAKE;
  x->tried++;
  if (!(lineJudge(sw, n, 0) & LV_LIVES) || lnoDie(LNO) < x->die0 || LNO[3] <= x->most) return SIT_END;
  x->most = LNO[3]; x->bn = n; for (int k = 0; k < 2 * n; k++) x->bsw[k] = sw[k];
  return SIT_END;
}
static Dec makeRoom(Dec d) {
  if (swapBreaks(d)) return d;
  int32_t sw[2] = { d.sr, d.sc };
  int cells0 = 0, die0 = 1 << 20;
  if (d.kind == K_SWAP && d.hasMove) { if (lineJudge(sw, 1, 0) & LV_LIVES) { cells0 = LNO[3]; die0 = lnoDie(LNO); } else die0 = 0; }
  else if (aloneOnEngine()) { cells0 = LNA[3]; die0 = aloneDie(0); }
  // the living clears in time, soonest first: the one that clears most
  RoomCtx x; x.die0 = die0; x.most = cells0; x.bn = 0; x.tried = 0;
  waitSearch(LINEHORIZON, sitRoom, &x);
  if (!x.bn) return d;
  if (x.bn > 1) lineSet(x.bsw + 2, x.bn - 1, LINE_PLAN, 0); else BT->nLine = 0;
  lineLast = 8;
  return mkSwap(x.bsw[0], x.bsw[1], V_KEEPHEALTH, d.mode, d.alive);
}
// NO STALL: with nothing on the board to break, a clear only keeps the board
// busy, and a busy board holds the queue off without making it any shorter
// -- it lands later, all at once, on a board the clears have spent. So while
// there is room for the next slab and the board is not topped, a clear that
// breaks nothing is not played: the board goes quiet and the slab comes, to
// a board readied for it.
// NOR A PERCH: a clear that breaks nothing and leaves more hollow under the
// garbage that lands than the board left alone digs the gap a slab perches
// over -- the board made less ready, not more.
// THE LEVELLER FILL FOUND: of the swaps and walks fill judged this decision,
// the one that clears nothing, loses health no sooner than the board left
// alone and leaves the least hollow (fewer than left alone) -- what a wait
// for the landing plays (noStall)
static Best fillLevel; static int fillLevelDec = -1;
// DOWNTIME LEVELS, THEN SETS UP VERTICAL TWOS: a decision that comes to
// standing still (not for a raise, nor with a line being played) plays fill's
// leveller if fill found one; else the swap,
// nearest the cursor first, that clears nothing, loses health no sooner and
// leaves no more hollow than the board left alone, and leaves the most
// vertical twos ready (LNO[14]: two of a colour atop a column, a third in the
// row under them within two columns -- a break for whatever lands there, a
// swap or two away) -- and keeps a break in the time the board left alone has
#define SETUPTRIES 8
static double marginAfter(const int32_t *sw, int n, int die);
// THE LEVELLER IN THE TIME THERE IS: if the board left alone breaks before it
// loses health, so must the board fill's leveller leaves
static int levelInTime(void) {
  if (!aloneOnEngine()) return 0;
  if (marginAfter(0, 0, LNA[0]) < 0) return 1;
  lineJudge(fillLevel.sw, fillLevel.n, 0);
  return marginAfter(fillLevel.sw, fillLevel.n, LNO[0]) >= 0;
}
// A COLUMN'S WORKING TOP: the highest panel a swap can reach under the
// column's lowest garbage, or the column's top when it holds none. Garbage
// cannot be swapped, so a reach measured from its top reaches nothing.
static int workTop(const int32_t *st, int c) {
  uint32_t g = U(st, GARB + c);
  return g ? __builtin_ctz(g) : topRow(U(st, OCC + c));
}
// VERTICAL TWOS ON THE MASKS: the judge's count (front.c out[14]) read off a
// predicted board, so two-swap setups can be ranked before the engine judges one
static int twosOfIn(const int32_t *st, int breaking);
static int twosOf(const int32_t *st) { return twosOfIn(st, 0); }
// the twos whose three touches garbage: lined up, they break
static int breakTwosOf(const int32_t *st) { return twosOfIn(st, 1); }
static int twosOfIn(const int32_t *st, int breaking) {
  int W = st[O_W], n = 0;
#define VP(r, c) ((r) >= 1 && (U(st, OCC + (c)) & (1u << ((r) - 1))) && !(U(st, (GARB) + (c)) & (1u << ((r) - 1))) && !(U(st, INERT + (c)) & (1u << ((r) - 1))))
  for (int c = 1; c <= W; c++) {
    int r = workTop(st, c);
    if (r < 3 || !VP(r, c) || !VP(r - 1, c)) continue;
    int col = colourFirst(st, c, 1u << (r - 1));
    if (!col || colourFirst(st, c, 1u << (r - 2)) != col || (VP(r - 2, c) && colourFirst(st, c, 1u << (r - 3)) == col)) continue;
    int ready = 0;
    for (int dd = -1; dd <= 1 && !ready; dd += 2)
      for (int k = 1; k <= 2; k++) {
        int cc = c + dd * k;
        if (cc < 1 || cc > W || (U(st, (GARB) + cc) & (1u << (r - 3)))) break;
        if (VP(r - 2, cc) && colourFirst(st, cc, 1u << (r - 3)) == col) { ready = 1; break; }
      }
    if (ready && breaking) {   // the three, rows r-2..r of c: garbage over it or beside it
      uint32_t three = 7u << (r - 3), g = U(st, GARB + c) & (1u << r);
      if (c > 1) g |= U(st, GARB + c - 1) & three;
      if (c < W) g |= U(st, GARB + c + 1) & three;
      ready = g != 0;
    }
    n += ready;
  }
#undef VP
  return n;
}
// SETUPS IN TIME: lines found soonest first by the shared search on the board
// the engine settles to, every step pressed in the time there is; a line is a
// setup if the board it leaves has more vertical twos (twosOf, read where the
// setup makes them) than the board has now -- or, a line that clears on the
// way (a combo, a chain), if the board it leaves has a break in reach. The
// first SETUPTRIES found are kept, each with its twos and its time.
#define SETUPWORK 6000
typedef struct { int base, n, len[SETUPTRIES], tw[SETUPTRIES], reach[SETUPTRIES]; int32_t sw[SETUPTRIES][2 * LINEMAX]; double at[SETUPTRIES]; } SetupCtx;   // reach: the board it leaves has a break in reach
#define SETUPREACH 1000   // a setup that leaves a break in reach ranks above any count of twos
static int sitSetup(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  SetupCtx *x = ctx;
  if (res[R_SCOPE] != SC_OK) return SIT_END;   // a break is the break stages'
  // A COMBO OR A CHAIN SETS UP TOO: a line that clears is a setup when the
  // board it leaves has a break in reach (anyBreakOf) -- the clear spent for
  // that break -- and grows on otherwise
  int tw, reach = 0;
  if (res[R_TOTAL] > 0) { if (!anyBreakOf(res + R_INTS)) return SIT_GROW; tw = SETUPREACH; reach = 1; }
  else tw = twosOf(res + R_INTS);
  if (tw > x->base && x->n < SETUPTRIES) {
    int k = x->n++;
    x->len[k] = n; x->tw[k] = tw; x->at[k] = at; x->reach[k] = reach;
    for (int q = 0; q < 2 * n; q++) x->sw[k][q] = sw[q];
    if (x->n >= SETUPTRIES) return SIT_TAKE;
  }
  return SIT_GROW;
}
// the next of them to judge: most twos, then soonest; each taken once
static int nextSetup(SetupCtx *x) {
  int at = -1;
  for (int i = 0; i < x->n; i++) if (x->tw[i] > 0 && (at < 0 || x->tw[i] > x->tw[at] || (x->tw[i] == x->tw[at] && x->at[i] < x->at[at]))) at = i;
  if (at >= 0) x->tw[at] = 0;
  return at;
}
// THE SETUPS THERE ARE, every step pressed by `left`: the shared search from
// the board the engine settles to, with up to SETUPWORK of what the decision
// has left. 0: no board to search from.
static int setupLines(SetupCtx *x, double left) {
  extern PATLS double paWork;
  static ST st1; int32_t cur1[2], t1; uint32_t can1[WMAX]; uint8_t waits1[32][WMAX];
  x->n = 0;
  if (lineState(0, 0, st1, can1, waits1, cur1, &t1) != 0 || paWork >= optLine()) return 0;
  x->base = twosOf(st1);
  double work = optLine() - paWork; if (work > SETUPWORK) work = SETUPWORK;
  searchInTime(st1, cur1[0], cur1[1], t1, 0, left, BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0, can1, waits1, work, sitSetup, x, 0, 0, 0);
  return 1;
}
static Dec setupTwos(Dec d) {
  if (d.kind != K_HOLD || d.via == V_RAISING || BT->nLine || !BIN[IN_HASPA] || BIN[IN_TOPPED]) return d;
  // levelling first: a slab that perches breaks on nothing
  if (fillLevelDec == btDecision && fillLevel.has && levelInTime()) return mkSwap(fillLevel.sw[0], fillLevel.sw[1], V_FILL, d.mode, d.alive);
  if (!aloneOnEngine()) return d;
  static SetupCtx x;
  if (!setupLines(&x, timeLeft())) return d;
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "SETUP lines %d, twos now %d\n", x.n, x.base); }
#endif
  // each judged on the engine, most twos first: it lives, pays nothing, loses
  // health no sooner and leaves no more hollow than the board left alone, and
  // -- IN THE TIME THERE IS -- if the board left alone breaks before it loses
  // health, so must the board the setup leaves
  double need = marginAfter(0, 0, LNA[0]);
  for (int done = 0; done < x.n; done++) {
    int at = nextSetup(&x);
    if (at < 0) break;
    int32_t *sw = x.sw[at]; int n = x.len[at];
    int v = lineJudge(sw, n, 0);
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "  SETUP"); for (int k = 0; k < n; k++) fprintf(BLOG, " %d,%d", sw[2 * k], sw[2 * k + 1]); fprintf(BLOG, " | v %d die %d/%d hollow %d/%d last %d\n", v, LNO[0], LNA[0], HOLLOW(LNO), HOLLOW(LNA), LNO[1]); }
#endif
    // it pays nothing -- unless it leaves a break in reach: material spent only to break
    if (!(v & LV_LIVES) || ((v & LV_PAYS) && !x.reach[at]) || (LNA[0] ? (LNO[0] && LNO[0] < LNA[0]) : LNO[0] != 0) || HOLLOW(LNO) > HOLLOW(LNA)) continue;
    if (need >= 0 && marginAfter(sw, n, LNO[0]) < 0) continue;
    if (n > 1) lineSet(sw, n, LINE_PLAN, 0);
    return mkSwap(sw[0], sw[1], V_SETUP, d.mode, d.alive);
  }
  return d;
}
// THE WAIT'S FILL's accept: a quiet line that lives, pays nothing, loses
// health no sooner than the board left alone, and leaves the least hollow
typedef struct { int tried, hb, bn; int32_t bsw[2 * LINEMAX]; } FillCtx;
static int sitFill(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  FillCtx *x = ctx; (void)at;
  if (res[R_SCOPE] != SC_OK || res[R_TOTAL] > 0) return SIT_END;
  if (x->tried >= MEANWHILES) return SIT_TAKE;
  x->tried++;
  int v = lineJudge(sw, n, 0);
  if (!(v & LV_LIVES) || (v & LV_PAYS) || (LNA[0] ? (LNO[0] && LNO[0] < LNA[0]) : LNO[0] != 0) || HOLLOW(LNO) >= x->hb) return SIT_GROW;
  x->hb = HOLLOW(LNO); x->bn = n; for (int k = 0; k < 2 * n; k++) x->bsw[k] = sw[k];
  return SIT_GROW;
}
// the target is what the decision finally walks to, recorded after the guards
static void recordTarget(Dec d) {
  // a hold leaves the target as it was: only a press, or a rule that outranks it, ends it
  if (!(d.kind == K_SWAP && d.hasMove)) return;
  if (BT->tgtN && d.sr == BT->tgt[0] && d.sc == BT->tgt[1] && BT->nNotes == BT->tgtPresses) return;   // the target kept
  BT->tgtN = 0;
  int line = BT->nLine && BT->line[0] == d.sr && BT->line[1] == d.sc;
  BT->tgtN = line ? BT->nLine : 1; BT->tgtKind = line ? BT->lineKind : 0; BT->tgtWait = line ? BT->lineWaitAll : d.waitAll; BT->tgtVia = d.via;
  if (line) for (int k = 0; k < 2 * BT->nLine; k++) BT->tgt[k] = BT->line[k]; else { BT->tgt[0] = d.sr; BT->tgt[1] = d.sc; }
  BT->tgtPresses = BT->nNotes;
}
static Dec noStall(Dec d) {
  if (d.kind != K_SWAP || !d.hasMove || !BIN[IN_HASPA] || !(BIN[IN_INCOMING] > 0) || BIN[IN_TOPPED]) return d;
  if (!roomForBreak(DBASE) || endsInBreak(d)) return d;
  if (swapBreaks(d)) return d;
  int32_t sw[2] = { d.sr, d.sc };
  int v = lineJudge(sw, 1, 0);
  if (!(v & LV_PAYS) || (v & (LV_BREAKS | LV_FILLS))) return d;   // a clear that readies the landing is no stall
  if (hasGarbage(DBASE) && !(HOLLOW(LNO) > HOLLOW(LNA))) return d;
  // over six rows the material is there to spend: shaping the board and
  // buying time with it is the six-row rule's to allow
  if (leavesSixRows()) return d;
  // and a pile not yet broken with a board not ready for the next slab needs
  // the time: the next slab would only stack on it, so the clear buys the
  // stop in which the break is found. With nothing on the board the slab
  // lands: a clear there spends material only broken garbage replaces.
  if (hasGarbage(DBASE)) { int32_t k[LNOLEN]; for (int q = 0; q < LNOLEN; q++) k[q] = LNO[q]; int r, c, rdy = readyInTime(0, 0, &r, &c); for (int q = 0; q < LNOLEN; q++) LNO[q] = k[q]; if (!rdy) return d; }
  BT->nLine = 0;
  // THE WAIT IS NOT IDLE: fill's leveller, if it found one; else the soonest
  // line (the shared search in time, MEANWHILES asked) of those that clear
  // nothing, live as long as the board left alone and leave the slab less
  // hollow to land on
  if (fillLevelDec == btDecision && fillLevel.has && levelInTime()) return mkSwap(fillLevel.sw[0], fillLevel.sw[1], V_FILL, d.mode, d.alive);
  {
    int last;
    FillCtx x = { 0, HOLLOW(LNA), 0 };
    waitSearch(lineEnds(0, 0, &last), sitFill, &x);
    if (x.bn) {
      if (x.bn > 1) lineSet(x.bsw + 2, x.bn - 1, LINE_PLAN, 0);
      return mkSwap(x.bsw[0], x.bsw[1], V_FILL, d.mode, d.alive);
    }
  }
  return mkHold(V_AWAITLANDING, d.mode, d.alive, 0, 0, 0);
}
// THE LINES THAT READY THE LANDING's accept: a line -- of any length, quiet
// steps and clears, combos and chains among them -- is asked of the
// engine if the masks show the slab ready in time after it (slabReadyHook);
// the masks can miss what the engine sees, so the soonest READYTRIES lines
// are asked whatever they show. Asked, it must live, as long as the
// readiness bar asks (dieRef), and be ready when the slab lands (readyInTime).
typedef struct { int dieRef, spare, dr, dc, tried, blind, masks, ok, r, c; } RqCtx;
static int sitReadies(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  RqCtx *x = ctx; (void)at;
  // a break is the break stages'; a clear on the way is spent for the break
  // the line readies, which the engine confirms below (readyInTime)
  if (res[R_SCOPE] != SC_OK) return SIT_END;
  if (n == 1 && sw[0] == x->dr && sw[1] == x->dc) return SIT_GROW;   // the choice itself: asked already
  if (slabReadyHook(res + R_INTS)) {
    x->masks++;
    if (x->tried >= READYTRIES) return SIT_TAKE;   // asked enough: the search ends, none confirmed
    x->tried++;
  } else {
    if (x->blind >= READYTRIES) return SIT_GROW;
    x->blind++;
  }
  if (!(lineJudge(sw, n, 0) & LV_LIVES) || lnoDie(LNO) < x->dieRef) return SIT_GROW;
  if (!readyInTime(sw, n, &x->r, &x->c)) return SIT_GROW;
  x->ok = 1;
  return SIT_TAKE;
}
// THE SOONEST LINE THAT READIES THE LANDING: the shared search in time on
// the board the engine settles to now, every step pressed before the slab
// lands (one pressed after readies nothing for it), sitReadies asking the
// engine. 1: found (sw, n; the break r, c); 0: none; -1: the board left alone
// has no landing to ready.
static int readiesLine(Dec d, int dieRef, int spare, int32_t *sw, int *n, int *r, int *c) {
  static ST rq0, RWL; int32_t cur0[2], t0, tLand; uint32_t can0[WMAX]; uint8_t wt0[32][WMAX];
  extern PATLS double paWork;
  if (lineLanded(0, 0, RWL, &tLand) != 0) return -1;
  if (lineState(0, 0, rq0, can0, wt0, cur0, &t0) != 0 || paWork >= optLine()) return 0;
  RqCtx x = { dieRef, spare, d.kind == K_SWAP && d.hasMove ? d.sr : 0, d.kind == K_SWAP && d.hasMove ? d.sc : 0, 0, 0, 0, 0, 0, 0 };
  *n = 0;
  searchInTime(rq0, cur0[0], cur0[1], t0, 0, tLand, BIN[IN_TOPPED] != 0 || BIN[IN_STOP] > 0, can0, wt0, optLine() - paWork, sitReadies, &x, sw, n, 0);
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "READIES lines: %d ready on the masks, %d asked, %d asked blind, %s", x.masks, x.tried, x.blind, x.ok ? "ready:" : "none");
    if (x.ok) { for (int k = 0; k < *n; k++) fprintf(BLOG, " %d,%d", sw[2 * k], sw[2 * k + 1]); fprintf(BLOG, " break %d,%d", x.r, x.c); } fprintf(BLOG, "\n"); }
#endif
  if (!x.ok) return 0;
  *r = x.r; *c = x.c;
  return 1;
}
static Dec readyWhenLands(Dec d) {
  if (d.kind == K_RAISE || !(BIN[IN_INCOMING] > 0) || !BIN[IN_HASPA]) return d;
  if (lineLast == 3 || (lineLast == 1 && BT->lineKind == LINE_BREAK)) return d;   // a break being played
  // no room for what a break makes: the room is made only when no line readies the landing
  int room = roomForBreak(DBASE);
  int32_t sw[2] = { d.sr, d.sc };
  int dieRef = 0, r, c;
  if (d.kind == K_SWAP && d.hasMove) {
    int rdy = swapBreaks(d) || readyInTime(sw, 1, &r, &c);
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "RWL %d,%d via %d ready %d at %d,%d\n", d.sr, d.sc, d.via, rdy, rdy ? r : 0, rdy ? c : 0); }
#endif
    if (rdy) return d;
  } else if (readyInTime(0, 0, &r, &c)) {
    if (!d.hasPark) { d.hasPark = 1; d.pr = r; d.pc = c; }
    return d;
  }
  // READY FIRST (lineRank): a line that readies the landing need only
  // outlive the board left alone, not the choice it replaces -- that choice's
  // later death is judged without a break, and the break is what saves it
  dieRef = readyBar();
  int spare = materialRows(DBASE) >= 6, tried;
  // FIRST BY DISTANCE: the time to the landing is what bounds the setup, not a count of
  // swaps. The breaks by distance are found on the board as the slab lands
  // on it; a walk whose steps but the last are played now, before it lands,
  // leaves that last one in reach when it does. The planner is not bounded
  // by the landing: the last step comes after it; the engine judges the
  // steps before it and readyInTime the break.
  {
    static ST RWB; uint32_t can[WMAX]; uint8_t wt[32][WMAX]; int32_t cur[2], tl;
    if (lineLandedFull(0, 0, RWB, can, wt, cur, &tl) == 0) {
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "RWL by distance: lands at %d | garbage %d work left %.0f lines before %d\n", tl, hasGarbage(RWB), workLeft(), nLines); }
#endif
    int n0 = nLines;
    tDupes = 0;
    breakLines(RWB, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 0, INF);
    static unsigned char wk[MAXLINES];
    for (int i = n0; i < nLines; i++) wk[i] = (char)(LINES[i].n < 2);
    int got = -1;
    for (tried = 0; tried < READYTRIES && got < 0;) {
      int at = -1;
      for (int i = n0; i < nLines; i++) if (!wk[i] && (at < 0 || LINES[i].est < LINES[at].est)) at = i;
      if (at < 0) break;
      wk[at] = 1;
      LineC *l = &LINES[at];
      if (!(lineJudge(l->sw, l->n - 1, 0) & LV_LIVES) || lnoDie(LNO) < dieRef) continue;
      tried++;
      if (readyInTime(l->sw, l->n - 1, &r, &c)) got = at;
    }
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "RWL by distance: %d lines, %d tried, got %d, %d already found\n", nLines - n0, tried, got, tDupes); }
#endif
    if (got >= 0) {
      LineC l = LINES[got];
      l.n--;
      nLines = n0;
      if (l.n > 1) lineKeep(&l, LINE_PLAN); else BT->nLine = 0;
      lineLast = 8;
      return mkSwap(l.sw[0], l.sw[1], V_LINEUP, d.mode, d.alive);
    }
    nLines = n0;
    }
  }
  // THE LINES THAT READY IT, IN TIME (readiesLine), with the work left after
  // the cheaper breaks by distance: the first the engine confirms is played
  {
    int32_t rl[2 * LINEMAX]; int rn;
    int got = readiesLine(d, dieRef, spare, rl, &rn, &r, &c);
    if (got < 0) return room ? d : makeRoom(d);
    if (got) {
      if (rn > 1) lineSet(rl, rn, LINE_PLAN, 0); else BT->nLine = 0;
      lineLast = 8;
      return mkSwap(rl[0], rl[1], V_LINEUP, d.mode, d.alive);
    }
  }
  return room ? d : makeRoom(d);
}
// BREAK WHEN IT PAYS. A match beside a pile converts the whole pile, so a
// pile let grow while there is room turns one match into many panels. A
// break of fewer than BATCH cells is held while the stack's top leaves
// ROOMLEFT rows, the board is not topped, and the engine says that, left
// alone until the next slab lands, the board still has a break in time (readyAfter).
// THE BOARD LEFT ALONE DIES -- BEFORE THE NEXT SLAB LANDS. The engine's
// replay of the board left alone breaks nothing, so with a queue it always
// dies in the end; that is the replay, not the board. A death counts as a
// reason to act only if it comes before the next slab lands: past that, the
// break readied for the slab is played.
int lineLanded(const int32_t *steps, int n, int32_t *masks, int32_t *t);
static int aloneDiesBeforeLanding(void) {
  if (!aloneOnEngine() || !LNA[0]) return 0;
  static ST ADL; int32_t t;
  if (lineLanded(0, 0, ADL, &t) != 0) return 1;
  return LNA[0] <= t;
}
static Dec batchBreak(Dec d) {
  if (BIN[IN_TOPPED] || !(BIN[IN_INCOMING] > 0) || !BIN[IN_HASPA] || d.kind != K_SWAP || !d.hasMove) return d;
  if (!BIN[IN_FALLING]) return d;   // break once it lands: held only for garbage in the air
  // how much garbage the swap's line converts, as the engine plays it
  int32_t sw[2] = { d.sr, d.sc };
  int playsLine = BT->nLine && BT->line[0] == d.sr && BT->line[1] == d.sc;
  int v = playsLine ? lineJudge(BT->line, BT->nLine, BT->lineWaitAll) : lineJudge(sw, 1, 0);
  int converts = (v & LV_BREAKS) && aloneOnEngine() ? LNO[2] - LNA[2] : 0;
  if (converts <= 0 || converts >= BATCH) return d;
  if (tallestBoard(DBASE) > BH - ROOMLEFT) return d;   // the whole stack, garbage and panels
  if (!readyAfter(0, 0)) return d;
  BT->nLine = 0; lineLast = 6;
  return mkHold(V_LINEUPHOLD, d.mode, d.alive, 1, d.sr, d.sc);
}
// MATERIAL IS SPENT ONLY TO BREAK OR TO LIVE. While garbage lies on the
// board or waits to drop, the board's panels are what the next break is made
// from, and broken garbage is where new ones come from. A swap that clears,
// or that drops garbage lying at rest -- a pile split is a pile broken in
// pieces -- is played only if it breaks, buys time (GAINS), was chosen to live
// (stayAlive) or is a step of a line that breaks; otherwise the bot holds.
static Dec spendToBreak(Dec d) {
  if (d.kind != K_SWAP || !d.hasMove || endsInBreak(d)) return d;
  // chosen to live (stayAlive, its cash line), a break line, a batch held:
  // the rule's own exceptions. A plan, a lineup or a kept break played on is
  // judged here whole, like any other choice.
  if (lineLast == 2 || lineLast == 3 || lineLast == 6 || (lineLast == 1 && BT->lineKind != LINE_PLAN)) return d;
  if (!(hasGarbage(DBASE) || BIN[IN_INCOMING] > 0)) return d;
  // what the swap does -- the line it is a step of, played whole -- on the engine against the board left alone
  int32_t sw[2] = { d.sr, d.sc };
  int playsLine = BT->nLine && BT->line[0] == d.sr && BT->line[1] == d.sc;
  int v = playsLine ? lineJudge(BT->line, BT->nLine, BT->lineWaitAll) : lineJudge(sw, 1, 0);
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr;
    fprintf(BLOG, "SPEND %d,%d v%d | drain %d/%d last %d conv %d/%d match %d/%d fell %d/%d\n", d.sr, d.sc, v, LNO[0], LNA[0], LNO[1], LNO[2], LNA[2], LNO[3], LNA[3], LNO[9], LNA[9]); }
#endif
  // garbage let down is never held: it lowers the stack
  if (!(v & LV_LIVES) || !(v & LV_PAYS) || (v & (LV_BREAKS | LV_DROPS))) return d;
  // a combo or a chain digging under no pile is played, the break looked for while it resolves
  if (LNO[3] - LNA[3] >= COMBOMIN && (!aloneOnEngine() || HOLLOW(LNO) <= HOLLOW(LNA))) return d;
  if (v & LV_GAINS) { int32_t k[LNOLEN]; for (int q = 0; q < LNOLEN; q++) k[q] = LNO[q]; int dies = aloneDiesBeforeLanding(); for (int q = 0; q < LNOLEN; q++) LNO[q] = k[q]; if (dies) return d; }
  // however much the board holds: in a storm the stack does not rise, and a
  // break is the only material that comes back
  BT->nLine = 0; lineLast = 0;
  return mkHold(V_SETUP, d.mode, d.alive, 0, 0, 0);
}
// WHAT LANDS IS WHAT IT WILL BREAK. A slab rests on the tallest column under
// it; every lower column is a hollow a clear beside the slab cannot reach,
// and the pile that settles into it later falls, unbroken, past the match.
// While garbage is coming and no line is being played, the move played is
// the one the engine finds leaves the least hollow under what lands (pa.c
// HOLLOW) -- a move that clears nothing and lives --
// if it leaves less than the choice and less than the board left alone.
// While a break is being played, a fill swap goes first only if the break
// still breaks after it, what lands is left less hollow, and the break is
// pressed before the next slab could land.
static void prejudge(const int32_t *sws, int stride, int count, int n, int waitAll);
// FILL BEFORE THE BREAK's accept: a quiet line that, with the break after
// it, still lives and breaks, presses the break before the next landing
// (tNext), and leaves less hollow under what lands (MAXCAND asked)
typedef struct { const int32_t *ln; int n, waitAll, need, tNext, best, tried, bn; int32_t bsw[2 * LINEMAX]; } FbCtx;
static int sitFillFirst(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  FbCtx *x = ctx; (void)at;
  if (res[R_SCOPE] != SC_OK || res[R_TOTAL] > 0) return SIT_END;
  if (n + x->n > LINEMAX) return SIT_END;
  if (x->tried >= MAXCAND) return SIT_TAKE;
  x->tried++;
  int32_t l2[2 * LINEMAX];
  for (int k = 0; k < 2 * n; k++) l2[k] = sw[k];
  for (int k = 0; k < 2 * x->n; k++) l2[2 * n + k] = x->ln[k];
  int v = lineJudge(l2, n + x->n, x->waitAll);
  if ((v & x->need) != x->need || LNO[1] >= x->tNext || HOLLOW(LNO) >= x->best) return SIT_GROW;
  x->best = HOLLOW(LNO); x->bn = n; for (int k = 0; k < 2 * n; k++) x->bsw[k] = sw[k];
  return SIT_GROW;
}
static Dec fillBeforeBreak(Dec d) {
  int32_t ln[2 * LINEMAX + 2]; int n = BT->nLine;
  if (n) for (int k = 0; k < 2 * n; k++) ln[2 + k] = BT->line[k];
  else if (d.kind == K_SWAP && d.hasMove) { ln[2] = d.sr; ln[3] = d.sc; n = 1; }
  if (!n || n >= LINEMAX) return d;
  int need = LV_LIVES | LV_BREAKS;
  if ((lineJudge(ln + 2, n, BT->lineWaitAll) & need) != need) return d;
  int best = HOLLOW(LNO);
  if (best == 0) return d;
  // the break may wait for a fill only while no slab can land first: the
  // board left alone has its next landing after the break, fill and all
  int32_t tNext; ST lum;
  if (lineLanded(0, 0, lum, &tNext) != 0) return d;
  // the quiet lines ahead of it, soonest first (the shared search in time,
  // every step before the next landing): the one that leaves least hollow
  FbCtx x = { ln + 2, n, BT->lineWaitAll, need, tNext, best, 0, 0 };
  waitSearch(tNext, sitFillFirst, &x);
  if (!x.bn) return d;
  if (x.bn > 1) {   // the rest of the fill, then the break, kept as the line
    int32_t l2[2 * LINEMAX]; int nl = 0;
    for (int k = 2; k < 2 * x.bn; k++) l2[nl++] = x.bsw[k];
    for (int k = 0; k < 2 * n; k++) l2[nl++] = ln[2 + k];
    lineSet(l2, nl / 2, BT->nLine ? BT->lineKind : LINE_BREAK, BT->lineWaitAll);
  }
  return mkSwap(x.bsw[0], x.bsw[1], V_FILL, d.mode, d.alive);
}
// THE FRAMES TO A BREAK AFTER `steps`: the steps played on the engine as the
// front plays them, then the soonest break the distance search finds on the
// board they leave, walked from where the cursor is (INF: none).
#define BUDGETMS 7.1   // the decision's budget: the 8 ms think budget less the frame's own work, 8 - 0.9 (0.9 ms at most, seed 4)
static int btAloneAt = -1; static double btAlone;
static double breakTimeOf(const int32_t *steps, int n, double limit);
static void prejudge(const int32_t *sws, int stride, int count, int n, int waitAll);
static void prereplay(const int32_t *sws, int count);
// the board left alone is asked about several times a decision: once
static double breakTime(const int32_t *steps, int n) {
  if (n > 0) return breakTimeOf(steps, n, INF);
  if (btAloneAt != btDecision) { btAlone = breakTimeOf(0, 0, INF); btAloneAt = btDecision; }
  return btAlone;
}
// THE BREAK BEFORE `limit`, or INF: a question with a bound searches only
// what could answer it -- every line past the bound is pruned
static double breakWithinT(const int32_t *steps, int n, double limit) { return breakTimeOf(steps, n, limit); }
static JLOCAL double btReplayMs, btSearchMs;   // GC_WORKSTAT
static double breakTimeAfter(const int32_t *steps, int n, double limit, int32_t *st, uint32_t *can, uint8_t (*w)[WMAX], int32_t *cur, int32_t t);
// A SEARCH ONLY WHERE THE BUDGET HOLDS ONE, as a judge (btCost: the most one
// has taken); past that no break is found
static double breakTimeOf(const int32_t *steps, int n, double limit) {
  int32_t st[ST_INTS], cur[2], t; uint32_t can[WMAX]; uint8_t w[32][WMAX];
  if (btCost > workLeft()) { budgetRefused++; return INF; }   // the work this thread has left (workLeft)
  double w0 = paWork, bt0 = NOWMS2();
  int lsr = lineState(steps, n, st, can, w, cur, &t);
  btReplayMs += NOWMS2() - bt0;
  double r = lsr != 0 ? INF : breakTimeAfter(steps, n, limit, st, can, w, cur, t);
  if (!inWorker && paWork - w0 > btCost) btCost = paWork - w0;
  return r;
}
// the same, from the board `steps` leave (lineState's), replayed already
static double breakTimeAfter(const int32_t *steps, int n, double limit, int32_t *st, uint32_t *can, uint8_t (*w)[WMAX], int32_t *cur, int32_t t) {
  // garbage still to drop: the break is made against it once it has landed
  if (!hasGarbage(st) && BIN[IN_INCOMING] > 0 && lineLandedFull(steps, n, st, can, w, cur, &t) != 0) return INF;
  double bt1 = NOWMS2();
  tTimeMode = 1; tTimeMin = limit < INF ? limit - t : INF;
  if (tTimeMin <= 0) { tTimeMode = 0; return INF; }
  double bound = tTimeMin;
  breakLines(st, cur[0], cur[1], 0, INF);
  // and the masks' lines on the same board, in time (linesFrom, TIMEWORK)
  { const int32_t *sb = ENGINE_BASE; uint8_t (*sw8)[WMAX] = ENGINE_WAITS; uint32_t sc[WMAX]; int snp = nPfx, stp = lsTopped, sbr = lsBreaks; double spt = pfxT;
    for (int c = 0; c < WMAX; c++) sc[c] = ENGINE_CAN[c];
    ENGINE_BASE = st; ENGINE_WAITS = w; for (int c = 0; c < WMAX; c++) ENGINE_CAN[c] = can[c];
    nPfx = 0; pfxT = 0; lsTopped = BIN[IN_TOPPED] != 0; lsBreaks = 1;
    linesFrom(st, cur[0], cur[1], 2, INF);
    ENGINE_BASE = sb; ENGINE_WAITS = sw8; for (int c = 0; c < WMAX; c++) ENGINE_CAN[c] = sc[c];
    nPfx = snp; pfxT = spt; lsTopped = stp; lsBreaks = sbr; }
  tTimeMode = 0;
  btSearchMs += NOWMS2() - bt1;
  return tTimeMin >= bound ? INF : t + tTimeMin;
}
// THE GOAL IS A BREAK IN THE TIME THERE IS. With garbage on the board and no
// break being played, every swap that lives is an option. An option's time is
// its own: the frame the engine, after it, finds the board loses health (none
// within the horizon: the horizon). It breaks in time if the break the
// distance search finds after it comes before then. The choice, if it breaks
// in time, stands; a lone option that does is taken; of several, the soonest.
// If none does, the time bought is time for a break: the option whose break
// comes nearest to fitting inside its time.
// each swap's soonest break before bsLim, one task a swap
static const int32_t *bsPl; static double *bsB0;
static double bsLim;
static int breakAhead(const int32_t *sw, double lim, double *out);   // front.c
static double bsWork[16];   // each task's own work (SOONBATCH)
static void bsTask(int k) { double v, w0 = paWork; bsB0[k] = breakAhead(bsPl + 2 * k, bsLim, &v) ? v : breakWithinT(bsPl + 2 * k, 1, bsLim); bsWork[k] = paWork - w0; }
#define SOONBATCH 16   // swaps taken together, out from the cursor (bsWork's size)
// BREAKSOON LEAVES FILL ITS SHARE (stageOpen)
static Dec breakSoonIn(Dec d);
static Dec breakSoon(Dec d) {
  double keep = stageOpen(6);
  Dec r = breakSoonIn(d);
  stageClose(keep);
  return r;
}
static Dec breakSoonIn(Dec d) {
  if (lineLast == 3 || (lineLast == 1 && BT->lineKind == LINE_BREAK)) return d;
  if (lineLast == 2 || d.kind == K_RAISE || !BIN[IN_HASPA] || !hasGarbage(DBASE)) return d;
  if (d.kind == K_SWAP && endsInBreak(d)) return d;
  if (!aloneOnEngine()) return d;
  double aloneTime = LNA[0] ? LNA[0] : LINEREACH;
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "SOON alone %g break %g via %d\n", aloneTime, breakTime(0, 0), d.via); }
#endif
  if (breakTime(0, 0) < aloneTime) return d;   // holding, a break still comes in time
  if (d.kind == K_SWAP && d.hasMove) {
    int32_t sw[2] = { d.sr, d.sc };
    if (lineJudge(sw, 1, 0) & LV_LIVES) {
      double time = LNO[0] ? LNO[0] : LINEREACH;
      if (breakTime(sw, 1) < time) return d;
    }
  }
  // in time: the soonest break (score -b); else the most margin (score time - b)
  Best inTime = { 0 }, margin = { 0 };
  int32_t pl[2 * MAXCAND]; int pn = 0, q;
  for (int k = 0; k < nPool && pn < MAXCAND; k++) if (POOL[k].kind == K_SWAP) { pl[2 * pn] = POOL[k].sr; pl[2 * pn + 1] = POOL[k].sc; pn++; }
  Out o;
  // OUT FROM THE CURSOR IN BATCHES: each batch's replays, break searches and
  // judgements done together (in parallel natively), then taken one by one.
  // In time: the soonest break (a tie still counts: it may win by its swaps);
  // a swap's break comes no sooner than the walk to it, so once the soonest in
  // time is had, a batch all further out cannot win and the walk ends. Until
  // one is, the margin is kept in the same order: a swap's time is within the
  // horizon, so a break later than the horizon less the best margin cannot
  // reach it, and no batch searches past that.
  double aloneM = breakTime(0, 0) < INF ? aloneTime - breakTime(0, 0) : -INF;
  double b0[MAXCAND];
  for (int k = 0; k < pn; k++) b0[k] = INF;
  int ordq[MAXCAND]; double ordf[MAXCAND], far0 = 0;
  outBegin(&o, pl, 2, pn, (int)BIN[IN_CROW], (int)BIN[IN_CCOL]);
  int no = 0; while (outNext(&o, &q, &far0)) { ordq[no] = q; ordf[no] = far0; no++; }
  int done = 0;
  for (int at = 0; at < no && !done; at += SOONBATCH) {
    int end = at + SOONBATCH < no ? at + SOONBATCH : no;
    if (outPast(&inTime, -ordf[at], 0)) break;
    int32_t bl[2 * SOONBATCH], wb[2 * SOONBATCH]; int nb = 0, nwb = 0, bq[SOONBATCH];
    for (int k = at; k < end; k++) { bq[nb] = ordq[k]; bl[2 * nb] = pl[2 * ordq[k]]; bl[2 * nb + 1] = pl[2 * ordq[k] + 1]; nb++; }
    double tb[SOONBATCH];
    // a margin is taken only past the board left alone's (aloneM), so no break later than that reaches it
    double floorM = margin.has && margin.score > aloneM ? margin.score : aloneM;
    bsLim = inTime.has ? -inTime.score + 1e-9 : floorM > -INF ? LINEREACH - floorM + 1e-9 : INF;
    nb = fitTasks(nb, btCost);
    if (!nb) break;
    prereplay(bl, nb); bsPl = bl; bsB0 = tb; parallelDo(nb, bsTask);
    for (int k = 0; k < nb; k++) if (bsWork[k] > btCost) btCost = bsWork[k];   // the most one task cost
    for (int k = 0; k < nb; k++) { b0[bq[k]] = tb[k]; if (tb[k] < INF) { wb[2 * nwb] = bl[2 * k]; wb[2 * nwb + 1] = bl[2 * k + 1]; nwb++; } }
    prejudge(wb, 2, nwb, 1, 0);
    for (int k = at; k < end; k++) {
      q = ordq[k]; double far = ordf[k];
      // a break after a swap comes no sooner than the walk to it
      if (outPast(&inTime, -far, 0)) { done = 1; break; }
      int32_t sw[2] = { pl[2 * q], pl[2 * q + 1] };
      double lim0 = inTime.has && -inTime.score < LINEREACH ? -inTime.score + 1e-9 : LINEREACH;
      if (!(b0[q] < lim0)) continue;
      if (!(lineJudge(sw, 1, 0) & LV_LIVES)) continue;
      double time = LNO[0] ? LNO[0] : LINEREACH;
      double lim = inTime.has && -inTime.score < time ? -inTime.score + 1e-9 : time;
      double b = b0[q] < lim ? b0[q] : INF;
      if (b < time) bestTake(&inTime, -b, 0, sw, 1);
    }
    if (inTime.has) continue;
    // none in time yet: the margin, which only then decides
    for (int k = at; k < end; k++) {
      q = ordq[k]; double far = ordf[k];
      int32_t sw[2] = { pl[2 * q], pl[2 * q + 1] };
      // no break within the bound: nothing to take, and not judged
      if (b0[q] >= INF) continue;
      if (!(lineJudge(sw, 1, 0) & LV_LIVES)) continue;
      double time = LNO[0] ? LNO[0] : LINEREACH;
      // its break comes no sooner than the walk to it
      if (margin.has && time - far < margin.score) continue;
      double lim = margin.has ? (time > time - margin.score ? time : time - margin.score) : INF;
      double b = b0[q] < lim ? b0[q] : INF;
      if (b < INF) bestTake(&margin, time - b, 0, sw, 1);
    }
  }
  if (inTime.has) margin.has = 0;
  int pr = inTime.has ? inTime.sw[0] : 0, pc = inTime.has ? inTime.sw[1] : 0, mr = margin.has ? margin.sw[0] : 0, mc = margin.has ? margin.sw[1] : 0;
  double best = inTime.has ? -inTime.score : INF, bestMargin = margin.has ? margin.score : -INF;
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "SOON! in-time %d,%d at %g | margin %d,%d %g\n", pr, pc, best, mr, mc, bestMargin); }
#endif
  if (pr) { lineLast = 7; return mkSwap(pr, pc, V_SETUP, d.mode, d.alive); }
  if (mr && bestMargin > (breakTime(0, 0) < INF ? aloneTime - breakTime(0, 0) : -INF)) {
    lineLast = 7; return mkSwap(mr, mc, V_KEEPHEALTH, d.mode, d.alive);
  }
  return d;
}
// AN OPTION'S MARGIN: the frames between the break the distance search finds
// after it and the frame it loses health (none within the horizon: the
// horizon); negative when no break comes in time. Keeps the search's grid.
static double marginAfter(const int32_t *sw, int n, int die) { extern double marginWithin(const int32_t *, int, int, double); return marginWithin(sw, n, die, INF); }
// the margin, searched only as far as `need` asks: a margin under it is -INF
double marginWithinIn(const int32_t *sw, int n, int die, double need);
double marginWithin(const int32_t *sw, int n, int die, double need) { double t = NOWMS2(); double m = marginWithinIn(sw, n, die, need); fillMargins++; fillMarginMs += NOWMS2() - t; return m; }
double marginWithinIn(const int32_t *sw, int n, int die, double need) {
  static int keep[TGRID + 2][WMAX + 1];
  int kw = tW, kh = tH;
  __builtin_memcpy(keep, tCell, sizeof keep);
  double time = die ? die : LINEREACH;
  double b = (need >= INF || n == 0) ? breakTime(sw, n) : breakWithinT(sw, n, time - (need > 0 ? 0 : need) + 1e-9);
  __builtin_memcpy(tCell, keep, sizeof keep); tW = kw; tH = kh;
  return (die ? die : LINEREACH) - b;
}
// in time (need 0): breaks in time; otherwise: no less time than the choice
static int fillKeeps(double m, double need) { return need >= 0 ? m > 0 : m >= need; }
static Dec fillFirstIn(Dec d);
static Dec fillFirst(Dec d) {
  int j0 = fillJudges; double jm0 = fillJudgeMs; fillMargins = 0; fillMarginMs = 0;
  double t0 = NOWMS2();
  Dec r = fillFirstIn(d);
#ifndef __wasm__
  if (0) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "FILLSTAT %.2f ms | judges %d %.2f ms | margins %d %.2f ms | pool %d\n", NOWMS2() - t0, fillJudges - j0, fillJudgeMs - jm0, fillMargins, fillMarginMs, nPool); }
#endif
  return r;
}
// the panel a fill walks in column c: its highest. Garbage over it does not
// hide it: walked out from under a perched slab, it lets the slab down.
static int walkTop(int c) {
  for (int k = tH; k >= 1; k--) if (tCell[k][c] > 0) return k;
  return 0;
}
// NEVER DYING FIRST: while the board left alone loses health before its
// soonest break (fillUrgent), a fill is ranked by the frame it loses health
// (later first); otherwise by the hollow it leaves
static int fillUrgent;
static double fillScore(int die, int last, int hollow) { return (fillUrgent && die ? lifeOf(die, last, hollow, 0) : (1 << 20)) * 4096.0 - hollow; }
// FILLS THAT TIE ORGANIZE: of two fills as good and as soon, the one leaving
// more vertical twos whose three touches garbage (breakTwosOf) -- asked only
// on the tie, since each costs a replay. btw: the best's twos (-1: not asked).
static int twosAfter(const int32_t *sw, int n);
static int fillBeats(const Best *b, int *btw, double score, double t, const int32_t *sw, int n) {
  if (!b->has || score != b->score || t != b->t) return bestBeats(b, score, t, sw, n);
  if (*btw < 0) *btw = twosAfter(b->sw, b->n);
  int tw = twosAfter(sw, n);
  if (tw != *btw) return tw > *btw;
  return swapsBeforeN(sw, n, b->sw, b->n);
}
static void fillTake(Best *b, int *btw, double score, double t, const int32_t *sw, int n) {
  b->has = 1; b->score = score; b->t = t; b->n = n; *btw = -1;
  for (int k = 0; k < 2 * n; k++) b->sw[k] = sw[k];
}
// the twos on the board a line leaves (0 where the budget holds no replay)
static int twosAfter(const int32_t *sw, int n) {
  static ST TA; int32_t c1[2], t1; uint32_t cn[WMAX]; uint8_t wt[32][WMAX];
  return lineState(sw, n, TA, cn, wt, c1, &t1) == 0 ? breakTwosOf(TA) : 0;
}
// BREAKING FIRST, LIFE KEPT: a fill after which the garbage breaks before the
// board loses health beats every other. Then a fill after which a break is
// still in reach in the time there is (the distance planner within the
// judge's reach, breakWithinT) beats one after which none is -- topped out,
// whatever stop time the other buys; not topped and losing health, only after
// life, since stop time beats a break that will not come in time. With no loss
// of health coming the fills that keep a break in reach are the ones that
// level: of those, the least hollow.
#define BREAKS_IN_TIME 1e12
#define BREAK_IN_REACH 1e11
static int reachFirst(void) { return BIN[IN_TOPPED] || !fillUrgent; }
static int breakKept(const int32_t *sw, int n) { return breakWithinT(sw, n, LINEREACH) < INF; }
static double breakTier(const int32_t *sw, int n, int die) {
  if (fillUrgent && marginWithin(sw, n, die ? die : LINEREACH, 0) >= 0) return BREAKS_IN_TIME;
  return reachFirst() && breakKept(sw, n) ? BREAK_IN_REACH : 0;
}
static double fillScoreOf(const int32_t *sw, int n, int die, int last, int hollow) {
  return fillScore(die, last, hollow) + breakTier(sw, n, die);
}
// a clear judged (LNO) leaves six rows of material, read off the line's own matches
static int readyAfterSpend(const int32_t *sw, int n);
static int nonSpendLives(void);
int lineLanded(const int32_t *steps, int n, int32_t *masks, int32_t *t);
#define LEVELTAKE(swp, nn, t) do { if (!(v & LV_PAYS) && (LNA[0] ? (!LNO[0] || LNO[0] >= LNA[0]) : !LNO[0]) && HOLLOW(LNO) < HOLLOW(LNA)) bestTake(&fillLevel, -HOLLOW(LNO), (t), (swp), (nn)); } while (0)
static Dec fillFirstIn(Dec d) {
  fillLevel.has = 0; fillLevelDec = btDecision;
  if (d.kind == K_RAISE || !BIN[IN_HASPA] || !(BIN[IN_INCOMING] > 0)) return d;
  if (lineLast == 1 || lineLast == 3) return BT->lineKind == LINE_BREAK || lineLast == 3 ? fillBeforeBreak(d) : d;
  if (lineLast) return d;
  if (d.kind == K_SWAP && endsInBreak(d)) return d;
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; aloneOnEngine(); fprintf(BLOG, "FILL? alone hollow %d last %d via %d\n", HOLLOW(LNA), lineLast, d.via); }
#endif
  if (!aloneOnEngine() || HOLLOW(LNA) == 0) return d;
  int best = HOLLOW(LNA);
  // A FILL IS A MEANS TO A BREAK, so it may not cost one: if the choice
  // breaks in time a fill must too; if not, a fill leaves at least as much
  // time between its break and its loss of health
  double need = marginAfter(0, 0, LNA[0]);
  fillUrgent = LNA[0] && need < 0;
  double ref = fillScore(LNA[0], -1, HOLLOW(LNA)) + (reachFirst() && breakKept(0, 0) ? BREAK_IN_REACH : 0);   // what a fill must beat: the board left alone, and the choice
  int refDie = lnoDie(LNA);   // the later loss of health of the two
  if (d.kind == K_SWAP && d.hasMove) {
    int32_t sw[2] = { d.sr, d.sc };
    if (lineJudge(sw, 1, 0) & LV_LIVES) { best = HOLLOW(LNO) < best ? HOLLOW(LNO) : best; if (lnoDie(LNO) > refDie) refDie = lnoDie(LNO); double cs = fillScore(LNO[0], LNO[1], HOLLOW(LNO)); double m = marginAfter(sw, 1, LNO[0]); cs += fillUrgent && m >= 0 ? BREAKS_IN_TIME : reachFirst() && breakKept(sw, 1) ? BREAK_IN_REACH : 0; if (cs > ref) ref = cs; if (m > need) need = m; }
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "  choice %d,%d die %d last %d hollow %d | alone die %d\n", d.sr, d.sc, LNO[0], LNO[1], HOLLOW(LNO), LNA[0]); }   // the log does no work of its own: under a work budget it would change the decision
#endif
  }
  if (need > 0) need = 0;   // in time is in time
  // A FILL PRESSED AFTER THE SLAB LANDS still levels the board for the slabs
  // after it: the hollow is read off the board the line ends on, whenever it
  // is pressed
  Cand *pick = 0;
  // NOT TO DIE: over six rows a clear may be spent to fill; under, only while
  // the board left alone loses health before its soonest break, and only by a
  // fill that loses it later. Losing it later is not enough on its own: a
  // clear's stop time puts every loss of health off, and a board spent below
  // six rows cannot rise while the stop lasts.
#define LIVES_LONGER() (fillUrgent && lnoDie(LNO) > refDie)
  // the pool: by fillScore, then the shortest walk, then the swaps; nothing
  // counts that does not beat the choice and the board left alone
  Best P = { 0 }; int ptw = -1;
  int32_t fl[2 * MAXCAND]; int fn = 0, fq[MAXCAND], q;
  for (int k = 0; k < nPool && fn < MAXCAND; k++) if (POOL[k].kind == K_SWAP) { fl[2 * fn] = POOL[k].sr; fl[2 * fn + 1] = POOL[k].sc; fq[fn++] = k; }
  prejudge(fl, 2, fn, 1, 0);
  Out o; double far;
  outBegin(&o, fl, 2, fn, (int)BIN[IN_CROW], (int)BIN[IN_CCOL]);
  while (outNext(&o, &q, &far)) {
    Cand *pc = &POOL[fq[q]];
    int32_t sw[2] = { pc->sr, pc->sc };
    int v = lineJudge(sw, 1, 0);
    int spend = (v & LV_PAYS) && !leavesSixRows();
#ifndef __wasm__
#define FILLWHY(why) do { if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "  pool %d,%d v %d die %d last %d hollow %d spend %d -> %s\n", sw[0], sw[1], v, LNO[0], LNO[1], HOLLOW(LNO), spend, why); } } while (0)
#else
#define FILLWHY(why) do { } while (0)
#endif
    if (!(v & LV_LIVES)) { FILLWHY("dies"); continue; }
    if (spend && !LIVES_LONGER()) { FILLWHY("spends, lives no longer"); continue; }
    int pdie = LNO[0], plast = LNO[1];
    LEVELTAKE(sw, 1, pc->moveFrames);
    double sc = fillScoreOf(sw, 1, pdie, plast, HOLLOW(LNO));
    if (P.has ? !fillBeats(&P, &ptw, sc, pc->moveFrames, sw, 1) : sc <= ref) { FILLWHY("beaten"); continue; }
    if (!fillKeeps(marginWithin(sw, 1, pdie, need), need)) { FILLWHY("costs the break's time"); continue; }
    if (spend && !readyAfterSpend(sw, 1) && (nonSpendLives() || spendKeepsRaiseOut())) { FILLWHY("spends, not ready, a non-spend lives or a raise waits"); continue; }   // a move that spends nothing lives: a spend must leave a break ready
    FILLWHY("best so far");
#undef FILLWHY
    fillTake(&P, &ptw, sc, pc->moveFrames, sw, 1); pick = pc;
  }
  if (P.has) ref = P.score;
  // the top of every column walked along its row, a column a swap, until it
  // drops into a lower column or meets something it cannot pass
  // the walk is planned on the board the engine settles to: a clear under a
  // column moves its top before the cursor gets there
  int32_t fsw[2 * LINEMAX], first[2] = { 0, 0 };
  Best W = { 0 }; int wtw = -1;
  { int32_t st0[ST_INTS], cur[2], t; uint32_t can0[WMAX]; uint8_t waits0[32][WMAX];
    tGrid(lineState(0, 0, st0, can0, waits0, cur, &t) == 0 ? st0 : DBASE); }
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "  grid H %d:", tH); for (int r = tH; r >= 1; r--) { fprintf(BLOG, " "); for (int c = 1; c <= tW; c++) fprintf(BLOG, "%c", tCell[r][c] == 0 ? '.' : tCell[r][c] < 0 ? 'g' : '0' + tCell[r][c]); } fprintf(BLOG, "\n"); }
#endif
  // every walk judged together first (natively in parallel), then taken in order
  { static LineC wl[2 * (WMAX + 1)]; LineC *wp[2 * (WMAX + 1)]; int nw = 0;
    for (int c = 1; c <= tW; c++) {
      int r = walkTop(c);
      if (!r) continue;
      for (int dir = -1; dir <= 1; dir += 2) {
        int n = 0, at = c;
        while (n < LINEMAX) {
          int to = at + dir;
          if (to < 1 || to > tW || tCell[r][to] != 0) break;
          wl[nw].sw[2 * n] = r; wl[nw].sw[2 * n + 1] = dir > 0 ? at : to; n++;
          at = to;
          if (!tSupported(r, at)) break;
        }
        if (n) { wl[nw].n = n; wp[nw] = &wl[nw]; nw++; }
      }
    }
    prejudgeLines(wp, nw); }
  for (int c = 1; c <= tW; c++) {
    int r = walkTop(c);
    if (!r) continue;
    for (int dir = -1; dir <= 1; dir += 2) {
      int n = 0, at = c;
      while (n < LINEMAX) {
        int to = at + dir;
        if (to < 1 || to > tW || tCell[r][to] != 0) break;
        fsw[2 * n] = r; fsw[2 * n + 1] = dir > 0 ? at : to; n++;
        at = to;
        if (!tSupported(r, at)) break;   // it drops here
      }
      if (n == 0) continue;
      int v = lineJudge(fsw, n, 0);
#ifndef __wasm__
      if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "  walk %d,%d dir %d n %d v %d hollow %d die %d last %d\n", r, c, dir, n, v, HOLLOW(LNO), LNO[0], LNO[1]); }
#endif
      int spend = (v & LV_PAYS) && !leavesSixRows();
      if (!(v & LV_LIVES) || (spend && !LIVES_LONGER())) continue;
      // its time: the engine's own last press (it has just played it); the clock where it could not
      double est = LNO[1] > 0 ? pressSeen(LNO[1]) : lineFrames(fsw, n, (int)BIN[IN_CROW], (int)BIN[IN_CCOL], 0, BIN[IN_TOPPED] || BIN[IN_STOP] > 0);
      // a walk must beat the pool's best; among walks, the same order (time: its estimate)
      int wdie = LNO[0], wlast = LNO[1];
      LEVELTAKE(fsw, n, est);
      double sc = fillScoreOf(fsw, n, wdie, wlast, HOLLOW(LNO));
      if (W.has ? !fillBeats(&W, &wtw, sc, est, fsw, n) : sc <= ref) continue;
      if (!fillKeeps(marginWithin(fsw, n, wdie, need), need)) continue;
      if (spend && !readyAfterSpend(fsw, n) && (nonSpendLives() || spendKeepsRaiseOut())) continue;
      fillTake(&W, &wtw, sc, est, fsw, n); first[0] = fsw[0]; first[1] = fsw[1];
    }
  }
  // A TOWER TWO WIDE COMES DOWN IN TWO WALKS: a slab rests on the taller of
  // the two, so neither walk alone leaves less hollow. When the two highest
  // columns stand side by side, two rows over every other, both tops are
  // walked off toward the lower side as one line, taken if it beats every
  // other fill by the same score.
  {
    int h[WMAX + 2], a = 0;
    for (int c = 1; c <= tW; c++) h[c] = walkTop(c);
    for (int c = 1; c < tW && !a; c++) {
      int lo = h[c] < h[c + 1] ? h[c] : h[c + 1], other = 0;
      for (int k = 1; k <= tW; k++) if (k != c && k != c + 1 && h[k] > other) other = h[k];
      if (lo >= other + 2) a = c;
    }
    if (a) {
      int dir = a == 1 ? 1 : a + 1 == tW ? -1 : (h[a - 1] <= h[a + 2] ? -1 : 1);
      int cols[2] = { dir < 0 ? a : a + 1, dir < 0 ? a + 1 : a };
      int32_t sw[2 * LINEMAX]; int n = 0, ok = 1;
      int sr[2], sc[2], sv[2], nset = 0;   // cells changed for the second walk, restored after
      for (int w = 0; w < 2 && ok; w++) {
        int c = cols[w], r = walkTop(c), at = c, m = 0;
        if (!r) { ok = 0; break; }
        while (n < LINEMAX) {
          int to = at + dir;
          if (to < 1 || to > tW || tCell[r][to] != 0) break;
          sw[2 * n] = r; sw[2 * n + 1] = dir > 0 ? at : to; n++; m++;
          at = to;
          if (!tSupported(r, at)) break;
        }
        if (!m) { ok = 0; break; }
        if (w == 0) {
          int land = r;
          if (!tSupported(r, at)) { land = 0; for (int k = r - 1; k >= 1 && !land; k--) if (tCell[k][at] != 0) land = k + 1; if (!land) land = 1; }
          sr[nset] = r; sc[nset] = c; sv[nset++] = tCell[r][c]; sr[nset] = land; sc[nset] = at; sv[nset++] = tCell[land][at];
          tCell[land][at] = tCell[r][c]; tCell[r][c] = 0;
        }
      }
      for (int k = nset - 1; k >= 0; k--) tCell[sr[k]][sc[k]] = sv[k];
      if (ok && n >= 2) {
        int v = lineJudge(sw, n, 0);
#ifndef __wasm__
        if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "  tower %d,%d dir %d n %d v %d hollow %d best %d\n", a, a + 1, dir, n, v, HOLLOW(LNO), best); }
#endif
        double beat = W.has && W.score > ref ? W.score : ref;
        // the judge plays the line through whatever lands while it is played
        int vv = v, die = LNO[0], last = LNO[1], hol = HOLLOW(LNO);
        if ((vv & LV_LIVES) && !(vv & LV_PAYS) && fillScoreOf(sw, n, die, last, hol) > beat && fillKeeps(marginWithin(sw, n, die, need), need)) {
          lineSet(sw, n, LINE_PLAN, 0);
          return mkSwap(sw[0], sw[1], V_FILL, d.mode, d.alive);
        }
      }
    }
  }
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "FILL! best %.0f walk %d,%d pool %d,%d\n", W.has ? W.score : ref, first[0], first[1], pick ? pick->sr : 0, pick ? pick->sc : 0); }
#endif
#undef LIVES_LONGER
  if (first[0]) return mkSwap(first[0], first[1], V_FILL, d.mode, d.alive);
  if (!pick) return d;
  return mkSwap(pick->sr, pick->sc, V_FILL, d.mode, d.alive);
}
// MEANWHILE: a swap that cannot be pressed for a while (what it is made on
// is still converting or falling) is preceded by a clear that does not put it
// off -- the two live as long as the swap alone, break if it breaks, and its
// line's last swap is pressed no later. The swap's line is kept, to play next.
// If no clear keeps it, one that lives as long on its own is played and the
// line is decided again: there is time to line it up again before it could be
// pressed, and the room the clear makes is what the converted panels need.
// READY AFTER A SPEND: no garbage to come, or a break the cursor reaches when
// the next slab lands after the line. The line's judgement (LNO) is kept.
static int readyAfterSpend(const int32_t *sw, int n) {
  if (!(BIN[IN_INCOMING] > 0)) return 1;
  int32_t keep[LNOLEN]; int r, c;
  for (int k = 0; k < LNOLEN; k++) keep[k] = LNO[k];
  int ok = readyInTime(sw, n, &r, &c);
  for (int k = 0; k < LNOLEN; k++) LNO[k] = keep[k];
  return ok;
}
// A MOVE THAT LIVES WITHOUT SPENDING: a line that clears nothing, soonest
// first (READYTRIES asked), that the engine says lives. When one does, spending under
// six rows buys nothing that moving does not.
typedef struct { int tried, found; } NsCtx;
static int sitNonSpend(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  NsCtx *x = ctx; (void)at;
  if (res[R_SCOPE] != SC_OK || res[R_TOTAL] > 0) return SIT_END;
  if (x->tried >= READYTRIES) return SIT_TAKE;
  x->tried++;
  int v = lineJudge(sw, n, 0);
  if ((v & LV_LIVES) && !(v & LV_PAYS) && !LNO[0]) { x->found = 1; return SIT_TAKE; }
  return SIT_GROW;
}
static int nonSpendLives(void) {
  NsCtx x = { 0, 0 };
  waitSearch(LINEHORIZON, sitNonSpend, &x);
  return x.found;
}
// WHAT GOES FIRST IN THE WAIT: lines pressed before the line's first step is
// due (last0, less the reaction), found soonest first by the shared search on
// the board the engine settles to now, each judged on the engine with the line
// after it (sitWaitClear: lines that end in a clear, MEANWHILES of them;
// sitWaitQuiet: quiet lines, SETUPTRIES of them). Any length: the time decides.
typedef struct {
  const int32_t *ln; int n, waitAll, need, last0, die0, dr, dc, urgent, die0Of, tried;
  int most, bn; int32_t bsw[2 * LINEMAX];        // the best: the clear that matches most, or the quiet line that leaves least hollow
  int fmost, fn; int32_t fsw[2 * LINEMAX];       // a clear on its own, the line dropped
  int hb, vb, hm;                                // the hollow and twos to beat (quiet); the hollow now on the masks
  uint32_t used[WMAX + 2]; const int32_t *pre;   // the line's panels (lineUses) on the board now
  int seen, moved;
  // the quiet lines reached, the best kept by what they leave on the masks
  int qn, qh[SETUPTRIES], qt[SETUPTRIES], ql[SETUPTRIES]; int32_t qsw[SETUPTRIES][2 * LINEMAX];
} MwCtx;
// MATERIAL IS SPENT ONLY TO BREAK OR TO LIVE: under six rows a clear goes
// first only while the board left alone loses health before its soonest
// break, and loses it later than the line it goes before. Living longer by
// keeping the board busy is a stall: the queue lands after it all the same,
// so the clear must leave a break ready for it -- unless the line it goes
// before dies: then stop time is what buys the time to find the break.
// (LNO: the judgement of the line asked about)
static int spendsOk(const MwCtx *x, const int32_t *sw, int n) {
  return leavesSixRows() || (x->urgent && lnoDie(LNO) > x->die0Of && (readyAfterSpend(sw, n) || (!nonSpendLives() && !spendKeepsRaiseOut())));
}
static int mwDiesSooner(const MwCtx *x) { return x->die0 ? (LNO[0] && LNO[0] < x->die0) : LNO[0] != 0; }
static int mwJoin(const MwCtx *x, const int32_t *sw, int n, int32_t *l2) {
  if (n + x->n > LINEMAX) return 0;
  for (int k = 0; k < 2 * n; k++) l2[k] = sw[k];
  for (int k = 0; k < 2 * x->n; k++) l2[2 * n + k] = x->ln[k];
  return n + x->n;
}
// A CLEAR IN THE WAIT ORGANIZES, OR SPENDS ONLY WHAT IS SPARE: it goes first
// if the board it leaves (the masks) has a break in reach, or more vertical
// twos than the board has now -- a clear spends what a break needs -- or still
// six rows of material (over six rows the material is there to spend: a full
// board's clears make the room the slabs to come need, and the stop). Of
// those: a break in reach first, then more twos -- the fewest panels spent --
// then spare, where the biggest clear goes first (fours, combos, chains take
// panels across the columns and earn the stop) and of those the flattest board.
static int clearKey(int org) { return org * 100000 + (org == 1 ? LNO[3] * 100 - HOLLOW(LNO) : -LNO[3]); }
static int clearOrganizes(const MwCtx *x, const int32_t *st) {
  if (hasGarbage(st) && anyBreakOf(st)) return 3;
  if (twosOf(st) > x->vb) return 2;
  return materialRows(st) >= 6 ? 1 : 0;
}
static int sitWaitClear(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  MwCtx *x = ctx; (void)at;
  if (res[R_SCOPE] != SC_OK) return SIT_END;
  if (!(res[R_TOTAL] > 0)) return SIT_GROW;   // quiet steps on the way to a clear
  if (n == 1 && sw[0] == x->dr && sw[1] == x->dc) return SIT_END;
  int org = clearOrganizes(x, res + R_INTS);
  if (!org) return SIT_END;
  int32_t l2[2 * LINEMAX]; int nl = mwJoin(x, sw, n, l2);
  if (!nl) return SIT_END;
  if (x->tried >= MEANWHILES) return SIT_TAKE;
  x->tried++;
  int v = lineJudge(l2, nl, x->waitAll);
  if ((v & x->need) == x->need && LNO[1] <= x->last0 && !mwDiesSooner(x) && spendsOk(x, l2, nl)) {
    int key = clearKey(org);
    if (!x->bn || key > x->most) { x->most = key; x->bn = n; for (int k = 0; k < 2 * n; k++) x->bsw[k] = sw[k]; }
    return SIT_END;
  }
  v = lineJudge(sw, n, 0);
  if ((v & LV_LIVES) && !mwDiesSooner(x) && spendsOk(x, sw, n)) {
    int key = clearKey(org);
    if (!x->fn || key > x->fmost) { x->fmost = key; x->fn = n; for (int k = 0; k < 2 * n; k++) x->fsw[k] = sw[k]; }
  }
  return SIT_END;
}
// THE HOLLOW ON THE MASKS, as the judge reads it (front.c out[10] + out[13]):
// the gaps under each column's lowest garbage, and the gaps the slabs to come
// would leave -- every four columns' gap under their tallest
static int hollowOnMasks(const int32_t *st) {
  int W = st[O_W], h = 0, top[WMAX + 2];
  for (int c = 1; c <= W; c++) {
    uint32_t g = U(st, GARB + c), occ = U(st, OCC + c);
    top[c] = topRow(occ);
    if (g) { uint32_t below = lowb(g) - 1u; h += popc(below) - popc(occ & below); }
  }
  for (int w = 1; w + 3 <= W; w++) {
    int t = 0;
    for (int c = w; c < w + 4; c++) if (top[c] > t) t = top[c];
    for (int c = w; c < w + 4; c++) h += t - top[c];
  }
  return h;
}
// THE LINE'S PANELS: every panel the line moves, clears or drops (the board
// before it against the board after). A line put first must leave each of them
// where it is, its colour unchanged, or the line is pressed on something else.
static void lineUses(const int32_t *pre, const int32_t *post, uint32_t *used) {
  for (int c = 1; c <= pre[O_W]; c++) {
    uint32_t u = U(pre, OCC + c) & ~U(post, OCC + c);
    for (int a = 0; a < NCOL; a++) u |= (CL(pre, a, c) ^ CL(post, a, c)) & U(pre, OCC + c);
    used[c] = u;
  }
}
static int movesLine(const MwCtx *x, const int32_t *st) {
  for (int c = 1; c <= st[O_W]; c++) {
    uint32_t u = x->used[c];
    if (!u) continue;
    if (u & ~U(st, OCC + c)) return 1;
    for (int a = 0; a < NCOL; a++) if ((CL(x->pre, a, c) ^ CL(st, a, c)) & u) return 1;
  }
  return 0;
}
// THE WAIT'S QUIET LINES, every one the search reaches in time and of any
// order of steps -- a drop and then a swap that lines up two, as much as a
// single swap -- each read on the board it leaves (the masks): least hollow,
// then most vertical twos, then soonest. The best are kept; the engine judges
// them after, in that order.
static int sitWaitQuiet(const int32_t *res, const int32_t *sw, int n, double at, void *ctx) {
  MwCtx *x = ctx; (void)at;
  if (res[R_SCOPE] != SC_OK || res[R_TOTAL] > 0) return SIT_END;
  if (n == 1 && sw[0] == x->dr && sw[1] == x->dc) return SIT_GROW;
  if (n + x->n > LINEMAX) return SIT_END;
  const int32_t *st = res + R_INTS;
  x->seen++;
  if (movesLine(x, st)) { x->moved++; return SIT_GROW; }
  int hl = hollowOnMasks(st), tw = twosOf(st), k = x->qn;
  if (hl > x->hm || (hl == x->hm && tw <= x->vb)) return SIT_GROW;   // levels nothing yet
  if (k == SETUPTRIES) {   // full: it replaces the worst kept, if it beats it
    k = 0;
    for (int i = 1; i < SETUPTRIES; i++) if (x->qh[i] > x->qh[k] || (x->qh[i] == x->qh[k] && x->qt[i] < x->qt[k])) k = i;
    if (hl > x->qh[k] || (hl == x->qh[k] && tw <= x->qt[k])) return SIT_GROW;
  } else x->qn++;
  x->qh[k] = hl; x->qt[k] = tw; x->ql[k] = n;
  for (int q = 0; q < 2 * n; q++) x->qsw[k][q] = sw[q];
  return SIT_GROW;
}
// the kept quiet lines judged on the engine, best on the masks first: the
// first that keeps the line its outcome, loses health no sooner, and leaves
// less hollow -- or as much, with more twos -- than the line alone
static void waitQuietJudge(MwCtx *x) {
  int32_t l2[2 * LINEMAX];
  for (int done = 0; done < x->qn; done++) {
    int at = -1;
    for (int i = 0; i < x->qn; i++) if (x->ql[i] && (at < 0 || x->qh[i] < x->qh[at] || (x->qh[i] == x->qh[at] && x->qt[i] > x->qt[at]))) at = i;
    if (at < 0) break;
    int n = x->ql[at]; x->ql[at] = 0;
    int nl = mwJoin(x, x->qsw[at], n, l2);
    if (!nl) continue;
    x->tried++;
    int v = lineJudge(l2, nl, x->waitAll);
    int hl = HOLLOW(LNO);
    if ((v & x->need) != x->need || LNO[1] > x->last0 || mwDiesSooner(x)) continue;
    if (hl > x->hb) continue;
    static ST MW1; int32_t mc1[2], mt1; uint32_t mcan[WMAX]; uint8_t mwt[32][WMAX];
    int tw = lineState(x->qsw[at], n, MW1, mcan, mwt, mc1, &mt1) == 0 ? twosOf(MW1) : 0;
    if (hl == x->hb && tw <= x->vb) continue;
    x->hb = hl; x->vb = tw; x->bn = n; for (int k = 0; k < 2 * n; k++) x->bsw[k] = x->qsw[at][k];
    return;
  }
}
static void waitLines(MwCtx *x, SitAccept accept) { waitSearch(pressSeen(x->last0) - REACT, accept, x); }
static Dec meanwhile(Dec d) {
  if (d.kind != K_SWAP || !d.hasMove || !BIN[IN_HASPA]) return d;
  int32_t ln[2 * LINEMAX]; int n = 0, kind = LINE_PLAN, waitAll = 0;
  if (BT->nLine && BT->line[0] == d.sr && BT->line[1] == d.sc) { n = BT->nLine; kind = BT->lineKind; waitAll = BT->lineWaitAll; for (int k = 0; k < 2 * n; k++) ln[2 + k] = BT->line[k]; }
  else { n = 1; ln[2] = d.sr; ln[3] = d.sc; }
  if (n >= LINEMAX) return d;
  int v0 = lineJudge(ln + 2, n, waitAll);
  if (!(v0 & LV_LIVES) || LNO[1] <= MEANWHILE) return d;
  int last0 = LNO[1], die0 = LNO[0], need = LV_LIVES | (v0 & LV_BREAKS), mr = 0, mc = 0, most = 0, tried = 0, keep = 1;
  MwCtx x; __builtin_memset(&x, 0, sizeof x);
  x.ln = ln + 2; x.n = n; x.waitAll = waitAll; x.need = need; x.last0 = last0; x.die0 = die0; x.dr = d.sr; x.dc = d.sc;
  x.urgent = aloneOnEngine() && LNA[0] && marginAfter(0, 0, LNA[0]) < 0;
  x.die0Of = die0 ? die0 : 1 << 20;
  int32_t pre[2 * LINEMAX]; int np = 0;   // what goes first: its first step is played, the rest kept before the line
  // THE WAIT LEVELS FIRST: a quiet line pressed now that leaves the line its
  // outcome and lowers the hollow the next slab lands on -- or, as level,
  // sets up more vertical twos -- goes first, the line kept; a clear is put
  // first only when nothing levels, since a clear spends what a break needs.
  {
    int32_t keepO[LNOLEN]; for (int k = 0; k < LNOLEN; k++) keepO[k] = LNO[k];
    static ST MW0; int32_t mc0[2], mt0; uint32_t mcan0[WMAX]; uint8_t mwt0[32][WMAX];
    int tw0 = lineState(0, 0, MW0, mcan0, mwt0, mc0, &mt0) == 0 ? twosOf(MW0) : 0;
    int h0 = HOLLOW(LNO);
    x.hb = h0; x.vb = tw0; x.qn = 0;
    static ST MWL; int32_t mcl[2], mtl; uint32_t mcanl[WMAX]; uint8_t mwtl[32][WMAX];
    if (lineState(ln + 2, n, MWL, mcanl, mwtl, mcl, &mtl) == 0 && tw0 >= 0) { lineUses(MW0, MWL, x.used); x.pre = MW0; }
    x.hm = tw0 >= 0 ? hollowOnMasks(MW0) : 0;
    waitSearchW(pressSeen(x.last0) - REACT, sitWaitQuiet, &x, SETUPWORK);
    waitQuietJudge(&x);
    if (x.bn) { np = x.bn; for (int k = 0; k < 2 * np; k++) pre[k] = x.bsw[k]; }
    for (int k = 0; k < LNOLEN; k++) LNO[k] = keepO[k];
#ifndef __wasm__
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "MEANWHILE level: seen %d moved %d hm %d, tried %d, line hollow %d twos %d -> %d steps hollow %d twos %d\n", x.seen, x.moved, x.hm, x.tried, h0, tw0, np, x.hb, x.vb); }
#endif
  }
  if (!np) {
    x.tried = 0; x.bn = 0;
    lineJudge(ln + 2, n, waitAll);
    waitLines(&x, sitWaitClear);
    tried = x.tried; most = x.most;
    if (x.bn) { np = x.bn; for (int k = 0; k < 2 * np; k++) pre[k] = x.bsw[k]; }
    else if (x.fn) { np = x.fn; for (int k = 0; k < 2 * np; k++) pre[k] = x.fsw[k]; most = x.fmost; keep = 0; }   // the line dropped: decided again once it can be pressed
  }
  if (np) { mr = pre[0]; mc = pre[1]; }
  // A WAIT SETS UP: with nothing better, a setup of any length (setupLines),
  // done before the line is due (last0), goes before it, the line kept, under
  // the same terms -- the line's outcome, no sooner a loss of health, no more hollow
  static SetupCtx mx;
  if (!mr && n < LINEMAX && setupLines(&mx, last0)) {
    int32_t keepO[LNOLEN]; for (int k = 0; k < LNOLEN; k++) keepO[k] = LNO[k];
    lineJudge(ln + 2, n, waitAll);
    int hl0 = HOLLOW(LNO);
    int32_t l2[2 * LINEMAX];
    for (int done = 0; done < mx.n; done++) {
      int at = nextSetup(&mx);
      if (at < 0) break;
      int ns = mx.len[at];
      if (ns + n > LINEMAX) continue;
      for (int k = 0; k < 2 * ns; k++) l2[k] = mx.sw[at][k];
      for (int k = 0; k < 2 * n; k++) l2[2 * ns + k] = ln[2 + k];
      int v = lineJudge(l2, ns + n, waitAll);
      if ((v & need) != need || LNO[1] > last0 || (die0 ? (LNO[0] && LNO[0] < die0) : LNO[0] != 0) || HOLLOW(LNO) > hl0) continue;
      for (int k = 0; k < LNOLEN; k++) LNO[k] = keepO[k];
      lineSet(l2 + 2, ns + n - 1, kind, waitAll);
      return mkSwap(l2[0], l2[1], V_SETUP, d.mode, d.alive);
    }
    for (int k = 0; k < LNOLEN; k++) LNO[k] = keepO[k];
  }
  // nothing goes first in the wait: the lines in time, by rank, the first that pays and lives as long
  LineC *two = 0;
  if (!mr) {
    static unsigned char tk[MAXLINES];
    int dieRef = die0 ? die0 : 1 << 20;
    linesFind(2, 0);
    for (int i = 0; i < nLines; i++) tk[i] = 0;
    for (int seen = 0; seen < LIVINGS && !two; seen++) {
      int at = -1;
      for (int i = 0; i < nLines; i++) {
        LineC *l = &LINES[i];
        if (tk[i] || (l->verdict >= 0 && (l->verdict & (LV_LIVES | LV_PAYS)) != (LV_LIVES | LV_PAYS))) continue;
        if (at < 0 || lineBefore(l, &LINES[at])) at = i;
      }
      if (at < 0) break;
      tk[at] = 1;
      LineC *l = &LINES[at];
      if ((judged(l) & (LV_LIVES | LV_PAYS)) == (LV_LIVES | LV_PAYS) && l->die >= dieRef && notLastSwap(l) && (lineJudge(l->sw, l->n, l->waitAll), spendsOk(&x, l->sw, l->n))) two = l;
    }
    if (two) { mr = two->sw[0]; mc = two->sw[1]; keep = 0; }
  }
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "MEANWHILE %d,%d last %d die %d | tried %d clear %d,%d cells %d keep %d\n", d.sr, d.sc, last0, die0, tried, mr, mc, most, keep); }
#endif
  if (!mr) return d;
  if (keep && np) { int32_t l2[2 * LINEMAX]; int nl = mwJoin(&x, pre + 2, np - 1, l2); if (nl) lineSet(l2, nl, kind, waitAll); else BT->nLine = 0; }
  else if (keep) lineSet(ln + 2, n, kind, waitAll);
  else if (np > 1) lineSet(pre + 2, np - 1, LINE_PLAN, 0);
  else if (two && two->n > 1) lineKeep(two, LINE_PLAN);
  else BT->nLine = 0;
  if (two) return lineSwap(two, d.via, d);
  return mkSwap(mr, mc, d.via, d.mode, d.alive);
}
// READY BEFORE IT LANDS: while garbage is to come and the board is ready
// for the next slab (a break in time once it has landed), a swap
// that leaves it unready is not played -- unless it breaks now, is a step of
// a break or lineup line, or the board held loses health before the swap does.
static Dec keepReady(Dec d) {
  if (!(BIN[IN_INCOMING] > 0) || !baseReady || d.kind != K_SWAP || !d.hasMove) return d;
  if (lineLast == 3 || lineLast == 5 || (lineLast == 1 && (BT->lineKind == LINE_BREAK || BT->lineKind == LINE_PLAN))) return d;
  Cand *pc = poolSwap(d.sr, d.sc);
  if (!pc || swapBreaks(d) || slabReadyHook(pc->masks)) return d;
  int32_t sw[2] = { d.sr, d.sc };
  int v = lineJudge(sw, 1, 0);
  if ((v & LV_LIVES) && aloneDiesBeforeLanding() && (!LNO[0] || LNO[0] > LNA[0])) return d;
#ifndef __wasm__
  if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "KEEPREADY held %d,%d via %d\n", d.sr, d.sc, d.via); }
#endif
  BT->nLine = 0;
  return mkHold(V_SETUP, d.mode, d.alive, 0, 0, 0);
}
// A SWAP THAT IS STILL MOVING WHEN THE LOCK ENDS TAKES THE ROW BACK: the
// raise starts the frame nothing holds the rise lock, and a swap queued then
// cancels it. While a raise waits, a swap is played only if its walk and its
// five frames are done before the lock ends; otherwise the bot holds.
static Dec raiseHold(Dec d) {
  if (!raiseWaiting || d.kind != K_SWAP || !d.hasMove) return d;
  Cand *pc = poolSwap(d.sr, d.sc);
  double mf = pc ? pc->moveFrames : travelCost((int)BIN[IN_CROW], (int)BIN[IN_CCOL], d.sr, d.sc);
  if (mf + 5 <= raiseWaitLeft()) return d;
  lineLast = 0;   // a hold is no line played on: what follows judges the hold
  return mkHold(V_RAISING, d.mode, d.alive, 0, 0, 0);
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
  // EVERY DECISION WITHIN ITS BUDGET, in work (WORKBUDGET, OPTWORK): past
  // OPTWORK resolves and engine lines are refused and every search keeps what
  // it found; past WORKBUDGET the decision is cut and the game fails.
  { extern void paBudget(double); paBudget(OPTWORK); }
  { extern PATLS double paWork; rdW0 = paWork; budgetRefused = 0; }
  btDecision++;
  btDecisionJ = btDecision;
  memoRoom();
  nSettle = nLandR = nFireR = nSavesR = nAnyR = 0;
  nRes = 0; nOptRuns = 0; nOptDepth = 0; nScore = 0; nLook = 0; nSave = 0; rScore = rMain = rLook = rSave = rCand = 0;
  ENGINE_BASE = BIN[IN_HASPA] ? IN : 0;
  for (int c = 0; c < WMAX; c++) ENGINE_CAN[c] = c >= 1 && c < BW ? (uint32_t)BIN[IN_CANSWAP + c] : 0;
  // the stages, timed; the budget is the whole decision's
  extern PATLS double paWork;
  double w0 = paWork, ws[12], ts[12], jm[12]; int k = 0, cutAt[12], js[12];
  fillJudges = 0; fillJudgeMs = 0;
#define NOWMS() 0.0
  double t0 = NOWMS();
  extern int paBudgetOut(void), paBudgetSpent(void), paCutPast(double);
#define SHARE(p) ((void)(p))   // one budget for the whole decision, opened above
  // THE HOLD IS JUDGED FIRST: the board left alone is what the guards hold
  // every decision to, and a guard with nothing to hold it to lets anything
  // through -- so it is judged while the budget is whole, once
  aloneOnEngine();
  frontCalm(aloneOnEngine() && !LNA[0]);   // a board that loses no health holds its walks: the input allowance kept for one that does
  // STORED ROWS FOLLOW THE STACK: every row the bot keeps from one decision
  // to the next -- the line, the target, the routes, the presses -- moves up
  // by the rows risen since
  { int dr = (int)(BIN[IN_RISEN] - BT->risenSeen);
    if (dr > 0) {
      for (int k = 0; k < BT->nLine; k++) BT->line[2 * k] += dr;
      for (int k = 0; k < BT->tgtN; k++) BT->tgt[2 * k] += dr;
      Route *rs[4] = { &BT->plan, &BT->dig, &BT->attack, &BT->flatten };
      for (int q = 0; q < 4; q++) for (int k = 0; k < rs[q]->n; k++) rs[q]->mv[2 * k] += dr;
      for (int i = 0; i < BT->nPr; i++) BT->prR[i] += dr;
    }
    BT->risenSeen = BIN[IN_RISEN]; }
  DBASE = IN; notePresses();
  // THE SWAPS NOT TO UNDO are the last two pressed, never the last decided:
  // a swap decided and still walked to has undone nothing
  BT->nRecent = BT->nPr < 2 ? BT->nPr : 2;
  for (int i = 0; i < BT->nRecent; i++) { BT->recent[2 * i] = BT->prR[i]; BT->recent[2 * i + 1] = BT->prC[i]; }
  routeAdvance(&BT->plan, 0); routeAdvance(&BT->dig, &BT->digIsBreak); routeAdvance(&BT->attack, 0); routeAdvance(&BT->flatten, 0);
  // A LINE ONCE PLAYED IS NOT REPLACED BY A CHOICE THAT DIES SOONER: a route
  // may set a line of its own over the one kept from the last decision, or
  // clear it and choose a swap or a hold; the kept line is played on instead
  // while it lives longer than what the route chose
  Dec d0;
  // the kept line is put back as it was, its stamp too: the presses made
  // since it was set are its steps (playOn), not presses made before it
  int32_t keptLine[2 * LINEMAX]; int keptN = BT->nLine, keptKind = BT->lineKind, keptWait = BT->lineWaitAll, keptPresses = BT->linePresses, keptBorn = BT->lineBorn;
  for (int q = 0; q < 2 * keptN; q++) keptLine[q] = BT->line[q];
  { double keep = stageOpen(0); SHARE(25); d0 = decideRuled(); stageClose(keep); }   // the stages after keep theirs
  Dec d = d0; cutAt[k] = paCutPast(WORKBUDGET); ts[k] = NOWMS(); js[k] = fillJudges; jm[k] = fillJudgeMs; ws[k++] = paWork;
  if (keptN && d.kind != K_RAISE && (BT->nLine != keptN || __builtin_memcmp(BT->line, keptLine, (unsigned long)keptN * 8))) {
    int32_t routeLine[2 * LINEMAX]; int routeN = BT->nLine, routeKind = BT->lineKind, routeWait = BT->lineWaitAll;
    for (int q = 0; q < 2 * routeN; q++) routeLine[q] = BT->line[q];
    lineSet(keptLine, keptN, keptKind, keptWait); BT->linePresses = keptPresses; BT->lineBorn = keptBorn;
    Dec dk = playOn(d);
    int keepIt = 0;
    if (BT->nLine) {
      int keptDie = playDie, routeDie;
      if (routeN || (d.kind == K_SWAP && d.hasMove)) {
        int32_t one[2] = { d.sr, d.sc };
        int v = routeN ? lineJudge(routeLine, routeN, routeWait) : lineJudge(one, 1, d.waitAll);
        routeDie = (v & LV_LIVES) && !LNO[0] ? 1 << 20 : LNO[0] ? LNO[0] : 0;
      } else routeDie = aloneDie(0);
      keepIt = keptDie > routeDie;
#ifndef __wasm__
      if (botTraceOn && keepIt) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "KEPT %d,%d (dies %d) over the route's %s %d,%d (dies %d)\n", BT->line[0], BT->line[1], keptDie, routeN ? "line" : d.kind == K_SWAP ? "swap" : "hold", d.sr, d.sc, routeDie); }
#endif
    }
    if (keepIt) d = dk;
    else { if (routeN) lineSet(routeLine, routeN, routeKind, routeWait); else BT->nLine = 0; d = playOn(d); }
  } else {
    SHARE(5); d = playOn(d);
  }
  int32_t lineAfterPlay[2 * LINEMAX]; int nLineAfterPlay = BT->nLine;
  for (int q = 0; q < 2 * BT->nLine; q++) lineAfterPlay[q] = BT->line[q];
  d = waitForDrain(d); d = raiseHold(d); cutAt[k] = paCutPast(WORKBUDGET); ts[k] = NOWMS(); js[k] = fillJudges; jm[k] = fillJudgeMs; ws[k++] = paWork;
  SHARE(25); d = breakFirst(d); cutAt[k] = paCutPast(WORKBUDGET); ts[k] = NOWMS(); js[k] = fillJudges; jm[k] = fillJudgeMs; ws[k++] = paWork;
  SHARE(5); d = stayAlive(d); cutAt[k] = paCutPast(WORKBUDGET); ts[k] = NOWMS(); js[k] = fillJudges; jm[k] = fillJudgeMs; ws[k++] = paWork;
  SHARE(15); d = keepBreak(d); d = lineupFirst(d); cutAt[k] = paCutPast(WORKBUDGET); ts[k] = NOWMS(); js[k] = fillJudges; jm[k] = fillJudgeMs; ws[k++] = paWork;
  SHARE(5); d = batchBreak(d); d = spendToBreak(d); cutAt[k] = paCutPast(WORKBUDGET); ts[k] = NOWMS(); js[k] = fillJudges; jm[k] = fillJudgeMs; ws[k++] = paWork;
  SHARE(10); d = breakSoon(d); cutAt[k] = paCutPast(WORKBUDGET); ts[k] = NOWMS(); js[k] = fillJudges; jm[k] = fillJudgeMs; ws[k++] = paWork;
  // FILL LEAVES THE STEPS AFTER IT THEIR SHARE (stageOpen): the leveling,
  // readiness and guards that follow it are measured as a stage of their own
  Dec dF;
  { double keep = stageOpen(7); SHARE(10); dF = fillFirst(d); stageClose(keep); }
  cutAt[k] = paCutPast(WORKBUDGET); ts[k] = NOWMS(); js[k] = fillJudges; jm[k] = fillJudgeMs; ws[k++] = paWork;
  // READY BEFORE THE WAIT: the line that readies the landing is chosen first,
  // with the work there is; the wait then fills the time before that line
  { Dec dC = dropReady(meanwhile(readyWhenLands(keepReady(onePlan(dF))))), dS = noStall(dC);
    // A STALL REFUSED FALLS BACK TO THE CHOICE IT WAS PUT BEFORE, not to
    // standing still: the fill (or what came before it), if that is no stall
    if (dS.kind == K_HOLD && dC.kind == K_SWAP && dF.kind == K_SWAP && !(dF.sr == dC.sr && dF.sc == dC.sc)) { Dec a = noStall(dF); if (a.kind == K_SWAP) dS = dF; }
    d = dS; }
  // A BREAK HELD FOR A BETTER TIME IS NOT HELD FOR NOTHING: if the decision
  // comes to standing still, the break is played -- idle readies nothing
  if (d.kind == K_HOLD && bbHasDeferred) {
    LineC *l = &bbDeferred;
    lineLast = 3; plansDrop();
    if (l->n > 1) lineKeep(l, LINE_BREAK); else BT->nLine = 0;
    d = lineSwap(l, V_BREAKREACH, d);
  }
  // A LINE IS PRESSED AS IT WAS JUDGED: a decision that plays the kept line's
  // step takes the line's timing (a break waits for its panels to settle),
  // whichever route returned it
  if (d.kind == K_SWAP && BT->nLine == 1 && BT->line[0] == d.sr && BT->line[1] == d.sc) d.waitAll = BT->lineWaitAll;
  // the one choice (arbitrate): survival's above all
  d = setupTwos(d);
  d = arbitrate(d);
  recordTarget(d);
  // a line set this decision is stamped with the presses made before it
  if (BT->nLine && (BT->nLine != nLineAfterPlay || __builtin_memcmp(BT->line, lineAfterPlay, (unsigned long)BT->nLine * 8))) { BT->linePresses = BIN[IN_PRESSES]; BT->lineBorn = BT->nNotes; }
#ifndef __wasm__
  // THE PRESS THE JUDGE EXPECTS, for the log: read from the judge's memo only
  // (the log does no work), set beside the PRESS line the front writes
  if (botTraceOn && d.kind == K_SWAP && d.hasMove) {
    extern int fprintf(void *, const char *, ...); extern void *stderr;
    int playsLine = BT->nLine && BT->line[0] == d.sr && BT->line[1] == d.sc, v; int32_t lno[LNOLEN];
    int32_t sw1[2] = { d.sr, d.sc };
    if (playsLine ? jmFind(BT->line, BT->nLine, BT->lineWaitAll, &v, lno) : jmFind(sw1, 1, d.waitAll, &v, lno))
      { fprintf(BLOG, "PLAN at %d,%d press at clock %d last %d die %d | line", d.sr, d.sc, lno[16], lno[1], lno[0]);
        for (int k = 0; k < BT->nLine; k++) fprintf(BLOG, " %d,%d", BT->line[2 * k], BT->line[2 * k + 1]);
        fprintf(BLOG, " kind %d wait %d\n", BT->lineKind, BT->lineWaitAll); }
  }
#endif
  cutAt[k] = paCutPast(WORKBUDGET); ts[k] = NOWMS(); js[k] = fillJudges; jm[k] = fillJudgeMs; ws[k++] = paWork;
#undef SHARE
#ifndef __wasm__
  // THE DECISION'S OWN ACCOUNT, kept for whoever finds it over the frame:
  // each stage's milliseconds and engine judges
  { extern int snprintf(char *, unsigned long, const char *, ...);
    static const char *const nm[] = { "ruled", "drain", "breakFirst", "stayAlive", "lineup", "spend", "soon", "fill", "after" };
    extern PATLS double paWork;
    int at = snprintf(lastStages, sizeof lastStages, "decision %d, work %.0f, judges declined %d:", btDecision, paWork - rdW0, budgetRefused);
    for (int i = 0; i < k && i < NSTAGES && at < (int)sizeof lastStages; i++)
      at += snprintf(lastStages + at, sizeof lastStages - at, " %s %.1f/%d", nm[i], ts[i] - (i ? ts[i - 1] : t0), js[i] - (i ? js[i - 1] : 0));
    if (botTraceOn) { extern int fprintf(void *, const char *, ...); extern void *stderr;   // every decision's work, by stage, in the bot log
      fprintf(BLOG, "WORKS"); for (int i = 0; i < k && i < NSTAGES; i++) fprintf(BLOG, " %s %.0f", nm[i], ws[i] - (i ? ws[i - 1] : w0)); fprintf(BLOG, " | total %.0f, declined %d\n", paWork - rdW0, budgetRefused); } }
#endif
  // the most the stages after breakFirst (and after lineup) have taken lately:
  // each decision's own, or the last most less a hundredth a decision -- one
  // heavy decision does not shut the searches out for the rest of the game
  stagesMeasured(ws, k);
  // the most a judge, a search, a replay has cost: lately, as the reserves -- one heavy one does not shut them out for the game
  jdCost *= 0.99; btCost *= 0.99; rpCost *= 0.99; rdCost *= 0.99;
  // A CUT IS A FAILURE: a stage that reaches its share has not decided, it has
  // been stopped. The decision fails and the game stops, naming the stage.
  for (int i = 0; i < k; i++) if (cutAt[i]) {
#ifndef __wasm__
    extern int fprintf(void *, const char *, ...); extern void *stderr;
    static const char *STAGE[] = { "decideRuled", "playOn/waitForDrain/raiseHold", "breakFirst", "stayAlive", "keepBreak/lineupFirst", "batchBreak/spendToBreak", "breakSoon", "fillFirst", "meanwhile/keepReady/readyWhenLands/dropReady/guards" };
    fprintf(BLOG, "budget: the decision was cut in %s (%.2f ms)\n", STAGE[i], ts[i] - (i ? ts[i - 1] : t0));
#endif
    botFailed = 1; break;
  }
#ifndef __wasm__
  { extern char *getenv(const char *); extern int fprintf(void *, const char *, ...); extern void *stderr;
    if (0) { fprintf(BLOG, "STAGES%s pool %.3f", paBudgetOut() ? " OUT" : "", dcCandMs); fprintf(BLOG, " SA %.3f %d MO %.3f", saMs, saN, moMs); saMs = moMs = 0; saN = 0; for (int i = 0; i < k; i++) fprintf(BLOG, " %.0f/%.3f/%d/%.3f", ws[i] - (i ? ws[i - 1] : w0), ts[i] - (i ? ts[i - 1] : t0), js[i] - (i ? js[i - 1] : 0), jm[i] - (i ? jm[i - 1] : 0)); fprintf(BLOG, "\n"); } }
#endif
  ENGINE_BASE = 0;
#ifndef __wasm__
  // what the decision is and which stage it came from, with what its swap
  // clears on its own (the pool's resolve): the trace's, read by scan tools
  if (botTraceOn && !(d.kind == K_SWAP && d.hasMove)) { extern int fprintf(void *, const char *, ...); extern void *stderr; fprintf(BLOG, "DECIDE %s via %d\n", d.kind == K_RAISE ? "raise" : "hold", d.via); }
  if (botTraceOn && d.kind == K_SWAP && d.hasMove) { extern int fprintf(void *, const char *, ...); extern void *stderr;
    Cand *pc = poolSwap(d.sr, d.sc);
    fprintf(BLOG, "DECIDE via %d %d,%d total %d chain %d broke %d line %d\n", d.via, d.sr, d.sc, pc ? pc->res.total : -1, pc ? pc->res.chain : -1, pc ? pc->res.broke : -1, lineLast); }
#endif
  double *o = BOUT;
  for (int i = 0; i < 128; i++) o[i] = 0;
  o[0] = d.kind; o[1] = d.hasMove; o[2] = d.sr; o[3] = d.sc; o[4] = d.hasPark; o[5] = d.pr; o[6] = d.pc;
  o[7] = d.via; o[8] = d.spends; o[9] = d.reveal; o[10] = d.mode; o[11] = d.alive;
  o[12] = BT->wantRaise; o[13] = BT->wantRows; o[14] = clearRaiseFrames;
  BT->lastVia = d.via;
  o[98] = d.waitAll;   // the swap waits for the board to settle (front.c)
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
    case 2: scoreShare = 0; return score(IN, (int)a[1], hasRes ? &r : 0);
    case 3: { Cand c; memset(&c, 0, sizeof c); c.masks = RISEN; c.moveFrames = (int)a[1]; return idleScore(&c, IN); }
    case 4: { Cand c; memset(&c, 0, sizeof c); c.kind = (int)a[2]; c.sr = (int)a[3]; c.sc = (int)a[4]; c.res = r;
              return refuses(&c, IN, (int)a[5], (int)a[6]); }
    case 5: return raiseMode(IN, (int)a[1]);
    case 6: return framesToRise(a[1], a[2], a[3]);
    case 7: return framesToDeath((int)a[1], a[2]);
    case 8: {
      DBASE = IN; optsBuilt = 0; optSkip = 0; planReset(IN);
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

// THE DISTANCE PLANNER ON A BOARD, for its tests: targetLines on the board
// put in IN, the cursor at (cr, cc), no time bound. LIST gets each line as
// its length then its swaps (up to eight), 22 lines at most; the count is returned.
__attribute__((export_name("bit_target_lines"))) int32_t bit_target_lines(int32_t cr, int32_t cc) {
  memoRoom(); threadInit();
  linesReset();
  breakLines(IN, cr, cc, 0, INF);
  int n = nLines < 22 ? nLines : 22;
  for (int i = 0; i < n; i++) {
    int32_t *o = LIST + 17 * i;
    o[0] = LINES[i].n;
    for (int k = 0; k < 16; k++) o[1 + k] = k < 2 * LINES[i].n ? LINES[i].sw[k] : 0;
  }
  return nLines;
}
// THE SHARED SEARCH ON A BOARD, for its tests: the soonest break (sitBreaks)
// from the cursor at (cr, cc), no time bound. LIST gets its length then its
// swaps; 1 if one is found.
__attribute__((export_name("bit_break_search"))) int32_t bit_break_search(int32_t cr, int32_t cc) {
  memoRoom(); threadInit();
  extern PATLS double paWork;
  rdW0 = paWork;
  int32_t sw[2 * LINEMAX]; int n = 0; double at = 0;
  int found = searchInTime(IN, cr, cc, 0, 0, INF, 0, 0, 0, 20000, sitBreaks, 0, sw, &n, &at);
  LIST[0] = found ? n : 0;
  for (int k = 0; k < 2 * n && k < 2 * LINEMAX; k++) LIST[1 + k] = sw[k];
  return found;
}
