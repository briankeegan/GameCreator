// GAMBIT'S DECISION (plans/decision.md): read the board, propose, judge, rank, play -- in that order, once a decision.

// THE QUESTION'S OWN FACTS from the host (answer.c gb_answer): the enemy as the host sends it, whether a raise may begin
typedef struct { int32_t has, out, topKnown, top, stopKnown, stop; } Opp;
static Opp theOpp;
static int32_t canRaiseNow, gambitHit, modeRule = -1, hostTopped, surviveAsked;
static int32_t openerOver;   // (the opener played out: a board has topped out this game)

// 1. READ: the facts of both boards, the mode and its list, the deadline, the floor every line keeps
#define RAISE_MS 150
static int32_t raiseRefill;   // (the raise asked is the floor's, not the opening's: answer.c lets nothing go before it)
static int32_t refillAsked, refillReady, refillAlive;   // (the floor's raise: the rows asked, ready, alive -- the log's)
static int32_t raiseWait; static Board *raiseWaitBoard;   // (the floor's raise put off to the frame the stack takes one, and that board)
#define LOW_ROWS 6   // a stack under this many rows of panels is raised (the floor's raise)
#define RAISE_WAIT 120   // the frames the floor's raise waits for the stack to take one, at most
// THE FLOOR A LINE'S BOARD KEEPS, as the rule in force tests it (facts.c keepsFloor, the line's breaks aside): outcome.c asks it of the
// board every line ends on
static Keep floorKeep; static int32_t floorKeepOn;
// THE FLOOR, the one test (outcome.c spendsFloor reads it of the board a line leaves): the rules' keep (facts.c keepsFloor), and while the
// owner's saving band holds -- begun topped with four rows' worth of panels or fewer, kept until the board holds eight rows' worth and
// the panels sure to make the list's largest combo ((size - 1) x colours and one) -- the band's top too. 1 kept, 0 not, -1 no floor.
static int32_t savingPanels, bandTop;   // (the band across decisions; a new game ends it -- gb_new_game)
// LOW ON PANELS, the ledger's test (rank.c rankLow): under the rules' material floor (the keep's material test alone), or in the saving
// band below its top -- the height and the evenness the floor also tests are no shortage of panels
static int lowOnPanels(const Board *b) {
  if (savingPanels && panelsOn(b) < bandTop) return 1;
  if (!floorKeepOn || !floorKeep.t[KEEP_MATERIAL].op) return 0;
  int32_t h, m, e; endFacts(b, &h, &m, &e);
  return !test(m, floorKeep.t[KEEP_MATERIAL]);
}
static int decisionFloor(const Board *b) {
  if (savingPanels && panelsOn(b) < bandTop) return 0;
  return floorKeepOn ? keepsFloor(&floorKeep, b, 0) : -1;
}
static int readBoard_(Read *R) {
  memset(R, 0, sizeof *R);
  FactSet *F = &R->F;
  factsOf(decQ.b, decQ.arr, decQ.narr, hostTopped, F);
  // (what every outcome reads of them: when the last block shown lands, and topped -- JUDGE.lastLanding, R.F.us.topped)
  decF.topped = !!F->v[FACT_US_TOPPED];
  decF.land = NOT_ASKED;
  for (int i = 0; i < decQ.narr; i++) if (decF.land == NOT_ASKED || decQ.arr[i].at > decF.land) decF.land = decQ.arr[i].at;
  if (decF.land == NOT_ASKED && F->known[FACT_US_NEXTLANDS]) decF.land = (int32_t)F->v[FACT_US_NEXTLANDS];
  decF.next = F->known[FACT_US_NEXTLANDS] ? (int32_t)F->v[FACT_US_NEXTLANDS] : NOT_ASKED;
  landingAt = decF.next != NOT_ASKED ? decF.next : -1;   // (the window plan's landing: core/nodes.h windowKeepsBreak)
  nextBlkSeen(&decQ);   // (the biggest block the mode has sent this game: what a proof must be ready for, core/nodes.h)
  // (and the breaks every block on its way is due, soonest first: a row each -- a break converts one -- the first as it lands, the next a
  // break's time after; the next landing with no block shown, one)
  nLandAts = 0;
  int32_t landBlk[LANDN];   // (the block each due is of: -1 the next landing with none shown)
  { int32_t shown = 0;
    for (int i = 0; i < decQ.narr; i++) shown |= decQ.arr[i].at == landingAt;
    if (landingAt >= 0 && !shown) { landBlk[nLandAts] = -1; landAts[nLandAts++] = landingAt; }
    // (each row of a block shown is due a break's time after the one before: the time its own row takes to pop -- its width's cells)
    for (int i = 0; i < decQ.narr; i++) for (int r = 0; r < imax(1, decQ.arr[i].height) && nLandAts < LANDN; r++) {
      int32_t gap = C2.reaction + 1 + popFrames(decQ.b, decQ.arr[i].width > 0 ? decQ.arr[i].width : W);
      int32_t a = decQ.arr[i].at + r * gap; int k = nLandAts++;
      while (k > 0 && landAts[k - 1] > a) { landAts[k] = landAts[k - 1]; landBlk[k] = landBlk[k - 1]; k--; }
      landAts[k] = a; landBlk[k] = i;
    } }
  // (and its walk: the nearest break's on this board by the shape math, two actions a swap -- a swap and a cell -- with the swap that
  // breaks; nothing on the board yet, a break's walk as measured)
  // (a break's walk measured on the board as it is; with none on it to measure, the last one measured this game -- LAND_RESERVE only
  // before the first)
  { int32_t w = garbageOn(decQ.b) ? walkOfBoard(decQ.b) : -1; if (w > 0) breakWalk = w; }
  // (and each due's walk: the nearest break's on the board its block lands on -- the board left alone run to that landing and settled.
  // A row's break is pressed on the board its block lands on, and that walk, not this board's, is what the window keeps for it; a due
  // with no block shown, or a board lost or bare by then, asks this board's)
  for (int k = 0; k < nLandAts; k++) landWalk[k] = 0;
  if (nLandAts && decQ.narr) {
    static Ctx *dueCtx; dueCtx = ctxOf(dueCtx);
    int root = dueCtx ? rootOf(dueCtx, &decQ) : -1;
    int32_t blkWalk[64]; int nb = imin(decQ.narr, 64);
    for (int i = 0; i < nb; i++) {
      blkWalk[i] = 0;
      if (root < 0 || decQ.arr[i].at <= 0) continue;
      int land = step(dueCtx, root, MK_LONG, 0, 0, decQ.arr[i].at);
      if (!liveNode(dueCtx, land)) continue;
      int calm = settleOf(dueCtx, land); if (liveNode(dueCtx, calm)) land = calm;
      const Board *lb = ensureBoard(dueCtx, land);
      int32_t w = lb && garbageOn(lb) ? walkOfBoard(lb) : -1;
      if (w > 0) blkWalk[i] = w;
    }
    for (int k = 0; k < nLandAts; k++) if (landBlk[k] >= 0 && landBlk[k] < nb) landWalk[k] = blkWalk[landBlk[k]];
  }
  if (theOpp.has) { factSet(F, FACT_ENEMY_TOPPED, !!theOpp.out); if (theOpp.topKnown) factSet(F, FACT_ENEMY_HEIGHT, theOpp.top); if (theOpp.stopKnown) factSet(F, FACT_ENEMY_STOP, theOpp.stop); }
  // (no enemy board to read -- time attack, nobody across: the rules' `enemy.none`)
  factSet(F, FACT_ENEMY_NONE, !theOpp.has);
  R->enemyTopped = theOpp.has && theOpp.out;
  // (the frames until the board is lost if nothing is done, from the engine with the garbage the game shows landing when it lands:
  // sooner than the rise alone takes, the garbage on its way decides it -- queueKills)
  int32_t alone = diesIn(&decQ, F->v[FACT_US_DIES]);
  if (alone >= 0 && alone < F->v[FACT_US_DIES]) { factSet(F, FACT_US_QUEUEKILLS, 1); F->v[FACT_US_DIES] = alone; }
  // (the rule: the mode in force, else the first whose `when` the facts hold -- with no opponent to read, the rule asking `enemy.none`;
  // else the first of the rules, so a board with nobody across still plays)
  // (THE OPENER: from the game's start until either board tops out, the opener's rule, whatever the mode -- big chains for the pressure
  // from the start; then the mode's)
  if (F->v[FACT_US_TOPPED] || (theOpp.has && theOpp.out)) openerOver = 1;
  int oi = -1;
  for (int i = 0; i < theTables.n && oi < 0 && !openerOver; i++) if (theTables.r[i].table == 2) oi = i;
  int ri = oi >= 0 ? oi : modeRule >= 0 ? namedRule(modeRule) : chooseRule(F);
  if (ri < 0 && !theOpp.has && theTables.n > 0) ri = 0;
  if (ri < 0) return 0;
  const Rule *rule = &theTables.r[ri];
  R->rule = ri;
  R->keep = rule->keep.on ? rule->keep : theTables.keep; R->keepOn = R->keep.on;
  floorKeep = R->keep; floorKeepOn = R->keepOn; floorOf = decisionFloor;
  R->list = rule->list; R->end = rule->end;
  R->guides = R->list;
  R->by = deadlineOf(F, rule);
  // (the owner's band, begun and ended on the board as it is)
  {
    int32_t colours = decQ.b->colors > 0 ? decQ.b->colors : 1, panels = panelsOn(decQ.b), big = 3;
    for (int i = 0; i < R->list.n; i++) { const Test *t = &R->list.aim[i].combo; if (t->op == OP_GE || t->op == OP_EQ || t->op == OP_GT) big = imax(big, t->n + (t->op == OP_GT)); }
    bandTop = imax((big - 1) * colours + 1, 8 * W);
    if (!savingPanels && F->v[FACT_US_TOPPED] && panels <= 4 * W) savingPanels = 1;
    else if (savingPanels && panels >= bandTop) savingPanels = 0;
  }
  // (the board as it is under the floor, by the one floor test: decisionFloor)
  R->belowFloor = decisionFloor(decQ.b) == 0;
  theList = R->list; listOn = 1;
  // (garbage on the board: the search asks every entry to break it too; garbage on it or topped out, the deadline is a break's -- before
  // the board dies; the rule's `by` is an attack's)
  R->under = !theTables.underIgnore && F->known[FACT_US_CONTACT];
  if (R->under) { for (int i = 0; i < R->guides.n; i++) R->guides.aim[i].brk = 1; R->end = 1; }
  decF.under = R->under;
  // (and after its entries, the one rule's three that breaks (rules.c withRule): the list as the board asks it, the searches' and the
  // rank's alike)
  if (R->under) guideShort(&R->guides);
  if (R->under) withRule(&R->guides);
  if (R->under) withAttacks(&R->guides, &R->list);
  R->asked = R->guides;
  // (A LIST ENDED BY "default" -- every list under garbage -- falls back to the default's own move when none of it can be made: the
  // break search looks off it when it finds no break within it (breakSearch), the searches that aim keep to it, and the order takes a
  // line off it only by living where nothing within it does)
  R->topped = !!F->v[FACT_US_TOPPED]; R->breakWaits = !!F->v[FACT_US_BREAKWAITS];
  if (R->under || R->topped) R->by = NOT_ASKED;
  // (ready: garbage on its way and none on the board -- the frames until the next block lands, 0 for one queued to drop once settled)
  R->readyAt = NOT_ASKED;
  if (!R->under) { for (int i = 0; i < decQ.narr; i++) if (R->readyAt == NOT_ASKED || decQ.arr[i].at < R->readyAt) R->readyAt = decQ.arr[i].at; if (R->readyAt == NOT_ASKED && decQ.b->ninc) R->readyAt = 0; }
  // (the opening raise: until garbage first reaches the board, below `to` rows and no chain running -- and after it, the rules' material
  // floor kept by raising, a reserve: below it, not topped, the panels under `to` -- garbage on them aside, a slab is no panel to break
  // with -- the rows the next break is made of brought in)
  int32_t to = rule->raiseTo ? rule->raiseTo : theTables.raiseTo;
  int opening = !gambitHit && !F->known[FACT_US_CONTACT] && !R->topped;
  // (and A LOW STACK: under LOW_ROWS rows of panels, not topped, it is raised all the same -- the owner's rule: below six rows, raise high)
  int refill = !opening && (R->belowFloor || panelTop(decQ.b) < LOW_ROWS) && !R->topped;
  raiseRefill = refill;
  int32_t rowsUp = to - (opening ? fullTop(decQ.b) : panelTop(decQ.b));
  R->low = to && (opening || refill) && rowsUp > 0; R->up = R->low && !cascadeLive(decQ.b) && canRaiseNow;
  refillAsked = refillReady = refillAlive = 0; raiseWait = 0;
  // (THE FLOOR'S RAISE, TIMED: a board busy now -- a cascade, panels moving, the shake -- is one the engine would not raise; it is run on,
  // left alone with the garbage shown landing as the game lands it, to the first frame it would (search/ready.c raiseOpenIn), and the
  // raise is judged on that board and pressed then)
  Question rq = decQ;
  if (refill && R->low && !R->up && !clockOut()) {
    if (!raiseWaitBoard) raiseWaitBoard = nb_new();
    int32_t w = raiseWaitBoard ? raiseOpenIn(&decQ, RAISE_WAIT, raiseWaitBoard) : NOT_ASKED;
    if (w > 0) {
      rq.b = raiseWaitBoard; rq.holdLeft = 0; rq.holdStarted = 0;
      rq.narr = 0; for (int i = 0; i < decQ.narr; i++) if (decQ.arr[i].at > w) { rq.arr[rq.narr] = decQ.arr[i]; rq.arr[rq.narr++].at -= w; }
      rowsUp = to - panelTop(raiseWaitBoard);
      if (rowsUp > 0) { R->up = 1; raiseWait = w; }
    }
    if (!R->up) refillAsked = -(w == NOT_ASKED ? 1 : 2);   // (asked, and the stack takes no raise within RAISE_WAIT: -1, or nothing to raise once it does: -2)
  }
  // (the raise is held for as many rows as leave the board a plan once everything the game shows has landed -- and alive while they rise)
  if (R->up) {
    double l = timeLeftMs(); if (l < 1) l = 1;
    int32_t rows = raiseReady(&rq, rowsUp, l < RAISE_MS ? l : RAISE_MS);
    // (THE FLOOR'S RAISE ON A BOARD TOO SHORT TO BREAK: below the floor, no row count leaves a break once everything lands -- the panels
    // a break is made of are what the board lacks -- so the rows the board lives through once everything lands are raised all the same:
    // the panels are the next break's material, and the opening's raise is held to readiness, never the floor's)
    refillAsked = refill ? rowsUp : 0; refillReady = rows; refillAlive = raiseAlive;
    if (rows <= 0 && refill) rows = raiseAlive;
    // (and, the opening's raise and the floor's alike: garbage on its way or on the board, never more than the board lives through once
    // it lands -- a raise ends the stop the board is held up by -- and never the stack's top, garbage on it counted, up to the top row: a
    // raise into the garbage is a death)
    if ((rq.narr > 0 || R->under) && rows > raiseAlive) rows = raiseAlive;
    { int32_t h = rq.b->height ? rq.b->height : 12; rows = imin(rows, h - 1 - fullTop(rq.b)); }
    if (rows <= 0) { R->up = R->low = 0; raiseWait = 0; } else to = fullTop(rq.b) + rows;
  }
  R->to = to;
  R->pop = popLeft(decQ.b) > 0;
  // (what the board left alone makes while a chain falls or a slab pops, as the game counts it -- for the log)
  ownChainBy = ownChainN = 0;
  if (cascadeLive(decQ.b) || R->pop) {
    ownChainOf(&decQ);
    Outcome a = leftAlone();
    if (!a.dead) { R->aloneChain = a.j.chainAll; Made z = { 0, 0, 0, 0 }; R->aloneOut = !fitsList(&R->list, z, &a.j, 0); }
  }
  return 1;
}

// 2-4. PROPOSE, JUDGE AND RANK: every candidate offered -- the hold among them -- judged by its outcome and put in the one order. With
// none that lives and time left, the survival search proposes its line too.
#define MAXCANDS 128
#define NINTENT 4   // the intentions a decision keeps (keepIntents)
#define NROUTE 10   // the routes a decision judges (routeJudged)
#define PROPOSED (2 * MAXCANDS)   // what the proposers may offer; past MAXCANDS, every play keeps its share (fairShare)
static Cand theCands[PROPOSED];
static int32_t cappedN;   // the candidates left unjudged past MAXCANDS, a decision (the log's capped=)
// EVERY PROPOSER ITS SHARE: past MAXCANDS, the candidates are taken a play at a time -- each play's first, then each play's second, in the
// order each offered them -- so a proposer offering last is never the one cut; how many are left, counted
static int fairShare(Cand *c, int n, int cap) {
  cappedN = n > cap ? n - cap : 0;
  if (n <= cap) return n;
  static Cand kept[MAXCANDS]; static uint8_t taken[PROPOSED];
  memset(taken, 0, sizeof taken);
  int k = 0;
  while (k < cap) {   // (a round: each play's next)
    int seen[NPLAYS] = { 0 }, any = 0;
    for (int i = 0; i < n && k < cap; i++) {
      if (taken[i]) continue;
      int p = c[i].play;
      if (seen[p]++ != 0) continue;
      kept[k++] = c[i]; taken[i] = 1; any = 1;
    }
    if (!any) break;
  }
  for (int i = 0; i < k; i++) c[i] = kept[i];
  return k;
}
#define NSTRIP 12   // the lines judged again with one swap left out (THE THREE TAKEN OUT)
#define STRIP_LINES 3   // the best lines that waste a three, each judged again so
static int32_t decTap;   // (the decision's pressTap, set by answer.c, for its jobs' threads and the line in progress)
static Judge theJudged[MAXCANDS + 4 + NINTENT + NROUTE], *order[MAXCANDS + 5 + NINTENT + NROUTE + NSTRIP], stripped[NSTRIP];
static int32_t phaseMs[3];
static Outlived svJob; static int32_t svJobDone;   // (the survival search already searched on a worker: answer.c breakJob)
static int carriedCand(const Read *R, Cand *k, int *wait);
static int carriedFromReady(void), carryWaitsOut(void);
static void readySpread(int n), readyStop(void);
static int keptJudged(const Read *R, int n), routeJudged(const Read *R, int n);
static const Judge *carriedJ;   // the line in progress among the ranked, for the log
// THE BOARD AFTER A LINE AND THE BEST ON (contLostOf): the line played to its end, the survival search asked of the board it leaves with
// the garbage still on its way, for `give` ms (SAVE_MS at most, an equal part of the decision's own time each); the frame that board is lost, 1e9 if it lives, -1 if
// it could not be asked. The hold's board is the board left alone. A line lost before its end is lost where the judge saw it lost, and a
// board the search finds no line on is lost where it is lost left alone.
#define SAVE_MS 10
#define SAVE_KEEP_MS 4
static const Judge *saveLine;   // (the line the save confirmed)
static int32_t saveAsked, saveNot, saveOk;   // (saves asked of the survival search this decision, the threes it found not needed, and whether it found one needed: the log's, and the frame loop's count)
static double saveCw = -1, saveCk = -1;
static double svLost = -1; static int32_t svClean;   // (the survival search's loss from now this decision, and whether its line wastes no three: the save's other side)
static double contBoardLost(const Board *e, double give, int32_t spent);
static double contBoardLostLine(const Board *e, double give, int32_t spent, int32_t *seq, int32_t *nseq);
// (and the survival line it plays on with, handed back where asked: the plan a line lives by, plans/gambit-next.md 6)
static double contLostOfLine(const Judge *J, double give, int32_t *seq, int32_t *nseq) {
  static Board *eb; if (!eb) eb = nb_new();
  if (nseq) *nseq = 0;
  if (J->o.dead) return J->o.lostAt >= 0 && J->o.lostAt != FOREVER ? (double)J->o.lostAt : -1;
  if (!eb) return -1;
  endNoKeep = 1;
  if (!J->hold) asLine(&J->k);
  const Board *e = J->hold ? lineEnd(0, 0, 0) : lineEnd(J->k.seq, J->k.nseq, J->settled);
  if (!J->hold) unLine();
  endNoKeep = 0;
  if (!e) return -1;
  return contBoardLostLine(e, give, J->hold ? 0 : J->o.j.spent, seq, nseq);
}
static double contLostOf(const Judge *J, double give) { return contLostOfLine(J, give, 0, 0); }
// (THE BEST ON FROM A BOARD: the survival search asked of board e, with the garbage still on its way, for `give` ms -- the frame from
// now that board is lost, 1e9 if it lives, -1 if it could not be asked: a line's plan ends here, whatever its last step was)
static double contBoardLostLine(const Board *e, double give, int32_t spent, int32_t *seq, int32_t *nseq) {
  static Board *cb; if (!cb) cb = nb_new();
  if (nseq) *nseq = 0;
  if (!cb || !e) return -1;
  cloneBoard(cb, e);
  int32_t dt = imax(0, cb->clock - decQ.b->clock);
  Question q2 = decQ; q2.b = cb; q2.holdLeft = 0; q2.holdStarted = 0; q2.narr = 0;
  for (int a = 0; a < decQ.narr; a++) if (decQ.arr[a].at > dt) { q2.arr[q2.narr] = decQ.arr[a]; q2.arr[q2.narr++].at -= dt; }
  // (rooted dt frames on, the line to it having spent `spent` of the window: core/nodes.h laterBegin)
  Later lt = laterBegin(dt, spent);
  Outlived c = outlive(&q2, HORIZON + REST, REST, give, 6, 30);
  int32_t lost = c.set ? c.lostAt : diesIn(&q2, HORIZON + REST);
  laterEnd(lt);
  if (lost < 0) return -1;
  if (seq && nseq && c.set) { int k = 0; for (; k < c.nseq && k < MAXLINE; k++) seq[k] = c.seq[k]; *nseq = k; }
  return lost == FOREVER ? 1e9 : (double)dt + lost;
}
static double contBoardLost(const Board *e, double give, int32_t spent) { return contBoardLostLine(e, give, spent, 0, 0); }
// THE JUDGING ON EVERY THREAD: the candidates judged on the workers, each from the work the decision had done when the judging began
// and in the share it had, into a slot of its own with what it adds to the decision's tallies (rank.c dropped, cutWhy, unbroken) --
// added in candidate order after, so the order is the same whichever thread judged what. The decision's clock is charged the judging's
// work over the threads that did it: what the machine's cores do in that much real time. The ideas a line leaves, and every later
// judging, stay the decision's own (rank.c besideJudge).
static const Read *jbR; static int64_t jbWork0; static double jbShare; static int32_t jbTap;
static Judge jbJ[MAXCANDS]; static int32_t jbOk[MAXCANDS]; static int64_t jbWork[MAXCANDS];
static int32_t jbDrops[MAXCANDS][NPLAYS][NDROPS], jbCut[MAXCANDS][4], jbCutBr[MAXCANDS][4]; static Unbroken jbUnb[MAXCANDS];
static Ctx *jbCtx;   // (the phase's own: the jobs make nodes only on their threads' contexts)
static void judgeJob(int32_t i) {
  clockWork = jbWork0; clockShare = jbShare; clockAborted = 0; clockPoll = 0; clockWentOut = 0; inJob = 0;
  pressTight = decQ.tight; pressTap = jbTap; pressFrom = pressSpent = 0; besideJudge = 1;
  cacheFresh(); ncache = 0;   // (judged from nothing: its work the same on whichever thread, and so the decision's clock)
  memset(dropped, 0, sizeof dropped); memset(cutWhy, 0, sizeof cutWhy); memset(cutWhyBreak, 0, sizeof cutWhyBreak); unbroken.set = 0;
  jbOk[i] = judgeWalked(jbR, &theCands[i], &jbJ[i]);
  memcpy(jbDrops[i], dropped, sizeof dropped); memcpy(jbCut[i], cutWhy, sizeof cutWhy); memcpy(jbCutBr[i], cutWhyBreak, sizeof cutWhyBreak);
  jbUnb[i] = unbroken; jbWork[i] = clockWork - jbWork0;
  besideJudge = 0;
}
// (the candidates judged, in order, into theJudged/order from n: on every thread where the pool is free, else here)
static int judgeAll(const Read *R, int nc, int n) {
  if (pool.nworkers > 0 && !poolBusy && nc > 1) {
    if (decF.under) aloneBuildable();   // (asked once, here: every judging reads it)
    if (!jbCtx) jbCtx = ctxOf(0);
    jbR = R; jbWork0 = clockWork; jbShare = clockShare; jbTap = pressTap;
    if (startJobs(jbCtx, judgeJob, nc)) {
      jobsAll(jbCtx);
      int64_t sum = 0;
      for (int i = 0; i < nc; i++) {
        sum += jbWork[i];
        for (int p = 0; p < NPLAYS; p++) for (int w = 0; w < NDROPS; w++) dropped[p][w] += jbDrops[i][p][w];
        for (int w = 0; w < 4; w++) { cutWhy[w] += jbCut[i][w]; cutWhyBreak[w] += jbCutBr[i][w]; }
        if (!unbroken.set && jbUnb[i].set) unbroken = jbUnb[i];
        if (jbOk[i]) { theJudged[n] = jbJ[i]; order[n] = &theJudged[n]; n++; }
      }
      clockCharge(sum / pool.nworkers);
      return n;
    }
  }
  for (int i = 0; i < nc; i++) if (judgeWalked(R, &theCands[i], &theJudged[n])) { order[n] = &theJudged[n]; n++; }
  return n;
}
#ifdef GB_TEST
static void gb_trace_ranked(const char *stage, Judge **o, int n);   // (test/decide_check.c: the order after each stage, under GC_GAMBIT_TRACE)
#define TRACE(stage) gb_trace_ranked(stage, order, n)
#else
#define TRACE(stage)
#endif
static int ranked(const Read *R, const Found *S) {
  memset(dropped, 0, sizeof dropped); memset(offered, 0, sizeof offered); memset(cutWhy, 0, sizeof cutWhy); memset(cutWhyBreak, 0, sizeof cutWhyBreak);
  carriedJ = 0; unbroken.set = 0; saveLine = 0; saveAsked = saveNot = saveOk = 0; saveCw = saveCk = -1; svLost = -1; svClean = 0;
  ideaAims = &R->asked; ideasAsks = 0;
  double t0 = nowMs();
  int nc = fairShare(theCands, proposeAll(R, S, theCands, PROPOSED), MAXCANDS), n = 0;
  double t1 = nowMs();
  for (int i = 0; i < nc; i++) offered[theCands[i].play]++;
  readyDefer = 1;   // (the proposers above ask readiness whole; the judging below ranks first)
  readyStop(); readyPendClear(); readyCollect = 1;   // (and keeps each landed board: searched once, its nearest break measured)
  rankReact = C2.reaction + 1;
  rankSave = rankReact + popFrames(decQ.b, W);   // (the order's unit of time: a full row's break -- the dues are each block's own, below)
  rankLow = lowOnPanels(decQ.b);
  n = judgeAll(R, nc, n); TRACE("judged");
  n = keptJudged(R, n); TRACE("kept");   // (the intentions the last decision kept, found again)
  // (the line in progress: first of its tier when its next step is due now; one whose next step must wait for the board is a hold
  // until then -- it ranks with the hold)
  Cand ck; int cwait = 0;
  if (R->guides.n && carriedCand(R, &ck, &cwait) && judgeCand(R, &ck, &theJudged[n])) {
    Judge *cj = &theJudged[n];
    cj->wait = cwait;
    if (cwait) cj->waitMax = 1; else if (!carriedFromReady()) cj->first = 1;   // (its place: rank.c tierView)
    // (A WAIT THAT DOES NOT END: a line that has waited CARRY_WAITS decisions for a board that has not settled -- under garbage it may
    // never -- is offered as any line is, no longer kept first as the line in progress (rank.c 1a): nothing of it has been pressed
    // since, and its loss comes no later while it waits)
    cj->carried = !(cwait && carryWaitsOut()); order[n] = cj; n++; carriedJ = cj;
    // (and, the board still moving, the same line pressed straight through -- each swap as soon as the board lets it, not once the
    // board has settled: a slab converting is frames the line can be pressed in)
    static Judge thru;
    Cand k2 = ck; k2.settled = 0; k2.play = PLAY_CARRY;
    if (cwait && judgeCand(R, &k2, &thru)) { thru.carried = 1; order[n] = &thru; n++; }
  }
  // (the hold, always: the chain the board makes alone is the board's, however far past the list it runs -- never one to stop)
  Judge *H = &theJudged[n];
  holdCand(R, 0, H);
  order[n] = H; n++;
  for (int i = 0; i < n; i++) if (order[i] != H && digWaits(order[i], H, C2.reaction + 1)) order[i]->wait = 1;
  sortJudged(order, n);
  // (THE ROUTE: the best lines that make something, two on columns apart made one line, judged whole and ranked with the rest)
  { int n0 = n; n = routeJudged(R, n); if (n > n0) sortJudged(order, n); }
  // (READY, ASKED BEST FIRST: every option is ranked on what the judging alone says; then, in the time left and best-ranked first, each
  // that does not live yet is asked whether a break is there once everything lands -- the break search on the landed board, an equal
  // part of the time left each of those still to be asked -- and the order is made again)
  readyDefer = 0; readyCollect = 0; readyFresh = 1;
  // (THE ORDER'S OWN SEARCHING -- the readiness asked of each line, the survival backup, the three taken out -- in its own share
  // (propose.c orderEnd): half of what the decision has left, the rest the save's and the answer's, and an answer comes as soon as the
  // searching is done)
  double orderShare = clockShareBegin(orderEnd());
  // (the line in progress too: a line that lived by a break in reach lives on by it, its landed board the one already searched)
  #define READY_ASKS(J_) (!(J_)->o.lives && !(J_)->o.dead && (J_)->o.ready == NOT_ASKED)
  // (THE KEPT PLAN'S LINES -- intentions and routes -- are asked as every line is: a worker's answer or this thread's search, the same
  // either way; the readiness of a break in reach, below, is asked of the decision's own lines alone)
  #define EXTRA(J_) ((J_)->k.kept || (J_)->k.route)
  readySpread(n);
  int toAsk = 0;
  for (int i = 0; i < n; i++) toAsk += READY_ASKS(order[i]);
  // (BY YIELD: a board with a break in reach by the shape math has one found for it half the time; one with none, settled, once in
  // fifty, in nearly all of the time a decision spends on readiness -- so those in reach are asked first, best-ranked first, and the
  // rest in the time left)
  for (int pass = 0; pass < 2; pass++)
  for (int i = 0; i < n && timeLeftMs() > 0; i++) {
    Judge *J = order[i];
    if (!READY_ASKS(J) || (J->o.j.readyNear < NEAR_MISS) != (pass == 0)) continue;
    readyShare(toAsk--);
    if (J->hold) holdCand(R, J->wait, J);
    else {
      static Judge again; Cand kc = J->k;
      if (judgeCand(R, &kc, &again)) {
        again.wait = J->wait; again.first = J->first; again.waitMax = J->waitMax; again.carried = J->carried;   // (its place in the order kept: the line in progress)
        again.outside = again.outside || J->outside;
        *J = again;
      }
    }
  }
  readyShare(0); readyFresh = 0;
  sortJudged(order, n);
  double t2 = nowMs();
  surviveAsked = 0;
  // (the survival search's line, the backup where nothing lives: the worker's whenever it has finished -- it was searched beside the
  // decision, in the searches' time -- else searched here in what time the decision has left. Judged before any line is asked its
  // readiness: not dying comes first, and a line the clock leaves unjudged is no line)
  int svDone = __atomic_load_n(&svJobDone, __ATOMIC_ACQUIRE);
  if (!(n && order[0]->o.lives) && (svDone || timeLeftMs() > 0)) {
    surviveAsked = 1;
    Outlived sv = svDone ? svJob : outlive(&decQ, HORIZON + REST, REST, timeLeftMs(), 6, 30);
    offered[PLAY_SURVIVE] = sv.set && sv.nseq ? 1 : 0;
    Cand sk;
    if (sv.set && sv.nseq && candOf(&sk, PLAY_SURVIVE, sv.seq, sv.nseq, -1, 0)) { sk.settled = 0; if (judgeCand(R, &sk, &theJudged[n + 1])) { readyNextFor(&theJudged[n + 1]); svClean = !wastesThree(&theJudged[n + 1]); order[n] = &theJudged[n + 1]; n++; sortJudged(order, n); } }
    if (sv.set) svLost = sv.lostAt == FOREVER ? 1e9 : sv.lostAt;
  }
  // (none lives: each is asked too whether a break is in reach once the next block lands -- the order puts those first. A ready line
  // first of all: being ready is all it is for, and asked last, in the order's tail, it was asked out of time -- 42 of 53 unanswered)
  if (!(n && order[0]->o.lives)) {
    int own = 0; for (int i = 0; i < n; i++) own += !EXTRA(order[i]);
    for (int pass = 0; pass < 2; pass++)
      for (int i = 0; i < n; i++) if (!EXTRA(order[i]) && (order[i]->k.play == PLAY_READY) == !pass) { readyShare(own--); readyNextFor(order[i]); }
    readyShare(0); sortJudged(order, n);
  }
  // THE THREE TAKEN OUT: each of the best lines that waste a three, judged again with one of its swaps left out at a time -- the line
  // without the swap that makes the three, where it does as well, is a line the order below keeps
  { int ns = 0, tried = 0, none = !(n && order[0]->o.lives), n0 = n;
    for (int i = 0; i < n0 && tried < STRIP_LINES && ns < NSTRIP && timeLeftMs() > 0; i++) {
      const Judge *J = order[i];
      if (J->hold || !wastesThree(J) || J->k.nseq < 2) continue;
      tried++;
      for (int s = 0; s < J->k.nseq && ns < NSTRIP && timeLeftMs() > 0; s++) {
        int32_t seq[MAXLINE]; int m = 0;
        for (int q = 0; q < J->k.nseq; q++) if (q != s) seq[m++] = J->k.seq[q];
        Cand k;
        if (!candOf(&k, J->k.play, seq, m, J->k.aim, J->k.extend)) continue;
        k.settled = J->k.settled; k.way = J->k.way;
        if (!judgeCand(R, &k, &stripped[ns]) || wastesThree(&stripped[ns])) continue;
        if (none) readyNextFor(&stripped[ns]);
        order[n++] = &stripped[ns++];
      }
    }
    if (ns) sortJudged(order, n);
  }
  // NO WASTED THREE (the owner: only when not doing it would kill it): a line whose clears break nothing and throw nothing is taken out
  // of the order -- unless every other line is lost and a three lives, or is lost later: only there is a three a save, and the save asks
  // whether it outlasts them by a break's time
  clockShareEnd(orderShare);
  { int keeps = 0, wasteLives = 0; double wasteLost = -1, keptLost = -1;
    for (int i = 0; i < n; i++) {
      if (wastesThree(order[i])) { if (order[i]->o.lives) wasteLives = 1; else if (lostOf(order[i]) > wasteLost) wasteLost = lostOf(order[i]); }
      else if (order[i]->o.lives) keeps = 1; else if (lostOf(order[i]) > keptLost) keptLost = lostOf(order[i]);
    }
    if (!keeps && !wasteLives && keptLost >= 0 && wasteLost <= keptLost) keeps = 1;
    // (THE SAVE ASKED: where the rule would let a three through, the best line that wastes one and the best that does not -- the hold
    // among them -- are each played to their end and the survival search asked of the boards they leave, the garbage on its way
    // landing as it would. A three whose board, with the best line on, outlasts the other's by nothing was not needed not to die: it
    // is wasted)
    if (!keeps && timeLeftMs() > SAVE_KEEP_MS + 2) {
      const Judge *bw = 0, *bk = 0;
      for (int i = 0; i < n; i++) {
        const Judge *J = order[i];
        if (wastesThree(J)) { if (!bw || J->o.lives > bw->o.lives || (J->o.lives == bw->o.lives && lostOf(J) > lostOf(bw))) bw = J; }
        else if (!bk || lostOf(J) > lostOf(bk)) bk = J;
      }
      if (bw && bk) {
        // (the three's side first, with the time; then the side without, bounded below by what is known already -- the best line's own
        // loss, the survival line's when it wastes none: a three that does not beat that is not needed, and only
        // otherwise is the side without searched, in what time is left)
        int have = svLost >= 0 && svClean;
        double kLow = lostOf(bk); if (have && svLost > kLow) kLow = svLost;
        double give = timeLeftMs() - SAVE_KEEP_MS; if (give > SAVE_MS) give = SAVE_MS;
        double cw = contLostOf(bw, give), ck = -1;
        if (cw >= 0 && kLow >= cw) ck = kLow;
        else if (cw >= 0) {
          double give2 = timeLeftMs() - SAVE_KEEP_MS; if (give2 > SAVE_MS) give2 = SAVE_MS;
          double c2 = give2 >= 1 ? contLostOf(bk, give2) : -1;
          ck = c2 > kLow ? c2 : (c2 >= 0 ? kLow : -1);
        }
        saveAsked++;
        saveCw = cw; saveCk = ck;
        // (needed not to die -- the rule above asks it only where every line without one is lost within a break's time: with the three
        // the board lives on, or outlasts the board without it by a break's time at least; a three that puts the loss off by less is wasted)
        if (cw >= 0 && ck >= 0 && ck < 1e9 && (cw >= 1e9 || cw - ck >= rankSave)) { saveOk = 1; saveLine = bw; }
        else if (cw >= 0 && ck >= 0) { keeps = 1; saveNot++; }
      }
    }
    // (only a three the save confirmed is played: any other line that wastes one goes, the hold always left -- the press guard refuses
    // what the order lets through, a walk spent for nothing)
    if (!saveOk) { int m = 0; for (int i = 0; i < n; i++) { if (wastesThree(order[i])) { dropAs(order[i]->k.play, DROP_WASTE); if (order[i] == carriedJ) carriedJ = 0; } else order[m++] = order[i]; } n = m; }
    // (a save confirmed: the survival search found the board lives on with it, or outlasts every line without it by a break's time -- its
    // three is no wasted three, a fact of the line the order reads like any other (rank.c threeNeeded), and the order ranks it)
    else if (saveLine) {
      for (int i = 0; i < n; i++) if (order[i] == saveLine) { order[i]->threeNeeded = 1; break; }
      sortJudged(order, n);
    } }
  // (THE ORDER AS IT STANDS: sorted once more when every stage has written its lines -- a plan read, a hold judged again, a three
  // marked needed -- so the line played is the first of the one order over the lines as they are)
  sortJudged(order, n);
  phaseMs[0] = (int32_t)(t1 - t0); phaseMs[1] = (int32_t)(t2 - t1); phaseMs[2] = (int32_t)(nowMs() - t2);
  TRACE("ranked");
  return n;
}

// 5. PLAY: the raise when the opening calls for it, a hold while the raise waits for a busy board, else the first candidate in the one
// order -- a line's first swap, or the hold
typedef struct { const Judge *top, *line; int32_t name, nlive, ncands, urgent, wait, deferred, heldFor; } Played;   // heldFor: the first line unproven, the hold played in its place (the save aside)
// (A REPLAY'S FORCED OPTION, gb_force: the first decision at or after frame forceAt plays the order's option forceK in place of its first,
// once a game -- a lost game played again from a decision with another choice, to find the decision that lost it)
static int32_t forceAt = -1, forceK = 0, forceDone, forcedNow, decAt;
EXPORT(gb_force) void gb_force(int at, int k) { forceAt = at; forceK = k; forceDone = 0; }
// THE RESERVE (plans/gambit-next.md, The idle frame): whether the board a line leaves has a break in reach -- the break search itself
// (search/break.c breakMoves), asked of that board as it is, known colours only, no projection, bounded to VETO_MS. 1 a break, 0 none,
// -1 not asked (no end board, or the clock out). A board with no garbage on it has nothing to break: 1.
#define VETO_MS 40
#define VETO_LOOK 2
static Board *reserveB;
static int32_t vetoed, vetoAsked, vetoCut;
// (THE VETO MEASURED FOR TRUTH: the board the line on top leaves, which the veto read as having no break, is logged (GAMBITV) for the
// report to search again with the full budget -- gambit_reach.js, "veto truth": a break found there is a veto that was wrong. The
// native host sets the hook; the wasm host logs none)
static void (*vetoDump)(int32_t at, const Board *b);   // (the log's veto=: the place of the line played for its reserve, 0 none; the boards asked; those the clock cut)
static int reserveOf(const Judge *J) {
  if (clockOut()) return -1;
  const Board *eb = J->hold ? decQ.b : lineEnd(J->k.seq, J->k.nseq, J->settled);
  if (!eb) return -1;
  if (!garbageOn(eb)) return 1;
  if (!reserveB) reserveB = nb_new();
  if (!reserveB) return -1;
  cloneBoard(reserveB, eb);
  Question q2 = decQ; q2.b = reserveB; q2.holdLeft = 0; q2.holdStarted = 0; q2.narr = 0;
  static LOCAL Broke rbr;
  double old = clockShareBegin(nowMs() + VETO_MS);
  breakMoves(&q2, 0, 0, &rbr);
  // (A SEARCH ANSWER IS A FACT ONLY WHEN THE SEARCH FINISHED: none found with the clock out is not none -- 917 vetoes on 20 ms answers,
  // 12/24, run 1327. A break found is a fact either way)
  int cut = clockOut();
  clockShareEnd(old);
  vetoAsked++;
  if (rbr.pathLen > 0) return 1;
  if (cut) { vetoCut++; return -1; }
  return 0;
}
// (alike for the veto: as proven, and lost within a break's time of each other -- or both standing)
static int vetoAlike(const Judge *x, const Judge *y) {
  if (proofOf(x) != proofOf(y)) return 0;
  double lx = lostOf(x), ly = lostOf(y);
  if (lx >= 1e9 && ly >= 1e9) return 1;
  return lostAlike(x, y) || (lx < 1e9 && ly < 1e9 && (lx > ly ? lx - ly : ly - lx) <= imax(1, rankSave));
}
static Played playOf(const Read *R, int n) {
  Played P; memset(&P, 0, sizeof P);
  forcedNow = -1;
  if (forceAt >= 0 && !forceDone && decAt >= forceAt) {
    forceDone = 1;
    if (forceK > 0 && forceK < n) { Judge *t = order[0]; order[0] = order[forceK]; order[forceK] = t; forcedNow = forceK; }
    else forcedNow = forceK < n ? 0 : -2;
  }
  // THE RESERVE VETO: every loss is a board with no break in reach, entered and not escaped (none at the next decision 86% of the
  // time). The line on top leaves a board with none in reach while a line below it, alike as proven and as lost, leaves one: that line
  // is played. Exact, and bounded: VETO_LOOK boards at VETO_MS each
  vetoed = 0; vetoAsked = 0; vetoCut = 0;
  if (n > 1 && R->under && reserveOf(order[0]) == 0) {
    for (int k = 1; k < n && k <= VETO_LOOK; k++) {
      Judge *c = order[k];
      if (!vetoAlike(order[0], c)) continue;
      if (reserveOf(c) == 1) {
        Judge *t = order[0]; order[0] = c; order[k] = t; vetoed = k;
        if (vetoDump) { const Board *tb = t->hold ? decQ.b : lineEnd(t->k.seq, t->k.nseq, t->settled); if (tb) vetoDump(decAt, tb); }
        break;
      }
    }
  }
  // (the opening's wait for the raise is a hold, so only while the hold lives: where it does not, the order decides -- a line that lives
  // is never passed over for a raise to come)
  int holdLivesNow = 0;
  for (int i = 0; i < n; i++) if (order[i]->hold && order[i]->o.lives) holdLivesNow = 1;
  P.wait = R->low && !R->up && !(n && order[0]->k.extend) && holdLivesNow;
  P.top = R->up || P.wait ? 0 : (n ? order[0] : 0);
  // (the line in progress that waits for the board is played as it was judged: its next swap from the frame the judge pressed it from)
  P.line = P.top && !P.top->hold && (!P.top->wait || P.top->k.play == PLAY_CARRYWAIT) ? P.top : 0;
  // (JUST IN TIME: a line whose first swap clears nothing and whose next is not due until well after the next decision is held while it
  // does as well with that swap pressed later -- the next decision plans it again, so a first swap pressed early is undone by the next
  // plan's)
  // (held only while the board left alone lasts to the frame the swap would be pressed)
  double holdLost = -1;
  // (the hold's loss as the order reads it, rank.c lostOf: a hold whose loss was not judged is lost now, never 'never' -- an unknown
  // never licenses waiting)
  // (and only while the hold lives: on a board left alone that is lost, a swap put off is put off again by the next plan until the board
  // is gone -- a line that saves it is played now)
  int holdLives = 0;
  for (int i = 0; i < n; i++) if (order[i]->hold && !order[i]->o.dead) { holdLost = lostOf(order[i]); holdLives = !!order[i]->o.lives; }
  if (P.line && holdLives && P.line->apNats >= 2 && P.line->apAts[1] - P.line->apAts[0] > 2 * rankReact && holdLost > P.line->apAts[1] &&
      firstClear(&decQ, P.line->k.seq, P.line->k.nseq) != 0 && !clockOut()) {
    const Judge *L = P.line;
    Outcome d = outcomeOf(L->k.seq, L->k.nseq, L->settled, 0, L->apAts[1] - rankReact);
    // (the line pressed later must be known to last as long: a loss it was not judged for never licenses waiting)
    double dl = d.lostAt == NOT_ASKED ? -1 : lostAtOf(d.lostAt, 0), ol = lostAtOf(L->o.lostAt, 0);
    if (!d.late && !d.dead && d.lives >= L->o.lives && d.j.made.broke >= L->apBroke && dl >= ol) { P.line = 0; P.deferred = 1; }
  }
  P.name = P.line ? P.line->k.play : R->up ? -2 : PLAY_HOLD;   // -2: the raise
  for (int i = 0; i < n; i++) if (order[i]->o.lives) P.nlive++;
  P.ncands = n;
  return P;
}
// THE LINE IN PROGRESS (carryOf): the line of the move played, when it has more than one swap and is a play -- not a hold or a clear. It
// keeps how it is pressed, what it was begun for (its entry, a break), and a panel of the bottom row it does not touch, by which it is
// found again once the stack has risen. A line handed to the frame loop is the line in progress too: the next decision judges what is
// left of it once the swaps the frame loop pressed of it since (carryFrom, carryPressed: the question's lineFrom, linePressed) are
// played, so a line begun is played on unless something ranks above it.
// (popping: a slab of garbage was popping on the board it was begun on -- a break the next decision finds popping is the line's own
// only when none was then)
// (ready: a break found on the board once everything lands, carried from a swap played for it -- offered, not put first: it was found
// on a board the stack is not yet)
typedef struct { int32_t set, id, play, nrest, rest[MAXLINE], restAt[MAXLINE], tap, unpaced, settled, hasAim, broke, popping, ready, anchorRow, anchorCol, anchorId, waits, move, moveAt; Aim aim; } Carry;   // restAt: the frame each swap was judged pressed at, -1 not said; move, moveAt: the answer's own first swap (the move, not handed on) and its frame, 0 none; play: the kind of line it was chosen as
static Carry theCarry;
// THE BREAK A LINE LIVES BY, NEXT: a line played that lives only by a break in reach once everything lands (its readiness) carries that
// break too, to be the line in progress once the line's own swaps are pressed -- the next decisions need not find it again
static Carry theCarryNext;
static int carriedFromReady(void) { return theCarry.ready; }
#define CARRY_WAITS 2
static int carryWaitsOut(void) { return theCarry.waits >= CARRY_WAITS; }
static int32_t carryFrom = -1, carryPressed;
// THE ANCHOR a line in progress is found again by: the first panel of the bottom row (its ids, row1) that no swap of the line touches,
// into theCarry; 0 when every one is touched. carryOf and carryReady ask it.
static int anchorFor(const int32_t *row1, const int32_t *seq, int n, int32_t *row, int32_t *col, int32_t *id) {
  for (int c = 1; c <= W; c++) {
    if (row1[c] == NUL) continue;
    int touched = 0;
    for (int i = 0; i < n; i++) if (CR(seq[i]) == 1 && (CC(seq[i]) == c || CC(seq[i]) + 1 == c)) touched = 1;
    if (!touched) { *row = 1; *col = c; *id = row1[c]; return 1; }
  }
  return 0;
}
// (and the rows the board has risen since, by that panel found again: NOT_ASKED when it is gone -- the carry's and the intentions')
static int anchorShift(int32_t row, int32_t col, int32_t id) {
  for (int r = 0; r < decQ.b->nrows; r++) if (decQ.b->p[r][col].f[ID] == id) return r - row;
  return NOT_ASKED;
}
static int anchorInto(Carry *C, const int32_t *row1, const int32_t *seq, int n) { return anchorFor(row1, seq, n, &C->anchorRow, &C->anchorCol, &C->anchorId); }
static int anchorOf(const int32_t *row1, const int32_t *seq, int n) { return anchorInto(&theCarry, row1, seq, n); }
// (first: the line's first swap left to carry -- 1 when it is the move played, 0 when the whole line is handed on, nothing pressed now)
// (waits: the decisions in a row the line has waited for the board to settle -- carryWaitsOut)
// (why a line in progress was not kept for the next decision -- read there as its carryDrop: 6 the line played waits and is no carry,
// 7 its tier past the last and nothing broken, 8 no bottom-row panel its swaps leave untouched to find it again by, 9 nothing played
// to carry: the hold, or a line with no swap after the one pressed)
static int32_t carryLost;
static void carryOf(const Read *R, const Judge *k, int32_t qid, int first) {
  int32_t waits = k && k->k.play == PLAY_CARRYWAIT ? theCarry.waits + 1 : 0, had = theCarry.set;
  memset(&theCarry, 0, sizeof theCarry);
  theCarry.waits = waits;
  carryLost = 0;
  // (a line that breaks garbage is carried whatever its tier: under garbage while the break waits, a breaking line ranks in the last
  // tier, and its swaps after the first are the break it was chosen for)
  if (!k || k->k.nseq < first + 1) { carryLost = had ? 9 : 0; return; }
  if (k->wait && k->k.play != PLAY_CARRYWAIT) { carryLost = 6; return; }
  if (k->t.tier > 4 && !(k->apBroke > 0)) { carryLost = 7; return; }
  int32_t row1[W + 1];
  for (int c = 1; c <= W; c++) row1[c] = anchorIdAt(decQ.b, c);
  if (!anchorOf(row1, k->k.seq, k->k.nseq)) { carryLost = 8; return; }
  theCarry.set = 1; theCarry.id = qid; theCarry.play = k->k.play == PLAY_CARRYWAIT ? PLAY_CARRY : k->k.play; theCarry.nrest = k->k.nseq - first;
  if (first) { theCarry.move = k->k.seq[0]; theCarry.moveAt = decAt + (!k->hold && k->o.j.nats > 0 ? k->o.j.ats[0] : 0); }
  for (int i = first; i < k->k.nseq; i++) { theCarry.rest[i - first] = k->k.seq[i]; theCarry.restAt[i - first] = !k->hold && i < k->o.j.nats ? decAt + k->o.j.ats[i] : -1; }
  theCarry.tap = k->k.tapOf ? k->k.tapOf - 1 : decTap; theCarry.unpaced = k->k.unpaced; theCarry.settled = k->settled; theCarry.broke = k->apBroke > 0; theCarry.popping = popLeft(decQ.b) > 0;
  if (k->aim >= 0) { theCarry.hasAim = 1; theCarry.aim = R->guides.aim[k->aim]; }
}
// THE BREAK A HOLD WAITS FOR is the line in progress too: a hold chosen because a break is in reach -- once everything lands, or its
// plan's next -- is a promise
// of that break, kept by carrying it -- anchored to a bottom-row panel of the board it was found on -- so the next decision plays it on
// as soon as it lives. A swap played for the break it leaves in reach once everything lands (one swap: nothing of it handed on) is the
// same promise.
// (THE BREAK A LINE IS READY FOR: the judge's readiness once everything lands, else its plan's next break (rank.c readyNextFor) -- the
// break it was ranked by either way; 0 none)
// (at: each swap's frame after the first, where the plan says one -- 0 none; the line's own readiness break has none but its wait)
static int readyBreakOfLine(const Judge *L, const int32_t **row1, const int32_t **line, int32_t *n, int32_t *wait, const int32_t **at) {
  if (!L) return 0;
  *at = 0;
  if (L->readyNext == 1 && L->planN > 0) { *row1 = L->planRow1; *line = L->planLine; *n = L->planN; *wait = L->planWait; *at = L->planAt; return 1; }
  if (L->o.ready == 1 && L->o.j.readyN > 0) { *row1 = L->o.j.readyRow1; *line = L->o.j.readyLine; *n = L->o.j.readyN; *wait = L->o.j.readyWait; return 1; }
  return 0;
}
// (the promise's frames: its first swap where the readiness found it, each later one where the plan says, else as the board lets)
static void carryFramesOf(Carry *C, int nl, int32_t wait, const int32_t *at) {
  C->restAt[0] = decAt + wait;
  for (int i = 1; i < nl; i++) C->restAt[i] = at && at[i] > 0 ? decAt + at[i] : 0;
}
// (A PROMISE'S ANCHOR, plans/gambit-next.md 6: a readiness break is found on the board once everything lands -- a board to come, whose
// bottom row is not yet on the board as it is -- and pressed, when carried, on that same board run to the same frame (carriedCand wTo).
// So it is anchored to a bottom-row panel of the board as it is now, a panel that is there to find again, and never moved by the rows
// the stack rises: the frame is the promise's, not the rows. carryKept, the log's: 1 kept, 2 no break to keep, 3 no panel to anchor it)
static int32_t carryKept;
static int anchorNow(Carry *C, const int32_t *seq, int n) {
  int32_t cur[W + 1];
  for (int c = 1; c <= W; c++) cur[c] = anchorIdAt(decQ.b, c);
  return anchorInto(C, cur, seq, n);
}
static void carryNextOf(const Judge *L) {
  memset(&theCarryNext, 0, sizeof theCarryNext);
  const int32_t *row1, *line, *at; int32_t nl, wait;
  if (!L || L->hold || !theCarry.set || !readyBreakOfLine(L, &row1, &line, &nl, &wait, &at)) return;
  if (!anchorNow(&theCarryNext, line, nl)) return;
  theCarryNext.set = 1; theCarryNext.id = -1; theCarryNext.play = PLAY_CARRY; theCarryNext.nrest = nl;
  for (int i = 0; i < nl; i++) theCarryNext.rest[i] = line[i];
  theCarryNext.settled = 0; theCarryNext.broke = 1; theCarryNext.ready = 1;
  carryFramesOf(&theCarryNext, nl, wait, at);
}
static void carryReady(const Judge *H, int32_t qid) {
  const int32_t *row1, *line, *at; int32_t nl, wait;
  carryKept = 2;
  if ((!H->hold && H->k.nseq != 1) || !readyBreakOfLine(H, &row1, &line, &nl, &wait, &at)) return;
  memset(&theCarry, 0, sizeof theCarry);
  carryKept = 3;
  if (!anchorNow(&theCarry, line, nl)) return;
  carryKept = 1;
  theCarry.set = 1; theCarry.id = qid; theCarry.play = PLAY_CARRY; theCarry.nrest = nl;
  for (int i = 0; i < nl; i++) theCarry.rest[i] = line[i];
  theCarry.settled = 0; theCarry.broke = 1; theCarry.popping = popLeft(decQ.b) > 0; theCarry.ready = !H->hold;
  theCarry.tap = decTap; carryFramesOf(&theCarry, nl, wait, at);   // (pressed where the readiness found it: the board run to that frame)
}
// THE READINESS BESIDE THE DECISION (search/break.c readyJob): the boards the order will ask readiness of handed to the workers,
// worst-ranked first -- the decision asks them best-ranked first -- each searched by whichever thread begins it first. They search on
// past the decision, until the next one takes the pool back (readyStop): a break found then is kept for the decisions after. The
// decision itself runs as it would with no workers.
static Ctx *jobCtx;   // (the phase's own: the jobs make nodes only on their threads' contexts)
static void readySpread(int n) {
  if (pool.nworkers <= 0 || !readyPendN || timeLeftMs() <= 0) return;
  uint8_t queued[READYPEND] = { 0 };
  int nj = 0;
  for (int i = n - 1; i >= 0 && nj < READYPEND; i--) {
    const Judge *J = order[i];
    int32_t p = J->o.j.readyPend - 1;
    if (!READY_ASKS(J) || p < 0 || p >= readyPendN || queued[p] || readyPend[p].gen != readyPendGen || readyPend[p].state != PEND_WAITING) continue;
    queued[p] = 1; readyJobs[nj++] = p;
  }
  if (!nj) return;
  if (!jobCtx) jobCtx = ctxOf(0);
  // (each board's budget the share the decision would give it when it asks them all: the time left over twice the asks -- readyShare)
  int asks = 0; for (int i = 0; i < n; i++) asks += READY_ASKS(order[i]) && !EXTRA(order[i]);
  double each = timeLeftMs() / (2.0 * imax(1, asks));
  for (int j = 0; j < nj; j++) { readyPend[readyJobs[j]].budget = each; readyPend[readyJobs[j]].work = 0; }
  readyJobWork = clockWork; readyJobEnd = 0;
  __atomic_store_n(&jobStop, 0, __ATOMIC_SEQ_CST);
  startJobs(jobCtx, readyJob, nj);
}
static void readyStop(void) {
  if (!poolBusy) return;
  __atomic_store_n(&jobStop, 1, __ATOMIC_SEQ_CST);
  jobsDone(jobCtx);
}
// THE INTENTIONS (plans/gambit-infra.md A, F): besides the line in progress, the best lines a decision ranked that make something -- a
// clear, a chain, a combo, a break -- each kept with a bottom-row panel it does not touch (found again by it once the stack has risen,
// as the line in progress is) and what it made; the next decision offers each as it is, judged on the engine like every line, so what
// one decision found the next need not search for again. A kept line that no longer makes something is let go.
typedef struct { int32_t set, play, nseq, seq[MAXLINE], settled, anchorRow, anchorCol, anchorId; } Intent;
static Intent theIntents[NINTENT];
static int32_t keptOffered, keptPlayed, routeOffered, routePlayed;   // (the log's, this decision)
static void keepIntents(int n, const Judge *played) {
  memset(theIntents, 0, sizeof theIntents);
  int32_t row1[W + 1];
  for (int c = 1; c <= W; c++) row1[c] = anchorIdAt(decQ.b, c);
  for (int i = 0, k = 0; i < n && k < NINTENT; i++) {
    const Judge *J = order[i];
    if (J == played || J->wait || J->o.dead || !clears(J) || J->k.nseq < 1) continue;
    Intent *I = &theIntents[k];
    if (!anchorFor(row1, J->k.seq, J->k.nseq, &I->anchorRow, &I->anchorCol, &I->anchorId)) continue;
    I->set = 1; I->play = J->k.play; I->nseq = J->k.nseq; I->settled = J->settled;
    for (int q = 0; q < J->k.nseq; q++) I->seq[q] = J->k.seq[q];
    k++;
  }
}
// AN IDEA FROM A LINE NOT PRESSED: a line in progress whose answer the frame loop never played is no line in progress, but what it
// makes is still on the board -- it goes first among the intentions, whole (its move too), found again by its anchor and judged as each
// is (answer.c carriedResume)
static int intentOfCarry(const Carry *C) {
  int n = (C->move ? 1 : 0) + C->nrest;
  if (!C->set || n < 1 || n > MAXLINE) return 0;
  for (int i = NINTENT - 1; i > 0; i--) theIntents[i] = theIntents[i - 1];
  Intent *I = &theIntents[0];
  memset(I, 0, sizeof *I);
  I->set = 1; I->play = C->play; I->settled = C->settled; I->anchorRow = C->anchorRow; I->anchorCol = C->anchorCol; I->anchorId = C->anchorId;
  if (C->move) I->seq[I->nseq++] = C->move;
  for (int q = 0; q < C->nrest; q++) I->seq[I->nseq++] = C->rest[q];
  return 1;
}
// (a line judged already this decision -- the same swaps, pressed the same way -- is the same answer: never judged twice)
static int judgedHas(int n, const Cand *k) {
  int st = k->settled >= 0 ? k->settled : settledPlay(k->play);
  for (int i = 0; i < n; i++) {
    const Judge *J = order[i];
    if (!J->hold && J->settled == st && J->k.nseq == k->nseq && !memcmp(J->k.seq, k->seq, sizeof k->seq[0] * k->nseq)) return 1;
  }
  return 0;
}
static int keptJudged(const Read *R, int n) {
  keptOffered = 0;
  for (int i = 0; i < NINTENT && !clockOut(); i++) {
    const Intent *I = &theIntents[i];
    if (!I->set) continue;
    int dr = anchorShift(I->anchorRow, I->anchorCol, I->anchorId);
    if (dr == NOT_ASKED) continue;
    int32_t seq[MAXLINE];
    for (int q = 0; q < I->nseq; q++) seq[q] = (CR(I->seq[q]) + dr) * 8 + CC(I->seq[q]);
    Cand k;
    if (!candOf(&k, I->play, seq, I->nseq, -1, 0)) continue;
    k.settled = I->settled; k.kept = 1;
    if (judgedHas(n, &k)) continue;
    keptOffered++;
    if (judgeWalked(R, &k, &theJudged[n]) && clears(&theJudged[n])) { order[n] = &theJudged[n]; n++; }
  }
  return n;
}
// THE ROUTE (plans/gambit-infra.md B): of the lines ranked so far, the best that make something and are pressed settled, two at a time
// on columns apart -- one's clears cannot move the panels the other swaps -- made one line, pressed in the order the cursor reaches its
// swaps soonest (rank.c judgeWalked), judged whole on the engine and ranked with the rest: one walk that does both. And the same two
// pressed at once, the second while the first still clears (two ideas fired together): both attacks out in the time of one, where the
// engine says the second swap is still there to press.
#define ROUTE_TOP 4
static int routeCols(const Judge *J) { int m = 0; for (int q = 0; q < J->k.nseq; q++) m |= 3 << CC(J->k.seq[q]); return m; }
static int routeJudged(const Read *R, int n) {
  routeOffered = 0;
  const Judge *top[ROUTE_TOP]; int nt = 0;
  for (int i = 0; i < n && nt < ROUTE_TOP; i++) {
    const Judge *J = order[i];
    if (J->wait || J->o.dead || !clears(J) || !J->settled || J->k.route) continue;
    top[nt++] = J;
  }
  for (int a = 0; a < nt && routeOffered < NROUTE && !clockOut(); a++)
    for (int b = a + 1; b < nt && routeOffered < NROUTE && !clockOut(); b++) {
      const Judge *A = top[a], *B = top[b];
      if ((routeCols(A) & routeCols(B)) || A->k.nseq + B->k.nseq > MAXLINE) continue;
      int32_t seq[MAXLINE], m = 0;
      for (int q = 0; q < A->k.nseq; q++) seq[m++] = A->k.seq[q];
      for (int q = 0; q < B->k.nseq; q++) seq[m++] = B->k.seq[q];
      Cand k;
      if (!candOf(&k, A->k.play, seq, m, -1, 0)) continue;
      k.settled = 1; k.route = 1;
      if (!judgedHas(n, &k)) { routeOffered++; if (judgeWalked(R, &k, &theJudged[n])) { order[n] = &theJudged[n]; n++; } }
      if (routeOffered >= NROUTE || clockOut()) break;
      k.settled = 0; k.pair = 1;
      if (!judgedHas(n, &k)) { routeOffered++; if (judgeWalked(R, &k, &theJudged[n])) { order[n] = &theJudged[n]; n++; } }
    }
  return n;
}
// CARRIED ON: the rest of the line in progress, found again on this board by its bottom-row panel and
// played on as it is pressed, while every step is legal and it still makes what it was begun for. wait: its next step must wait for
// the board to settle.
// (why the line in progress was not carried on, for the log: 0 carried or none, 1 its anchor panel gone, 2 a step no longer there to
// press, 3 it no longer breaks and its swaps pressed did not, 5 it no longer makes what it was begun for (offered all the same); 6-9 it
// was not kept when the last decision played it: carryOf)
static int carryDrop;
// (and for the log, the line dropped: the steps it had left, and for 2 how the judge ended it -- cut at, the steps it pressed)
static int32_t carryDropN, carryDropRest[MAXLINE], carryDropDead, carryDropCut, carryDropWhy, carryDropNats, carryDropPlan, carryDropAt, carryDropTap;   // (Plan, At: the frame the rest's next swap was judged pressed at when chosen, and judged again)
static int carriedCand(const Read *R, Cand *k, int *wait) {
  Carry *C = &theCarry;
  *wait = 0; carryDrop = 0; carryDropPlan = carryDropAt = -1;
  // (AN ANSWER NOT YET THE FRAME LOOP'S: a question asked for a frame no later than the answer's move, while the frame loop still holds
  // another line -- the move is not pressed, and the line is judged with it, from its frame; once the answer is the frame loop's, its
  // move is pressed and the swaps it handed on after it are counted as the frame loop says)
  int pending = C->set && C->move && C->id != carryFrom && decAt <= C->moveAt;
  int skip = pending ? 0 : C->id == carryFrom ? carryPressed : 0, own = C->nrest + pending;
  if (C->set && own <= skip && theCarryNext.set) {
    // (the line's own swaps all pressed: the break it lived by is the line in progress now, popping or not as the board is now)
    *C = theCarryNext; memset(&theCarryNext, 0, sizeof theCarryNext); C->popping = popLeft(decQ.b) > 0; skip = 0; pending = 0; own = C->nrest;
  }
  if (!C->set || own <= skip) { if (!C->set) carryDrop = carryLost; carryLost = 0; return 0; }
  int32_t lineSw[MAXLINE + 1], lineAt[MAXLINE + 1], nl = 0;
  if (pending) { lineSw[nl] = C->move; lineAt[nl++] = C->moveAt; }
  for (int i = 0; i < C->nrest && nl < MAXLINE; i++) { lineSw[nl] = C->rest[i]; lineAt[nl++] = C->restAt[i]; }
  // (a line's swaps are rows of the board at the frame each is pressed, every rise until then counted -- judged again here, each is
  // pressed then, as it was judged and as the frame loop presses it; only a readiness break, found on the board once everything lands,
  // is moved by the rows that board has risen past this one -- the board a waited-for break was found on)
  int dr = anchorShift(C->anchorRow, C->anchorCol, C->anchorId);
  if (dr == NOT_ASKED) { carryDrop = 1; return 0; }
  dr = 0;   // (the anchor says the board is still the one the line was found on; a line's rows are the board's at the frame it is pressed -- a readiness break's the board to come's, run to -- so none are moved)
  int32_t rest[MAXLINE], nrest = nl - skip;
  for (int i = 0; i < nrest; i++) rest[i] = (CR(lineSw[skip + i]) + dr) * 8 + CC(lineSw[skip + i]);
  // (judged as every line is -- one replayer, what the line makes counted one way -- each step settled when the line was begun so; a
  // settled line waits while the board still moves)
  // (a settled line's next step is pressed on the board settled from the step before, as it was judged: on a board still moving the
  // step is judged once it has settled -- waitTo -- not cut for a walk that cannot begin within a reaction; and a break the readiness
  // found, on the board once everything lands, is pressed on that board: on one still moving it waits as a settled line does)
  int moving = (C->settled || C->ready) && boardMoving(decQ.b);
  // (its next swap pressed no sooner than the frame it was judged pressed from, as the frame loop presses a line in hand: front.c lineDue)
  int32_t at0 = lineAt[skip] > decAt ? lineAt[skip] - decAt : 0;
  // (a readiness break not yet begun is pressed as its promise was judged: the board run to the frame the readiness found it on, let
  // settle, then pressed -- outcome.c promised)
  int32_t wTo = C->ready && skip == 0 ? imax(1, at0) : moving ? 1 : 0;
  // (a promise's later swaps each pressed where its plan says -- the board run to that frame and let settle, as the plan was judged:
  // outcome.c readyNextOf's later breaks and the survival line on from its end)
  int32_t mAt[MAXLINE], mTo[MAXLINE], nm = 0;
  if (C->ready) for (int i = 1; i < nrest; i++) if (lineAt[skip + i] > decAt) { mAt[nm] = i; mTo[nm++] = lineAt[skip + i] - decAt; }
  JudgeOpts jo = { C->settled, decQ.tight, NOT_ASKED, 0, 0, -1, 0, 0, 0, wTo, 0, nm, nm ? mAt : 0, nm ? mTo : 0, wTo ? 0 : at0 };
  Judged j;
  { int32_t t = pressTap, u = pressUnpaced; pressTap = C->tap; pressUnpaced = C->unpaced; judge(&decQ, rest, nrest, &jo, &j); pressTap = t; pressUnpaced = u; }
  carryDropN = nrest; for (int i = 0; i < nrest; i++) carryDropRest[i] = rest[i];
  carryDropPlan = lineAt[skip]; carryDropAt = j.nats ? decAt + j.ats[0] : -1; carryDropTap = C->tap * 2 + decTap;
  // (a step no longer legal: the judge pressed fewer than the line has. A line the board is lost on is offered all the same -- judged
  // lost, as any line is, and ranked by its loss: where every line is lost, the line in progress may be lost latest)
  // (a judging the clock stopped is no answer: the line is offered, and the rank reads it as any line the clock cut -- rank.c judgeCand)
  if (!j.dead && !j.late && j.nats < nrest) { carryDrop = 2; carryDropDead = -1; carryDropCut = j.cut; carryDropWhy = j.cutWhy; carryDropNats = j.nats; return 0; }
  *wait = moving || wTo > 1;
  // (the chain as the game counts it -- one already falling is the line's, begun by its first swap -- as the list's check counts it)
  Made x = { j.made.combo, imax(j.made.chain, j.chainAll), j.made.broke, 0 };
  int32_t done = j.done, fire = j.fire, nats = j.nats, ats[MAXLINE];
  for (int i = 0; i < nats; i++) ats[i] = j.ats[i];
  // (a line begun for a break whose swaps pressed so far made it -- the slab popping now, none when it was begun -- is carried on for
  // what the rest of it makes: the rest is what the line was judged to live by)
  if (!j.late && C->broke && !(x.broke > 0) && !(!C->popping && popLeft(decQ.b) > 0)) { carryDrop = 3; return 0; }
  // (the rest no longer meeting the entry it was begun for -- the swaps pressed so far made part of it -- it is carried on for no entry,
  // ranked as the line in progress is: rank.c 1a)
  int aimGone = !j.late && C->hasAim && !meets(&C->aim, x);
  if (aimGone) carryDrop = 5;
  int aim = -1;
  if (C->hasAim && !aimGone) for (int i = 0; i < R->guides.n && aim < 0; i++) if (!memcmp(&R->guides.aim[i], &C->aim, sizeof(Aim))) aim = i;
  if (!candOf(k, *wait ? PLAY_CARRYWAIT : PLAY_CARRY, rest, nrest, aim, 0)) return 0;
  k->settled = C->settled; k->at0 = wTo ? 0 : at0; k->waitTo = wTo; k->tapOf = 1 + C->tap; k->unpaced = C->unpaced;
  k->x.combo = x.combo; k->x.chain = x.chain; k->x.broke = x.broke; k->x.cells = x.cells; k->xDone = done; k->xFire = fire;
  k->xNats = nats; for (int i = 0; i < nats; i++) k->xAts[i] = ats[i];
  return 1;
}
