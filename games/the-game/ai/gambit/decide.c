// GAMBIT'S DECISION (plans/decision.md): read the board, propose, judge, rank, play -- in that order, once a decision.

// THE QUESTION'S OWN FACTS from the host (answer.c gb_answer): the enemy as the host sends it, whether a raise may begin
typedef struct { int32_t has, out, topKnown, top, stopKnown, stop; } Opp;
static Opp theOpp;
static int32_t canRaiseNow, gambitHit, modeRule = -1, hostTopped, surviveAsked;

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
  int ri = modeRule >= 0 ? namedRule(modeRule) : chooseRule(F);
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
    double l = leftMs(); if (l < 1) l = 1;
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
static int32_t saveAsked, saveNot, saveOk;   // (saves asked of the survival search this decision, the threes it found not needed, and whether it found one needed: the log's, and the frame loop's count)
static double saveCw = -1, saveCk = -1;
static double svLost = -1; static int32_t svClean;   // (the survival search's loss from now this decision, and whether its line wastes no three: the save's other side)
static double saveRoomMs(void) { return C2.due ? C2.due - C2.margin - nowMs() : 1e9; }
static double contLostOf(const Judge *J, double give) {
  static Board *eb; if (!eb) eb = nb_new();
  if (J->o.dead) return J->o.lostAt >= 0 && J->o.lostAt != FOREVER ? (double)J->o.lostAt : -1;
  if (!eb) return -1;
  endNoKeep = 1;
  const Board *e = J->hold ? lineEnd(0, 0, 0) : lineEnd(J->k.seq, J->k.nseq, J->settled);
  endNoKeep = 0;
  if (!e) return -1;
  cloneBoard(eb, e);
  int32_t dt = imax(0, eb->clock - decQ.b->clock);
  Question q2 = decQ; q2.b = eb; q2.holdLeft = 0; q2.holdStarted = 0; q2.narr = 0;
  for (int a = 0; a < decQ.narr; a++) if (decQ.arr[a].at > dt) { q2.arr[q2.narr] = decQ.arr[a]; q2.arr[q2.narr++].at -= dt; }
  Outlived c = outlive(&q2, HORIZON + REST, REST, give, 6, 30);
  int32_t lost = c.set ? c.lostAt : diesIn(&q2, HORIZON + REST);
  if (lost < 0) return -1;
  return lost == FOREVER ? 1e9 : (double)dt + lost;
}
static int ranked(const Read *R, const Found *S) {
  memset(dropped, 0, sizeof dropped); memset(offered, 0, sizeof offered); memset(cutWhy, 0, sizeof cutWhy); memset(cutWhyBreak, 0, sizeof cutWhyBreak);
  carriedJ = 0; unbroken.set = 0; saveAsked = saveNot = saveOk = 0; saveCw = saveCk = -1; svLost = -1; svClean = 0;
  ideaAims = &R->asked; ideasAsks = 0;
  double t0 = nowMs();
  int nc = fairShare(theCands, proposeAll(R, S, theCands, PROPOSED), MAXCANDS), n = 0;
  double t1 = nowMs();
  for (int i = 0; i < nc; i++) offered[theCands[i].play]++;
  readyDefer = 1;   // (the proposers above ask readiness whole; the judging below ranks first)
  readyStop(); readyPendClear(); readyCollect = 1;   // (and keeps each landed board: searched once, its nearest break measured)
  rankReact = C2.reaction + 1;
  rankSave = rankReact + decQ.b->fFLASH + decQ.b->fFACE + decQ.b->fPOP * (3 + W);   // (pa.c matchGarbagePanels: a row of W cells)
  for (int i = 0; i < nc; i++) if (judgeWalked(R, &theCands[i], &theJudged[n])) { order[n] = &theJudged[n]; n++; }
  n = keptJudged(R, n);   // (the intentions the last decision kept, found again)
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
  // (the line in progress too: a line that lived by a break in reach lives on by it, its landed board the one already searched)
  #define READY_ASKS(J_) (!(J_)->o.lives && !(J_)->o.dead && (J_)->o.ready == NOT_ASKED)
  // (THE KEPT PLAN'S LINES -- intentions and routes -- take none of the decision's own search: their readiness is what the workers or
  // the kept breaks already hold, so the time is shared only over the lines the decision would ask with no plan kept)
  #define EXTRA(J_) ((J_)->k.kept || (J_)->k.route)
  readySpread(n);
  int toAsk = 0;
  for (int i = 0; i < n; i++) toAsk += READY_ASKS(order[i]) && !EXTRA(order[i]);
  // (BY YIELD: a board with a break in reach by the shape math has one found for it half the time; one with none, settled, once in
  // fifty, in nearly all of the time a decision spends on readiness -- so those in reach are asked first, best-ranked first, and the
  // rest in the time left)
  for (int pass = 0; pass < 2; pass++)
  for (int i = 0; i < n && leftMs() > 0; i++) {
    Judge *J = order[i];
    if (!READY_ASKS(J) || (J->o.j.readyNear < NEAR_MISS) != (pass == 0)) continue;
    readyKnownOnly = EXTRA(J);
    if (!readyKnownOnly) readyShare(toAsk--);
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
  readyShare(0); readyFresh = 0; readyKnownOnly = 0;
  sortJudged(order, n);
  // (none lives: each is asked too whether a break is in reach once the next block lands -- the order puts those first)
  if (!(n && order[0]->o.lives)) {
    int own = 0; for (int i = 0; i < n; i++) own += !EXTRA(order[i]);
    for (int i = 0; i < n; i++) if (!EXTRA(order[i])) { readyShare(own--); readyNextFor(order[i]); }
    readyShare(0); sortJudged(order, n);
  }
  double t2 = nowMs();
  surviveAsked = 0;
  // (the survival search's line, the backup where nothing lives: the worker's whenever it has finished -- it was searched beside the
  // decision, in the searches' time -- else searched here in what time the decision has left)
  int svDone = __atomic_load_n(&svJobDone, __ATOMIC_ACQUIRE);
  if (!(n && order[0]->o.lives) && (svDone || leftMs() > 0)) {
    surviveAsked = 1;
    Outlived sv = svDone ? svJob : outlive(&decQ, HORIZON + REST, REST, leftMs(), 6, 30);
    offered[PLAY_SURVIVE] = sv.set && sv.nseq ? 1 : 0;
    Cand sk;
    if (sv.set && sv.nseq && candOf(&sk, PLAY_SURVIVE, sv.seq, sv.nseq, -1, 0)) { sk.settled = 0; if (judgeCand(R, &sk, &theJudged[n + 1])) { readyNextFor(&theJudged[n + 1]); svClean = !wastesThree(&theJudged[n + 1]); order[n] = &theJudged[n + 1]; n++; sortJudged(order, n); } }
    if (sv.set) svLost = sv.lostAt == FOREVER ? 1e9 : sv.lostAt;
  }
  // THE THREE TAKEN OUT: each of the best lines that waste a three, judged again with one of its swaps left out at a time -- the line
  // without the swap that makes the three, where it does as well, is a line the order below keeps
  { int ns = 0, tried = 0, none = !(n && order[0]->o.lives), n0 = n;
    for (int i = 0; i < n0 && tried < STRIP_LINES && ns < NSTRIP && leftMs() > 0; i++) {
      const Judge *J = order[i];
      if (J->hold || !wastesThree(J) || J->k.nseq < 2) continue;
      tried++;
      for (int s = 0; s < J->k.nseq && ns < NSTRIP && leftMs() > 0; s++) {
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
  // of the order -- unless every other line is lost within a break's time (rankSave) and a three lives, or is lost later: only there is
  // a three a save
  { int keeps = 0, wasteLives = 0; double wasteLost = -1, keptLost = -1;
    for (int i = 0; i < n; i++) {
      if (wastesThree(order[i])) { if (order[i]->o.lives) wasteLives = 1; else if (lostOf(order[i]) > wasteLost) wasteLost = lostOf(order[i]); }
      else if (order[i]->o.lives) keeps = 1; else if (lostOf(order[i]) > keptLost) keptLost = lostOf(order[i]);
    }
    if (!keeps && keptLost >= rankSave) keeps = 1;
    if (!keeps && !wasteLives && keptLost >= 0 && wasteLost <= keptLost) keeps = 1;
    // (THE SAVE ASKED: where the rule would let a three through, the best line that wastes one and the best that does not -- the hold
    // among them -- are each played to their end and the survival search asked of the boards they leave, the garbage on its way
    // landing as it would. A three whose board, with the best line on, outlasts the other's by nothing was not needed not to die: it
    // is wasted)
    if (!keeps && saveRoomMs() > SAVE_KEEP_MS + 2) {
      const Judge *bw = 0, *bk = 0;
      for (int i = 0; i < n; i++) {
        const Judge *J = order[i];
        if (wastesThree(J)) { if (!bw || J->o.lives > bw->o.lives || (J->o.lives == bw->o.lives && lostOf(J) > lostOf(bw))) bw = J; }
        else if (!bk || lostOf(J) > lostOf(bk)) bk = J;
      }
      if (bw && bk) {
        // (the side without a three: the survival search's own line from now when it wastes none -- searched already, on a worker -- else
        // the best line without one played to its end and searched on; the decision's time all the three's side's when it need not)
        // (the three's side first, with the time; then the side without, bounded below by what is known already -- the best line's own
        // loss, the survival line's when it wastes none: a three that does not beat that is not needed, and only
        // otherwise is the side without searched, in what time is left)
        int have = svLost >= 0 && svClean;
        double kLow = lostOf(bk); if (have && svLost > kLow) kLow = svLost;
        double give = saveRoomMs() - SAVE_KEEP_MS; if (give > SAVE_MS) give = SAVE_MS;
        double cw = contLostOf(bw, give), ck = -1;
        if (cw >= 0 && kLow >= cw) ck = kLow;
        else if (cw >= 0) {
          double give2 = saveRoomMs() - SAVE_KEEP_MS; if (give2 > SAVE_MS) give2 = SAVE_MS;
          double c2 = give2 >= 1 ? contLostOf(bk, give2) : -1;
          ck = c2 > kLow ? c2 : (c2 >= 0 ? kLow : -1);
        }
        saveAsked++;
        saveCw = cw; saveCk = ck;
        if (cw >= 0 && ck >= 0 && ck >= cw) { keeps = 1; saveNot++; }
        else if (cw >= 0 && ck >= 0) saveOk = 1;
      }
    }
    // (only a three the save confirmed is played: any other line that wastes one goes, the hold always left -- the press guard refuses
    // what the order lets through, a walk spent for nothing)
    if (!saveOk) { int m = 0; for (int i = 0; i < n; i++) { if (wastesThree(order[i])) { dropAs(order[i]->k.play, DROP_WASTE); if (order[i] == carriedJ) carriedJ = 0; } else order[m++] = order[i]; } n = m; } }
  phaseMs[0] = (int32_t)(t1 - t0); phaseMs[1] = (int32_t)(t2 - t1); phaseMs[2] = (int32_t)(nowMs() - t2);
  return n;
}

// 5. PLAY: the raise when the opening calls for it, a hold while the raise waits for a busy board, else the first candidate in the one
// order -- a line's first swap, or the hold
typedef struct { const Judge *top, *line; int32_t name, nlive, ncands, urgent, wait, deferred; } Played;
static Played playOf(const Read *R, int n) {
  Played P; memset(&P, 0, sizeof P);
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
typedef struct { int32_t set, id, nrest, rest[MAXLINE], settled, hasAim, broke, popping, ready, anchorRow, anchorCol, anchorId, waits; Aim aim; } Carry;
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
static int anchorInto(Carry *C, const int32_t *row1, const int32_t *seq, int n) {
  for (int c = 1; c <= W; c++) {
    if (row1[c] == NUL) continue;
    int touched = 0;
    for (int i = 0; i < n; i++) if (CR(seq[i]) == 1 && (CC(seq[i]) == c || CC(seq[i]) + 1 == c)) touched = 1;
    if (!touched) { C->anchorRow = 1; C->anchorCol = c; C->anchorId = row1[c]; return 1; }
  }
  return 0;
}
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
  theCarry.set = 1; theCarry.id = qid; theCarry.nrest = k->k.nseq - first;
  for (int i = first; i < k->k.nseq; i++) theCarry.rest[i - first] = k->k.seq[i];
  theCarry.settled = k->settled; theCarry.broke = k->apBroke > 0; theCarry.popping = popLeft(decQ.b) > 0;
  if (k->aim >= 0) { theCarry.hasAim = 1; theCarry.aim = R->guides.aim[k->aim]; }
}
// THE BREAK A HOLD WAITS FOR is the line in progress too: a hold chosen because a break is in reach once everything lands is a promise
// of that break, kept by carrying it -- anchored to a bottom-row panel of the board it was found on -- so the next decision plays it on
// as soon as it lives. A swap played for the break it leaves in reach once everything lands (one swap: nothing of it handed on) is the
// same promise.
static void carryNextOf(const Judge *L) {
  memset(&theCarryNext, 0, sizeof theCarryNext);
  const Judged *j = L ? &L->o.j : 0;
  if (!j || L->hold || L->o.ready != 1 || j->readyN < 1 || !theCarry.set) return;
  if (!anchorInto(&theCarryNext, j->readyRow1, j->readyLine, j->readyN)) return;
  theCarryNext.set = 1; theCarryNext.id = -1; theCarryNext.nrest = j->readyN;
  for (int i = 0; i < j->readyN; i++) theCarryNext.rest[i] = j->readyLine[i];
  theCarryNext.settled = 0; theCarryNext.broke = 1; theCarryNext.ready = 1;
}
static void carryReady(const Judge *H, int32_t qid) {
  const Judged *j = &H->o.j;
  if ((!H->hold && H->k.nseq != 1) || H->o.ready != 1 || j->readyN < 1) return;
  memset(&theCarry, 0, sizeof theCarry);
  if (!anchorOf(j->readyRow1, j->readyLine, j->readyN)) return;
  theCarry.set = 1; theCarry.id = qid; theCarry.nrest = j->readyN;
  for (int i = 0; i < j->readyN; i++) theCarry.rest[i] = j->readyLine[i];
  theCarry.settled = 0; theCarry.broke = 1; theCarry.popping = popLeft(decQ.b) > 0; theCarry.ready = !H->hold;
}
// THE READINESS BESIDE THE DECISION (search/break.c readyJob): the boards the order will ask readiness of handed to the workers,
// worst-ranked first -- the decision asks them best-ranked first -- each searched by whichever thread begins it first. They search on
// past the decision, until the next one takes the pool back (readyStop): a break found then is kept for the decisions after. The
// decision itself runs as it would with no workers.
static Ctx *jobCtx;   // (the phase's own: the jobs make nodes only on their threads' contexts)
static void readySpread(int n) {
  if (pool.nworkers <= 0 || !readyPendN || leftMs() <= 0) return;
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
  readyJobWork = clockWork; readyJobEnd = 0;   // (no share: each searched whole, unless the next decision comes first)
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
static int clearsSomething(const Judge *J) { return !J->hold && (J->apCombo > 0 || J->apChain > 0 || J->apBroke > 0); }
static int anchorFor(const int32_t *row1, const int32_t *seq, int n, int32_t *row, int32_t *col, int32_t *id) {
  for (int c = 1; c <= W; c++) {
    if (row1[c] == NUL) continue;
    int touched = 0;
    for (int i = 0; i < n; i++) if (CR(seq[i]) == 1 && (CC(seq[i]) == c || CC(seq[i]) + 1 == c)) touched = 1;
    if (!touched) { *row = 1; *col = c; *id = row1[c]; return 1; }
  }
  return 0;
}
static void keepIntents(int n, const Judge *played) {
  memset(theIntents, 0, sizeof theIntents);
  int32_t row1[W + 1];
  for (int c = 1; c <= W; c++) row1[c] = anchorIdAt(decQ.b, c);
  for (int i = 0, k = 0; i < n && k < NINTENT; i++) {
    const Judge *J = order[i];
    if (J == played || J->wait || J->o.dead || !clearsSomething(J) || J->k.nseq < 1) continue;
    Intent *I = &theIntents[k];
    if (!anchorFor(row1, J->k.seq, J->k.nseq, &I->anchorRow, &I->anchorCol, &I->anchorId)) continue;
    I->set = 1; I->play = J->k.play; I->nseq = J->k.nseq; I->settled = J->settled;
    for (int q = 0; q < J->k.nseq; q++) I->seq[q] = J->k.seq[q];
    k++;
  }
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
    int dr = NOT_ASKED;
    for (int r = 0; r < decQ.b->nrows && dr == NOT_ASKED; r++) if (decQ.b->p[r][I->anchorCol].f[ID] == I->anchorId) dr = r - I->anchorRow;
    if (dr == NOT_ASKED) continue;
    int32_t seq[MAXLINE];
    for (int q = 0; q < I->nseq; q++) seq[q] = (CR(I->seq[q]) + dr) * 8 + CC(I->seq[q]);
    Cand k;
    if (!candOf(&k, I->play, seq, I->nseq, -1, 0)) continue;
    k.settled = I->settled; k.kept = 1;
    if (judgedHas(n, &k)) continue;
    keptOffered++;
    if (judgeWalked(R, &k, &theJudged[n]) && clearsSomething(&theJudged[n])) { order[n] = &theJudged[n]; n++; }
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
    if (J->wait || J->o.dead || !clearsSomething(J) || !J->settled || J->k.route) continue;
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
static int32_t carryDropN, carryDropRest[MAXLINE], carryDropDead, carryDropCut, carryDropWhy, carryDropNats;
static int carriedCand(const Read *R, Cand *k, int *wait) {
  Carry *C = &theCarry;
  *wait = 0; carryDrop = 0;
  int skip = C->id == carryFrom ? carryPressed : 0;
  if (C->set && C->nrest <= skip && theCarryNext.set) {
    // (the line's own swaps all pressed: the break it lived by is the line in progress now, popping or not as the board is now)
    *C = theCarryNext; memset(&theCarryNext, 0, sizeof theCarryNext); C->popping = popLeft(decQ.b) > 0; skip = 0;
  }
  if (!C->set || C->nrest <= skip) { if (!C->set) carryDrop = carryLost; carryLost = 0; return 0; }
  int dr = NOT_ASKED;
  // (from the row not yet risen: the board a waited-for break was found on may have risen past this one)
  for (int r = 0; r < decQ.b->nrows && dr == NOT_ASKED; r++) if (decQ.b->p[r][C->anchorCol].f[ID] == C->anchorId) dr = r - C->anchorRow;
  if (dr == NOT_ASKED) { carryDrop = 1; return 0; }
  int32_t rest[MAXLINE], nrest = C->nrest - skip;
  for (int i = 0; i < nrest; i++) rest[i] = (CR(C->rest[skip + i]) + dr) * 8 + CC(C->rest[skip + i]);
  // (judged as every line is -- one replayer, what the line makes counted one way -- each step settled when the line was begun so; a
  // settled line waits while the board still moves)
  // (a settled line's next step is pressed on the board settled from the step before, as it was judged: on a board still moving the
  // step is judged once it has settled -- waitTo -- not cut for a walk that cannot begin within a reaction; and a break the readiness
  // found, on the board once everything lands, is pressed on that board: on one still moving it waits as a settled line does)
  int moving = (C->settled || C->ready) && (hasActivePanels(decQ.b) || decQ.b->swappingCount > 0);
  JudgeOpts jo = { C->settled, decQ.tight, NOT_ASKED, 0, 0, -1, 0, 0, 0, moving ? 1 : 0, 0 };
  Judged j;
  judge(&decQ, rest, nrest, &jo, &j);
  carryDropN = nrest; for (int i = 0; i < nrest; i++) carryDropRest[i] = rest[i];
  // (a step no longer legal: the judge pressed fewer than the line has. A line the board is lost on is offered all the same -- judged
  // lost, as any line is, and ranked by its loss: where every line is lost, the line in progress may be lost latest)
  // (a judging the clock stopped is no answer: the line is offered, and the rank reads it as any line the clock cut -- rank.c judgeCand)
  if (!j.dead && !j.late && j.nats < nrest) { carryDrop = 2; carryDropDead = -1; carryDropCut = j.cut; carryDropWhy = j.cutWhy; carryDropNats = j.nats; return 0; }
  *wait = moving;
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
  k->settled = C->settled;
  k->x.combo = x.combo; k->x.chain = x.chain; k->x.broke = x.broke; k->x.cells = x.cells; k->xDone = done; k->xFire = fire;
  k->xNats = nats; for (int i = 0; i < nats; i++) k->xAts[i] = ats[i];
  return 1;
}
