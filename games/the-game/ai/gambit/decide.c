// GAMBIT'S DECISION (plans/decision.md): read the board, propose, judge, rank, play -- in that order, once a decision.

// THE QUESTION'S OWN FACTS from the host (answer.c gb_answer): the enemy as the host sends it, whether a raise may begin
typedef struct { int32_t has, out, topKnown, top, stopKnown, stop; } Opp;
static Opp theOpp;
static int32_t canRaiseNow, gambitHit, modeRule = -1, hostTopped, surviveAsked;

// 1. READ: the facts of both boards, the mode and its list, the deadline, the floor every line keeps
#define RAISE_MS 150
static int readBoard_(Read *R) {
  memset(R, 0, sizeof *R);
  FactSet *F = &R->F;
  factsOf(decQ.b, decQ.arr, decQ.narr, hostTopped, F);
  // (what every outcome reads of them: when the last block shown lands, and topped -- JUDGE.lastLanding, R.F.us.topped)
  decF.topped = !!F->v[FACT_US_TOPPED];
  decF.land = NOT_ASKED;
  for (int i = 0; i < decQ.narr; i++) if (decF.land == NOT_ASKED || decQ.arr[i].at > decF.land) decF.land = decQ.arr[i].at;
  if (decF.land == NOT_ASKED && F->known[FACT_US_NEXTLANDS]) decF.land = (int32_t)F->v[FACT_US_NEXTLANDS];
  if (theOpp.has) { factSet(F, FACT_ENEMY_TOPPED, !!theOpp.out); if (theOpp.topKnown) factSet(F, FACT_ENEMY_HEIGHT, theOpp.top); if (theOpp.stopKnown) factSet(F, FACT_ENEMY_STOP, theOpp.stop); }
  R->enemyTopped = theOpp.has && theOpp.out;
  // (the frames until the board is lost if nothing is done, from the engine with the garbage the game shows landing when it lands:
  // sooner than the rise alone takes, the garbage on its way decides it -- queueKills)
  int32_t alone = diesIn(&decQ, F->v[FACT_US_DIES]);
  if (alone < F->v[FACT_US_DIES]) { factSet(F, FACT_US_QUEUEKILLS, 1); F->v[FACT_US_DIES] = alone; }
  int ri = modeRule >= 0 ? namedRule(modeRule) : chooseRule(F);
  if (ri < 0) return 0;
  const Rule *rule = &theTables.r[ri];
  R->rule = ri;
  R->keep = rule->keep.on ? rule->keep : theTables.keep; R->keepOn = R->keep.on;
  R->list = rule->list; R->end = rule->end;
  R->aims = R->list; R->listAims = R->list;
  R->by = deadlineOf(F, rule);
  // (below the material floor a step that clears and breaks nothing is out, as the judge drops it)
  R->belowFloor = R->keepOn && R->keep.t[KEEP_MATERIAL].op && !test(F->v[FACT_US_MATERIAL], R->keep.t[KEEP_MATERIAL]);
  theList = R->list; listOn = 1; decF.belowFloor = R->belowFloor;
  // (garbage on the board: the search asks every entry to break it too; garbage on it or topped out, the deadline is a break's -- before
  // the board dies; the rule's `by` is an attack's)
  R->under = !theTables.underIgnore && F->known[FACT_US_CONTACT];
  if (R->under) { for (int i = 0; i < R->aims.n; i++) R->aims.aim[i].brk = 1; R->end = 1; }
  R->topped = !!F->v[FACT_US_TOPPED]; R->breakWaits = !!F->v[FACT_US_BREAKWAITS];
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
    Outcome a = outcome(0, 0, 0);
    if (!a.dead) { R->aloneChain = a.j.chainAll; Made z = { 0, 0, 0, 0 }; R->aloneOut = !fitsList(&R->list, z, &a.j); }
  }
  return 1;
}

// 2-4. PROPOSE, JUDGE AND RANK: every candidate offered -- the hold among them -- judged by its outcome and put in the one order. With
// none that lives and time left, the survival search proposes its line too.
#define MAXCANDS 128
static Cand theCands[MAXCANDS];
static Judge theJudged[MAXCANDS + 4], *order[MAXCANDS + 4];
static int32_t phaseMs[3];
static int carriedCand(const Read *R, Cand *k, int *wait);
static const Judge *carriedJ;   // the line in progress among the ranked, for the log
static int ranked(const Read *R, const Found *S) {
  memset(dropped, 0, sizeof dropped); memset(offered, 0, sizeof offered);
  carriedJ = 0;
  double t0 = nowMs();
  int nc = proposeAll(R, S, theCands, MAXCANDS), n = 0;
  double t1 = nowMs();
  for (int i = 0; i < nc; i++) offered[theCands[i].play]++;
  for (int i = 0; i < nc; i++) if (judgeCand(R, &theCands[i], &theJudged[n])) { order[n] = &theJudged[n]; n++; }
  // (the line in progress: first of its tier when its next step is due now; one whose next step must wait for the board is a hold
  // until then -- it ranks with the hold)
  Cand ck; int cwait = 0;
  if (R->aims.n && carriedCand(R, &ck, &cwait) && judgeCand(R, &ck, &theJudged[n])) {
    Judge *cj = &theJudged[n];
    cj->wait = cwait;
    if (cwait) { cj->t.tier = imax(cj->t.tier, HOLD_TIER); cj->t.nsub = 1; cj->t.sub[0] = -1; }
    else { for (int q = imin(cj->t.nsub, MAXSUB - 1); q > 0; q--) cj->t.sub[q] = cj->t.sub[q - 1]; cj->t.sub[0] = -1e300; cj->t.nsub = imin(cj->t.nsub + 1, MAXSUB); }
    order[n] = cj; n++; carriedJ = cj;
  }
  // (the hold: never while the chain the board makes alone runs past the list)
  Judge *H = &theJudged[n];
  holdCand(0, H);
  if (!R->aloneOut) { order[n] = H; n++; }
  if (!R->aloneOut) for (int i = 0; i < n; i++) if (order[i] != H && digWaits(order[i], H, C2.reaction + 1)) { order[i]->wait = 1; order[i]->t.tier = HOLD_TIER; order[i]->t.nsub = 1; order[i]->t.sub[0] = -1; }
  sortJudged(order, n);
  double t2 = nowMs();
  surviveAsked = 0;
  if (!(n && order[0]->o.lives) && leftMs() > 0) {
    surviveAsked = 1;
    Outlived sv = outlive(&decQ, HORIZON + REST, REST, leftMs(), 6, 30);
    offered[PLAY_SURVIVE] = sv.set && sv.nseq ? 1 : 0;
    Cand sk;
    if (sv.set && sv.nseq && candOf(&sk, PLAY_SURVIVE, sv.seq, sv.nseq, -1, 0)) { sk.settled = 0; if (judgeCand(R, &sk, &theJudged[n + 1])) { order[n] = &theJudged[n + 1]; n++; sortJudged(order, n); } }
  }
  phaseMs[0] = (int32_t)(t1 - t0); phaseMs[1] = (int32_t)(t2 - t1); phaseMs[2] = (int32_t)(nowMs() - t2);
  return n;
}

// 5. PLAY: the raise when the opening calls for it, a hold while the raise waits for a busy board, else the first candidate in the one
// order -- a line's first swap, or the hold
typedef struct { const Judge *top, *line; int32_t name, nlive, ncands, urgent, wait; } Played;
static Played playOf(const Read *R, int n) {
  Played P; memset(&P, 0, sizeof P);
  P.wait = R->low && !R->up && !(n && order[0]->k.extend);
  P.top = R->up || P.wait ? 0 : (n ? order[0] : 0);
  P.line = P.top && !P.top->hold && !P.top->wait ? P.top : 0;
  P.name = P.line ? P.line->k.play : R->up ? -2 : PLAY_HOLD;   // -2: the raise
  for (int i = 0; i < n; i++) if (order[i]->o.lives) P.nlive++;
  P.ncands = n;
  return P;
}
// THE LINE IN PROGRESS (carryOf): the line of the move played, when it has more than one swap and is a play -- not a hold or a clear. It
// keeps how it is pressed, what it was begun for (its entry, a break), and a panel of the bottom row it does not touch, by which it is
// found again once the stack has risen.
typedef struct { int32_t set, nrest, rest[MAXLINE], settled, hasAim, broke, anchorRow, anchorCol, anchorId; Aim aim; } Carry;
static Carry theCarry;
static void carryOf(const Read *R, const Judge *k) {
  memset(&theCarry, 0, sizeof theCarry);
  if (!k || k->wait || k->k.nseq < 2 || k->t.tier > 4) return;
  int col = 0;
  for (int c = 1; c <= W && !col; c++) {
    int32_t id = decQ.b->p[1][c].f[ID];
    if (id == NUL) continue;
    int touched = 0;
    for (int i = 0; i < k->k.nseq; i++) if (CR(k->k.seq[i]) == 1 && (CC(k->k.seq[i]) == c || CC(k->k.seq[i]) + 1 == c)) touched = 1;
    if (!touched) { col = c; theCarry.anchorRow = 1; theCarry.anchorCol = c; theCarry.anchorId = id; }
  }
  if (!col) return;
  theCarry.set = 1; theCarry.nrest = k->k.nseq - 1;
  for (int i = 1; i < k->k.nseq; i++) theCarry.rest[i - 1] = k->k.seq[i];
  theCarry.settled = k->settled; theCarry.broke = k->apBroke > 0;
  if (k->aim >= 0) { theCarry.hasAim = 1; theCarry.aim = R->aims.aim[k->aim]; }
}
// CARRIED ON: the rest of the line in progress, found again on this board by its bottom-row panel and
// played on as it is pressed, while every step is legal and it still makes what it was begun for. wait: its next step must wait for
// the board to settle.
static int carriedCand(const Read *R, Cand *k, int *wait) {
  Carry *C = &theCarry;
  *wait = 0;
  if (!C->set || !C->nrest) return 0;
  int dr = NOT_ASKED;
  for (int r = 1; r < decQ.b->nrows && dr == NOT_ASKED; r++) if (decQ.b->p[r][C->anchorCol].f[ID] == C->anchorId) dr = r - C->anchorRow;
  if (dr == NOT_ASKED) return 0;
  int32_t rest[MAXLINE];
  for (int i = 0; i < C->nrest; i++) rest[i] = (CR(C->rest[i]) + dr) * 8 + CC(C->rest[i]);
  Made x; int32_t done, fire, nats = 0, ats[MAXLINE];
  if (C->settled) {
    Replayed rp;
    if (!replay(&decQ, rest, C->nrest, 1, &rp)) return 0;
    *wait = rp.wait > 1;
    x = (Made){ rp.combo, rp.chain, rp.broke, rp.cells }; done = rp.done; fire = rp.fire; nats = rp.nats; for (int i = 0; i < nats; i++) ats[i] = rp.ats[i];
  } else {
    JudgeOpts jo = { 0, decQ.tight, NOT_ASKED, 0, 0, -1, 0, 0 };
    Judged j;
    judge(&decQ, rest, C->nrest, &jo, &j);
    if (j.dead || j.nats < C->nrest) return 0;   // (a step no longer legal: the judge pressed fewer than the line has)
    x = (Made){ j.made.combo, j.made.chain, j.made.broke, 0 }; done = j.done; fire = j.fire; nats = j.nats; for (int i = 0; i < nats; i++) ats[i] = j.ats[i];
  }
  if ((C->broke && !(x.broke > 0)) || (C->hasAim && !meets(&C->aim, x))) return 0;
  int aim = -1;
  if (C->hasAim) for (int i = 0; i < R->aims.n && aim < 0; i++) if (!memcmp(&R->aims.aim[i], &C->aim, sizeof(Aim))) aim = i;
  if (!candOf(k, *wait ? PLAY_CARRYWAIT : PLAY_CARRY, rest, C->nrest, aim, 0)) return 0;
  k->settled = C->settled;
  k->x.combo = x.combo; k->x.chain = x.chain; k->x.broke = x.broke; k->x.cells = x.cells; k->xDone = done; k->xFire = fire;
  k->xNats = nats; for (int i = 0; i < nats; i++) k->xAts[i] = ats[i];
  return 1;
}
