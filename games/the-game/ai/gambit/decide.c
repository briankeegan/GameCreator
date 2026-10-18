// GAMBIT'S DECISION (plans/decision.md): read the board, propose, judge, rank, play -- in that order, once a decision.

// THE QUESTION'S OWN FACTS from the host (answer.c gb_answer): the enemy as the host sends it, whether a raise may begin
typedef struct { int32_t has, out, topKnown, top, stopKnown, stop; } Opp;
static Opp theOpp;
static int32_t canRaiseNow, gambitHit, modeRule = -1, hostTopped, surviveAsked;

// 1. READ: the facts of both boards, the mode and its list, the deadline, the floor every line keeps
#define RAISE_MS 150
static int32_t savingPanels;   // (saving panels up, across decisions; a new game ends it -- gb_new_game)
// THE FLOOR A LINE'S BOARD KEEPS, as the rule in force tests it (facts.c keepsFloor, the line's breaks aside): outcome.c asks it of the
// board every line ends on
static Keep floorKeep; static int32_t floorKeepOn;
static int decisionFloor(const Board *b) { return floorKeepOn ? keepsFloor(&floorKeep, b, 0) : -1; }
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
  R->enemyTopped = theOpp.has && theOpp.out;
  // (the frames until the board is lost if nothing is done, from the engine with the garbage the game shows landing when it lands:
  // sooner than the rise alone takes, the garbage on its way decides it -- queueKills)
  int32_t alone = diesIn(&decQ, F->v[FACT_US_DIES]);
  if (alone < F->v[FACT_US_DIES]) { factSet(F, FACT_US_QUEUEKILLS, 1); F->v[FACT_US_DIES] = alone; }
  // (the rule: the mode in force, else the first whose `when` the facts hold -- else, with no opponent to read (no `when` can hold),
  // the first of the rules, so a board with nobody across still plays)
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
  // (below the material floor a step that clears and breaks nothing is out, as the judge drops it)
  R->belowFloor = R->keepOn && R->keep.t[KEEP_MATERIAL].op && !test(F->v[FACT_US_MATERIAL], R->keep.t[KEEP_MATERIAL]);
  theList = R->list; listOn = 1; decF.belowFloor = R->belowFloor;
  // (garbage on the board: the search asks every entry to break it too; garbage on it or topped out, the deadline is a break's -- before
  // the board dies; the rule's `by` is an attack's)
  R->under = !theTables.underIgnore && F->known[FACT_US_CONTACT];
  if (R->under) { for (int i = 0; i < R->guides.n; i++) R->guides.aim[i].brk = 1; R->end = 1; }
  decF.under = R->under;
  R->asked = R->guides;   // (the list as the board asks it, the rank's: before the defence's entry is added for the searches)
  // (and after its own entries, THE DEFENCE: a combo of four or more that breaks -- the clear that buys stop as it breaks, within every
  // list -- so every mode's searches look for the breaks that keep a board alive, whatever its list asks)
  if (R->under && R->guides.n < MAXAIMS) { Aim d; memset(&d, 0, sizeof d); d.combo.op = OP_GE; d.combo.n = 4; d.brk = 1; R->guides.aim[R->guides.n++] = d; }
  // (A LIST ENDED BY "default" -- every list under garbage -- falls back to the default's own move when none of it can be made: the
  // break search looks off it when it finds no break within it (breakSearch), the searches that aim keep to it, and the order takes a
  // line off it only by living where nothing within it does)
  R->topped = !!F->v[FACT_US_TOPPED]; R->breakWaits = !!F->v[FACT_US_BREAKWAITS];
  defendStop = R->topped && !R->under;   // (judge.c defends: topped with no garbage, the clear that buys stop time is the defence)
  // (SAVING UP PANELS, as the raise holds a band: begun topped with four rows' worth of panels or fewer, and kept until the board holds
  // eight rows' worth and the panels sure to make the list's largest combo ((size - 1) x colours and one); then it spends again)
  {
    int32_t colours = decQ.b->colors > 0 ? decQ.b->colors : 1, panels = panelsOn(decQ.b), big = 3;
    for (int i = 0; i < R->list.n; i++) { const Test *t = &R->list.aim[i].combo; if (t->op == OP_GE || t->op == OP_EQ || t->op == OP_GT) big = imax(big, t->n + (t->op == OP_GT)); }
    int32_t low = 4 * W, high = imax((big - 1) * colours + 1, 8 * W);
    if (!savingPanels && R->topped && panels <= low) savingPanels = 1;
    else if (savingPanels && panels >= high) savingPanels = 0;
    R->saving = savingPanels;
    // (the board fuller than it lives longest with -- the life table's peak -- and not saving: while the owner's band saves panels up,
    // the band decides, never the table)
    R->full = !savingPanels && panels > lifePeakOf();
  }
  if (R->under || R->topped) R->by = NOT_ASKED;
  // (ready: garbage on its way and none on the board -- the frames until the next block lands, 0 for one queued to drop once settled)
  R->readyAt = NOT_ASKED;
  if (!R->under) { for (int i = 0; i < decQ.narr; i++) if (R->readyAt == NOT_ASKED || decQ.arr[i].at < R->readyAt) R->readyAt = decQ.arr[i].at; if (R->readyAt == NOT_ASKED && decQ.b->ninc) R->readyAt = 0; }
  // (the opening raise: until garbage first reaches the board, below `to` rows and no chain running; never after)
  int32_t to = rule->raiseTo ? rule->raiseTo : theTables.raiseTo;
  int opening = !gambitHit && !F->known[FACT_US_CONTACT] && !R->topped;
  R->low = to && opening && fullTop(decQ.b) < to; R->up = R->low && !cascadeLive(decQ.b) && canRaiseNow;
  // (the raise is held for as many rows as leave the board a plan once everything the game shows has landed)
  if (R->up) {
    double l = leftMs(); if (l < 1) l = 1;
    int32_t rows = raiseReady(&decQ, to - fullTop(decQ.b), l < RAISE_MS ? l : RAISE_MS);
    if (rows <= 0) R->up = R->low = 0; else to = fullTop(decQ.b) + rows;
  }
  R->to = to;
  R->pop = popLeft(decQ.b) > 0;
  // (what the board left alone makes while a chain falls or a slab pops, as the game counts it: outside the list, holding is outside it too)
  if (cascadeLive(decQ.b) || R->pop) {
    Outcome a = leftAlone();
    if (!a.dead) { R->aloneChain = a.j.chainAll; Made z = { 0, 0, 0, 0 }; R->aloneOut = !fitsList(&R->list, z, &a.j); }
  }
  return 1;
}

// 2-4. PROPOSE, JUDGE AND RANK: every candidate offered -- the hold among them -- judged by its outcome and put in the one order. With
// none that lives and time left, the survival search proposes its line too.
#define MAXCANDS 128
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
static Judge theJudged[MAXCANDS + 4], *order[MAXCANDS + 4];
static int32_t phaseMs[3];
static int carriedCand(const Read *R, Cand *k, int *wait);
static const Judge *carriedJ;   // the line in progress among the ranked, for the log
static int ranked(const Read *R, const Found *S) {
  memset(dropped, 0, sizeof dropped); memset(offered, 0, sizeof offered);
  carriedJ = 0; unbroken.set = 0;
  double t0 = nowMs();
  int nc = fairShare(theCands, proposeAll(R, S, theCands, PROPOSED), MAXCANDS), n = 0;
  double t1 = nowMs();
  for (int i = 0; i < nc; i++) offered[theCands[i].play]++;
  readyDefer = 1;   // (the proposers above ask readiness whole; the judging below ranks first)
  rankReact = C2.reaction + 1;
  rankSave = rankReact + decQ.b->fFLASH + decQ.b->fFACE + decQ.b->fPOP * (3 + W);   // (pa.c matchGarbagePanels: a row of W cells)
  for (int i = 0; i < nc; i++) if (judgeCand(R, &theCands[i], &theJudged[n])) { order[n] = &theJudged[n]; n++; }
  // (the line in progress: first of its tier when its next step is due now; one whose next step must wait for the board is a hold
  // until then -- it ranks with the hold)
  Cand ck; int cwait = 0;
  if (R->guides.n && carriedCand(R, &ck, &cwait) && judgeCand(R, &ck, &theJudged[n])) {
    Judge *cj = &theJudged[n];
    cj->wait = cwait;
    if (cwait) cj->waitMax = 1; else cj->first = 1;   // (its place: rank.c tierView)
    order[n] = cj; n++; carriedJ = cj;
  }
  // (the hold: never while the chain the board makes alone runs past the list)
  Judge *H = &theJudged[n];
  holdCand(0, H);
  if (!R->aloneOut) { order[n] = H; n++; }
  if (!R->aloneOut) for (int i = 0; i < n; i++) if (order[i] != H && digWaits(order[i], H, C2.reaction + 1)) order[i]->wait = 1;
  sortJudged(order, n);
  // (READY, ASKED BEST FIRST: every option is ranked on what the judging alone says; then, in the time left and best-ranked first, each
  // that does not live yet is asked whether a break is there once everything lands -- the break search on the landed board, an equal
  // part of the time left each -- and the order is made again)
  readyDefer = 0; readyFresh = 1;
  for (int i = 0; i < n && leftMs() > 0; i++) {
    Judge *J = order[i];
    if (J->o.lives || J->o.dead || J->o.ready != NOT_ASKED || J == carriedJ) continue;
    readyShare(n - i);
    if (J->hold) holdCand(J->wait, J);
    else {
      static Judge again; Cand kc = J->k;
      if (judgeCand(R, &kc, &again)) {
        again.wait = J->wait;
        again.outside = again.outside || J->outside;
        *J = again;
      }
    }
  }
  readyShare(0); readyFresh = 0;
  sortJudged(order, n);
  // (none lives: each is asked too whether a break is in reach once the next block lands -- the order puts those first)
  if (!(n && order[0]->o.lives)) { for (int i = 0; i < n; i++) { readyShare(n - i); readyNextFor(order[i]); } readyShare(0); sortJudged(order, n); }
  double t2 = nowMs();
  surviveAsked = 0;
  if (!(n && order[0]->o.lives) && leftMs() > 0) {
    surviveAsked = 1;
    Outlived sv = outlive(&decQ, HORIZON + REST, REST, leftMs(), 6, 30);
    offered[PLAY_SURVIVE] = sv.set && sv.nseq ? 1 : 0;
    Cand sk;
    if (sv.set && sv.nseq && candOf(&sk, PLAY_SURVIVE, sv.seq, sv.nseq, -1, 0)) { sk.settled = 0; if (judgeCand(R, &sk, &theJudged[n + 1])) { readyNextFor(&theJudged[n + 1]); order[n] = &theJudged[n + 1]; n++; sortJudged(order, n); } }
  }
  phaseMs[0] = (int32_t)(t1 - t0); phaseMs[1] = (int32_t)(t2 - t1); phaseMs[2] = (int32_t)(nowMs() - t2);
  return n;
}

// 5. PLAY: the raise when the opening calls for it, a hold while the raise waits for a busy board, else the first candidate in the one
// order -- a line's first swap, or the hold
typedef struct { const Judge *top, *line; int32_t name, nlive, ncands, urgent, wait, deferred; } Played;
static Played playOf(const Read *R, int n) {
  Played P; memset(&P, 0, sizeof P);
  P.wait = R->low && !R->up && !(n && order[0]->k.extend);
  P.top = R->up || P.wait ? 0 : (n ? order[0] : 0);
  P.line = P.top && !P.top->hold && !P.top->wait ? P.top : 0;
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
typedef struct { int32_t set, id, nrest, rest[MAXLINE], settled, hasAim, broke, anchorRow, anchorCol, anchorId; Aim aim; } Carry;
static Carry theCarry;
static int32_t carryFrom = -1, carryPressed;
// THE ANCHOR a line in progress is found again by: the first panel of the bottom row (its ids, row1) that no swap of the line touches,
// into theCarry; 0 when every one is touched. carryOf and carryReady ask it.
static int anchorOf(const int32_t *row1, const int32_t *seq, int n) {
  for (int c = 1; c <= W; c++) {
    if (row1[c] == NUL) continue;
    int touched = 0;
    for (int i = 0; i < n; i++) if (CR(seq[i]) == 1 && (CC(seq[i]) == c || CC(seq[i]) + 1 == c)) touched = 1;
    if (!touched) { theCarry.anchorRow = 1; theCarry.anchorCol = c; theCarry.anchorId = row1[c]; return 1; }
  }
  return 0;
}
static void carryOf(const Read *R, const Judge *k, int32_t qid) {
  memset(&theCarry, 0, sizeof theCarry);
  if (!k || k->wait || k->k.nseq < 2 || k->t.tier > 4) return;
  int32_t row1[W + 1];
  for (int c = 1; c <= W; c++) row1[c] = decQ.b->p[1][c].f[ID];
  if (!anchorOf(row1, k->k.seq, k->k.nseq)) return;
  theCarry.set = 1; theCarry.id = qid; theCarry.nrest = k->k.nseq - 1;
  for (int i = 1; i < k->k.nseq; i++) theCarry.rest[i - 1] = k->k.seq[i];
  theCarry.settled = k->settled; theCarry.broke = k->apBroke > 0;
  if (k->aim >= 0) { theCarry.hasAim = 1; theCarry.aim = R->guides.aim[k->aim]; }
}
// THE BREAK A HOLD WAITS FOR is the line in progress too: a hold chosen because a break is in reach once everything lands is a promise
// of that break, kept by carrying it -- anchored to a bottom-row panel of the board it was found on -- so the next decision plays it on
// as soon as it lives.
static void carryReady(const Judge *H, int32_t qid) {
  const Judged *j = &H->o.j;
  if (!H->hold || H->o.ready != 1 || j->readyN < 1) return;
  memset(&theCarry, 0, sizeof theCarry);
  if (!anchorOf(j->readyRow1, j->readyLine, j->readyN)) return;
  theCarry.set = 1; theCarry.id = qid; theCarry.nrest = j->readyN;
  for (int i = 0; i < j->readyN; i++) theCarry.rest[i] = j->readyLine[i];
  theCarry.settled = 0; theCarry.broke = 1;
}
// CARRIED ON: the rest of the line in progress, found again on this board by its bottom-row panel and
// played on as it is pressed, while every step is legal and it still makes what it was begun for. wait: its next step must wait for
// the board to settle.
// (why the line in progress was not carried on, for the log: 0 carried or none, 1 its anchor panel gone, 2 a step no longer there to
// press or the board lost on it, 3 it no longer breaks, 4 it no longer makes what it was begun for)
static int carryDrop;
static int carriedCand(const Read *R, Cand *k, int *wait) {
  Carry *C = &theCarry;
  *wait = 0; carryDrop = 0;
  int skip = C->id == carryFrom ? carryPressed : 0;
  if (!C->set || C->nrest <= skip) return 0;
  int dr = NOT_ASKED;
  // (from the row not yet risen: the board a waited-for break was found on may have risen past this one)
  for (int r = 0; r < decQ.b->nrows && dr == NOT_ASKED; r++) if (decQ.b->p[r][C->anchorCol].f[ID] == C->anchorId) dr = r - C->anchorRow;
  if (dr == NOT_ASKED) { carryDrop = 1; return 0; }
  int32_t rest[MAXLINE], nrest = C->nrest - skip;
  for (int i = 0; i < nrest; i++) rest[i] = (CR(C->rest[skip + i]) + dr) * 8 + CC(C->rest[skip + i]);
  // (judged as every line is -- one replayer, what the line makes counted one way -- each step settled when the line was begun so; a
  // settled line waits while the board still moves)
  JudgeOpts jo = { C->settled, decQ.tight, NOT_ASKED, 0, 0, -1, 0, 0 };
  Judged j;
  judge(&decQ, rest, nrest, &jo, &j);
  if (j.dead || j.nats < nrest) { carryDrop = 2; return 0; }   // (a step no longer legal: the judge pressed fewer than the line has)
  *wait = C->settled && (hasActivePanels(decQ.b) || decQ.b->swappingCount > 0);
  // (the chain as the game counts it -- one already falling is the line's, begun by its first swap -- as the list's check counts it)
  Made x = { j.made.combo, imax(j.made.chain, j.chainAll), j.made.broke, 0 };
  int32_t done = j.done, fire = j.fire, nats = j.nats, ats[MAXLINE];
  for (int i = 0; i < nats; i++) ats[i] = j.ats[i];
  if (C->broke && !(x.broke > 0)) { carryDrop = 3; return 0; }
  if (C->hasAim && !meets(&C->aim, x)) { carryDrop = 4; return 0; }
  int aim = -1;
  if (C->hasAim) for (int i = 0; i < R->guides.n && aim < 0; i++) if (!memcmp(&R->guides.aim[i], &C->aim, sizeof(Aim))) aim = i;
  if (!candOf(k, *wait ? PLAY_CARRYWAIT : PLAY_CARRY, rest, nrest, aim, 0)) return 0;
  k->settled = C->settled;
  k->x.combo = x.combo; k->x.chain = x.chain; k->x.broke = x.broke; k->x.cells = x.cells; k->xDone = done; k->xFire = fire;
  k->xNats = nats; for (int i = 0; i < nats; i++) k->xAts[i] = ats[i];
  return 1;
}
