// GAMBIT IN THE GAME'S OWN PROCESS (libgambit.so, loaded by lua/GambitNative.lua): the C engine, Gambit (gambit.c) and its frame
// loop (front.c), and Gambit's own thread, which answers the frame loop's questions while the game runs on. The game's thread only loads
// the board, plays the frame loop and returns the keys. What a host gives -- the heap, the clock, a lock and a thread, the log -- is
// host.c's, built beside this with the system's headers (which this file, on the engine's own libc.h, cannot include).
//
//   clang -O3 -march=native -pthread -fPIC -shared -DPA_HEAP native.c host.c -lm -o libgambit.so      (build.sh)

// (the default bot's thread pool in search.h waits on wasm's atomics; Gambit never starts it, and natively it has no workers)
#define __builtin_wasm_memory_atomic_notify(p, n) ((void)(p), 0)
#define __builtin_wasm_memory_atomic_wait32(p, v, t) ((void)(p), 0)
#include "gambit.c"

// ---------------------------------------------------------------- host.c
void *paHeap(unsigned long n);
double hostNowMs(void);
void hostLock(void), hostUnlock(void), hostWait(void), hostSignal(void);
int hostThread(void *(*fn)(void *));
int hostOpenLog(const char *path);
void hostLog(const char *s);
int snprintf(char *s, unsigned long n, const char *fmt, ...);
int strncmp(const char *a, const char *b, unsigned long n);
char *strchr(const char *s, int c);
int atoi(const char *s);
int abs(int v);
void *memmove(void *d, const void *s, unsigned long n);

// ---------------------------------------------------------------- what the engine and Gambit take from a host
static int32_t abortId, curQid;
// 1 once the question being answered is no longer wanted: every question up to abortId is not
int abort_poll(void) { return __atomic_load_n(&abortId, __ATOMIC_SEQ_CST) >= __atomic_load_n(&curQid, __ATOMIC_SEQ_CST) ? 1 : 0; }
double clock_ms(void) { return hostNowMs(); }
static void flog(const char *s) { hostLog(s); }

#include "front.c"

// ---------------------------------------------------------------- Gambit's thread
// One question waits at most: a newer one takes its place. Answers wait in order for the frame loop to take them.
#define ANSN 16
static int workerOn, qHas, qReset;
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
  int got = ansN > 0;
  if (got) { *a = answers[ansHead]; ansHead = (ansHead + 1) % ANSN; ansN--; }
  hostUnlock();
  return got;
}
static int answerWaiting(int32_t id) {
  hostLock();
  int has = 0;
  for (int i = 0; i < ansN && !has; i++) has = answers[(ansHead + i) % ANSN].id == id;
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
static int canRaiseOn(Board *b) {
  return !b->preventManualRaise && !b->manualRaise && !isToppedOut(b) && !hasFallingGarbage(b) && !b->riseLock && !hasActivePanels(b) && !(b->shakeTime > 0);
}
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
static void dumpBoard(int32_t at, const Board *b, const Arr *arr, int narr) {
  static unsigned char bytes[sizeof(Board)];
  static char line[sizeof(Board) * 2];
  unsigned long n = BOARD_HEAD;
  memcpy(bytes, b, BOARD_HEAD);
  memcpy(bytes + n, b->inc, (unsigned long)b->ninc * sizeof(Incoming)); n += (unsigned long)b->ninc * sizeof(Incoming);
  memcpy(bytes + n, b->p, (unsigned long)b->nrows * sizeof(Panel) * (W + 1)); n += (unsigned long)b->nrows * sizeof(Panel) * (W + 1);
  int k = snprintf(line, sizeof line, "GAMBITB %d C%d:", at, (int)sizeof(Board));
  k += b64(bytes, (int)n, line + k);
  k += snprintf(line + k, sizeof line - (unsigned long)k, " [");
  for (int i = 0; i < narr; i++) k += snprintf(line + k, sizeof line - (unsigned long)k, "%s[%d,%d,%d]", i ? "," : "", arr[i].at, arr[i].width, arr[i].height);
  snprintf(line + k, sizeof line - (unsigned long)k, "]");
  flog(line);
}
// A question answered: the board judged at level 10's health, a clock behind the last a new game. It stops in time for its move, on
// the game's own frame, which the frame loop publishes (the frame played, when it began, the ms a frame takes): out once the frame
// before its move has begun, or sooner when what it still has to do once out (its closing work, the slowest of the last CLOSEN
// decisions') would not be done before its move's frame begins. Its searches share the time until then.
#define CLOSEN 32
static int32_t gameFrame, dueFrame;
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
static int32_t gameBurst;
static int frameOut(void) {
  if (__atomic_load_n(&gameFrame, __ATOMIC_SEQ_CST) >= dueFrame - __atomic_load_n(&gameBurst, __ATOMIC_SEQ_CST)) return 1;
  return clock_ms() + closeWorst() >= moveStartMs(dueFrame + 1);
}
static int32_t lastAt = NUL;
static void answerOne(FQuestion *q, Board *b, FAnswer *out) {
  double t0 = clock_ms();
  if (gnPlanHealth) { b->health = imin(b->health, gnPlanHealth); b->maxHealth = imin(b->maxHealth, gnPlanHealth); }
  dueFrame = q->at - 1; clockFrameOut = frameOut;
  double due = moveStartMs(q->at) - closeWorst();
  if (lastAt != NUL && q->at < lastAt) gb_new_game();
  lastAt = q->at;
  if (!hostBoard) hostBoard = nb_new();
  cloneBoard(hostBoard, b);
  memset(&hostQ, 0, sizeof hostQ);
  hostQ.b = hostBoard; hostQ.holdLeft = q->holdLeft; hostQ.holdStarted = q->holdStarted; hostQ.tight = 0;
  hostQ.narr = arrivalsFrom(hostBoard, q->arr, q->narr, hostQ.arr);
  answerQuestion(q->id, q->at, q->topped, q->oppHas, q->oppOut, 1, q->oppTop, 0, 0, 1, q->allowance, q->lineFrom, q->linePressed,
                 canRaiseOn(hostBoard), due, t0, 0);
  // (the closing work: from the moment it ran out of time to its answer)
  if (clockWentOut) { closeMs[nclose < CLOSEN ? nclose++ : (int)(frameCounter++ % CLOSEN)] = clock_ms() - clockWentOut; }
  Answer *A = &theAnswer;
  memset(out, 0, sizeof *out);
  out->id = q->id; out->epoch = q->epoch; out->at = q->at; out->kind = A->d.kind; out->move = A->d.move;
  out->raiseNow = A->raiseNow; out->raiseAfter = A->raiseAfter; out->nhand = A->nhand;
  for (int i = 0; i < A->nhand; i++) out->hand[i] = A->hand[i];
  out->holdLives = A->holdLives; out->brk = A->brk; out->urgent = A->urgent; out->idleMs = A->idleMs;
  out->ms = clock_ms() - t0; out->closeMs = clockWentOut ? clock_ms() - clockWentOut : 0;
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
  snprintf(line + k, sizeof line - (unsigned long)k, "%s wallMs=%d", s, (int)(clock_ms() - t0));
  flog(line);
  if (A->dumpBoard) dumpBoard(q->at, hostBoard, hostQ.arr, hostQ.narr);
}
static void *workerMain(void *arg) {
  (void)arg;
  paThreadId(1);
  static FQuestion q;
  Board *b = nb_new();
  for (;;) {
    hostLock();
    while (!qHas && !qReset) hostWait();
    if (qReset) { qReset = 0; hostUnlock(); gb_new_game(); lastAt = NUL; continue; }
    q = qSlot; copyBoard(b, qSlotBoard); q.b = b; qHas = 0;
    __atomic_store_n(&curQid, q.id, __ATOMIC_SEQ_CST);
    hostUnlock();
    FAnswer a;
    if (abort_poll() == 1) continue;
    answerOne(&q, b, &a);
    if (abort_poll() == 1) continue;
    hostLock();
    if (ansN == ANSN) { ansHead = (ansHead + 1) % ANSN; ansN--; }
    answers[(ansHead + ansN) % ANSN] = a; ansN++;
    hostUnlock();
  }
  return 0;
}

// ---------------------------------------------------------------- the host's calls (lua/GambitNative.lua)
static int32_t gnAhead = 90, gnGap = 20, gnJitter = 16, gnFrames;
static int32_t ages[512];
// The bot's hands and pacing, level 10's health, and the run's log.
int gn_setup(int reaction, int swapGap, int cursor, int ahead, int gap, int jitter, int planHealth, const char *logPath) {
  gnReaction = reaction; gnAhead = ahead; gnGap = gap; gnJitter = jitter; gnPlanHealth = planHealth;
  gb_config(reaction, swapGap, cursor);
  if (logPath && *logPath) hostOpenLog(logPath);
  return 0;
}
// The rules, as the loader encodes them (gambit.js rulesWords), in gn_io; set before the first question.
int32_t *gn_io(void) { return gbIo; }
int gn_rules(int n) { return gb_rules(n); }
void gn_rule_name(int i, const char *name) { if (i >= 0 && i < MAXRULES) snprintf(ruleNames[i], sizeof ruleNames[i], "%s", name); }
void gn_profile(int mode, int ms, int extendMs, int width, int depth, int pool, int extendDepth, int extendOff) {
  gb_profile(mode, ms, extendMs, width, depth, pool, extendDepth, extendOff, cfgReaction, cfgSwapGap, cfgCursor);
}
int32_t *gn_tele(void) { return tele; }
int32_t *gn_ages(void) { return ages; }
static void statsOut(void) { static char line[4096]; if (!F.st.frames) return; statsLine(line, sizeof line); flog(line); }
// A match begins: nothing of the last is carried on.
void gn_match(void) {
  statsOut();
  frontNew(gnReaction, gnAhead, gnGap, gnJitter);
  gnFrames = 0;
  hostLock();
  qHas = 0; qReset = 1; ansN = 0;
  hostSignal();
  hostUnlock();
  if (!workerOn) { workerOn = 1; hostThread(workerMain); }
}
// A frame in play: the board in the engine's io (the host wrote it, nb_io_head / nb_io_body), the telegraphs in gn_tele, the input
// budget's limit and window and the frames ago each key inside it went down (gn_ages), and the opponent. The keys to press, or -1.
int gn_frame(int limit, int window, int nages, int oppHas, int oppOut, int oppTop) {
  if (nb_load(F.truth)) return -1;
  int32_t clock = F.truth->clock;
  { double t = clock_ms(), per = F.msPerFrame, last;
    static int32_t run;
    __atomic_load(&gameFrameMs, &last, __ATOMIC_SEQ_CST);
    run = last && t - last < per / 2 ? run + 1 : 0;
    if (run > __atomic_load_n(&gameBurst, __ATOMIC_SEQ_CST)) __atomic_store_n(&gameBurst, run, __ATOMIC_SEQ_CST);
    __atomic_store(&gameFrameMs, &t, __ATOMIC_SEQ_CST); __atomic_store(&gameMsPerFrame, &per, __ATOMIC_SEQ_CST); __atomic_store_n(&gameFrame, clock, __ATOMIC_SEQ_CST); }
  if (limit > 0) F.limit = limit;
  if (window > 0) F.window = window;
  F.npress = 0;
  for (int i = 0; i < nages && i < 512; i++) F.pressFrames[F.npress++] = clock - ages[i];
  F.oppHas = oppHas; F.oppOut = oppOut; F.oppTop = oppTop;
  arrivalsOf(F.truth);
  int32_t bits = frontFrame();
  afterFrame(bits);
  // (the stats now and then, and when the game is lost: a client may be stopped at any frame)
  if (++gnFrames % 600 == 0 || F.truth->gameOverClock > 0) statsOut();
  return bits;
}
void gn_end(void) { statsOut(); }
