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
static int32_t replayLast[8];
EXPORT(gb_replay_last) void gb_replay_last(int32_t *v) { for (int i = 0; i < 8; i++) v[i] = replayLast[i]; }
// A LOW STACK (gb_replay_low KEEP, before a replay): the question's board cut to its bottom KEEP rows, nothing queued or on its way --
// refused (-2) when those rows hold garbage or anything not at rest
static int32_t replayLow;
EXPORT(gb_replay_low) void gb_replay_low(int keep) { replayLow = keep; }
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
  answerQuestion(1, 0, topped, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, replayLow && canRaiseOn(hostBoard), due, t0, 0);   // (the raise asked of a low stack only)
  clockNowOf = 0;
  const Answer *A = &theAnswer;
  replayLast[0] = A->d.kind; replayLast[1] = A->verdict; replayLast[2] = A->nlive; replayLast[3] = garbageOn(hostBoard);
  replayLast[4] = hostQ.narr; replayLast[5] = fullTop(hostBoard); replayLast[6] = theTables.raiseTo; replayLast[7] = A->d.kind == 2 ? A->raiseNow : 0;
  int k = snprintf(out, (unsigned long)cap, "move %d %d,%d play %d live %d/%d |", A->d.kind, A->d.move ? CR(A->d.move) : 0, A->d.move ? CC(A->d.move) : 0,
                   A->play, A->nlive, A->ncands);
  // (the chain the board makes left alone and the one it makes with the line played, where the board is making one)
  if (aloneChain > 1) k += snprintf(out + k, (unsigned long)(cap - k), " own %d/%d", aloneChain, A->whole >= 0 ? A->whole : aloneChain);
  for (int i = 0; i < 3 && i < A->ncands && k < cap - 160; i++) {
    const Judge *J = order[i];
    k += snprintf(out + k, (unsigned long)(cap - k), " %d:%d,%d,%d,%d,%d,%d,%d,t%d", J->hold ? PLAY_HOLD : J->k.play, J->o.lives, J->o.lostAt, J->outside,
                  J->met, J->material, J->saving, J->o.lifeLeft, tierView(J).tier);
  }
  return k;
}
// SWITCHING'S DIRECTIONS (answer.c gb_switch_game): over `games` games of `frames` frames each, how often each ordered pair of the
// attack rules is switched between -- into counts (n x n, by the rules' order), the pairs never switched between returned
EXPORT(gb_switch_check) int gb_switch_check(int games, int frames, int min, int max, int32_t *counts, int *nrules) {
  int32_t idx[MAXRULES], nr = 0;
  for (int i = 0; i < theTables.n && nr < MAXRULES; i++) if (theTables.r[i].table == 1) idx[nr++] = theTables.r[i].name;
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
static int32_t framesR2, framesC2, framesAt2;   // (a second swap, pressed from the frame framesAt2: gb_frames2)
static int32_t framesAskAt = -1; static Board *framesAsk;   // (the board kept at framesAskAt, for gb_frames_ask)
EXPORT(gb_frames_keep) void gb_frames_keep(int at) { framesAskAt = at; }
EXPORT(gb_frames2) void gb_frames2(int r, int c, int at) { framesR2 = r; framesC2 = c; framesAt2 = at; }
EXPORT(gb_frames) int gb_frames(int mr, int mc, int frames, int32_t *out) {
  static Ctx *fx; fx = ctxOf(fx);
  curQid = abortId + 1; clockNowOf = 0; clockFrameOut = 0; clockStart(0);
  int n = rootOf(fx, &hostQ);
  if (n < 0) return -1;
  if (mr) { int from; n = pressWalk(fx, n, MK_SWAP, mr, mc, stepTapped, &from); if (!liveNode(fx, n)) return -2; }
  int k = 0, clears = 0;
  for (int f = 0; f < frames; f++) {
    int w;
    if (framesR2 && NODE(fx, n)->t >= framesAt2) { int from; w = pressWalk(fx, n, MK_SWAP, framesR2, framesC2, stepTapped, &from); framesR2 = 0; }
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
