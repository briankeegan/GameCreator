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
  answerQuestion(1, 0, topped, 0, 0, 0, 0, 0, 0, replayAllow >= 0, imax(0, replayAllow), -1, 0, (replayLow || replayRaise) && canRaiseOn(hostBoard), due, t0, 0);
  hostTaps = taps;   // (the raise asked of a low stack only)
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
  frontNew(cfgReaction, 90, -1, 0);
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
  pressTap = decTap = tap; decQ.tight = tightAt(allow); pressTight = decQ.tight; pressAllowance = allow;
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
