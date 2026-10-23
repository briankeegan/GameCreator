// GAMBIT'S TURN (plans/decision.md): a question from the frame loop answered by Gambit alone -- the break search, the
// decision, the move. What carries from one decision to the next lives here: the break search's lines, the boards this dig has stood
// on, the line toward a break begun, the line in progress, the pair the last swap swapped.

#define BREAK_SHARE 0.4    // of the searches' time (propose.c leftMs), for the break search
#define UNDER_SHARE 0.75   // with garbage on the board: there the break is what saves the board
// (the profile's own, in percent, where it gives one: gb_share)
static double breakShare = BREAK_SHARE, underShare = UNDER_SHARE;
#define BREAK_MIN_MS 5
#define BREAK_MAX_MS 400
#define ROW_STEPS 16


// ---- the garbage the search digs toward: the id of the lowest block on the board
static int lowestGarbageRowOf(const Board *b) {
  for (int r = 1; r < b->nrows; r++) for (int c = 1; c <= W; c++) if (b->p[r][c].f[ISGARBAGE]) return r;
  return 0;
}
static int32_t digTargetOf(const Board *b) {
  int r = lowestGarbageRowOf(b);
  if (r) for (int k = 1; k <= W; k++) if (b->p[r][k].f[ISGARBAGE]) return b->p[r][k].f[GARBAGEID];
  return NUL;
}

// ---- THE DIG: the boards stood on since the garbage the break search digs toward was first the lowest:
// each row's colours, garbage as G
#define KEYLEN 160
#define DIGMAX 8192
static char digSeen[DIGMAX][KEYLEN]; static int32_t digN, digGid = NUL, digOn;
static int keyOf(const Board *b, char *out) {
  int k = 0;
  for (int r = 1; r < b->nrows && k < KEYLEN - 8; r++) {
    for (int c = 1; c <= W; c++) {
      const int32_t *f = b->p[r][c].f;
      if (f[ISGARBAGE]) out[k++] = 'G';
      else { int32_t v = f[COLOR] == NUL ? 0 : f[COLOR]; char d[12]; int nd = 0; if (!v) d[nd++] = '0'; while (v > 0) { d[nd++] = (char)('0' + v % 10); v /= 10; } while (nd) out[k++] = d[--nd]; }
    }
    out[k++] = '|';
  }
  out[k] = 0;
  return k;
}
static int sameDigKey(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }
static int digHas(const char *key) { for (int i = 0; i < digN; i++) if (sameDigKey(digSeen[i], key)) return 1; return 0; }
static void digAdd(const char *key) { if (digN < DIGMAX && !digHas(key)) { for (int i = 0; i < KEYLEN; i++) { digSeen[digN][i] = key[i]; if (!key[i]) break; } digN++; } }
// (the board a first swap leaves: pressed and six frames run)
static int seenDigHas(const Board *b, int32_t mv) {
  if (!digOn) return 0;
  static Board *t;
  if (!t) t = nb_new();
  cloneBoard(t, b);
  t->curRow = CR(mv); t->curCol = CC(mv);
  if (tryQueueSwap(t, CR(mv), CC(mv))) for (int f = 0; f < 6; f++) { t->input = 0; run(t); }
  char key[KEYLEN];
  keyOf(t, key);
  return digHas(key);
}

// ---- THE BREAK SEARCH CARRIED ON: this beam's lines, on this board, the garbage they dig toward, the move played and the line handed
// on after it, a bottom-row panel none of them touches, and the line toward a break played
typedef struct { int32_t set, gid, anchorRow, anchorCol, anchorId, id, playedHold, played, nhanded, handed[MAXLINE], ntoward, toward[MAXPATH]; Paths paths; } Kept;
static Kept theKept;
// (a life not kept: the last decision's verdict under garbage, its next landing frame and queue -- answerTurn's log)
#define LIFEDUMPS 20
static int32_t lifeLived, lifeLand, lifeQk, lifeDumps;
static int32_t towardPlayedN, towardPlayed[MAXPATH];
static int32_t riseSince(const Board *b, int row, int col, int32_t id) {
  for (int r = 1; r < b->nrows; r++) if (b->p[r][col].f[ID] == id) return r - row;
  return NOT_ASKED;
}
static int playedSince(const Kept *K, int32_t lineFrom, int32_t linePressed, int32_t *pre) {
  int n = lineFrom == K->id && K->nhanded ? imin(linePressed, K->nhanded) : 0, k = 0;
  if (!K->playedHold) pre[k++] = K->played;
  for (int i = 0; i < n; i++) pre[k++] = K->handed[i];
  return k;
}
static int startsWith(const int32_t *p, int np, const int32_t *pre, int npre) { if (np <= npre) return 0; for (int i = 0; i < npre; i++) if (p[i] != pre[i]) return 0; return 1; }
static int carriedPaths(const Board *b, int32_t lineFrom, int32_t linePressed, Paths *out) {
  out->n = 0;
  Kept *K = &theKept;
  if (!K->set || !K->paths.n || digTargetOf(b) != K->gid) return 0;
  int32_t dr = riseSince(b, K->anchorRow, K->anchorCol, K->anchorId);
  if (dr == NOT_ASKED) return 0;
  int32_t pre[MAXLINE + 1];
  int npre = playedSince(K, lineFrom, linePressed, pre);
  // (THE LINE TOWARD A BREAK BEGUN: the rest of the one played last, the same moves taken off)
  if (K->ntoward && startsWith(K->toward, K->ntoward, pre, npre)) {
    towardRestLen = K->ntoward - npre;
    for (int i = 0; i < towardRestLen; i++) towardRest[i] = (CR(K->toward[npre + i]) + dr) * 8 + CC(K->toward[npre + i]);
  }
  for (int i = 0; i < K->paths.n; i++) {
    if (!startsWith(K->paths.path[i], K->paths.len[i], pre, npre)) continue;
    int t = out->n++;
    out->len[t] = K->paths.len[i] - npre;
    for (int k = 0; k < out->len[t]; k++) out->path[t][k] = (CR(K->paths.path[i][npre + k]) + dr) * 8 + CC(K->paths.path[i][npre + k]);
  }
  return 1;
}
// (a frontier kept: K anchored to a bottom-row panel the move played and the swaps handed on do not touch, with what was played)
static int anchorKept(Kept *K, const Paths *paths, int kind, int32_t move, const int32_t *handed, int nhanded, int32_t qid) {
  const Board *b = decQ.b;
  for (int col = 1; col <= W; col++) {
    int32_t id = b->p[1][col].f[ID];
    if (id == NUL) continue;
    int touched = 0;
    if (kind == 1 && CR(move) == 1 && (CC(move) == col || CC(move) + 1 == col)) touched = 1;
    for (int i = 0; i < nhanded; i++) if (CR(handed[i]) == 1 && (CC(handed[i]) == col || CC(handed[i]) + 1 == col)) touched = 1;
    if (touched) continue;
    K->set = 1; K->paths = *paths; K->gid = digTargetOf(b); K->anchorRow = 1; K->anchorCol = col; K->anchorId = id; K->id = qid;
    K->playedHold = kind == 0; K->played = move; K->nhanded = nhanded; for (int i = 0; i < nhanded; i++) K->handed[i] = handed[i];
    return 1;
  }
  return 0;
}
// THE PLAN KEPT (search/plan.c planOut): the planner's lines, anchored as the break search's are, and re-rooted at the next decision --
// the swaps played since taken off, the rows risen since added (plannedPaths: the next plan's seeds)
static Kept thePlanKept;
static void keepPlan(int kind, int32_t move, const int32_t *handed, int nhanded, int32_t qid) {
  memset(&thePlanKept, 0, sizeof thePlanKept);
  if (!planOut.n || !(kind == 0 || kind == 1)) return;
  anchorKept(&thePlanKept, &planOut, kind, move, handed, nhanded, qid);
}
static int plannedPaths(const Board *b, int32_t lineFrom, int32_t linePressed, Paths *out) {
  out->n = 0;
  Kept *K = &thePlanKept;
  if (!K->set || !K->paths.n) return 0;
  int32_t dr = riseSince(b, K->anchorRow, K->anchorCol, K->anchorId);
  if (dr == NOT_ASKED) return 0;
  int32_t pre[MAXLINE + 1];
  int npre = playedSince(K, lineFrom, linePressed, pre);
  for (int i = 0; i < K->paths.n; i++) {
    if (!startsWith(K->paths.path[i], K->paths.len[i], pre, npre)) continue;
    int t = out->n++;
    out->len[t] = K->paths.len[i] - npre;
    for (int k = 0; k < out->len[t]; k++) out->path[t][k] = (CR(K->paths.path[i][npre + k]) + dr) * 8 + CC(K->paths.path[i][npre + k]);
  }
  return out->n > 0;
}
static void keepFrontier(const Broke *br, int kind, int32_t move, const int32_t *handed, int nhanded, int32_t qid) {
  memset(&theKept, 0, sizeof theKept);
  if (!br || !br->keepOut.n || br->depth || !(kind == 0 || kind == 1)) return;
  const Board *b = decQ.b;
  for (int col = 1; col <= W; col++) {
    int32_t id = b->p[1][col].f[ID];
    if (id == NUL) continue;
    int touched = 0;
    if (kind == 1 && CR(move) == 1 && (CC(move) == col || CC(move) + 1 == col)) touched = 1;
    for (int i = 0; i < nhanded; i++) if (CR(handed[i]) == 1 && (CC(handed[i]) == col || CC(handed[i]) + 1 == col)) touched = 1;
    if (touched) continue;
    Kept *K = &theKept;
    K->set = 1; K->paths = br->keepOut; K->gid = digTargetOf(b); K->anchorRow = 1; K->anchorCol = col; K->anchorId = id; K->id = qid;
    K->playedHold = kind == 0; K->played = move; K->nhanded = nhanded; for (int i = 0; i < nhanded; i++) K->handed[i] = handed[i];
    K->ntoward = towardPlayedN; for (int i = 0; i < towardPlayedN; i++) K->toward[i] = towardPlayed[i];
    return;
  }
}

// THE BREAK SEARCH, in its share of the decision's time -- or, with workers, on one of them beside the other searches, in all of theirs
static Broke theBr;
static int32_t brCut, brResumed;
static Paths brResume; static int brHave;
// (the search itself, on whichever thread runs it: what it reads is the question, the read and the kept paths, its nodes its thread's)
static void breakRunTo(const Read *R, double by, Broke *into);
static void breakRun(const Read *R, double by) { breakRunTo(R, by, &theBr); }
static void breakRunTo(const Read *R, double by, Broke *into) {
  int32_t pop = popLeft(decQ.b);
  double old = clockShareBegin(by);
  // (a list ended by "default" -- every list under garbage -- plays off it only when no break within it is found: the break off the list
  // is searched first, quick to find, so a break to play is in hand however long the list's own takes; the rest of the share then goes
  // to a break within the list, which is played instead if found)
  listDefault = 0;
  if (R->end == 1) {
    static LOCAL Broke off;
    listDefault = 1;
    breakMoves(&decQ, pop ? pop + LINEUP_AFTER : 0, 0, into);
    listDefault = 0;
    off = *into;
    if (off.depth && !clockOut()) {
      breakMoves(&decQ, pop ? pop + LINEUP_AFTER : 0, brHave ? &brResume : 0, into);
      if (!into->depth) *into = off;
    }
  } else breakMoves(&decQ, pop ? pop + LINEUP_AFTER : 0, brHave ? &brResume : 0, into);
  clockShareEnd(old);
}
static int breakSearch(const Read *R, int32_t lineFrom, int32_t linePressed, double *ms) {
  double share = R->under ? underShare : breakShare;
  *ms = 0; brCut = 0; brResumed = 0;
  // (no break search on a question due sooner than it could take: the answer would come late -- the searches' time is what it takes
  // first, and short of that, the judging's quarter: a board this near its end has a break one swap away or none (run 447, combo_storm-2
  // at 13038: a one-swap break, found in 3 ms, not searched for))
  double t = nowMs(), room = C2.due ? C2.due - C2.margin - t : 1e9;
  if (C2.due && room < BREAK_MIN_MS) return 0;
  brHave = carriedPaths(decQ.b, lineFrom, linePressed, &brResume);
  // (its share of what the searches have, propose.c leftMs: the other searches the rest, the judging its quarter)
  double by = C2.due ? t + (BREAK_MIN_MS > leftMs() * share ? BREAK_MIN_MS : leftMs() * share) : t + BREAK_MAX_MS;
  breakRun(R, by);
  brCut = nowMs() >= by; brResumed = brHave ? brResume.n : 0;
  *ms = nowMs() - t;
  return 1;
}
// THE BREAK SEARCH ON A WORKER (plans/gambit-infra.md: two plans at once): begun before the other searches, until they end
// (searchesEnd), and taken back after them -- a job no worker began by then is searched here, in what is left. Its judging is its
// thread's own (judge.c judgeCtx, outcome.c cache: LOCAL).
// (and with a second worker, the survival search too (decide.c ranked), in the same time: what it is asked of is the board alone, so it is
// searched before the judging says whether anything lives, and kept for it -- svJob)
// (THE JOBS, in the order the workers take them: the break search; the second half of the planner's list and the chain extended or begun,
// when the decision splits them off (propose.c searchPrep); the survival search -- each with what it needs from the decision, and a
// worker that finishes one takes the next)
// (and under garbage, the break search's wider touch beam on a worker of its own from the start, beside the narrower: the break it finds
// is played when the narrower finds none -- theBrWide)
enum { JOB_BREAK, JOB_PLAN, JOB_EXT, JOB_WIDE, JOB_SURVIVE };
static int32_t jobKinds[5], njobKinds;
static Broke theBrWide; static int32_t wideDone;
// (where the break search ran, for the log: 0 not run, 1 a worker beside the searches, 2 the decision after a worker had not finished it,
// 3 the decision with no worker free; and the ms it was given)
static int32_t brWhere; static double brGiven;
static int32_t decTap;   // (the decision's pressTap, for its jobs' threads)
static int32_t hostTaps;   // (a host whose frame loop presses a line's taps as the answer says: the native one, native.c gn_setup)
static Ctx *brCtx; static const Read *brJobR; static Found *brJobS; static int64_t brJobWork; static double brJobT0, brJobBy, brJobMs; static int32_t brJobDone;
static void breakJob(int32_t i) {
  clockWork = brJobWork; clockShare = 0; clockAborted = 0; clockPoll = 0;
  inJob = 1; pressTight = decQ.tight; pressTap = decTap; ncache = 0;
  int kind = jobKinds[i];
  if (kind == JOB_BREAK) breakRun(brJobR, brJobBy);
  else if (kind == JOB_PLAN) planJob();
  else if (kind == JOB_EXT) extJob(brJobR, brJobS);
  else if (kind == JOB_WIDE) { touchFrom = 1; breakRunTo(brJobR, brJobBy, &theBrWide); touchFrom = 0; __atomic_store_n(&wideDone, 1, __ATOMIC_RELEASE); }
  else {
    double old = clockShareBegin(brJobBy);
    svJob = outlive(&decQ, HORIZON + REST, REST, brJobBy - nowMs(), 6, 30);
    clockShareEnd(old);
    __atomic_store_n(&svJobDone, 1, __ATOMIC_RELEASE);
  }
  inJob = 0;
  if (kind == JOB_BREAK) { brJobMs = nowMs() - brJobT0; __atomic_store_n(&brJobDone, 1, __ATOMIC_RELEASE); }
}
static int breakBegin(const Read *R, Found *S, int32_t lineFrom, int32_t linePressed) {
  brCut = 0; brResumed = 0; __atomic_store_n(&brJobDone, 0, __ATOMIC_SEQ_CST); __atomic_store_n(&svJobDone, 0, __ATOMIC_SEQ_CST);
  if (pool.nworkers <= 0 || poolBusy || !C2.due || leftMs() < BREAK_MIN_MS) return 0;
  brHave = carriedPaths(decQ.b, lineFrom, linePressed, &brResume);
  brJobR = R; brJobS = S; brJobWork = clockWork; brJobT0 = nowMs(); brJobBy = searchesEnd();
  if (!brCtx) brCtx = ctxOf(0);
  __atomic_store_n(&jobStop, 0, __ATOMIC_SEQ_CST);
  // (in the order a thread takes them, and a job no thread has begun when the searches end is not begun at all (jobsDone): the survival
  // search second, the backup where nothing lives, begun every decision with a thread to spare)
  njobKinds = 0; jobKinds[njobKinds++] = JOB_BREAK;
  if (pool.nworkers >= 2) jobKinds[njobKinds++] = JOB_SURVIVE;
  if (planSplit) jobKinds[njobKinds++] = JOB_PLAN;
  if (extBeside) jobKinds[njobKinds++] = JOB_EXT;
  __atomic_store_n(&wideDone, 0, __ATOMIC_SEQ_CST);
  if (R->under && pool.nworkers >= 4) jobKinds[njobKinds++] = JOB_WIDE;
  return startJobs(brCtx, breakJob, njobKinds);
}
// (taken back when its time is up, searchesEnd: cut short when the other searches end early, the break search missed breaks -- 18 of
// 120 boards searched again, run 415, where 1 to 3 had been)
static int breakEnd(const Read *R, int32_t lineFrom, int32_t linePressed, double *ms) {
  jobsDone(brCtx);
  if (!__atomic_load_n(&brJobDone, __ATOMIC_ACQUIRE)) { brWhere = 2; brGiven = leftMs(); return breakSearch(R, lineFrom, linePressed, ms); }
  brWhere = 1; brGiven = brJobBy - brJobT0;
  if (__atomic_load_n(&wideDone, __ATOMIC_ACQUIRE) && !theBr.depth && theBrWide.depth) { theBr = theBrWide; theBr.wide = theBr.wide ? theBr.wide : 1; }
  *ms = brJobMs; brCut = brJobT0 + brJobMs >= brJobBy; brResumed = brHave ? brResume.n : 0;
  return 1;
}

// ---- THE LOG LINE: one a decision, what Gambit chose, what was played and why
static char logBuf[8192]; static int logN;
static void L_s(const char *s) { while (*s && logN < (int)sizeof logBuf - 1) logBuf[logN++] = *s++; logBuf[logN] = 0; }
static void L_i(int64_t v) { char d[24]; int n = 0, neg = v < 0; if (neg) v = -v; if (!v) d[n++] = '0'; while (v > 0) { d[n++] = (char)('0' + v % 10); v /= 10; } if (neg) L_s("-"); while (n) { char c[2] = { d[--n], 0 }; L_s(c); } }
static void L_d(double v) {
  if (v == (double)(int64_t)v) { L_i((int64_t)v); return; }
  if (v < 0) { L_s("-"); v = -v; }
  L_i((int64_t)v); L_s(".");
  double f = v - (double)(int64_t)v;
  char d[8]; int n = 0;
  for (int i = 0; i < 6; i++) { f *= 10; int k = (int)f; d[n++] = (char)('0' + k); f -= k; }
  while (n > 1 && d[n - 1] == '0') n--;
  for (int i = 0; i < n; i++) { char c[2] = { d[i], 0 }; L_s(c); }
}
static void L_mv(int32_t mv) { L_i(CR(mv)); L_s(","); L_i(CC(mv)); }
static void L_play(int p) { const char *s = p == -2 ? "raise" : PLAY_NAME[p]; for (; *s; s++) { char c[2] = { *s == ' ' ? '_' : *s, 0 }; L_s(c); } }
static const char DROP_CHAR[NDROPS] = { 'b', 'o', 't', 'f', 'r', 'u', 'c', 'w', 'j' };

// THE MOVE: the one order's choice -- the raise the opening called for, a line's first swap, or the hold
typedef struct { int32_t kind, move; } Move;   // kind: 0 hold, 1 swap, 2 raise
// THE ANSWER, read by the host (gb_answer): the move, the raise held, the line handed on, and what the log and the audit read
typedef struct {
  Move d; int32_t raiseNow, raiseAfter, raiseWait, nhand, hand[MAXLINE], handAt[MAXLINE], handSettled, tap;
  int32_t verdict;    // 0 none, 1 lives, 2 dies, 3 raise
  int32_t holdLives, brk, urgent, offered, lineup, touch, took, clears, dumpBoard;
  int32_t wastes;   // the line played makes a three for nothing as the judge saw it, and the survival search found the board needed it (decide.c saveOk)
  int32_t empty;                 // a hold the clock left no time to judge anything for (the frame loop plays the move in hand)
  int32_t nalt, alt[MAXLINE];    // the move in hand: the best line that lives and is no hold, a ready one first
  int32_t play, combo, chain, chainAll, broke, done, fire, nseq, seq[MAXLINE], rule, nlive, ncands;
  int32_t whole;   // the chain the board ends up making with the line played (-1: held)
  double idleMs, brMs;
} Answer;
static Answer theAnswer;
static int32_t lastA, lastB, pairRuns, blockA, blockB, blockUntil, emptyAt = NUL;

// SWITCHING (plans/gambit-goal.md 5): the profile's `switch` -- the mode changed mid-game as a rule's `when` changes it, after a random
// stretch of `min` to `max` frames each time. A game's switches walk a circuit through every ordered pair of the attack rules (each
// rule to each other rule, once a lap), its start, its labels and its stretches drawn from the game's seed (gb_switch_game); every reader
// asks modeAt (the frame loop drops a line handed it under another mode, front.c). Off: the mode stays the profile's.
#define MAXSWITCH 256
static int32_t switchMin, switchMax, nswitch, switchAt[MAXSWITCH], switchMode[MAXSWITCH], switchedNow;
static double readMs;   // (the board's reading, for the log)
static void answerTurn(int32_t qid, int32_t at, int32_t allowanceKnown, int32_t allowance, int32_t lineFrom, int32_t linePressed) {
  Answer *A = &theAnswer;
  memset(A, 0, sizeof *A);
  logN = 0; logBuf[0] = 0;
  double tStart = nowMs();
  // (the input budget tight: the frame loop walks held from two cells, so every line is judged pressed as it walks)
  { const Board *b = decQ.b; double dies = (hostTopped ? b->stopTime + b->preStopTime : framesToTop(b)) + b->health;
    pressTap = decTap = hostTaps && allowanceKnown && dies <= TAP_DIES; }
  decQ.tight = allowanceKnown && tightAt(allowance);
  A->tap = pressTap;
  pressTight = decQ.tight;
  pressAllowance = allowanceKnown ? allowance : -1;
  towardRestLen = 0;
  // (the readiness the last decision left searching on the workers taken back first: the pool is this decision's searches' -- breakBegin)
  readyStop();
  carryFrom = lineFrom; carryPressed = linePressed;
  planSeedsHave = plannedPaths(decQ.b, lineFrom, linePressed, &planSeeds); planOut.n = 0; planSeeded = 0;
  // (THE DIG: the boards stood on since the garbage the break search digs toward was first the lowest)
  int32_t gid = digTargetOf(decQ.b);
  if (gid == NUL) { digOn = 0; digN = 0; digGid = NUL; }
  else { if (!digOn || digGid != gid) { digOn = 1; digGid = gid; digN = 0; } char key[KEYLEN]; keyOf(decQ.b, key); digAdd(key); }
  // (the rules read first -- the list, the floor -- so the break search finds only breaks the judge will take)
  Read R;
  backBoard = decQ.b;
  theBack.at = at;
  aloneChain = 0;   // (this decision's, found by the hold's judging -- rank.c holdCand -- or none)
  readyAsked = readyHit = 0; readyStop(); readyPendClear();
  if (!readBoard_(&R)) { A->d.kind = -1; return; }
  readMs = nowMs() - tStart;
  double brMs;
  // (THE SEARCHES' SHARE: the decision's time but the judging's quarter -- propose.c searchesEnd -- every search within it)
  double searchShare = clockShareBegin(searchesEnd());
  static Found S;
  searchPrep(&R, &S);
  int beside = breakBegin(&R, &S, lineFrom, linePressed);
  if (!beside) searchUnsplit();
  searchBeside = beside;
  brWhere = 0; brGiven = 0;
  if (!beside) { brWhere = 3; brGiven = leftMs(); }
  int ran = beside ? 0 : breakSearch(&R, lineFrom, linePressed, &brMs);
  double ts = nowMs();
  searchAll(&R, &S);
  if (beside) ran = breakEnd(&R, lineFrom, linePressed, &brMs);
  searchMerge(&R, &S);
  S.searchMs = nowMs() - ts;
  C2.br = ran ? &theBr : 0; C2.brMs = (int32_t)brMs;
  clockShareEnd(searchShare);
  int starved = clockOut();   // (out of time before anything was judged)
  int n = ranked(&R, &S);
  // (the floor's raise gives way to nothing: a low stack is raised, and the break it holds ready is made once it has risen (the owner)
  // -- the rows raised are the ones that leave a break once everything lands, decide.c read)
  // (and the opening's to a break, where nothing lives: a raise is no answer to garbage landing on a board that dies)
  // -- or to a line that outlasts the hold by a break's time (rankSave): where nothing lives, a raise only brings the loss sooner
  if (R.up && !raiseRefill && n && !order[0]->o.lives) {
    const Judge *H = 0; for (int i = 0; i < n && !H; i++) if (order[i]->hold) H = order[i];
    if (order[0]->apBroke > 0 || (H && !order[0]->hold && lostOf(order[0]) >= lostOf(H) + rankSave)) R.up = R.low = 0;
  }
  Played P = playOf(&R, n);
  if (R.F.known[FACT_US_CONTACT] || R.topped) gambitHit = 1;
  // THE MOVE (a line whose first swap was judged pressed later than now -- its pair still moving -- is a hold, the line handed on whole)
  int timed = !R.up && P.line && P.line->apNats > 0 && P.line->apAts[0] > 0;
  Move d = R.up ? (Move){ 2, 0 } : P.line && !timed ? (Move){ 1, P.line->k.seq[0] } : (Move){ 0, 0 };
  A->d = d;
  A->empty = starved && d.kind == 0;
  // (THE MOVE IN HAND: of the lines that live and are no hold -- a ready one first -- the best ranked, kept by the frame loop for a
  // decision the clock leaves no time)
  A->nalt = 0;
  for (int pass = 0; pass < 2 && !A->nalt; pass++)
    for (int i = 0; i < n && !A->nalt; i++) {
      const Judge *J = order[i];
      if (J->hold || J->wait || !J->o.lives || J->k.nseq < 1 || (pass == 0 && J->o.ready != 1)) continue;
      A->nalt = imin(J->k.nseq, MAXLINE); for (int q = 0; q < A->nalt; q++) A->alt[q] = J->k.seq[q];
    }
  const Judge *top = R.up ? 0 : P.top;
  A->verdict = R.up ? 3 : top ? (top->o.lives ? 1 : 2) : 0;
  A->holdLives = d.kind == 0 && top && top->o.lives;
  A->wastes = P.line && !R.up && wastesThree(P.line) && saveOk;   // (a three the survival search found the board needed not to die)
  // (THE LINE PRESSED ON: the line played is handed to the frame loop whole, each swap from the frame the judge pressed it from -- a
  // settled line's after the board settles -- so the frame loop presses the line that was judged)
  A->nhand = 0; A->handSettled = P.line && P.line->settled;
  if (P.line && !R.up) {
    int first = timed ? 0 : 1;
    for (int i = first; i < P.line->k.nseq; i++, A->nhand++) {
      A->hand[A->nhand] = P.line->k.seq[i]; A->handAt[A->nhand] = i < P.line->apNats ? at + P.line->apAts[i] : 0;
    }
  }
  towardPlayedN = 0;
  if (d.kind == 1 && P.line && P.line->k.play == PLAY_TOWARD) { towardPlayedN = P.line->k.nseq; for (int i = 0; i < P.line->k.nseq; i++) towardPlayed[i] = P.line->k.seq[i]; }
  // (the break search's work carried on to the next decision, past the move and as much of the line handed on as gets pressed)
  keepFrontier(ran ? &theBr : 0, d.kind, d.move, A->hand, A->nhand, qid);
  keepPlan(d.kind, d.move, A->hand, A->nhand, qid);   // (and the planner's: search/plan.c planOut)
  if (!(d.kind == 0 && P.top && P.top->wait && !P.line)) carryOf(&R, P.line, qid, timed ? 0 : 1);
  carryNextOf(P.line);
  keptPlayed = P.line && P.line->k.kept; routePlayed = P.line && P.line->k.route; wayPlayed = P.line && P.line->k.way;
  keepIntents(P.ncands, P.line);   // (the best lines that make something, kept for the next decision: decide.c keepIntents)
  if (d.kind == 0 && P.top && P.top->hold) carryReady(P.top, qid);
  else if (d.kind == 1 && P.line && P.line->k.nseq == 1 && !theCarry.set) carryReady(P.line, qid);
  // (no swap back: the pair the last swap swapped is kept out for a second when it is swapped three times running)
  int32_t pa = NUL, pb = NUL;
  if (d.kind == 1) { pa = decQ.b->p[CR(d.move)][CC(d.move)].f[ID]; pb = decQ.b->p[CR(d.move)][CC(d.move) + 1].f[ID]; }
  int pairKnown = d.kind == 1 ? (pa != NUL && pb != NUL) : !!lastA;
  int32_t na = d.kind == 1 ? pa : lastA, nb = d.kind == 1 ? pb : lastB;
  int same = pairKnown && lastA && samePair(na, nb, lastA, lastB);
  pairRuns = same ? pairRuns + 1 : 0;
  if (pairRuns >= 2) { blockA = na; blockB = nb; blockUntil = at + 60; }
  if (pairKnown) { lastA = na; lastB = nb; } else { lastA = lastB = 0; }
  gb_back(lastA, lastB, pairRuns, blockA, blockB, blockUntil, at);
  C2.idle = d.kind == 0 || (!R.up && !P.wait && !n);   // (held, or nothing was wanted)
  // what the answer and the audit read
  if (P.line) {
    const Judge *l = P.line;
    A->play = l->k.play; A->combo = l->apCombo; A->chain = l->apChain; A->chainAll = l->apChainAll; A->broke = l->apBroke; A->whole = l->hold || !l->apPlayed ? -1 : l->apWhole;
    A->done = l->apDone; A->fire = l->apFire; A->nseq = l->k.nseq; for (int i = 0; i < l->k.nseq; i++) A->seq[i] = l->k.seq[i];
  } else { A->play = P.name; A->whole = -1; }
  A->clears = d.kind == 1 && (A->combo > 0 || A->broke > 0);
  A->brk = ran && theBr.depth; A->offered = ran ? theBr.depth : 0; A->lineup = ran && theBr.lineup; A->touch = ran && theBr.touch;
  if (ran && theBr.depth && d.kind == 1) for (int i = 0; i < theBr.nmoves; i++) if (theBr.moves[i] == d.move) A->took = 1;
  A->idleMs = S.idleMs; A->brMs = brMs;
  A->rule = theTables.r[R.rule].name; A->nlive = P.nlive; A->ncands = P.ncands;

  // (urgent: a cascade or a pop, an extension, or the line done within a pace gap of its deadline -- the frame loop's pace)
  // (and a hold that lives only by the break it waits for: that break has its frame, so the frame loop asks again at its own pace, never
  // the calm board's)
  A->urgent = (P.line && P.line->k.extend) || popLeft(decQ.b) > 0 || cascadeLive(decQ.b) ||
              (d.kind == 0 && top && top->hold && top->o.lives && top->o.lostAt != FOREVER);
  // THE LOG LINE
  const Rule *rule = &theTables.r[R.rule];
  L_s("GAMBITD "); L_i(at); L_s(" @"); L_i(rule->name); L_s(" play="); L_play(P.name);
  L_s(" want="); if (R.up) L_s("raise"); else if (P.wait) L_s("hold"); else if (!n) L_s("-"); else if (order[0]->hold || order[0]->wait) L_s("hold"); else L_mv(order[0]->k.seq[0]);
  L_s(" got="); if (d.kind == 1) L_mv(d.move); else L_s(d.kind == 2 ? "raise" : "hold");
  L_s(" src=gambit v="); L_s(A->verdict == 1 ? "lives" : A->verdict == 2 ? "dies" : A->verdict == 3 ? "raise" : "none");
  L_s(" under="); L_i(R.under); L_s(" mat="); L_d(R.F.v[FACT_US_MATERIAL]); L_s(" pan="); L_i(panelsOn(decQ.b)); L_s(" chain="); L_i(A->chain); L_s(" combo="); L_i(A->combo); L_s(" broke="); L_i(A->broke);
  // (the chain the board makes left alone, and the one it makes with the line played: own=4/2 is a chain cut short -- a line the judge
  // could not play out, or the hold, shows the board's own)
  if (aloneChain > 1 && P.line) { L_s(" own="); L_i(aloneChain); L_s("/"); L_i(A->whole >= 0 ? A->whole : aloneChain);
    // (and the lines that live and keep it, the hold among them: a cut with one of them there is the plan's to count)
    int keeps = 0; for (int i = 0; i < n; i++) keeps += order[i]->o.lives && !cutsShort(order[i]);
    L_s(" ownKept="); L_i(keeps); }
  L_s(" tier="); L_i(P.line ? P.line->t.tier : d.kind == 0 ? HOLD_TIER : 0);
  // (the part of the one rule the line played is (judge.c): e an entry of the list, t the three that breaks, l a last resort, - none)
  L_s(" rule="); L_s(!P.line || P.line->met < 0 ? (P.line && P.line->outside ? "l" : "-") : P.line->met < R.list.n ? "e" : "t");
  L_s(" by="); if (R.by != NOT_ASKED && R.by) L_i(R.by); else L_s("-");
  L_s(" done="); if (P.line && A->done >= 0) L_i(A->done); else L_s("-");
  L_s(" fire="); if (P.line && A->fire >= 0) L_i(A->fire); else L_s("-");
  L_s(" ats="); if (P.line && P.line->apNats) { for (int i = 0; i < P.line->apNats; i++) { if (i) L_s("/"); L_i(P.line->apAts[i]); } } else L_s("-");
  L_s(" swaps="); L_i(P.line ? P.line->k.nseq : 0);
  if (P.line && P.line->k.nseq > 0) { L_s(" seq="); for (int q = 0; q < P.line->k.nseq; q++) { if (q) L_s(";"); L_mv(P.line->k.seq[q]); } }   // (the line played, every swap: whether the next decision carries it on)
  // (SEVERAL IDEAS AT ONCE: the blocks the line played throws, every attack its own; the ideas the board it leaves holds, where a key
  // asked them; the lines firing two ideas the planner offered, and whether one -- or a route pressed at once -- was played)
  L_s(" thrown="); L_i(P.line ? thrownOf(P.line) : 0);
  L_s(" w3="); L_i(P.line ? P.line->o.j.threes : -1); if (P.line && wastesThree(P.line)) L_s("/w");   // (the line played: its wasted threes as the judge saw them)
  if (P.line && P.line->ideasAsked && P.line->ideas >= 0) { L_s(" ideas="); L_i(P.line->ideas); }
  if (pairOffered || (P.line && P.line->k.pair)) { L_s(" pair="); L_i(pairOffered); if (P.line && P.line->k.pair) L_s("/played"); }
  L_s(" land="); if (R.F.known[FACT_US_NEXTLANDS]) L_d(R.F.v[FACT_US_NEXTLANDS]); else L_s("-");
  L_s(" dies="); L_d(R.F.v[FACT_US_DIES]); if (R.F.v[FACT_US_QUEUEKILLS]) L_s(" qk=1"); if (R.aloneOut) { L_s(" alone="); L_i(R.aloneChain); }
  L_s(" casc="); L_i(cascadeLive(decQ.b)); L_s(" pop="); L_i(popLeft(decQ.b)); L_s(" hp="); L_i(decQ.b->health); L_s(" stop="); L_d(R.F.v[FACT_US_STOP]);
  if (readyAsked) { L_s(" rdy="); L_i(readyHit); L_s("/"); L_i(readyAsked); }
  if (keptOffered) { L_s(" kept="); L_i(keptOffered); if (keptPlayed) L_s("/played"); }
  if (routeOffered) { L_s(" route="); L_i(routeOffered); if (routePlayed) L_s("/played"); }
  if (planSeeded) { L_s(" seed="); L_i(planSeeded); }
  if (readyPre) { L_s(" pre="); L_i(readyPre); L_s("/"); L_i(readyPendN); }
  if (wayOffered) { L_s(" way="); L_i(wayOffered); if (wayPlayed) L_s("/played"); }
  // (the floor's raise: the rows asked, how many leave a break once everything lands, how many the board lives through -- or, asked
  // while the board is busy, -1 a cascade, -2 the game's raise not allowed)
  L_s(" sv="); L_i(__atomic_load_n(&svJobDone, __ATOMIC_ACQUIRE) ? 1 : 0); if (surviveAsked) L_s("/asked");   // (the survival job finished this decision; the backup asked of it)
  if (saveAsked) { L_s(" saveAsk="); L_i(saveNot); L_s("/"); L_i(saveAsked); L_s(":"); L_i((int64_t)saveCw); L_s("/"); L_i((int64_t)saveCk); if (saveOk) L_s("/needed"); }   // (the threes the survival search found not needed, of those asked)
  if (refillAsked) { L_s(" refill="); L_i(refillAsked); L_s("/"); L_i(refillReady); L_s("/"); L_i(refillAlive); if (raiseWait) { L_s("/w"); L_i(raiseWait); } else if (refillAsked == -1) { L_s("/s"); L_i(raiseShut); } }
  L_s(" waits="); L_i(R.breakWaits); L_s(" tight="); L_i(decQ.tight); L_s(" allow="); L_i(pressAllowance); if (decTap) L_s(" tap=1");
  L_s(" br=");
  if (ran) { L_i(theBr.depth); L_s("/"); if (theBr.pathLen) L_i(theBr.pathLen); else if (theBr.towardLen) { L_s("t"); L_i(theBr.towardLen); } else L_s("0");
             if (brCut) L_s("/cut"); if (brResumed) { L_s("/r"); L_i(brResumed); } if (theBr.wide) { L_s("/w"); L_i(theBr.wide); } if (theBr.carried) L_s("/carried"); if (theBr.built) L_s("/built"); }
  else L_s("none");
  L_s(" brMs="); L_i((int64_t)brMs); L_s(" brAt="); L_i(brWhere); L_s("/"); L_i((int64_t)brGiven);
  L_s(" ms="); L_i((int64_t)brMs); L_s("/"); L_i((int64_t)S.searchMs); L_s("/"); L_i(phaseMs[0]); L_s("/"); L_i(phaseMs[1]); L_s("/"); L_i(phaseMs[2]);
  L_s(" cands=");
  int any = 0;
  for (int p = 0; p < NPLAYS; p++) {
    if (!offered[p] && !(p == PLAY_SURVIVE && surviveAsked)) continue;
    if (any) L_s(","); any = 1;
    L_play(p); L_s(":"); L_i(offered[p]);
    int dn = 0; for (int w = 0; w < NDROPS; w++) dn += dropped[p][w];
    if (dn) { L_s("-"); for (int w = 0; w < NDROPS; w++) if (dropped[p][w]) { char c[2] = { DROP_CHAR[w], 0 }; L_s(c); L_i(dropped[p][w]); } }
  }
  if (!any) L_s("-");
  L_s(" live="); L_i(P.nlive); L_s("/"); L_i(P.ncands);
  if (cutWhy[1] + cutWhy[2] + cutWhy[3]) { L_s(" cutWhy="); for (int w = 1; w <= 3; w++) { if (w > 1) L_s("/"); L_i(cutWhy[w]); } L_s(":"); for (int w = 1; w <= 3; w++) { if (w > 1) L_s("/"); L_i(cutWhyBreak[w]); } }
  if (unbroken.set) { L_s(" unbroken="); L_play(unbroken.play); L_s(":"); for (int i = 0; i < unbroken.nseq; i++) { if (i) L_s(";"); L_mv(unbroken.seq[i]); } L_s(":"); L_i(unbroken.said); L_s("/"); L_i(unbroken.judged); }
  // (the one order, its first eight: the play -- * the line in progress -- whether it lives or the frame its board is lost, the garbage it breaks)
  if (carryDrop) {
    L_s(" carryDrop="); L_i(carryDrop);
    if (carryDrop == 2) { L_s(":d"); L_i(carryDropDead); L_s(":c"); L_i(carryDropCut); if (carryDropWhy) L_s(carryDropWhy == 1 ? "a" : carryDropWhy == 2 ? "n" : "w"); L_s(":n"); L_i(carryDropNats); }
    if (carryDrop >= 2) { L_s(" carryRest="); for (int i = 0; i < carryDropN; i++) { if (i) L_s(";"); L_mv(carryDropRest[i]); } }
  }
  L_s(" opts=");
  for (int i = 0; i < P.ncands && i < 8; i++) {
    const Judge *j = order[i];
    if (i) L_s(",");
    L_play(j->hold ? PLAY_HOLD : j->k.play); if (j == carriedJ) L_s("*"); if (j->outside) L_s("~");
    L_s(":"); if (j->o.lives) L_s("L"); else if (j->o.lostAt == FOREVER) L_s("inf"); else L_i(j->o.lostAt);
    L_s(":"); L_i(j->apBroke); if (j->readyNext == 1) L_s(":n");
    { int32_t b = j->hold ? 0 : blocksOf(j->apCombo, j->apChain); if (b) { L_s(":b"); L_i(b); } }   // (the blocks it throws)
  }
  L_s(" lost="); if (top) { if (top->o.lostAt == FOREVER) L_s("inf"); else L_i(top->o.lostAt); } else L_s("-");
  // (THE LINE PLAYED OVER ONE LOST LATER: of the lines offered, the one lost latest when the line played does not live and it is lost
  // later -- its play, its loss and the order's key that put the played line first, rank.c cmpKey: sooner=play:lost:kLINE)
  if (top && !top->o.lives) {
    const Judge *late = 0;
    for (int i = 0; i < P.ncands; i++) { const Judge *j = order[i]; if (j != top && (j->o.lives || lostOf(j) > lostOf(top)) && (!late || (j->o.lives && !late->o.lives) || (j->o.lives == late->o.lives && lostOf(j) > lostOf(late)))) late = j; }
    if (late && compareJudged(top, late) < 0) {
      L_s(" sooner="); L_play(late->hold ? PLAY_HOLD : late->k.play); L_s(":"); if (late->o.lives) L_s("L"); else L_i(late->o.lostAt); L_s(":k"); L_i(cmpKey);
    }
  }
  L_s(" ms_c="); L_i((int64_t)(nowMs() - tStart)); L_s(" ms_r="); L_i((int64_t)readMs);
  L_s(" why="); if (top) L_play(top->k.play); else L_s(d.kind == 2 ? "raise" : "hold");
  if (P.deferred) L_s(" deferred=1");
  if (R.saving) L_s(" saving=1");
  // (the panels the measured life peaks at, beside the owner's saving band, for the owner to read: core/material.h)
  L_s(" lifePeak="); L_i(lifePeakOf());
  if (R.full) L_s(" full=1");
  if (switchedNow) L_s(" switched=1");
  // (the enemy as the rules read it: its height, topped out, the frames of its stop -- what picked the rule)
  if (theOpp.has) { L_s(" enemy="); L_i(theOpp.top); L_s("/"); L_i(theOpp.out); L_s("/"); L_i(theOpp.stopKnown ? theOpp.stop : -1); }
  if (P.line && P.line->k.grown) L_s(" grown=1");
  if (P.line && P.line->k.drop) L_s(" drop=1");
  if (cappedN) { L_s(" capped="); L_i(cappedN); }
  // (THE BOARD THE BREAK SEARCH CAME UP EMPTY ON, under garbage, for the reach report: at most one every 30 frames)
  if (R.under && !(ran && theBr.depth) && (emptyAt == NUL || at - emptyAt >= 30 || at < emptyAt)) { emptyAt = at; A->dumpBoard = 1; }
  // (THE BOARD TOPPED WITH NO GARBAGE ON IT, for reading the stalls: at most one every 30 frames)
  else if (R.topped && !R.under && (emptyAt == NUL || at - emptyAt >= 30 || at < emptyAt)) { emptyAt = at; A->dumpBoard = 2; }
  // (A LIFE NOT KEPT: the last decision's line lived under garbage, nothing new was told since -- the next block lands on the same frame,
  // as many queued -- and no line lives now. The engine predicts every frame, so this is a fault: this board and the last are logged,
  // GAMBITK, to be replayed side by side. At most LIFEDUMPS a game.)
  { int32_t landAbs = R.F.known[FACT_US_NEXTLANDS] ? at + (int32_t)R.F.v[FACT_US_NEXTLANDS] : NUL, qk = R.F.v[FACT_US_QUEUEKILLS] ? 1 : 0;
    if (lifeLived && landAbs != NUL && landAbs == lifeLand && qk == lifeQk && !P.nlive && lifeDumps < LIFEDUMPS) { A->dumpBoard = 3; lifeDumps++; }
    lifeLived = A->verdict == 1 && R.under; lifeLand = landAbs; lifeQk = qk; }
  // THE RAISE HELD DOWN: the steps the row has left, and the rows on to the rule's `to`
  // (a raise put off to the frame the stack takes one is held from then, on the board it will be: decide.c raiseWait)
  A->raiseWait = d.kind == 2 ? raiseWait : 0;
  if (d.kind == 2) { const Board *rb = A->raiseWait ? raiseWaitBoard : decQ.b;
                     A->raiseNow = imax(1, (rb->displacement ? rb->displacement : ROW_STEPS) - 1); A->raiseAfter = imax(0, R.to - fullTop(rb) - 1) * ROW_STEPS; }
}

// ---- THE HOST'S SIDE: the rules, the profile, a question, the log
// The rules (the loader encodes the rules file): rule count, then per rule -- table, name, nwhen, when (fact, op, n, near each), naims,
// aims (ten words each), end, byFact, byFrames, keep (on, then height, material, evenness tests: op, n, near each), raiseTo -- then the
// file's keep (as a rule's), raiseTo and underIgnore.
static int readTest(const int32_t **w, Test *t) { t->op = (*w)[0]; t->n = (*w)[1]; t->near = (*w)[2]; *w += 3; return 1; }
EXPORT(gb_rules) int gb_rules(int n) {
  if (n < 0 || n > MAXRULES) return -1;
  const int32_t *w = gbIo;
  memset(&theTables, 0, sizeof theTables);
  for (int i = 0; i < n; i++) {
    Rule *r = &theTables.r[i];
    r->table = *w++; r->name = *w++; r->nwhen = *w++;
    if (r->nwhen > MAXWHEN) return -1;
    for (int k = 0; k < r->nwhen; k++) { r->when[k].fact = *w++; readTest(&w, &r->when[k].t); }
    r->list.n = *w++;
    if (r->list.n > MAXAIMS) return -1;
    for (int k = 0; k < r->list.n; k++) { Aim *a = &r->list.aim[k]; readTest(&w, &a->combo); readTest(&w, &a->chain); readTest(&w, &a->send); a->brk = *w++; }
    r->end = *w++; r->byFact = *w++; r->byFrames = *w++;
    r->keep.on = *w++; for (int k = 0; k < NKEEP; k++) readTest(&w, &r->keep.t[k]);
    r->raiseTo = *w++;
  }
  theTables.n = n;
  theTables.keep.on = *w++; for (int k = 0; k < NKEEP; k++) readTest(&w, &theTables.keep.t[k]);
  theTables.raiseTo = *w++; theTables.underIgnore = *w++;
  return n;
}
// The profile: the mode played the whole game (the rule's name, -1: chosen by the facts each decision), the gambit's numbers, the
// bot's hands.
// THE BREAK SEARCH'S SHARE of the searches' time, in percent, under garbage and otherwise (the profile's `share`); 0 keeps the default
EXPORT(gb_share) void gb_share(int under, int otherwise) {
  underShare = under > 0 && under <= 100 ? under / 100.0 : UNDER_SHARE;
  breakShare = otherwise > 0 && otherwise <= 100 ? otherwise / 100.0 : BREAK_SHARE;
}
EXPORT(gb_profile) void gb_profile(int mode, int ms, int extendMs, int width, int depth, int pool, int extendDepth, int extendOff, int reaction, int swapGap, int cursor) {
  modeRule = mode;
  // (the opening raise is held through every row it is asked for -- search.h HOLD_THROUGH -- not let go at each row's end and asked
  // again a decision later)
  HOLD_THROUGH = 1;
  Profile p = { mode, ms, extendMs, width, depth, pool, extendDepth, extendOff };
  C2.GP = p; C2.reaction = reaction;
  gb_config(reaction, swapGap, cursor);
}
// WHAT A MODE CARRIES from one decision to the next, let go when the mode changes: the break search's lines, the line in progress (begun
// for the old mode's list), the dig, the line toward a break.
static void modeLeft(void) {
  lifeLived = 0;
  memset(&theKept, 0, sizeof theKept); memset(&theCarry, 0, sizeof theCarry); memset(&theCarryNext, 0, sizeof theCarryNext);
  digOn = 0; digN = 0; digGid = NUL; towardPlayedN = 0; towardRestLen = 0;
}
// A new game: nothing of the last one is carried on.
EXPORT(gb_new_game) void gb_new_game(void) {
  modeLeft(); lifeDumps = 0;
  lastA = lastB = pairRuns = blockA = blockB = blockUntil = 0; emptyAt = NUL; gambitHit = 0; C2.idle = 0; savingPanels = 0;
  readyStop(); readyKeptClear();   // (a new game's boards are its own)
  memset(theIntents, 0, sizeof theIntents);
  memset(&thePlanKept, 0, sizeof thePlanKept);
  gb_back(0, 0, 0, 0, 0, 0, 0);
}
EXPORT(gb_switch) void gb_switch(int min, int max) { switchMin = min > 0 ? min : 0; switchMax = max > switchMin ? max : switchMin; nswitch = 0; }
// (the circuit: Hierholzer's walk of the complete directed graph on n rules -- n(n-1) steps, each ordered pair once)
static int lapOf(int n, int32_t *lap) {
  static int32_t used[MAXRULES][MAXRULES], stack[MAXRULES * MAXRULES + 1];
  for (int a = 0; a < n; a++) for (int b = 0; b < n; b++) used[a][b] = a == b;
  int sp = 0, k = 0; stack[sp++] = 0;
  while (sp) {
    int v = stack[sp - 1], w = -1;
    for (int b = 0; b < n && w < 0; b++) if (!used[v][b]) w = b;
    if (w >= 0) { used[v][w] = 1; stack[sp++] = w; } else lap[k++] = stack[--sp];
  }
  for (int i = 0; i < k / 2; i++) { int32_t t = lap[i]; lap[i] = lap[k - 1 - i]; lap[k - 1 - i] = t; }
  return k - 1;   // (the walk ends where it began)
}
EXPORT(gb_switch_game) void gb_switch_game(uint32_t seed) {
  nswitch = 0; modeRule = C2.GP.mode;
  int32_t rules[MAXRULES], nr = 0;
  for (int i = 0; i < theTables.n && nr < MAXRULES; i++) if (theTables.r[i].table == 1 && !asksNoEnemy(&theTables.r[i])) rules[nr++] = theTables.r[i].name;
  if (!switchMin || nr < 2) return;
  static int32_t lap[MAXRULES * MAXRULES + 1];
  int nl = lapOf(nr, lap);
  uint32_t s = seed * 2654435761u + 1;
#define NEXT() (s = s * 1664525u + 1013904223u, s >> 8)
  for (int i = nr - 1; i > 0; i--) { int j = (int)(NEXT() % (uint32_t)(i + 1)); int32_t t = rules[i]; rules[i] = rules[j]; rules[j] = t; }
  int at0 = (int)(NEXT() % (uint32_t)nl);
  int32_t t = 0;
  for (int k = 0; nswitch < MAXSWITCH; k++) {
    switchAt[nswitch] = t; switchMode[nswitch++] = rules[lap[(at0 + k) % nl]];
    t += switchMin + (int32_t)(NEXT() % (uint32_t)(switchMax - switchMin + 1));
  }
#undef NEXT
}
// The mode the game plays at frame `at`: the profile's, or the switch in force then
static int32_t modeAt(int32_t at) {
  if (!nswitch) return C2.GP.mode;
  int k = 0;
  while (k + 1 < nswitch && switchAt[k + 1] <= at) k++;
  return switchMode[k];
}
// A QUESTION ON THE BOARD IN hostQ (hostBoard, its hold and garbage on its way): the answer into theAnswer, the log line at logBuf
static void answerQuestion(int qid, int at, int topped, int oppHas, int oppOut, int oppTopKnown, int oppTop, int oppStopKnown, int oppStop,
                           int allowanceKnown, int allowance, int lineFrom, int linePressed, int canRaise, double due, double t0, double margin) {
  decQ = hostQ; decQ.b = hostBoard;
  ncache = 0; rootBuildable = NOT_ASKED;
  // (switching: the mode in force at the question's frame; a change lets go of what the old mode carried)
  switchedNow = 0;
  if (nswitch) { int32_t m = modeAt(at); if (m != modeRule) { if (modeRule >= 0) { modeLeft(); switchedNow = 1; } modeRule = m; } }
  hostTopped = topped;
  Opp o = { oppHas, oppOut, oppTopKnown, oppTop, oppStopKnown, oppStop }; theOpp = o;
  canRaiseNow = canRaise;
  C2.due = due; C2.t0 = t0; C2.margin = margin;
  clockStart(due ? due - margin : 0);
  decF.timeLeft = -1;   // (readiness is asked while the searches have time left, as each outcome finds it)
  answerTurn(qid, at, allowanceKnown, allowance, lineFrom, linePressed);
}
// A QUESTION: its board, hold and garbage on its way are node i of the host's search (the root it made); then its own facts. The answer
// into the io body (gb_answer's words below); the log line at gb_log.
EXPORT(gb_answer) int gb_answer(Ctx *hx, int i, int qid, int at, int topped, int oppHas, int oppOut, int oppTopKnown, int oppTop, int oppStopKnown, int oppStop,
                                int allowanceKnown, int allowance, int lineFrom, int linePressed, int canRaise, double due, double t0, double margin) {
  if (gb_question(hx, i, 0) < 0) return -1;
  answerQuestion(qid, at, topped, oppHas, oppOut, oppTopKnown, oppTop, oppStopKnown, oppStop, allowanceKnown, allowance, lineFrom, linePressed,
                 canRaise, due, t0, margin);
  Answer *A = &theAnswer;
  int32_t *w = gbIo, k = 0;
  w[k++] = A->d.kind; w[k++] = A->d.move ? CR(A->d.move) : 0; w[k++] = A->d.move ? CC(A->d.move) : 0;
  w[k++] = A->raiseNow; w[k++] = A->raiseAfter; w[k++] = A->verdict; w[k++] = A->holdLives; w[k++] = A->brk; w[k++] = A->urgent;
  w[k++] = A->offered; w[k++] = A->lineup; w[k++] = A->touch; w[k++] = A->took; w[k++] = A->clears; w[k++] = A->dumpBoard;
  w[k++] = A->play; w[k++] = A->combo; w[k++] = A->chain; w[k++] = A->chainAll; w[k++] = A->broke; w[k++] = A->done; w[k++] = A->fire;
  w[k++] = (int32_t)A->idleMs; w[k++] = (int32_t)A->brMs;
  w[k++] = A->nhand; for (int q = 0; q < A->nhand; q++) w[k++] = A->hand[q];
  w[k++] = A->nseq; for (int q = 0; q < A->nseq; q++) w[k++] = A->seq[q];
  w[k++] = A->d.kind < 0 ? -1 : A->rule; w[k++] = A->nlive; w[k++] = A->ncands;
  w[k++] = A->handSettled; for (int q = 0; q < A->nhand; q++) w[k++] = A->handAt[q];
  return k;
}
EXPORT(gb_log) const char *gb_log(void) { return logBuf; }
EXPORT(gb_log_len) int gb_log_len(void) { return logN; }
EXPORT(gb_play_name) const char *gb_play_name(int p) { return p == -2 ? "raise" : p >= 0 && p < NPLAYS ? PLAY_NAME[p] : ""; }
