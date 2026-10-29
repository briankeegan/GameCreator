// THE DECISION REPLAYED (test/main.c asks it, built with GB_TEST): a question Gambit met in a game, its board and the garbage on its way
// (gb_question_bytes), answered as a new game with the mode's rules. Its time is a game's (REPLAY_MS, shared out among the searches and
// the judging as a game's is), read off the work done -- `work` engine frames to the whole decision, never the wall clock, so the same
// board gives the same answer every time. Its record: the move, the play, and the first three of the one order with the keys they were
// ranked by.
#define REPLAY_MS 150   // a decision's time, as the frame loop gives one
static int64_t replayWork;
static double replayNow(void) { return (double)clockWork * REPLAY_MS / (double)replayWork; }
// (the last replay's answer as numbers, for the checks: its kind (0 hold, 1 swap, 2 raise), verdict (answer.c Answer), the candidates
// that live, the garbage on the board, the blocks on their way, the stack's top row, the rules' raise row, the raise's held steps)
static int32_t replayLast[9];
EXPORT(gb_replay_last) void gb_replay_last(int32_t *v) { for (int i = 0; i < 9; i++) v[i] = replayLast[i]; }
// A LOW STACK (gb_replay_low KEEP, before a replay): the question's board cut to its bottom KEEP rows, nothing queued or on its way --
// refused (-2) when those rows hold garbage or anything not at rest
static int32_t replayLow;
EXPORT(gb_replay_low) void gb_replay_low(int keep) { replayLow = keep; }
// (THE ALLOWANCE THE GAME GAVE, gb_replay_allow ALLOW before a replay: the actions left in the input window, the walks tapped near the
// end as the native host's frame loop taps them -- -1: none said, as the checks replay)
static int32_t replayAllow = -1;
EXPORT(gb_replay_allow) void gb_replay_allow(int allow) { replayAllow = allow; }
// (THE RAISE OFFERED, gb_replay_raise 1 before a replay: the question asked as the frame loop asks one it may answer with a raise)
static int32_t replayRaise;
EXPORT(gb_replay_raise) void gb_replay_raise(int on) { replayRaise = on; }
static int lowered(Board *b, int keep) {
  const Panel *empty = 0;
  for (int c = 1; c <= W && !empty; c++) if (!b->p[b->nrows - 1][c].f[COLOR] && !b->p[b->nrows - 1][c].f[ISGARBAGE]) empty = &b->p[b->nrows - 1][c];
  if (!empty || keep + 1 >= b->nrows) return 0;
  for (int r = 0; r <= keep; r++) for (int c = 1; c <= W; c++) if (b->p[r][c].f[ISGARBAGE] == 1 || b->p[r][c].f[STATE] != (r ? NORMAL : DIMMED)) return 0;   // (row 0: the row rising, dimmed)
  Panel e = *empty;
  for (int r = keep + 1; r < b->nrows; r++) for (int c = 1; c <= W; c++) { int32_t id = b->p[r][c].f[ID]; b->p[r][c] = e; b->p[r][c].f[ROW] = r; b->p[r][c].f[COL] = c; b->p[r][c].f[ID] = id; }
  b->ninc = 0; b->nstall = 0; b->chainCounter = 0; b->shakeTime = 0; b->riseLock = 0; b->stopWatch = 0; b->preventManualRaise = 0; b->manualRaise = 0;
  b->stopTime = 0; b->preStopTime = 0; b->nActive = 0; b->nPrevActive = 0;
  for (int r = 0; r < b->nrows; r++) { b->rowActive[r] = -1; for (int c = 1; c <= W; c++) b->p[r][c].f[CHAINING] = 0; }
  return 1;
}
EXPORT(gb_replay) int gb_replay(int nbytes, int narr, int mode, int64_t work, char *out, int cap) {
  if (gb_question_bytes(nbytes, replayLow ? 0 : narr) != 0) return -1;
  if (replayLow && !lowered(hostBoard, replayLow)) return -2;
  if (replayLow) hostQ.narr = 0;
  gb_new_game();
  modeRule = mode;
  curQid = abortId + 1;
  replayWork = work; clockNowOf = work > 0 ? replayNow : 0; clockFrameOut = 0; clockWork = 0;
  int topped = fullTop(hostBoard) >= hostBoard->height;
  // (work 0: the wall clock's REPLAY_MS, as a game gives it -- the speed check's; else the work's, the same answer every time)
  double t0 = work > 0 ? 0 : clock_ms(), due = t0 + REPLAY_MS;
  int32_t taps = hostTaps; if (replayAllow >= 0) hostTaps = 1;
  __atomic_store_n(&decGap, replayAllow >= 0 ? paceGap(replayAllow, 76, 600) : 0, __ATOMIC_RELAXED);   // (the pace the frame loop would ask with: the standard budget)
  answerQuestion(1, 0, topped, 0, 0, 0, 0, 0, 0, replayAllow >= 0, imax(0, replayAllow), -1, 0, (replayLow || replayRaise) && canRaiseOn(hostBoard), due, t0, 0);
  hostTaps = taps;   // (the raise asked of a low stack only)
  readyStop();   // (the readiness left searching beside the decision taken back before its clock is: the next decision would discard it)
  clockNowOf = 0;
  const Answer *A = &theAnswer;
  replayLast[0] = A->d.kind; replayLast[1] = A->verdict; replayLast[2] = A->nlive; replayLast[3] = garbageOn(hostBoard);
  replayLast[4] = hostQ.narr; replayLast[5] = fullTop(hostBoard); replayLast[6] = theTables.raiseTo; replayLast[7] = A->d.kind == 2 ? A->raiseNow : 0; replayLast[8] = A->sooner;
  int k = snprintf(out, (unsigned long)cap, "move %d %d,%d play %d live %d/%d |", A->d.kind, A->d.move ? CR(A->d.move) : 0, A->d.move ? CC(A->d.move) : 0,
                   A->play, A->nlive, A->ncands);
  // (the chain the board makes left alone and the one it makes with the line played, where the board is making one)
  if (aloneChain > 1) k += snprintf(out + k, (unsigned long)(cap - k), " own %d/%d", aloneChain, A->whole >= 0 ? A->whole : aloneChain);
  for (int i = 0; i < 3 && i < A->ncands && k < cap - 160; i++) {
    const Judge *J = order[i];
    k += snprintf(out + k, (unsigned long)(cap - k), " %d:%d,%d,%d,%d,%d,%d,%d,t%d", J->hold ? PLAY_HOLD : J->k.play, J->o.lives, J->o.lostAt, J->outside,
                  J->met, J->material, 0, J->o.lifeLeft, tierView(J).tier);
  }
  return k;
}
// SWITCHING'S DIRECTIONS (answer.c gb_switch_game): over `games` games of `frames` frames each, how often each ordered pair of the
// attack rules is switched between -- into counts (n x n, by the rules' order), the pairs never switched between returned
EXPORT(gb_switch_check) int gb_switch_check(int games, int frames, int min, int max, int32_t *counts, int *nrules) {
  int32_t idx[MAXRULES], nr = 0;
  for (int i = 0; i < theTables.n && nr < MAXRULES; i++) if (theTables.r[i].table == 1 && !asksNoEnemy(&theTables.r[i])) idx[nr++] = theTables.r[i].name;
  *nrules = nr;
  for (int i = 0; i < nr * nr; i++) counts[i] = 0;
  gb_switch(min, max);
  for (int g = 0; g < games; g++) {
    gb_switch_game((uint32_t)(g * 7919 + 1));
    for (int k = 1; k < nswitch && switchAt[k] < frames; k++) {
      int a = -1, b = -1;
      for (int i = 0; i < nr; i++) { if (idx[i] == switchMode[k - 1]) a = i; if (idx[i] == switchMode[k]) b = i; }
      if (a >= 0 && b >= 0) counts[a * nr + b]++;
    }
  }
  gb_switch(0, 0); nswitch = 0;
  int missing = 0;
  for (int a = 0; a < nr; a++) for (int b = 0; b < nr; b++) if (a != b && !counts[a * nr + b]) missing++;
  return missing;
}
// A BOARD RUN A FRAME AT A TIME (gb_frames, the checks' tool for a board a game dumped): the question's board (gb_question_bytes), the
// swap at (mr, mc) pressed as the judge presses it (mr 0: none), then `frames` frames left alone; per frame into out: the frame, the
// chain counter, the panels active, the clears so far -- 4 words a frame. The frames written.
#define FRAMESW 16
static int32_t framesR2[FRAMESW], framesC2[FRAMESW], framesAt2[FRAMESW], framesN2;   // (swaps after the first, each pressed from its frame: gb_frames2)
static int32_t framesAskAt = -1; static Board *framesAsk;   // (the board kept at framesAskAt, for gb_frames_ask)
EXPORT(gb_frames_keep) void gb_frames_keep(int at) { framesAskAt = at; }
EXPORT(gb_frames2) void gb_frames2(int r, int c, int at) { if (framesN2 < FRAMESW) { framesR2[framesN2] = r; framesC2[framesN2] = c; framesAt2[framesN2++] = at; } }
EXPORT(gb_frames) int gb_frames(int mr, int mc, int frames, int32_t *out) {
  static Ctx *fx; fx = ctxOf(fx);
  curQid = abortId + 1; clockNowOf = 0; clockFrameOut = 0; clockStart(0);
  int n = rootOf(fx, &hostQ);
  if (n < 0) return -1;
  if (mr) { int from; n = pressWalk(fx, n, MK_SWAP, mr, mc, stepTapped, &from); if (!liveNode(fx, n)) return -2; }
  int k = 0, clears = 0, next = 0;
  for (int f = 0; f < frames; f++) {
    int w;
    if (next < framesN2 && NODE(fx, n)->t >= framesAt2[next]) { int from; w = pressWalk(fx, n, MK_SWAP, framesR2[next], framesC2[next], stepTapped, &from); next++; }
    else w = step(fx, n, MK_LONG, 0, 0, 1);
    if (!liveNode(fx, w)) break;
    Board *b = ensureBoard(fx, w);
    if (framesAskAt >= 0 && NODE(fx, w)->t == framesAskAt) { if (!framesAsk) framesAsk = nb_new(); cloneBoard(framesAsk, b); }
    Stats st; if (statsOf(fx, w, &st)) clears += st.n;
    out[4 * k] = NODE(fx, w)->t; out[4 * k + 1] = b->chainCounter; out[4 * k + 2] = b->nActive; out[4 * k + 3] = clears; k++;
    n = w;
  }
  return k;
}
// THE DECISION ON THE BOARD KEPT (gb_frames_ask): answered as gb_replay answers, and the first candidates' chain keys -- for the checks
EXPORT(gb_frames_ask) int gb_frames_ask(int mode, int64_t work, char *out, int cap) {
  if (!framesAsk) return -1;
  if (!hostBoard) hostBoard = nb_new();
  cloneBoard(hostBoard, framesAsk);
  hostQ.b = hostBoard; hostQ.narr = 0; hostQ.holdLeft = 0; hostQ.holdStarted = 0;
  gb_new_game(); modeRule = mode; curQid = abortId + 1;
  replayWork = work; clockNowOf = replayNow; clockFrameOut = 0; clockWork = 0;
  answerQuestion(1, 0, fullTop(hostBoard) >= hostBoard->height, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, REPLAY_MS, 0, 0);
  clockNowOf = 0;
  int k = snprintf(out, (unsigned long)cap, "ownChainBy %d N %d aloneChain %d | ", ownChainBy, ownChainN, aloneChain);
  for (int i = 0; i < 6 && i < theAnswer.ncands && k < cap - 200; i++) {
    const Judge *J = order[i];
    k += snprintf(out + k, (unsigned long)(cap - k), " [%s lost %d keeps %d whole %d cuts %d broke %d]", J->hold ? "hold" : PLAY_NAME[J->k.play], J->o.lostAt, J->o.j.keepsChain, J->apWhole, cutsShort(J), J->apBroke);
  }
  k += snprintf(out + k, (unsigned long)(cap - k), "\n%s", logBuf);
  return k;
}
// THE LINE AS THE FRAME LOOP PRESSES IT (gb_front_line, the checks' tool): the question's board, its swaps mv[0..n) followed as front.c
// follow() makes their keys -- each from the frame the keys before it end, or the frame it was judged pressed from (at, from the
// board's clock; 0 none), whichever is later -- with `allow` actions left in the input window and the walks tapped (tap) or not. Per
// swap into out: the frame its keys begin, the frame its swap goes down, its keys. The swaps keyed (a swap no keys press ends it).
static int frontLine(int n, const int32_t *mv, const int32_t *at, int allow, int tap, int32_t *out);
// (THE HELD KEYS, OFF THE WALL: the keys played on the board they begin on, every direction held two frames or more and let go with the
// cursor anywhere but the wall it walks toward -- core/nodes.h legHeld -- counted)
static int32_t frontHeldOff, frontHeld, frontOffCell;
static Board *heldBoard;
// (and the swap: pressed with the cursor on the swap the keys were made for, mv -- frontOffCell counts those that are not)
static int heldOffWall(const Board *b, const Keys *k, int32_t mv) {
  if (!heldBoard) heldBoard = nb_new();
  Board *g = heldBoard;
  copyBoard(g, b);
  int off = 0, held = 0;
  int32_t dir = 0;
  for (int q = 0; q <= k->n && g->gameOverClock <= 0; q++) {
    int32_t bits = q < k->n ? k->ins[q] : 0, d = bits & 15;
    if (dir && d != dir) { if (held >= 2) { frontHeld++; off += !legHeld(dir, g->curRow, g->curCol); } held = 0; }
    dir = d; if (d) held++;
    if (q == k->n) break;
    g->input = bits & ~IN_SWAP; g->pressSwap = !!(bits & IN_SWAP);
    if ((bits & IN_SWAP) && (g->curRow != CR(mv) || g->curCol != CC(mv))) frontOffCell++;
    run(g);
  }
  return off;
}
EXPORT(gb_held_off) int gb_held_off(int *held, int *offCell) { *held = frontHeld; *offCell = frontOffCell; int o = frontHeldOff; frontHeldOff = frontHeld = frontOffCell = 0; return o; }
// (on the game's thread, as the frame loop runs: its own board pool, apart from thread 0's that the workers' searches hand out -- native.c)
EXPORT(gb_front_line) int gb_front_line(int n, const int32_t *mv, const int32_t *at, int allow, int tap, int32_t *out) {
  paThreadId(MAXTHREADS - 1);
  int keyed = frontLine(n, mv, at, allow, tap, out);
  paThreadId(0);
  return keyed;
}
static int frontLine(int n, const int32_t *mv, const int32_t *at, int allow, int tap, int32_t *out) {
  frontNew(90, -1, 0);
  F.keyGap = paceGap(allow, F.limit, F.window);
  Board *b0 = F.truth; cloneBoard(b0, hostBoard);
  int32_t t0 = b0->clock;
  F.now = t0; F.npress = 0;
  for (int i = 0; i < F.limit - allow; i++) F.pressFrames[F.npress++] = t0 - 1;
  Arrival arr[MAXARR]; int32_t narr = 0;
  for (int i = 0; i < hostQ.narr; i++) { Arrival a; memset(&a, 0, sizeof a); a.at = b0->stopWatch + hostQ.arr[i].at; a.g.width = hostQ.arr[i].width; a.g.height = hostQ.arr[i].height; a.g.isChain = hostQ.arr[i].isChain; a.g.frameEarned = NUL; arr[narr++] = a; }
  static Keys k;
  int32_t nextAt = t0, i = 0;
  for (; i < n; i++) {
    int32_t due = imax(nextAt, at[i] ? t0 + at[i] : 0), hl, hs;
    if (!predict(b0, due, 0, 0, arr, narr, F.pr, &hl, &hs)) break;
    if (!keysOf(F.pr, hl, hs, F.prPend, F.nprPend, MK_SWAP, CR(mv[i]), CC(mv[i]), &k)) break;
    pressTap = tap;
    walkKeys(&k, due, F.pr);
    frontHeldOff += heldOffWall(F.pr, &k, mv[i]);
    int sw = -1;
    for (int q = 0; q < k.n && sw < 0; q++) if (k.ins[q] & IN_SWAP) sw = q;
    for (int q = 0; q < k.n; q++) planSet(due + q, (Planned){ k.ins[q], k.hl[q], k.hs[q], 1, 0 });
    out[3 * i] = due - t0; out[3 * i + 1] = sw >= 0 ? due + sw - t0 : -1; out[3 * i + 2] = k.n;
    nextAt = due + k.n;
  }
  return i;
}
// THE LINE AS THE JUDGE PRESSES IT (gb_judge_line, beside gb_front_line): the question's board, its swaps judged with `allow` actions
// left and the walks tapped (tap) or not, as a decision judges them. Into out: each swap's frame (ats), then dead, deadAt, lostAt.
EXPORT(gb_judge_line) int gb_judge_line(int n, const int32_t *mv, int allow, int tap, int settled, int32_t *out) {
  curQid = abortId + 1; clockNowOf = 0; clockFrameOut = 0; clockStart(0);
  decQ = hostQ;
  lookPause();   // (the look-ahead beside reads the press and the pace: held while they are set)
  pressTap = decTap = tap; decQ.tight = tightAt(allow); pressTight = decQ.tight; pressAllowance = allow; __atomic_store_n(&decGap, paceGap(allow, 76, 600), __ATOMIC_RELAXED);
  JudgeOpts jo = { settled, decQ.tight, NOT_ASKED, 0, 0, -1, 0, 0, 0, 0, 0 };
  Judged j;
  judge(&decQ, mv, n, &jo, &j);
  int k = 0;
  for (int i = 0; i < j.nats; i++) out[k++] = j.ats[i];
  out[k++] = j.dead; out[k++] = j.deadAt; out[k++] = j.cut;
  return j.nats;
}
// THE LINE PRESSED AS JUDGED (gb_line_agree, after a replay given an allowance: gb_replay_allow): the answer's swap and the line it hands
// on, keyed as the frame loop keys them (gb_front_line) -- the swaps whose keys begin later than the frame the judge pressed them from,
// or that no keys press. *n: the swaps compared.
static char lineShown[512];
EXPORT(gb_line_agree) int gb_line_agree(int *n) {
  const Answer *A = &theAnswer;
  int32_t mv[MAXLINE + 1], at[MAXLINE + 1], out[3 * (MAXLINE + 1)], k = 0;
  *n = 0;
  if (replayAllow < 0 || !(A->d.kind == 1 || (A->d.kind == 0 && A->nhand))) return 0;
  if (A->d.kind == 1) { mv[k] = A->d.move; at[k++] = 0; }
  for (int i = 0; i < A->nhand && k <= MAXLINE && A->handAt[i] > 0; i++) { mv[k] = A->hand[i]; at[k++] = A->handAt[i]; }
  int keyed = gb_front_line(k, mv, at, replayAllow, A->tap, out), late = k - keyed;
  for (int i = 0; i < keyed; i++) late += out[3 * i] > at[i];
  *n = k;
  // (the line, for the checks' report: each swap, the frame judged, the frame keyed)
  int w = snprintf(lineShown, sizeof lineShown, "tap %d settled %d:", A->tap, A->handSettled);
  for (int i = 0; i < k && w < (int)sizeof lineShown - 40; i++) w += snprintf(lineShown + w, sizeof lineShown - (unsigned long)w, " %d,%d@%d/%d", CR(mv[i]), CC(mv[i]), at[i], i < keyed ? out[3 * i] : -1);
  return late;
}
EXPORT(gb_line_shown) const char *gb_line_shown(void) { return lineShown; }
// COLOURS SHOWN (gb_reveal_keep, then a board loaded, then gb_reveal_apply -- the checks' tool): the board kept gives the board loaded
// the colours it shows where the loaded one has them unseen, panel by panel id. The panels coloured.
static Board *revealSrc;
EXPORT(gb_reveal_keep) void gb_reveal_keep(void) { if (!revealSrc) revealSrc = nb_new(); cloneBoard(revealSrc, hostBoard); }
EXPORT(gb_reveal_apply) int gb_reveal_apply(void) {
  int n = 0;
  if (!revealSrc) return 0;
  for (int r = 0; r < hostBoard->nrows; r++) for (int c = 1; c <= W; c++) {
    int32_t *f = hostBoard->p[r][c].f;
    if (!((f[COLOR] >= 30 && f[COLOR] <= 119) || (f[COLOR] >= 130 && f[COLOR] <= 219))) continue;
    for (int r2 = 0; r2 < revealSrc->nrows; r2++) for (int c2 = 1; c2 <= W; c2++) {
      const int32_t *g = revealSrc->p[r2][c2].f;
      if (g[ID] == f[ID] && g[COLOR] >= 1 && g[COLOR] <= 10 && f[COLOR] != g[COLOR]) { f[COLOR] = g[COLOR]; n++; }
    }
  }
  return n;
}
// THE FRAME LOOP ON ITS OWN (gb_front_sim, the checks' tool): the question's board played `frames` frames by the frame loop and Gambit's
// thread as a game plays them -- the engine is the game: each frame's board is the one the frame loop predicted -- a frame each
// `msPerFrame` of the wall clock, under the rule `mode` (-1: the profile's). Per frame into out: the clock, the keys. The frames played (the game lost: the last).
EXPORT(gb_front_sim) int gb_front_sim(int frames, int msPerFrame, int mode, int32_t *out) {
  paThreadId(MAXTHREADS - 1);
  clockNowOf = workNowMs;   // (the native host's own clock: native.c, the replays above leave the wall's)
  gn_match();
  if (mode >= 0) modeRule = mode;
  cloneBoard(F.truth, hostBoard);
  // (the garbage on its way with the question, as one sender's telegraph: each piece's transit at the stopWatch it lands on, shown until
  // it has)
  int32_t na = hostQ.narr, absAt[MAXARR];
  for (int i = 0; i < na; i++) absAt[i] = F.truth->stopWatch + hostQ.arr[i].at;
  tele[0] = 0;
  int k = 0;
  double next = clock_ms();
  for (; k < frames; k++) {
    while (clock_ms() < next) {}
    next += msPerFrame;
    double t = clock_ms(), per = msPerFrame;
    __atomic_store(&gameFrameMs, &t, __ATOMIC_SEQ_CST); __atomic_store(&gameMsPerFrame, &per, __ATOMIC_SEQ_CST); __atomic_store_n(&gameFrame, F.truth->clock, __ATOMIC_SEQ_CST);
    { int32_t *w = tele, nt = 0; w[0] = na ? 1 : 0; w[1] = F.truth->stopWatch; w[2] = 0; int32_t *ntAt = &w[3]; int x = 4;
      for (int i = 0; i < na; i++) if (absAt[i] > F.truth->stopWatch) { w[x++] = absAt[i]; w[x++] = 1; w[x++] = hostQ.arr[i].width; w[x++] = hostQ.arr[i].height;
        w[x++] = hostQ.arr[i].isChain; w[x++] = hostQ.arr[i].isMetal; w[x++] = NUL; w[x++] = 1; nt++; }
      *ntAt = nt; w[x++] = 0; }
    int32_t clock = F.truth->clock, bits = frontFrame();
    afterFrame(bits);
    out[2 * k] = clock; out[2 * k + 1] = bits;
    if (F.truth->gameOverClock > 0 || F.expect->gameOverClock > 0) { k++; break; }
    cloneBoard(F.truth, F.expect);
  }
  statsOut();
  paThreadId(0);
  return k;
}
// (THE WINDOW HELD on the last frame loop played: lines reached as judged, those the window held fewer actions for, by how many at most)
EXPORT(gb_win_held) void gb_win_held(int32_t *o) { o[0] = F.st.winChecked; o[1] = F.st.winShort; o[2] = F.st.winShortWorst; }
// (the board kept at gb_frames_keep's frame, a few of its numbers: its clock, stop, shake, the queue, the garbage made, the top -- for the
// checks' tools to hold it beside a board the game logged)
EXPORT(gb_frames_kept_info) int gb_frames_kept_info(int32_t *out) {
  if (!framesAsk) return 0;
  const Board *b = framesAsk;
  out[0] = b->clock; out[1] = b->stopTime + b->preStopTime; out[2] = b->shakeTime; out[3] = b->ninc; out[4] = b->garbageCreatedCount; out[5] = fullTop(b);
  return 6;
}

// THE ORDER AFTER EACH STAGE of decide.c ranked, into the bot's log (GC_GAMBIT_LOG) once gb_trace(1): each line's play, whether it
// lives and the frame it is lost on -- where a line vanishes between two askings of one board (test/main.c, unsteady)
static int traceOn;
EXPORT(gb_trace) void gb_trace(int on) { traceOn = on; }
static void gb_trace_ranked(const char *stage, Judge **o, int n) {
  if (!traceOn) return;
  static char line[4096]; int k = snprintf(line, sizeof line, "TRACE ranked %s: %d lines:", stage, n);
  for (int i = 0; i < n && k < (int)sizeof line - 120; i++) {
    k += snprintf(line + k, sizeof line - (unsigned long)k, " %d/%d@%d/f%d/w%d/b%d:", o[i]->hold ? PLAY_HOLD : o[i]->k.play, o[i]->o.lives, o[i]->o.lostAt, 0, o[i]->o.j.threes, o[i]->o.j.made.broke);
    for (int q = 0; q < o[i]->k.nseq && q < 8 && k < (int)sizeof line - 20; q++) k += snprintf(line + k, sizeof line - (unsigned long)k, "%s%d,%d", q ? ";" : "", CR(o[i]->k.seq[q]), CC(o[i]->k.seq[q]));
  }
  hostLog(line);
}
static void gb_trace_cand(int play, const int32_t *seq, int n, int fc) {
  if (!traceOn) return;
  static char line[512]; int k = snprintf(line, sizeof line, "TRACE cand play %d n %d fc %d:", play, n, fc);
  for (int i = 0; i < n && k < (int)sizeof line - 20; i++) k += snprintf(line + k, sizeof line - (unsigned long)k, " %d,%d", CR(seq[i]), CC(seq[i]));
  hostLog(line);
}
static void gb_trace_walked(int ok, int wok, int cmp, int key, const char *why, const Judge *J, const Judge *JW) {
  if (!traceOn) return;
  static char line[512];
  snprintf(line, sizeof line, "TRACE walked ok %d wok %d cmp %d key %d %s | line play %d lost %d outside %d spends %d ready %d readyNext %d | walked play %d lost %d outside %d spends %d ready %d readyNext %d", ok, wok, cmp, key, why ? why : "-",
           J->k.play, J->o.lostAt, J->outside, J->spends, J->o.ready, J->readyNext, JW->k.play, JW->o.lostAt, JW->outside, JW->spends, JW->o.ready, JW->readyNext);
  hostLog(line);
}

// AN EXHAUSTIVE SOLVER, no search of the bot's: every legal swap pressed where the cursor stands (no walk), the board let settle (the
// queue landing on its idle frames as the game lands it), to `depth` swaps deep, until a block is converted (sBroke) -- the oracle the
// death boards are held to. Returns the depth of the line found into `line` (swaps as row * 8 + col), 0 none within the depth, -1 the
// time ran out. The frames the longest-lived line survived left alone after it are in *best.
static Board *solveB[10];
static int32_t solveBest;
static int solveDfs(const Board *b, int depth, int32_t *line, int n, double due) {
  if (depth <= 0) return 0;
  if (nowMs() > due) return -1;
  int32_t ms[MAXROWS * W]; int nm = legalSwaps((Board *)b, ms);
  if (!solveB[n]) solveB[n] = nb_new();
  Board *t = solveB[n];
  for (int i = 0; i < nm; i++) {
    cloneBoard(t, b);
    t->curRow = CR(ms[i]); t->curCol = CC(ms[i]);
    if (!tryQueueSwap(t, CR(ms[i]), CC(ms[i]))) continue;
    t->sBroke = 0;
    int f = 0;
    for (; f < 600 && t->gameOverClock <= 0; f++) { t->input = 0; t->pressSwap = 0; run(t); if (t->sBroke > 0) break; if (f >= 24 && !boardMoving(t)) break; }
    line[n] = ms[i];
    if (t->sBroke > 0) return n + 1;
    if (t->gameOverClock > 0) continue;
    if (f > solveBest) solveBest = f;
    int r = solveDfs(t, depth - 1, line, n + 1, due);
    if (r) return r;
  }
  return 0;
}
EXPORT(gb_solve) int gb_solve(int depth, int ms, int32_t *line, int32_t *best) {
  solveBest = 0;
  int r = 0;
  for (int d = 1; d <= depth && !r; d++) r = solveDfs(hostBoard, d, line, 0, nowMs() + ms);
  *best = solveBest;
  return r;
}

// THE BEAM SOLVER, the death boards' oracle: lines of swaps pressed back to back as the frame loop presses them (core/nodes.h step,
// MK_SWAP: the cursor walked, the swap pressed, the next pressed as soon as it can be -- a board kept busy lands nothing), every legal swap
// from every board kept, the boards kept ranked by their shape for a FLATTEN, not by the bot's nearness to a break: fewer empty cells
// under garbage, more columns touching it, a lower peak, an evener stack. Each line asked after every swap: let settle, has it broken
// garbage the board alone does not? The line found into `line` (row * 8 + col), its length returned; 0 none within depth, -1 the clock.
static uint32_t solveKey(const Board *b) {
  uint32_t h = 2166136261u;
  for (int r = 1; r < b->nrows && r <= b->height + 1; r++) for (int c = 1; c <= W; c++) {
    const int32_t *f = b->p[r][c].f; uint32_t v = f[ISGARBAGE] ? 99u + (uint32_t)(f[GARBAGEID] & 63) : (uint32_t)(f[COLOR] > 0 ? f[COLOR] : 0);
    h = (h ^ v) * 16777619u; }
  h = (h ^ (uint32_t)b->curRow) * 16777619u; h = (h ^ (uint32_t)b->curCol) * 16777619u;
  return h;
}
static int32_t solveShape(const Board *b) {
  static LOCAL BoardShape SS; static LOCAL Bits SB;
  bitsOf(b, &SB); bitsShape(&SB, &SS);
  return -(imin(SS.hollow, 255) << 20) + (imin(SS.contact, 15) << 16) - (imin(SS.top, 63) << 8) - imin(SS.even, 255);
}
#define SOLVE_BEAM 1500
// (COLLECTING, gb_solve_collect: every distinct break line found is kept, up to SOLVE_KEEP, and the search goes on to the end of its depth
// or its time -- the breaks to choose among, each asked for a follow-up by the caller)
#define SOLVE_KEEP 8
static int32_t solveCollect, solveNKept, solveKeptN[SOLVE_KEEP], solveKept[SOLVE_KEEP][16];
EXPORT(gb_solve2) int gb_solve2(int depth, int beam, int ms, int32_t *line, int32_t *expanded) {
  static Ctx *sx; sx = ctxOf(sx);
  Question q = hostQ; q.b = hostBoard;
  curQid = abortId + 1; clockNowOf = 0; clockFrameOut = 0;   // (the host's abort not in force, the wall clock: as gb_replay asks)
  gb_clock_start(nowMs() + ms);
  int root = rootOf(sx, &q);
  if (root < 0) return -2;
  int a0 = settleOf(sx, root); int32_t brk0 = liveNode(sx, a0) ? NODE(sx, a0)->brk : NODE(sx, root)->brk;
  static int32_t cur[SOLVE_BEAM], nxt[SOLVE_BEAM * 40], par[SOLVE_BEAM * 40], mv[SOLVE_BEAM * 40], sc[SOLVE_BEAM * 40];
  static int32_t hist[16][SOLVE_BEAM][2];   // (per depth, each kept node's parent slot and move: the line read back)
  static uint32_t seen[1 << 16]; memset(seen, 0, sizeof seen);
  if (beam > SOLVE_BEAM) beam = SOLVE_BEAM; if (depth > 16) depth = 16;
  static int32_t curMv[SOLVE_BEAM], curFrom[SOLVE_BEAM];   // (each kept node's own swap and the node it was pressed on: the put-back rule)
  int ncur = 1; cur[0] = root; curMv[0] = 0; curFrom[0] = -1; *expanded = 0;
  for (int d = 0; d < depth; d++) {
    int nn = 0;
    for (int i = 0; i < ncur; i++) {
      Board *b = ensureBoard(sx, cur[i]); if (!b) continue;
      int32_t ms2[MAXROWS * W]; int nm = legalSwaps(b, ms2);
      for (int k = 0; k < nm && nn < SOLVE_BEAM * 40; k++) {
        if (clockOut()) return -1;
        // (the owner's rule, rules.c putBackFor: the pair the last swap swapped is never put back for nothing)
        if (curFrom[i] >= 0 && ms2[k] == curMv[i] && NODE(sx, cur[i])->cleared == NODE(sx, curFrom[i])->cleared && NODE(sx, cur[i])->brk == NODE(sx, curFrom[i])->brk) continue;
        int c = step(sx, cur[i], MK_SWAP, CR(ms2[k]), CC(ms2[k]), 0); (*expanded)++;
        if (!liveNode(sx, c)) continue;
        int st = settleOf(sx, c);
        if (liveNode(sx, st) && NODE(sx, st)->brk > brk0) {
          // (found: the line read back through the kept parents)
          int L = d + 1; line[d] = ms2[k];
          for (int dd = d - 1, slot = i; dd >= 0; dd--) { line[dd] = hist[dd + 1][slot][1]; slot = hist[dd + 1][slot][0]; }
          if (!solveCollect) return L;
          if (solveNKept < SOLVE_KEEP && L <= 16) { int q = solveNKept++; solveKeptN[q] = L; for (int z = 0; z < L; z++) solveKept[q][z] = line[z]; }
          if (solveNKept >= SOLVE_KEEP) return L;
          continue;
        }
        Board *cb = ensureBoard(sx, c); if (!cb) continue;
        uint32_t key = solveKey(cb), slot = key & 0xffff;
        if (seen[slot] == key) continue; seen[slot] = key;
        nxt[nn] = c; par[nn] = i; mv[nn] = ms2[k]; sc[nn] = solveShape(cb); nn++;
      }
    }
    if (!nn) return 0;
    // (the beam kept: the best shapes, by a partial selection)
    int keep = nn < beam ? nn : beam;
    for (int a = 0; a < keep; a++) { int best = a; for (int z = a + 1; z < nn; z++) if (sc[z] > sc[best]) best = z;
      int32_t t; t = nxt[a]; nxt[a] = nxt[best]; nxt[best] = t; t = par[a]; par[a] = par[best]; par[best] = t; t = mv[a]; mv[a] = mv[best]; mv[best] = t; t = sc[a]; sc[a] = sc[best]; sc[best] = t; }
    { static int32_t prevNode[SOLVE_BEAM]; for (int a = 0; a < ncur; a++) prevNode[a] = cur[a];
      for (int a = 0; a < keep; a++) { curFrom[a] = prevNode[par[a]]; curMv[a] = mv[a]; cur[a] = nxt[a]; hist[d + 1][a][0] = par[a]; hist[d + 1][a][1] = mv[a]; } }
    ncur = keep;
  }
  return 0;
}

static int getenv_test(void) { return traceOn; }
// THE QUESTION'S BOARD, a row a line from the top: a panel its colour, garbage G (g matched, its colour once shown, g? not yet), an
// empty cell '.' -- what the search was asked on, the colours a pop has not shown left unshown
EXPORT(gb_board_show) void gb_board_show(char *out, int cap) {
  const Board *b = hostQ.b; int k = 0;
  for (int r = b->nrows - 1; r >= 1 && k < cap - 40; r--) {
    k += snprintf(out + k, (unsigned long)(cap - k), "%2d ", r);
    for (int c = 1; c <= W; c++) {
      const int32_t *f = b->p[r][c].f;
      if (f[ISGARBAGE]) k += snprintf(out + k, (unsigned long)(cap - k), f[STATE] == MATCHED ? (f[COLOR] >= 1 && f[COLOR] <= 8 ? "g%d " : "g? ") : "G  ", f[COLOR]);
      else if (f[COLOR] > 0) k += snprintf(out + k, (unsigned long)(cap - k), "%d%c ", f[COLOR], f[STATE] == MATCHED ? '*' : ' ');
      else k += snprintf(out + k, (unsigned long)(cap - k), ".  ");
    }
    k += snprintf(out + k, (unsigned long)(cap - k), "\n");
  }
}
// THE BOT'S OWN BREAK SEARCH on a board (search/break.c breakMoves, as the reach report asks it: no list, the clock `ms`), with the touch
// beam's switches: the line's length returned, its swaps into line; 0 none
EXPORT(gb_break_test) int gb_break_test(int ms, int noBand, int noDoomed, int beam, int open, int32_t *line) {
  tbNoBand = noBand; tbNoDoomed = noDoomed; tbBeam = beam;
  breakOpen = open;   // (the open search: no list, no wasted-three rule -- search/break.c breakOpen)
  curQid = abortId + 1; clockNowOf = 0; clockFrameOut = 0;
  gb_list_on(0); gb_decision_on(-1, 0, 1);
  gb_clock_start(nowMs() + ms);
  // (GC_BREAK_WAIT: the frames a popping slab has left, as the decision hands them -- the line-ups searched first)
  extern char *getenv(const char *); const char *bw = getenv("GC_BREAK_WAIT");
  static Broke br; breakMoves(&hostQ, bw ? atoi(bw) : 0, 0, &br);
  if (bw) { extern int printf(const char *, ...); printf("[lineup %d nmoves %d] ", br.lineup, br.nmoves); }
  if (getenv_test()) { static char l[256]; snprintf(l, sizeof l, "BREAKTEST depth %d nmoves %d pathLen %d towardLen %d touch %d built %d lowestG %d gridLen %d clockOut %d", br.depth, br.nmoves, br.pathLen, br.towardLen, br.touch, br.built, lowestG(hostQ.b), gridLen(hostQ.b), clockOut()); hostLog(l); }
  tbNoBand = tbNoDoomed = tbBeam = 0; breakOpen = 0;
  if (!br.depth) return 0;
  if (br.pathLen > 0) { for (int i = 0; i < br.pathLen; i++) line[i] = br.path[i]; return br.pathLen; }
  line[0] = br.moves[0]; return 1;
}

// A LINE HANDED TO THE BOT'S JUDGE on the host's question (outcome.c outcome, as every search's line check asks it): what it says
EXPORT(gb_line_verdict) void gb_line_verdict(const int32_t *seq, int n, char *out, int cap) {
  curQid = abortId + 1; clockNowOf = 0; clockFrameOut = 0;
  gb_list_on(0); gb_decision_on(-1, 0, 1); gb_clock_start(nowMs() + 2000);
  decQ = hostQ;
  Outcome o = outcomeOf(seq, n, 0, 0, 0);
  const Judged *j = &o.j;
  int k = snprintf(out, (unsigned long)cap, "dead %d late %d cut %d why %d broke %d threes %d fell %d combo %d chain %d lost %d lives %d ok %d okNoWaste %d", j->dead, j->late, j->cut, j->cutWhy, j->made.broke, j->threes, 0, j->made.combo, j->made.chain, o.lostAt, o.lives, lineOk(&o, CHECK_WASTE | CHECK_LIST), lineOk(&o, 0));
  // (and the frames its swaps were pressed on, as the judge pressed them)
  for (int i = 0; i < j->nats && k < cap - 12; i++) k += snprintf(out + k, (unsigned long)(cap - k), "%s%d", i ? "/" : " ats ", j->ats[i]);
}

// ONE SWAP THROUGH THE SEARCH'S BREAK TEST, stage by stage (search/break.c breaksAt): what it reads at the swap's frame and settled
EXPORT(gb_break_trace) void gb_break_trace(int32_t mv, char *out, int cap) {
  curQid = abortId + 1; clockNowOf = 0; clockFrameOut = 0;
  gb_list_on(0); gb_decision_on(-1, 0, 1); gb_clock_start(nowMs() + 2000);
  static Ctx *tx; tx = ctxOf(tx);
  int root = rootOf(tx, &hostQ);
  int n = step(tx, root, MK_SWAP, CR(mv), CC(mv), 0);
  int z = liveNode(tx, n) ? settleOf(tx, n) : -1;
  int32_t tn = liveNode(tx, n) ? NODE(tx, n)->t : -1, tz = liveNode(tx, z) ? NODE(tx, z)->t : -1;
  int32_t bn = liveNode(tx, n) ? NODE(tx, n)->brk : -1, bz = liveNode(tx, z) ? NODE(tx, z)->brk : -1;
  int32_t an = tn >= 0 ? aloneBrokeAt(tx, root, tn) : -1, az = tz >= 0 ? aloneBrokeAt(tx, root, tz) : -1;
  const Board *nb = liveNode(tx, n) ? ensureBoard(tx, n) : 0;
  int moving = nb ? boardMoving(nb) : -1;
  int fits = liveNode(tx, z) ? stepFitsAt(tx, z) : -1, first = liveNode(tx, n) ? firstOk(CR(mv), CC(mv), madeBy(tx, n, root)) : -1;
  decQ = hostQ;
  int chk = lineCheckOn(&decQ, &mv, 1, 0, CHECK_WASTE);
  snprintf(out, (unsigned long)cap, "root brk %d | swap node t %d brk %d alone %d moving %d | settled t %d brk %d alone %d | stepFits %d firstOk %d lineCheck %d", NODE(tx, root)->brk, tn, bn, an, moving, tz, bz, az, fits, first, chk);
}

// A LINE THROUGH THE SEARCH'S EYES, swap by swap: each swap's node as the touch beam grows it (MK_SWAP, back to back), what it reads there
// (broken against the board alone, moving), the board settled from it, and the beam's key for it (nearScore)
EXPORT(gb_line_trace) void gb_line_trace(const int32_t *seq, int n, char *out, int cap) {
  curQid = abortId + 1; clockNowOf = 0; clockFrameOut = 0;
  gb_list_on(0); gb_decision_on(-1, 0, 1); gb_clock_start(nowMs() + 2000);
  static Ctx *tx; tx = ctxOf(tx);
  int node = rootOf(tx, &hostQ), root = node, k = 0;
  k += snprintf(out + k, (unsigned long)(cap - k), "root key %d lowestG %d gridLen %d;", nearScore(ensureBoard(tx, root)), lowestG(hostQ.b), gridLen(hostQ.b));
  for (int i = 0; i < n && k < cap - 200; i++) {
    int c = step(tx, node, MK_SWAP, CR(seq[i]), CC(seq[i]), 0);
    if (!liveNode(tx, c)) { k += snprintf(out + k, (unsigned long)(cap - k), " %d,%d dead", CR(seq[i]), CC(seq[i])); break; }
    int z = settleOf(tx, c);
    k += snprintf(out + k, (unsigned long)(cap - k), " %d,%d: t %d brk %d/%d key %d | settled t %d brk %d/%d key %d;", CR(seq[i]), CC(seq[i]), NODE(tx, c)->t, NODE(tx, c)->brk, aloneBrokeAt(tx, root, NODE(tx, c)->t), nearScore(ensureBoard(tx, c)),
                  liveNode(tx, z) ? NODE(tx, z)->t : -1, liveNode(tx, z) ? NODE(tx, z)->brk : -1, liveNode(tx, z) ? aloneBrokeAt(tx, root, NODE(tx, z)->t) : -1, liveNode(tx, z) ? nearScore(ensureBoard(tx, z)) : 0);
    node = c;
  }
}

// EVERY BREAK AND ITS FOLLOW-UP: the beam solver collecting up to SOLVE_KEEP break lines; each played on the engine from the question
// (pressed back to back, then settled), the board it leaves made the question, and the solver asked again on it. out: per break, its
// length, its swaps, and its follow-up's length (0 none, -1 the time). Returns the breaks found.
EXPORT(gb_solve_two) int gb_solve_two(int depth, int beam, int ms, int32_t *out) {
  solveCollect = 1; solveNKept = 0;
  int32_t line[16], ex = 0;
  gb_solve2(depth, beam, ms, line, &ex);
  solveCollect = 0;
  int nk = solveNKept, k = 0;
  static int32_t keptN[SOLVE_KEEP], kept[SOLVE_KEEP][16];
  for (int q = 0; q < nk; q++) { keptN[q] = solveKeptN[q]; for (int z = 0; z < keptN[q]; z++) kept[q][z] = solveKept[q][z]; }
  static Board *keep; if (!keep) keep = nb_new();
  cloneBoard(keep, hostBoard); Question kq = hostQ;
  for (int q = 0; q < nk; q++) {
    static Ctx *px; px = ctxOf(px);
    hostQ = kq; hostQ.b = hostBoard; cloneBoard(hostBoard, keep);
    curQid = abortId + 1; gb_clock_start(nowMs() + 2000);
    int node = rootOf(px, &hostQ);
    for (int z = 0; z < keptN[q] && liveNode(px, node); z++) node = step(px, node, MK_SWAP, CR(kept[q][z]), CC(kept[q][z]), 0);
    int st = liveNode(px, node) ? settleOf(px, node) : -1;
    // (a break that leaves no garbage on the board leaves the next one to the next block: the board left idle until a block has landed on
    // it, then settled -- the follow-up is asked of that board, never of one with nothing to break)
    for (int w = 0; w < 20 && liveNode(px, st); w++) {
      const Board *sb = ensureBoard(px, st);
      if (!sb || garbageOn(sb)) break;
      int nx = step(px, st, MK_LONG, 0, 0, 20);
      if (!liveNode(px, nx)) { st = nx; break; }
      st = settleOf(px, nx); if (!liveNode(px, st)) st = nx;
    }
    int follow = 0;
    if (liveNode(px, st)) {
      Board *eb = ensureBoard(px, st); int32_t t = NODE(px, st)->t;
      cloneBoard(hostBoard, eb); hostQ.b = hostBoard; hostQ.narr = 0;
      for (int a = 0; a < kq.narr; a++) if (kq.arr[a].at > t) { hostQ.arr[hostQ.narr] = kq.arr[a]; hostQ.arr[hostQ.narr++].at -= t; }
      int32_t l2[16], e2 = 0;
      follow = gb_solve2(depth, beam, ms, l2, &e2);
    } else follow = -2;
    out[k++] = keptN[q]; for (int z = 0; z < keptN[q]; z++) out[k++] = kept[q][z]; out[k++] = follow;
  }
  hostQ = kq; hostQ.b = hostBoard; cloneBoard(hostBoard, keep);
  return nk;
}

// THE INPUT WINDOW A DUMPED BOARD WAS DECIDED UNDER (native.c dumpBoard, W<len>:<ages>): loaded with its allowance for a replay of that
// decision; n -1 lets it go
EXPORT(gb_window) void gb_window(int len, int n, const int32_t *ages) {
  if (n < 0) { nWinAges = -1; hostWin = 0; return; }
  winLen = len; nWinAges = n < WINMAX ? n : WINMAX; for (int i = 0; i < nWinAges; i++) winAges[i] = ages[i]; hostWin = 1;
}
