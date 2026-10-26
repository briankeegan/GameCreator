// GAMBIT IN THE GAME'S OWN PROCESS (libgambit.so, loaded by lua/GambitNative.lua): the C engine, Gambit (gambit.c) and its frame
// loop (front.c), and Gambit's own thread, which answers the frame loop's questions while the game runs on. The game's thread only loads
// the board, plays the frame loop and returns the keys. What a host gives -- the heap, the clock, a lock and a thread, the log -- is
// host.c's, built beside this with the system's headers (which this file, on the engine's own libc.h, cannot include).
//
//   clang -O3 -march=native -pthread -fPIC -shared -DPA_HEAP native.c host.c -lm -o libgambit.so      (build.sh)

// (the engine's thread pool, search.h, waits on wasm's atomics: natively a futex, host.c -- the workers gn_setup starts)
int hostFutexWait(int *p, int v), hostFutexWake(int *p, int n);
#define __builtin_wasm_memory_atomic_notify(p, n) hostFutexWake((int *)(p), (int)(n))
#define __builtin_wasm_memory_atomic_wait32(p, v, t) hostFutexWait((int *)(p), (int)(v))
#include "gambit.c"

// ---------------------------------------------------------------- host.c
void *paHeap(unsigned long n);
double hostNowMs(void);
void hostThreadStats(double *out);
void hostLock(void), hostUnlock(void), hostWait(void), hostSignal(void), hostWaitDone(void), hostSignalDone(void);
int hostLockstep(void);
int hostForce(int *at, int *k);
int hostThread(void *(*fn)(void *));
int hostWorkers(void *(*fn)(void *), int most);
int hostOpenLog(const char *path);
void hostCrashHandler(void);
void hostLog(const char *s);
int snprintf(char *s, unsigned long n, const char *fmt, ...);
int strncmp(const char *a, const char *b, unsigned long n);
char *strchr(const char *s, int c);
int atoi(const char *s);
int abs(int v);
void *memmove(void *d, const void *s, unsigned long n);

// ---------------------------------------------------------------- what the engine and Gambit take from a host
static int32_t abortId, curQid;
static int32_t gameFrame;   // (the frame the game last published: gn_frame)
// 1 once the question being answered is no longer wanted: every question up to abortId is not
int abort_poll(void) { return __atomic_load_n(&abortId, __ATOMIC_SEQ_CST) >= __atomic_load_n(&curQid, __ATOMIC_SEQ_CST) ? 1 : 0; }
double clock_ms(void) { return hostNowMs(); }
// THE DECISION'S CLOCK: the engine's work, never the wall's (core/clock.h WORK_PER_MS) -- so a board gets the same answer on any machine
// and the game is its seed's. The wall stays the guard: a decision the game's frame overtakes is cut there (frameOut) and counted (wallCut),
// and an answer taken after its own frame is counted by the frame loop (pastFrame).
static void flog(const char *s) { hostLog(s); }

#include "front.c"

// ---------------------------------------------------------------- Gambit's thread
// One question waits at most: a newer one takes its place. Answers wait in order for the frame loop to take them.
#define ANSN 16
static int workerOn, qHas, qReset, qBusy;
static FQuestion qSlot;
static Board *qSlotBoard;
static FAnswer answers[ANSN];
static int ansHead, ansN;
static int32_t gnReaction = 12, gnPlanHealth = 1;
static char ruleNames[MAXRULES][48];

static void postQuestion(FQuestion *q) {
  hostLock();
  if (!qSlotBoard) qSlotBoard = nb_new();
  qSlot = *q; copyBoard(qSlotBoard, q->b); qSlot.b = qSlotBoard;
  qHas = 1;
  hostSignal();
  hostUnlock();
}
static int takeAnswer(FAnswer *a) {
  hostLock();
  int got = ansN > 0 && answers[ansHead].readyFrame <= __atomic_load_n(&gameFrame, __ATOMIC_SEQ_CST);   // (on its frame, not before)
  if (got) { *a = answers[ansHead]; ansHead = (ansHead + 1) % ANSN; ansN--; }
  hostUnlock();
  return got;
}
static int answerWaiting(int32_t id) {
  hostLock();
  int has = 0;
  for (int i = 0; i < ansN && !has; i++) has = answers[(ansHead + i) % ANSN].id == id && answers[(ansHead + i) % ANSN].readyFrame <= __atomic_load_n(&gameFrame, __ATOMIC_SEQ_CST);
  hostUnlock();
  return has;
}
static void abortTo(int32_t id) {
  int32_t old = __atomic_load_n(&abortId, __ATOMIC_SEQ_CST);
  while (id > old && !__atomic_compare_exchange_n(&abortId, &old, id, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)) {}
  hostLock();
  if (qHas && qSlot.id <= id) qHas = 0;
  hostUnlock();
}
// Whether the stack would take a raise now: the engine acts on one only while nothing holds the floor.
static int canRaiseOn(Board *b) { return raiseOpen(b); }   // (the raise open: search/ready.c raiseShutOf, the one test)
// (and the raise the frame loop would press there: the engine step its keys are made from -- front.c keysOf -- asked on the question's
// board, so a raise is offered only where it can be pressed)
static Ctx *raiseCtx;
static int raisePresses(const FQuestion *q, Board *b) {
  raiseCtx = ctxOf(raiseCtx);
  Question qq; memset(&qq, 0, sizeof qq);
  qq.b = b; qq.holdLeft = q->holdLeft; qq.holdStarted = q->holdStarted; qq.narr = arrivalsFrom(b, q->arr, q->narr, qq.arr);
  int root = rootOf(raiseCtx, &qq);
  if (root < 0) return 0;
  int r = advance(raiseCtx, root, MK_RAISE, 0, 0, 0);
  ns_reset(raiseCtx);
  return r != STEP_NULL && r != STEP_ERR;
}
// (THE LAST BOARDS, ringKeep below)
#define RINGN 32
static Board *ring[RINGN]; static int32_t ringAt[RINGN], ringNarr[RINGN], ringAllow[RINGN], ringGap[RINGN]; static Arr ringArr[RINGN][MAXARR]; static int ringHead, ringCount;
// The board as base64 of its bytes (the head, the queue, the rows), for the reach report (GAMBITB)
static int b64(const unsigned char *p, int n, char *out) {
  static const char A[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  int k = 0;
  for (int i = 0; i < n; i += 3) {
    unsigned v = (unsigned)p[i] << 16 | (i + 1 < n ? (unsigned)p[i + 1] << 8 : 0) | (i + 2 < n ? p[i + 2] : 0);
    out[k++] = A[v >> 18 & 63]; out[k++] = A[v >> 12 & 63]; out[k++] = i + 1 < n ? A[v >> 6 & 63] : '='; out[k++] = i + 2 < n ? A[v & 63] : '=';
  }
  out[k] = 0;
  return k;
}
#define SAMPLEQ 32   // (a board is about 20 KB of log: one in 32 decisions keeps a game's log under a megabyte of them)
// (with the decision's conditions after the arrivals: a<allowance left> g<the pace's gap> -- what a search again is given)
static int32_t dumpAllow = -1, dumpGap;
static void dumpBoard(const char *tag, int32_t at, const Board *b, const Arr *arr, int narr) {
  static unsigned char bytes[sizeof(Board)];
  static char line[sizeof(Board) * 2];
  unsigned long n = BOARD_HEAD;
  memcpy(bytes, b, BOARD_HEAD);
  memcpy(bytes + n, b->inc, (unsigned long)b->ninc * sizeof(Incoming)); n += (unsigned long)b->ninc * sizeof(Incoming);
  memcpy(bytes + n, b->p, (unsigned long)b->nrows * sizeof(Panel) * (W + 1)); n += (unsigned long)b->nrows * sizeof(Panel) * (W + 1);
  int k = snprintf(line, sizeof line, "%s %d C%d:", tag, at, (int)sizeof(Board));
  k += b64(bytes, (int)n, line + k);
  k += snprintf(line + k, sizeof line - (unsigned long)k, " [");
  for (int i = 0; i < narr; i++) k += snprintf(line + k, sizeof line - (unsigned long)k, "%s[%d,%d,%d]", i ? "," : "", arr[i].at, arr[i].width, arr[i].height);
  snprintf(line + k, sizeof line - (unsigned long)k, "] a%d g%d", dumpAllow, dumpGap);
  flog(line);
}
// A question answered: the board judged at level 10's health. It stops in time for its move, on
// the game's own frame, which the frame loop publishes (the frame played, when it began, the ms a frame takes): out once the frame
// before its move has begun, or sooner when what it still has to do once out (its closing work, the slowest of the last CLOSEN
// decisions') would not be done before its move's frame begins. Its searches share the time until then.
#define CLOSEN 32
static int32_t dueFrame;
static double gameFrameMs, gameMsPerFrame = 1000.0 / 60, closeMs[CLOSEN];
static int32_t nclose; static uint32_t frameCounter;
static double closeWorst(void) { double w = 0; for (int i = 0; i < nclose; i++) if (closeMs[i] > w) w = closeMs[i]; return w; }
// (read without a lock: the frame loop's thread must never wait on Gambit's, which reads these on every step)
static double moveStartMs(int32_t at) {
  double began, per;
  __atomic_load(&gameFrameMs, &began, __ATOMIC_SEQ_CST); __atomic_load(&gameMsPerFrame, &per, __ATOMIC_SEQ_CST);
  int32_t f = __atomic_load_n(&gameFrame, __ATOMIC_SEQ_CST);
  return began + (at - f) * per;
}
// (the client runs frames back to back to catch up: the longest such run seen, which a decision's frame comes that much sooner by)
static int32_t gameBurst, wallCut;
// LOCKSTEP (GC_GAMBIT_LOCKSTEP=1, the training runs): the frame loop waits for every answer asked, so no wall reaches a decision -- its
// time is the work clock's alone, and the game runs as fast as Gambit and the engine can play it, the same game on any machine
static int gnLockstep;
static int frameOut(void) {
  if (gnLockstep) return 0;
  int out = __atomic_load_n(&gameFrame, __ATOMIC_SEQ_CST) >= dueFrame - __atomic_load_n(&gameBurst, __ATOMIC_SEQ_CST) ||
            clock_ms() + closeWorst() >= moveStartMs(dueFrame + 1);
  if (out) wallCut = 1;
  return out;
}
static void ringKeep(int32_t at);
static void answerOne(FQuestion *q, Board *b, FAnswer *out) {
  double t0 = clock_ms();
  wallCut = 0;
  if (gnPlanHealth) { b->health = imin(b->health, gnPlanHealth); b->maxHealth = imin(b->maxHealth, gnPlanHealth); }
  dueFrame = q->at - 1; clockFrameOut = frameOut;
  // (the searches' deadline on the work clock: the frames from the question's frame to the one before its move, less one for its
  // closing work -- clockStart begins the count at 0)
  double due = imax(1, q->lead - 2) * (1000.0 / 60);
  if (!hostBoard) hostBoard = nb_new();
  cloneBoard(hostBoard, b);
  memset(&hostQ, 0, sizeof hostQ);
  hostQ.b = hostBoard; hostQ.holdLeft = q->holdLeft; hostQ.holdStarted = q->holdStarted; hostQ.tight = 0;
  hostQ.narr = arrivalsFrom(hostBoard, q->arr, q->narr, hostQ.arr);
  gb_refused(q->refA, q->refB);
  __atomic_store_n(&decGap, q->gap, __ATOMIC_RELAXED);   // (the pace the frame loop presses this decision's line with)
  dumpAllow = q->allowance; dumpGap = q->gap;
  hostWin = 1; winLen = q->window; nWinAges = imin(q->nages, WINMAX); for (int i = 0; i < nWinAges; i++) winAges[i] = q->ages[i];
  gb_played(q->played);
  answerQuestion(q->id, q->at, q->topped, q->oppHas, q->oppOut, q->oppHas, q->oppTop, q->oppHas, q->oppStop, 1, q->allowance, q->lineFrom, q->linePressed,
                 canRaiseOn(hostBoard) && raisePresses(q, hostBoard), due, 0, 0);
  // (the closing work: from the moment it ran out of time to its answer)
  if (clockWentOut) { closeMs[nclose < CLOSEN ? nclose++ : (int)(frameCounter++ % CLOSEN)] = nowMs() - clockWentOut; }   // (on the work clock: the wall guard's estimate)
  Answer *A = &theAnswer;
  memset(out, 0, sizeof *out);
  out->id = q->id; out->epoch = q->epoch; out->at = q->at; out->kind = A->d.kind; out->move = A->d.move; out->play = A->play;
  out->tap = A->tap; out->raiseNow = A->raiseNow; out->raiseAfter = A->raiseAfter; out->raiseWait = A->raiseWait; out->nhand = A->nhand;
  for (int i = 0; i < A->nhand; i++) { out->hand[i] = A->hand[i]; out->handAt[i] = A->handAt[i]; }
  out->wastes = A->wastes; out->proven = A->proven;
  out->holdLives = A->holdLives; out->brk = A->brk; out->urgent = A->urgent; out->idleMs = A->idleMs;
  out->empty = A->empty; out->nalt = A->nalt; for (int i = 0; i < A->nalt; i++) out->alt[i] = A->alt[i];
  out->ms = nowMs(); out->closeMs = clockWentOut ? nowMs() - clockWentOut : 0;
  // (never the frame it was asked on: the frame loop takes answers before it asks, so the soonest it can take one is the frame after)
  out->readyFrame = imax(q->at - q->lead + 1, (q->at - q->lead) + (int32_t)__builtin_ceil(out->ms / (1000.0 / 60)));
  // the log line, its rule named and its wall time added
  static char line[sizeof logBuf + 128];
  const char *s = logBuf;
  int k = 0;
  if (!strncmp(s, "GAMBITD ", 8)) {
    const char *at = strchr(s + 8, ' ');
    if (at && at[1] == '@') {
      int r = atoi(at + 2);
      k = snprintf(line, sizeof line, "%.*s %s", (int)(at - s), s, A->d.kind >= 0 && r >= 0 && r < MAXRULES ? ruleNames[r] : "");
      s = at + 2; while (*s >= '0' && *s <= '9') s++;
    }
  }
  snprintf(line + k, sizeof line - (unsigned long)k, "%s wallMs=%d out=%d pre=%d/%d work=%lld%s", s, (int)(clock_ms() - t0), clockWentOut ? (int)(nowMs() - clockWentOut) + 1 : 0, (int)readyPre, (int)readyPendN, (long long)clockWork, wallCut ? " wallCut=1" : "");
  flog(line);
  // (a life not kept: the last decision's board, then this one -- GAMBITK)
  if (A->dumpBoard == 3) { hostLock(); int last = (ringHead - 1 + RINGN) % RINGN; if (ringCount && ring[last]) { int32_t a = dumpAllow, g = dumpGap; dumpAllow = ringAllow[last]; dumpGap = ringGap[last]; dumpBoard("GAMBITK", ringAt[last], ring[last], ringArr[last], ringNarr[last]); dumpAllow = a; dumpGap = g; } hostUnlock(); }
  if (A->dumpBoard) dumpBoard(A->dumpBoard == 2 ? "GAMBITT" : A->dumpBoard == 3 ? "GAMBITK" : "GAMBITB", q->at, hostBoard, hostQ.arr, hostQ.narr);
  // (A SAMPLE OF EVERY DECISION: one question in SAMPLEQ, whatever it is, its board -- GAMBITQ, what test/decisions.txt.gz is drawn from,
  // so the replay holds the decisions a game makes and not only the ones some search came up empty on)
  static uint32_t asked;
  if (++asked % SAMPLEQ == 0) dumpBoard("GAMBITQ", q->at, hostBoard, hostQ.arr, hostQ.narr);
  // (a line the break search said breaks and the judge says does not: its board, rate-limited, for replaying both on it -- GAMBITU)
  static int32_t lastU = NUL;
  if (unbroken.set && (lastU == NUL || q->at - lastU >= 120 || q->at < lastU)) { lastU = q->at; dumpBoard("GAMBITU", q->at, hostBoard, hostQ.arr, hostQ.narr); }
  // (a line played lost a break's time sooner than one offered: its board, rate-limited, for the checks' questions -- GAMBITS; test/main.c
  // fails any such answer)
  static int32_t lastS = NUL;
  if (A->sooner && (lastS == NUL || q->at - lastS >= 60 || q->at < lastS)) { lastS = q->at; dumpBoard("GAMBITS", q->at, hostBoard, hostQ.arr, hostQ.narr); }
  ringKeep(q->at);
}
// THE LAST BOARDS: every question's board and garbage on its way, the last RINGN decisions kept, written out when the match ends (GAMBITL lines,
// oldest first) -- what a loss is replayed from.
static void ringKeep(int32_t at) {
  hostLock();
  // (a question asked again for a frame no later than ones kept takes their place: the plans made past it were dropped -- the ring holds
  // one board a frame, in order, the last RINGN decisions forward)
  while (ringCount && ringAt[(ringHead - 1 + RINGN) % RINGN] >= at) { ringHead = (ringHead - 1 + RINGN) % RINGN; ringCount--; }
  int k = ringHead;
  if (!ring[k]) ring[k] = nb_new();
  if (ring[k]) {
    cloneBoard(ring[k], hostBoard); ringAt[k] = at; ringNarr[k] = hostQ.narr; ringAllow[k] = dumpAllow; ringGap[k] = dumpGap;
    for (int i = 0; i < hostQ.narr; i++) ringArr[k][i] = hostQ.arr[i];
    ringHead = (ringHead + 1) % RINGN; if (ringCount < RINGN) ringCount++;
  }
  hostUnlock();
}
static void ringOut(void) {
  hostLock();
  for (int i = 0; i < ringCount; i++) { int k = (ringHead - ringCount + i + RINGN) % RINGN; dumpAllow = ringAllow[k]; dumpGap = ringGap[k]; dumpBoard("GAMBITL", ringAt[k], ring[k], ringArr[k], ringNarr[k]); }
  ringCount = 0;
  hostUnlock();
}
static void *workerMain(void *arg) {
  (void)arg;
  paThreadId(0);   // (the engine's thread 0, the searching one: the phases hand boards out of its pool, the workers are 1..n)
  static FQuestion q;
  Board *b = nb_new();
  for (;;) {
    hostLock();
    while (!qHas && !qReset) hostWait();
    if (qReset) { qReset = 0; ringCount = 0; hostUnlock(); gb_new_game(); hostLock(); hostSignalDone(); hostUnlock(); continue; }
    q = qSlot; copyBoard(b, qSlotBoard); q.b = b; qHas = 0; qBusy = 1;
    __atomic_store_n(&curQid, q.id, __ATOMIC_SEQ_CST);
    hostUnlock();
    FAnswer a;
    int kept = 0;
    if (abort_poll() != 1) { answerOne(&q, b, &a); kept = abort_poll() != 1; }
    hostLock();
    if (kept) {
      if (ansN == ANSN) { ansHead = (ansHead + 1) % ANSN; ansN--; }
      answers[(ansHead + ansN) % ANSN] = a; ansN++;
    }
    qBusy = 0;
    hostSignalDone();
    hostUnlock();
  }
  return 0;
}

// ---------------------------------------------------------------- the host's calls (lua/GambitNative.lua)
static int32_t gnAhead = 90, gnGap = 20, gnJitter = 16, gnFrames;
static int32_t ages[512];
// The bot's hands and pacing, level 10's health, and the run's log.
// THE WORKERS: GC_GAMBIT_WORKERS of them (host.c hostWorkers; none unset), each the
// engine's pool's (search.h workerLoop) -- every batch of steps a search hands the pool (core/nodes.h stepMany) is played on them all.
static void *gnWorker(void *arg) { paThreadId((int)(long)arg); workerLoop(); return 0; }
int gn_setup(int reaction, int swapGap, int cursor, int ahead, int gap, int jitter, int planHealth, const char *logPath) {
  hostTaps = 1;
  // (THE GAME'S THREAD, which calls this and plays the frame loop -- its keys are engine steps (front.c keyCtx) -- is the engine's last
  // thread, its own board pool: thread 0 is Gambit's, the one the workers' phases hand boards out of)
  paThreadId(MAXTHREADS - 1);
  gnLockstep = hostLockstep();
  { int fa, fk; if (hostForce(&fa, &fk)) gb_force(fa, fk); }
  gnReaction = reaction; gnAhead = ahead; gnGap = gap; gnJitter = jitter; gnPlanHealth = planHealth;
  gb_config(reaction, swapGap, cursor);
  gb_clock_on_work(1);   // (every thread's decisions on the work clock)
  if (logPath && *logPath) hostOpenLog(logPath);
  hostCrashHandler();
  static int started;
  if (!started) {
    started = 1;
    int n = hostWorkers(gnWorker, MAXTHREADS - 2);
    while (__atomic_load_n(&pool.nworkers, __ATOMIC_SEQ_CST) < n) {}
    static char line[64]; snprintf(line, sizeof line, "GAMBIT workers %d", n); flog(line);
  }
  return 0;
}
// The rules, as the loader encodes them (gambit.js rulesWords), in gn_io; set before the first question.
int32_t *gn_io(void) { return gbIo; }
int gn_rules(int n) { return gb_rules(n); }
void gn_rule_name(int i, const char *name) { if (i >= 0 && i < MAXRULES) snprintf(ruleNames[i], sizeof ruleNames[i], "%s", name); }
void gn_profile(int mode, int ms, int extendMs, int width, int depth, int pool, int extendDepth, int extendOff) {
  gb_profile(mode, ms, extendMs, width, depth, pool, extendDepth, extendOff, cfgReaction, cfgSwapGap, cfgCursor);
}
// Switching (answer.c gb_switch): the profile's stretch between switches, in frames; each match draws its own (gn_match)
void gn_switch(int min, int max) { gb_switch(min, max); }
// The break search's share in percent, under garbage and otherwise (answer.c gb_share; 0 the default)
void gn_share(int under, int otherwise) { gb_share(under, otherwise); }
void gn_thread_stats(double *out) { hostThreadStats(out); }
int32_t *gn_tele(void) { return tele; }
int32_t *gn_ages(void) { return ages; }
static void statsOut(void) { static char line[4096]; if (!F.st.frames) return; statsLine(line, sizeof line); flog(line); }
// A match begins: nothing of the last is carried on.
void gn_match(void) {
  statsOut();
  frontNew(gnAhead, gnGap, gnJitter);
  gb_switch_game(1);   // (the switches the same every game: the game is its seed's)
  gnFrames = 0;
  hostLock();
  qHas = 0; qReset = 1; ansN = 0;
  hostSignal();
  hostUnlock();
  if (!workerOn) { workerOn = 1; hostThread(workerMain); }
}
// A frame in play: the board in the engine's io (the host wrote it, nb_io_head / nb_io_body), the telegraphs in gn_tele, the input
// budget's limit and window and the frames ago each key inside it went down (gn_ages), and the opponent. The keys to press, or -1.
// (a clock behind the last frame's is a game begun again without gn_match: begun so. A question asked for a frame sooner than the
// last one asked is the same game -- the frame loop asks again after it drops its plans.)
int gn_frame(int limit, int window, int nages, int oppHas, int oppOut, int oppTop, int oppStop) {
  static int32_t lastClock = NUL;
  if (nb_load(F.truth)) return -1;
  int32_t clock = F.truth->clock;
  if (lastClock != NUL && clock < lastClock) gn_match();
  lastClock = clock;
  // (the game over, once: what is logged after it is the frame loop asking on a board that no longer plays)
  if (F.truth->gameOver && !F.overLogged) { char l[64]; snprintf(l, sizeof l, "GAMEOVER clock %d", clock); flog(l); F.overLogged = 1; }
  { double t = clock_ms(), per = F.wallPerFrame, last;
    static int32_t run;
    __atomic_load(&gameFrameMs, &last, __ATOMIC_SEQ_CST);
    run = last && t - last < per / 2 ? run + 1 : 0;
    // (the longest burst within the input window just past, not the longest ever: a hiccup long gone takes no frames from a decision)
    static int32_t burstAt[64], burstRun[64], nb;
    if (run > 0) { int k = nb < 64 ? nb++ : 0; if (k == 0 && nb == 64) { for (int i = 1; i < 64; i++) { burstAt[i - 1] = burstAt[i]; burstRun[i - 1] = burstRun[i]; } k = 63; } burstAt[k] = clock; burstRun[k] = run; }
    int32_t worst = 0, win = F.window > 0 ? F.window : 600;
    for (int i = 0; i < nb; i++) if (clock - burstAt[i] <= win && burstRun[i] > worst) worst = burstRun[i];
    __atomic_store_n(&gameBurst, worst, __ATOMIC_SEQ_CST);
    __atomic_store(&gameFrameMs, &t, __ATOMIC_SEQ_CST); __atomic_store(&gameMsPerFrame, &per, __ATOMIC_SEQ_CST); __atomic_store_n(&gameFrame, clock, __ATOMIC_SEQ_CST); }
  // (lockstep: every question asked answered before the frame is played -- its answer then taken on its own frame, as the work clock says)
  if (gnLockstep && workerOn) { hostLock(); while (qHas || qBusy || qReset) hostWaitDone(); hostUnlock(); }
  if (limit > 0) F.limit = limit;
  if (window > 0) F.window = window;
  F.npress = 0;
  for (int i = 0; i < nages && i < 512; i++) F.pressFrames[F.npress++] = clock - ages[i];
  F.oppHas = oppHas; F.oppOut = oppOut; F.oppTop = oppTop; F.oppStop = oppStop;
  double t0 = clock_ms();
  arrivalsOf(F.truth);
  double t1 = clock_ms();
  int32_t bits = frontFrame();
  double t2 = clock_ms();
  afterFrame(bits);
  double t3 = clock_ms();
  // (a frame loop over a frame's time: where it went)
  if (t3 - t0 > 8) { char l[200]; snprintf(l, sizeof l, "SLOWLOOP clock %d: %.1f ms (arrivals %.1f, frame %.1f, after %.1f)", clock, t3 - t0, t1 - t0, t2 - t1, t3 - t2); flog(l); }
  // (the stats now and then, and when the game is lost: a client may be stopped at any frame)
  if (++gnFrames % 600 == 0 || F.truth->gameOverClock > 0) statsOut();
  return bits;
}
void gn_end(void) { statsOut(); frontTraceOut(); ringOut(); }
// A line from the host into the run's log (a slow frame's parts, say)
void gn_log(const char *s) { flog(s); }
// (the C checks, built by ./build.sh test)
#ifdef GB_TEST
#include "test/cells_ref.c"
#include "test/bits_check.c"
#include "test/decide_check.c"
#endif
