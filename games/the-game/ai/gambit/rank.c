// THE RANK (hold, compare, digWaits; plans/decision.md step 4): every candidate a proposer offers, judged by its
// outcome and filtered -- a swap back, outside the list, below the floor, too late -- then given its place: one order for every
// candidate, a line that lives before one that does not; of two that live, the tier and its sub-keys; of two that do not, the one
// whose board is lost later.

// A CANDIDATE: the play, its swaps, what the search that found it says it makes (x), the entry it was found
// for (aim, -1 none), whether it extends a cascade, how it is judged (settled: -1 as its play is)
typedef struct {
  int32_t set, play, nseq, seq[MAXLINE], aim, extend, settled;
  int32_t grown;   // a line another proposed, one more panel walked into its match (propose.c growLines)
  int32_t drop;    // a perched block let down (search/break.c perchedDrops)
  int32_t kept;    // an intention the last decision kept, found again (decide.c keptJudged)
  int32_t way;     // a line another proposed, with a swap that does something made first on the cursor's way to it (propose.c wayLines)
  int32_t route;   // two lines on columns apart made one, in walking order (decide.c routeJudged)
  int32_t pair;    // a line that fires two ideas, one after the other (search/plan.c pair; decide.c routeJudged)
  int32_t builds;  // a set-up whose board comes nearer the list's first entry than the board as it is (propose.c; decide.c carriedCand)
  int32_t at0;     // the line in progress: its first swap's walk begun no sooner than this frame, as it was chosen (decide.c carriedCand)
  int32_t tapOf;   // and its walks tapped or held as they were when it was chosen: 1 + that pressTap (0: the decision's)
  int32_t waitTo;  // and the frame its board is run to and let settle before its first swap (0: none)
  Xs x; int32_t xFire, xDone, xNats, xAts[MAXLINE];   // xFire/xDone: -1 not said
} Cand;
// A JUDGED CANDIDATE: its place (tier, sub), its outcome, and what the move played reads (ap)
typedef struct {
  Cand k;
  int32_t settled, aim, wait, hold;
  Tier t;
  Outcome o;
  int32_t apDone, apFire, apNats, apAts[MAXLINE], apChain, apChainAll, apCombo, apBroke, apPlayed;
  int32_t apWhole;     // the chain the board ends up making with the line played (Judged.whole)
  int32_t readyNext;   // a break in reach once the next block lands (readyNextOf), asked when none lives; NOT_ASKED: not asked
  int32_t endReady;    // the board it (or its plan) ends on is ready for the next block the mode sends (outcome.c endReadyOf): 1, 0, NOT_ASKED
  int32_t endReadyWhy; // and why not (outcome.c endReadyWhy)
  int32_t planN, planWait, planLine[MAXLINE], planRow1[W + 1];
  int32_t planAt[MAXLINE];   // each swap of the plan's frame, 0 as the board lets (outcome.c readyNextOf pAt)
  int32_t planBreaks, planBreakAt[16];   // the frame each of its plan's breaks is pressed from (outcome.c readyNextOf)
  int32_t planBroke;   // the garbage its plan converts beyond the board left alone (outcome.c readyNextOf)
  int32_t planMargin[5];   // the margin its plan leaves: top, material, contact, under, its last swap's frame (outcome.c planLanded); [0] -1 not read
  int32_t solDue, solPaid, solShort, solAt;   // its ledger (ledgerOf): rows due, rows paid, the shortfall at worst, the first frame short (FOREVER never)   // and that break: its swaps, the frame it is pressed from, the bottom row it was found on (what anchors it) -- carried when the line is played (decide.c carryNextOf)
  int32_t extLost;     // and where that break leads: the line and the break played, lost then (readyNextOf); NOT_ASKED: not asked
  int32_t extSpent;    // and the actions that plan presses, the line and its breaks (readyNextOf); NOT_ASKED: not asked
  int32_t outside;     // outside the list, taken as the default's own move (a list ended by "default")
  int32_t spends;      // outside it for spending the rules' floor or the reserve (outcome.c spendsFloor, spendsReserve)
  int32_t met;         // the entry of the list as the board asks it the judged line meets, -1 none (rules.c metOf)
  int32_t first;       // the line in progress, its next step due now: first of its tier (decide.c ranked)
  int32_t carried;     // the line in progress, carried on from the last decision (decide.c carriedCand)
  int32_t idle;        // a line that clears nothing and does no better than the hold (markIdle): ranked after the hold
  int32_t threeNeeded;   // its three the save confirmed the board needs not to die (decide.c): no wasted three to the list
  int32_t fallback;      // an attack of its own, breaking nothing, that meets an entry of the list after its first, or none (rule 4)
  int32_t builds;        // a line that fires nothing and builds toward the list's first entry (Cand builds)
  int32_t holdSunk;    // a hold lost sooner than a line lost alike with it that keeps the board's own chain: after every line lost alike (sortJudged)
  double idleLost;     // and, of two that do not live, lost as the hold is and a half frame sooner (an unknown is not shown better)
  int32_t waitMax;     // a line waiting, ranked with the hold at the hold's tier or its own when lower (the line in progress)
  int32_t material;    // a break under garbage: 0 leaves a break to build and keeps the floor, 1 keeps one of them, 2 neither; -1 none
  int32_t ideas, ideasAsked;   // the ideas the board the line leaves holds (search/ideas.c; -1 the clock left none), asked when a key needs it
} Judge;
// why a candidate was dropped, counted per decision for the log (DROP_CODE: b back, o list, t late, f floor, r ready, u unbroken, c a swap
// the judge could not press, w a wasted three, j the clock stopped its judging)
enum { DROP_BACK, DROP_LIST, DROP_LATE, DROP_FLOOR, DROP_READY, DROP_UNBROKEN, DROP_CUT, DROP_WASTE, DROP_UNJUDGED, NDROPS };
// (each thread's own -- the judging runs on every thread, decide.c judgeJob, and each candidate's are added in order after)
static LOCAL int32_t dropped[NPLAYS][NDROPS];
static int32_t offered[NPLAYS];
static void dropAs(int play, int why) { dropped[play][why]++; }
// (the lines cut, by why the judge cut them: judge.c cutWhy -- 1 a first walk over the allowance, 2 no swap there, 3 a walk not begun
// within a reaction -- and how many of them the break search found)
static LOCAL int32_t cutWhy[4], cutWhyBreak[4];
// THE FIRST LINE OF A DECISION THE BREAK SEARCH SAID BREAKS AND THE JUDGE SAYS DOES NOT: its play, swaps and both counts, for the log
// and the board's dump (two measures of one fact)
typedef struct { int32_t set, play, nseq, seq[MAXLINE], said, judged; } Unbroken;
static LOCAL Unbroken unbroken;
static LOCAL int32_t besideJudge;   // (judging on a worker: decide.c judgeJob -- the ideas are asked by the decision's own thread)

// the decision's reading of the board, which every candidate is judged by (decide.c read)
typedef struct {
  FactSet F; int32_t enemyTopped;
  List list, asked, guides; int32_t end;
  // (list: the rule's, its priorities; guides: the list as the board asks it -- every entry a break under garbage, then the one rule's
  // three that breaks -- the searches', a proposal's aim indexes it; asked: the same, the rank's)
  int32_t by;                      // NOT_ASKED: none
  int32_t under, topped, breakWaits, belowFloor;
  Keep keep; int32_t keepOn;
  int32_t readyAt;                 // NOT_ASKED: none
  int32_t pop, to, low, up;
  int32_t aloneChain, aloneOut;
  int32_t rule;
} Read;

// a sub-key put in at `pos`, the keys from there on after it (one that does not fit is dropped from the end)
static void tierInsert(Tier *t, int pos, double v) {
  if (pos > t->nsub) pos = t->nsub;
  for (int q = imin(t->nsub, MAXSUB - 1); q > pos; q--) t->sub[q] = t->sub[q - 1];
  if (pos < MAXSUB) t->sub[pos] = v;
  t->nsub = imin(t->nsub + 1, MAXSUB);
  if (pos <= t->nlist) t->nlist++;
}
// (THE LINE IN PROGRESS AS IT WAS CHOSEN, every judging of it: from its planned frame, its walks as they were -- asLine before, unLine
// after; any other line, the decision's own)
static LOCAL int32_t unTap;
static void asLine(const Cand *k) { lineAt0 = k->at0; lineWaitTo = k->waitTo; unTap = pressTap; if (k->tapOf) pressTap = k->tapOf - 1; }
static void unLine(void) { lineAt0 = lineWaitTo = 0; pressTap = unTap; }
static int nearActsOf(const Judge *J, int32_t near);
#ifdef GB_TEST
static void gb_trace_cand(int play, const int32_t *seq, int n, int fc);   // (test/decide_check.c, under GC_GAMBIT_TRACE)
static void gb_trace_walked(int ok, int wok, int cmp, int key, const char *why, const Judge *J, const Judge *JW);
#endif
static int judgeCand(const Read *R, const Cand *k0, Judge *J) {
  memset(J, 0, sizeof *J);
  J->readyNext = NOT_ASKED; J->endReady = NOT_ASKED; J->extLost = NOT_ASKED; J->extSpent = NOT_ASKED; J->planN = 0; J->planBroke = 0; J->planMargin[0] = -1; J->threeNeeded = 0;
  J->k = *k0;
  Cand *k = &J->k;
  int play = k->play, aim = k->aim;
  int st = k->settled >= 0 ? k->settled : settledPlay(play);
  // (what it makes is the whole line on the engine, as the judge counts it -- not what the search that found it counted; a line the
  // judge could not play out is judged on the search's word)
  // (the line in progress waiting for the board to settle: judged on the board settled, as carriedCand found it)
  asLine(k);
  Outcome oc = play == PLAY_CARRYWAIT && !k->waitTo ? outcomeOf(k->seq, k->nseq, st, 0, 1) : outcome(k->seq, k->nseq, st);
  unLine();
  // (A LINE THE JUDGE COULD NOT PLAY OUT IS NO LINE: a swap not there to press, however long the board is let settle, and the line
  // stops -- its board is not the one the line makes, so it is not ranked as if it were)
  if (judgedCut(&oc.j)) { dropAs(play, DROP_CUT); int w = oc.j.cutWhy >= 1 && oc.j.cutWhy <= 3 ? oc.j.cutWhy : 0; cutWhy[w]++; if (play == PLAY_BREAKSEARCH || play == PLAY_LINEUPBREAK) cutWhyBreak[w]++; return 0; }
  // (ONE THE CLOCK STOPPED THE JUDGE ON: its board past that frame unknown -- ranked as a line lost on the frame it was judged alive to,
  // what it makes on the search's word: never a board that lasts, and never dropped for a hold that dies sooner. A grown line has no
  // search's word, only the judge's, so one the judge did not finish is no line)
  if (oc.late) {
    if (oc.j.aliveTo <= 0 || k->grown) { dropAs(play, DROP_UNJUDGED); return 0; }
    oc.late = 0; oc.dead = 1; oc.lives = 0; oc.lostAt = oc.j.aliveTo; oc.ready = NOT_ASKED;
  }
  const Judged *j = oc.dead ? 0 : &oc.j;
  Made m = j ? (Made){ j->made.combo, j->made.chain, j->made.broke, k->x.cells } : (Made){ k->x.combo, k->x.chain, k->x.broke, k->x.cells };
  if (j && k->x.broke > 0 && !(j->made.broke > 0)) {
    dropAs(play, DROP_UNBROKEN);
    if (!unbroken.set) { unbroken.set = 1; unbroken.play = play; unbroken.nseq = k->nseq; for (int i = 0; i < k->nseq; i++) unbroken.seq[i] = k->seq[i]; unbroken.said = k->x.broke; unbroken.judged = j->made.broke; }
  }
  // (the swap back asks what the first swap made -- judge.c madeBy, as the searches ask it; a line judged dead, what it was offered for)
  if (k->nseq && swapBack(CR(k->seq[0]), CC(k->seq[0]), j ? j->firstMade : m.broke > 0 ? 2 : m.combo > 0 || m.chain > 0)) { dropAs(play, DROP_BACK); return 0; }
  // (it fits the list -- the chain as the game counts it -- or it is outside it: ranked after every line within it that lives, and kept,
  // so a list never chooses a death. A line that spends the rules' floor (outcome.c spendsFloor, the shared line check's own test) is
  // outside too)
  if (m.chain > MAXCHAIN) { dropAs(play, DROP_LIST); return 0; }
  if (!(j ? fitsList(&R->list, m, j, 0) : fits(&R->list, m))) J->outside = 1;
  if (j && lineSpends(j, oc.floorKept)) J->outside = J->spends = 1;
  // (THE ENTRY A LINE MEETS, the one the list's key and the tier's keys read: of the list as the board asks it (R->asked) -- its
  // entries, then the one rule's three that breaks)
  // (read off what the board ends up making, the chain already under way included: a swap that cuts it short meets what is left of it,
  // and leaving it alone -- the hold -- meets what it makes)
  int entry = metOf(&R->asked, j ? (Made){ j->whole.combo, j->whole.chain, j->whole.broke, m.cells } : m);
  J->met = j ? entry : -1;
  // (THE LIST'S FIRST ENTRY IS WHAT THE MODE GOES FOR, the owner: the rest are for when not doing them would kill it -- the order's
  // survival keys come before the list, and within the list a fallback ranks after a line that fires nothing. A break is the rule under
  // garbage, never a fallback)
  J->fallback = j && R->asked.n > 0 && entry != 0 && !(m.broke > 0) && (m.combo >= 4 || m.chain >= 2);
  // (the next break's material, as the engine leaves the board: a break to build, the floor kept -- outcome.c nextBuild, floorKept)
  J->material = R->under && m.broke > 0 ? (oc.nextBuild == 0) + (oc.floorKept == 0) : -1;
  // (the entry a line is ranked for is the one the judged line meets; the search's word only where the judge could not play it out)
  if (j) aim = entry; else if (entry >= 0 && (aim < 0 || entry < aim)) aim = entry;
  // (in time: the line's last swap begun by the deadline -- the frame the judge pressed it; the search's own word only when the judge
  // could not play the line out)
  int32_t fire = j && j->fire >= 0 ? j->fire : (k->xFire >= 0 ? k->xFire : k->xDone);
  if (R->by != NOT_ASKED && R->by && fire >= 0 && fire > R->by) { dropAs(play, DROP_LATE); return 0; }
  // (a set-up is to clear nothing: it ends before its first step that clears panels and breaks nothing; when that is its first, the
  // play is a clear)
  Xs x = k->x;
  if (setupPlay(play)) {
    int fc = firstClear(&decQ, k->seq, k->nseq);
#ifdef GB_TEST
    gb_trace_cand(play, k->seq, k->nseq, fc);
#endif
    if (fc == 0) { play = PLAY_CLEAR; memset(&x, 0, sizeof x); x.combo = 3; x.chain = 1; x.floor = -1; m.combo = 3; m.chain = 1; m.broke = 0; m.cells = 0; }
    else if (fc > 0) k->nseq = fc;
  }
  k->play = play;
  // (a set-up, cut before its first clear, or the rest of one carried on that still clears nothing)
  J->builds = k->builds && (play == PLAY_SETUP || !(m.combo > 0 || m.chain > 0));
  // (ranked on the judge's count and time)
  Xs tx = x;
  tx.floor = oc.floorKept >= 0 ? oc.floorKept : tx.floor;   // (the floor the judged board keeps, the claim only where it was not asked)
  tx.combo = m.combo; tx.chain = m.chain; tx.broke = m.broke; tx.done = j ? j->done : (k->xDone >= 0 ? k->xDone : 0); tx.dropAt = j ? j->dropAt : 0;
  J->t = tierOf(play, &tx, aim, R->under, R->enemyTopped, R->topped, R->breakWaits);
  // (topped out, the stop time and the shake are the board's life: a line that keeps it held past what is left now comes first -- under
  // garbage one that breaks before one that does not: a break turns garbage into the panels the next one needs)
  const Board *b = decQ.b;
  int32_t stopNow = imax(b->stopTime + b->preStopTime, b->shakeTime);
  if (R->topped && j && j->dropAt > stopNow) {
    int brk = R->under && m.broke > 0;
    J->t.tier = 0; J->t.nsub = 3; J->t.nlist = 2; J->t.sub[0] = R->under ? (brk ? 0 : 1) : 0; J->t.sub[1] = aim >= 0 ? aim : 99; J->t.sub[2] = -j->dropAt;
  }
  // (THE LIFE ITS PANELS LEAVE (outcome.c lifeOf, measured), then THE NEAREST BREAK AFTER IT: of two in one tier, the one whose board has
  // more life by the panels left on it, then the one nearer its next break -- right after the list's own keys)
  // -- under garbage the nearer break first: the next break is the board's life there, and the panels kept by doing nothing never make it
  if (oc.panelsLeft >= 0) {
    if (R->under && oc.nearAfter >= 0) { tierInsert(&J->t, J->t.nlist, nearActsOf(J, oc.nearAfter)); tierInsert(&J->t, J->t.nlist + 1, -(double)oc.lifeLeft); }
    else {
      tierInsert(&J->t, J->t.nlist, -(double)oc.lifeLeft);
      if (oc.nearAfter >= 0) tierInsert(&J->t, J->t.nlist + 1, nearActsOf(J, oc.nearAfter));
    }
  }
  J->settled = st; J->aim = aim; J->o = oc;
  J->apDone = j ? j->done : k->xDone; J->apFire = fire;
  if (j) { J->apNats = j->nats; for (int i = 0; i < j->nats; i++) J->apAts[i] = j->ats[i]; }
  else { J->apNats = k->xNats; for (int i = 0; i < k->xNats; i++) J->apAts[i] = k->xAts[i]; }
  J->apChain = m.chain; J->apChainAll = j ? j->chainAll : 0; J->apCombo = m.combo; J->apBroke = m.broke; J->apPlayed = !!j;
  J->apWhole = j ? j->whole.chain : 0;
  return 1;
}
// THE HOLD, a candidate like any other: nothing pressed, its outcome the board's own -- below every play that fits, above a clear
#define HOLD_TIER 5
static int32_t aloneChain;   // the chain the board left alone makes, as the hold's judging found it
static void holdCand(const Read *R, int wait, Judge *J) {
  memset(J, 0, sizeof *J);
  J->readyNext = NOT_ASKED; J->endReady = NOT_ASKED; J->extLost = NOT_ASKED; J->extSpent = NOT_ASKED; J->planN = 0; J->planBroke = 0; J->planMargin[0] = -1; J->threeNeeded = 0;
  // (the hold presses nothing: it meets the entry the board makes left alone, if any, and is no break -- never a break's best material)
  J->o = outcome(0, 0, 0);
  J->material = -1;
  J->met = J->o.dead ? -1 : metOf(&R->asked, (Made){ J->o.j.whole.combo, J->o.j.whole.chain, 0, 0 });
  aloneChain = J->o.j.whole.chain;   // (made before the board is lost too: judge.c, a settle the board is lost in)
  J->k.play = PLAY_HOLD; J->k.aim = -1; J->hold = 1; J->wait = wait; J->aim = -1;
  J->t.tier = HOLD_TIER; J->t.nsub = 1; J->t.sub[0] = wait ? -1 : 0;
  const Judged *j = J->o.dead ? 0 : &J->o.j;
  J->apDone = j ? j->done : -1; J->apFire = -1; J->apChainAll = j ? j->chainAll : 0; J->apPlayed = !!j;
}
// A DIG THAT CAN WAIT: a line toward a break that lives no longer than the hold, and is still done before the hold is lost after one
// more decision (react frames)
static double contLostOf(const Judge *J, double give);
static double contLostOfLine(const Judge *J, double give, int32_t *seq, int32_t *nseq);   // (decide.c)   // (decide.c)
static double lostAtOf(int32_t t, int hold);
// PROVEN (plans/gambit-next.md 1, 4): a plan that, played on the engine, stands past the last row shown is due and PROOF_ROWS rows' breaks
// more -- the margin for garbage not shown, the owner's to set. FOREVER lives
#define PROOF_ROWS 1
// (the frame a plan must stand past: the last row shown due, and a break's time for it and for each row of the margin -- frames from now)
static double proofFrame(void) { return (double)(nLandAts ? landAts[nLandAts - 1] : 0) + (1 + PROOF_ROWS) * (double)imax(1, rankSave); }
static int planProven(int32_t lost) {
  if (lost == FOREVER) return 1;
  if (lost == NOT_ASKED || lost < 0) return 0;
  return (double)lost > proofFrame();
}
// (of two plans, the proven; then the one that converts more; then the one lost later)
#define PLAN_LANDS 4
static int32_t landsAsked, landsTaken;   // (this decision's later landings asked and the plans taken from them: the log's lands=)
static int planBetter(int32_t lx, int32_t bx, int32_t ly, int32_t by) {
  int px = planProven(lx), py = planProven(ly);
  if (px != py) return px;
  if (bx != by) return bx > by;
  return (lx == NOT_ASKED ? -1 : lostAtOf(lx, 0)) > (ly == NOT_ASKED ? -1 : lostAtOf(ly, 0));
}
static void readyNextFor(Judge *J) {
  if (J->readyNext != NOT_ASKED) return;
  // (a line that lives: only whether the board it ends on is ready for the next block, plans/gambit-next.md 1)
  if (J->o.lives) {
    if (J->endReady == NOT_ASKED && nextBlk.height > 0 && !clockOut()) {
      if (!J->hold) asLine(&J->k);
      Board *eb = J->hold ? decQ.b : lineEnd(J->k.seq, J->k.nseq, J->settled);   // (the hold's end board is the board as it is)
      J->endReady = endReadyOf(eb);
      J->endReadyWhy = endReadyWhy;
      if (!J->hold) unLine();
    }
    return;
  }
  if (!J->hold) asLine(&J->k);
  int32_t land = decF.next;
  if (land == NOT_ASKED && garbageOn(decQ.b)) { int32_t end = J->hold ? 0 : J->o.j.endAt; land = end + regainAfter(end, J->hold ? 0 : J->o.j.spent); }
  J->readyNext = readyNextOf(J->k.seq, J->k.nseq, J->hold ? 0 : J->settled, land, &J->extLost, &J->extSpent, J->planLine, &J->planN, J->planRow1, &J->planWait, J->planAt);
  J->planBreaks = imin(planBreakN, 16); for (int k = 0; k < J->planBreaks; k++) J->planBreakAt[k] = planBreakAt[k];
  J->planBroke = planBroke; for (int k = 0; k < 5; k++) J->planMargin[k] = planMargin[k];
  J->endReady = planEndReady;
  // (CONVERT MORE PER BREAK, plans/gambit-next.md 5: under attack, material comes only from breaking, and a break pressed after more has
  // landed converts more -- where the plan from the next landing is not proven, its break is asked from each later landing shown too, and
  // the plan kept is the one proven, else the one that converts most, else the one lost latest)
  if (land == decF.next && land != NOT_ASKED && !planProven(J->extLost)) {
    // (the landings after the next, soonest first, PLAN_LANDS of them at most)
    int32_t ats[MAXARR], na = 0;
    for (int i = 0; i < decQ.narr && na < MAXARR; i++) {
      int32_t a = decQ.arr[i].at; int dup = a <= land;
      for (int k = 0; k < na && !dup; k++) dup = ats[k] == a;
      if (dup) continue;
      int k = na++;
      while (k > 0 && ats[k - 1] > a) { ats[k] = ats[k - 1]; k--; }
      ats[k] = a;
    }
    if (na > PLAN_LANDS) na = PLAN_LANDS;
    for (int i = 0; i < na && !clockOut(); i++) {
      int32_t xl, xs, xn, xw, xline[MAXLINE], xrow[W + 1], xat[MAXLINE];
      readyKind = READY_KIND_LAND + i;
      int r = readyNextOf(J->k.seq, J->k.nseq, J->hold ? 0 : J->settled, ats[i], &xl, &xs, xline, &xn, xrow, &xw, xat);
      readyKind = 2; landsAsked++;
      if (r != 1 || !planBetter(xl, planBroke, J->extLost, J->planBroke)) continue;
      landsTaken++;
      J->readyNext = r; J->extLost = xl; J->extSpent = xs; J->planN = xn; J->planWait = xw; J->planBroke = planBroke; J->endReady = planEndReady;
      for (int k = 0; k < 5; k++) J->planMargin[k] = planMargin[k];
      for (int k = 0; k < xn; k++) { J->planLine[k] = xline[k]; J->planAt[k] = xat[k]; }
      for (int k = 0; k <= W; k++) J->planRow1[k] = xrow[k];
      J->planBreaks = imin(planBreakN, 16); for (int k = 0; k < J->planBreaks; k++) J->planBreakAt[k] = planBreakAt[k];
    }
  }
  if (!J->hold) unLine();
  // (READY FOR THE NEXT BLOCK not asked by the plan -- nothing shown, or its judging kept no end board: asked of the board the line itself
  // ends on, plans/gambit-next.md 1)
  if (J->endReady == NOT_ASKED && nextBlk.height > 0 && !clockOut()) {
    if (!J->hold) asLine(&J->k);
    Board *eb = J->hold ? decQ.b : lineEnd(J->k.seq, J->k.nseq, J->settled);
    J->endReady = endReadyOf(eb);
    if (!J->hold) unLine();
  }
  J->endReadyWhy = endReadyWhy;
  // (and where no break is found to lead on to, the plan goes on as the survival search plays on from the board the line leaves
  // (decide.c contLostOf), in the readiness check's share: a line is lost where the best that can be played after it is -- a break that
  // converts its garbage and survives on outlasts a line that only survives, and is judged so)
  if (!J->hold && J->extLost == NOT_ASKED && readyShareMs > 0 && !clockOut()) {
    double c = contLostOf(J, readyShareMs);
    if (c >= 1e9) J->extLost = FOREVER;
    else if (c >= 0 && c > lostAtOf(J->o.lostAt, 0)) J->extLost = (int32_t)c;
  }
}
static double lostOf(const Judge *x);
static int digWaits(const Judge *k, const Judge *H, int32_t react) {
  return k->k.play == PLAY_TOWARD && !k->o.lives && !H->o.lives && H->o.lostAt != NOT_ASKED && k->o.j.done >= 0 && !k->o.dead &&
         lostOf(k) <= lostOf(H) && lostOf(H) - k->o.j.done > react;
}
// THE LOSS A LINE IS JUDGED BY (the one order is compareJudged, plans/gambit-next.md): its board's, or its plan's when that is later
// (a line whose judging the clock cut has no known loss: it proves nothing, and ranks unproven)
// (a line ready for the next block is lost where its readiness break leads, when that is later -- the hold too: holding while the window
// fills, then pressing the break, is a plan like any other)
static int32_t rankReact;   // (frames to the next decision: a reaction and a frame, set by the decision -- decide.c ranked)
static int32_t rankSave;    // (and the frames one break takes after it: a full-width slab's row popped -- flash, face, a pop a cell)
static int32_t rankLow;     // (the board low on panels: decide.c lowOnPanels)
static double lostAtOf(int32_t t, int hold) { return t == FOREVER ? 1e300 : t == NOT_ASKED ? (hold ? -1 : 1e299) : t; }
static double lostOf(const Judge *x) {
  if (x->idle) return x->idleLost;   // (a move must beat doing nothing: markIdle)
  double own = lostAtOf(x->o.lostAt, x->hold);
  if (x->extLost == NOT_ASKED) return own;
  double ext = lostAtOf(x->extLost, 0);
  return ext > own ? ext : own;
}
// A LINE'S TIER AS THE ORDER READS IT: a line that must wait for the board ranks with the hold (at the hold's tier, or its own when that
// is lower for the line in progress, waitMax), before the hold itself; a line that clears nothing and does no better than holding
// (idle) right after the hold; the line in progress whose next step is due now is first of its tier. The only place a line's tier is read otherwise than tierOf made it.
static Tier tierView(const Judge *J) {
  Tier t = J->t;
  if (J->wait && !J->hold) { t.tier = J->waitMax ? imax(t.tier, HOLD_TIER) : HOLD_TIER; t.nsub = 1; t.sub[0] = -1; }
  else if (J->idle) { t.tier = HOLD_TIER; t.nsub = 1; t.sub[0] = 1; }
  else if (J->first) { for (int q = imin(t.nsub, MAXSUB - 1); q > 0; q--) t.sub[q] = t.sub[q - 1]; t.sub[0] = -1e300; t.nsub = imin(t.nsub + 1, MAXSUB); }
  return t;
}
// A MOVE MUST BEAT DOING NOTHING: a line that clears nothing comes before the hold only when the engine says it does better than holding
// -- a later loss, a nearer break, or ready for the next block where the hold is not. (Not more life by its panels: a line that clears
// nothing leaves the panels the hold does, and two such boards read at different frames differ only by what landed between.) Being offered is never a
// reason to be played. (markIdle, before every sort of the order: idle lines rank after the hold, tierView)
// (A LINE THAT CLEARS: panels cleared or garbage broken by what it presses, as judged -- the hold presses nothing. Every reader asks it)
static int clears(const Judge *J) { return !J->hold && (J->apCombo > 0 || J->apChain > 0 || J->apBroke > 0); }
// THE IDEAS A LINE LEAVES (search/ideas.c, several ideas at once): the board it ends on, the attacks one swap from fired there -- asked
// the first time a key compares them, and kept with the line
// (only with no garbage on the board -- under it the list's entries are breaks, and one a swap away is the break search's to find --
// and IDEAS_ASKS lines a decision at most: each is a judging and a settle of every swap, taken from the decision's own time)
#define IDEAS_ASKS 8
static const List *ideaAims;   // (the list they meet: the rank's, decide.c ranked)
static int32_t ideasAsks;      // (asked this decision)
static int ideasOf(const Judge *J0) {
  Judge *J = (Judge *)J0;
  if (besideJudge) return -1;   // (not asked here: the order asks it on the decision's thread)
  if (!J->ideasAsked) {
    J->ideasAsked = 1;
    if (decF.under || ideasAsks >= IDEAS_ASKS) { J->ideas = -1; return -1; }
    ideasAsks++;
    endNoKeep = 1;
    if (!J->hold) asLine(&J->k);
    const Board *e = clockOut() || J->o.dead ? 0 : J->hold ? lineEnd(0, 0, 0) : lineEnd(J->k.seq, J->k.nseq, J->settled);
    if (!J->hold) unLine();
    endNoKeep = 0;
    J->ideas = e ? ideasOn(e, ideaAims) : -1;
  }
  return J->ideas;
}
// (more ideas ready, both known)
static int moreIdeas(const Judge *x, const Judge *y) { int a = ideasOf(x), b = ideasOf(y); return a >= 0 && b >= 0 && a > b; }
// THE BLOCKS A LINE THROWS (judge.c blocks: every attack its own)
static int thrownOf(const Judge *J) { return J->hold || J->o.dead ? 0 : J->o.j.blocks; }
static int clearsNothing(const Judge *J) { return !J->hold && !clears(J); }
// A WASTED THREE: a line whose clears break nothing and throw nothing (a combo of three, no chain) -- panels spent for no garbage sent
// and none broken
static int cutsShort(const Judge *J);
static int wastesThree(const Judge *J) {
  if (J->hold) return 0;
  if (judgedWastes(&J->o.j)) return 1;   // (any clear of three the line makes for nothing, whatever else it makes -- a line lost too -- or
  if (cutsShort(J)) return 1;            // the board's own chain cut short: the three that began it made for nothing)
  return (J->apCombo > 0 || J->apChain > 0) && !(J->apBroke > 0) && J->apCombo <= 3 && J->apChain <= 1 && thrownOf(J) == 0;
}
// (each loss as the order reads it -- lostOf, the readiness break's loss with it -- where both are known)
static int beatsHold(const Judge *L, const Judge *H) {
  int known = L->o.lostAt != NOT_ASKED && H->o.lostAt != NOT_ASKED;
  // (a known loss beats holding when it comes later, the line's own death or the hold's forecast alike: two losses are two frames)
  if (known && lostOf(L) > lostOf(H)) return 1;
  if (L->o.nearAfter >= 0 && H->o.nearAfter >= 0 && nearActsOf(L, L->o.nearAfter) < nearActsOf(H, H->o.nearAfter)) return 1;
  // (a break lost no sooner than the hold: the garbage it converts is the board's next panels -- run 491, large_garbage-4, 7531: two
  // breaks lost at 44 put after a hold lost at 44)
  if (L->apBroke > 0 && known && lostOf(L) >= lostOf(H)) return 1;
  if (L->o.ready == 1 && H->o.ready != 1) return 1;
  if (L->readyNext == 1 && H->readyNext != NOT_ASKED && H->readyNext != 1) return 1;
  // (A SET-UP: with no garbage on the board, a line that lives where the hold does and leaves more ideas ready than the hold -- an attack
  // made ready is something done)
  if (!decF.under && L->o.lives && H->o.lives && moreIdeas(L, H)) return 1;
  return 0;
}
// (FLATTENING WHEN THERE IS NOTHING TO DO: a level line -- the stack walked flatter, nothing cleared -- known to do no worse than
// holding beats holding; it is still the last of the lines that do something, tier 4's last)
static int levelsFree(const Judge *L, const Judge *H) {
  if (L->k.play != PLAY_LEVEL || L->o.dead) return 0;
  if (L->o.lives) return 1;
  return !H->o.lives && L->o.lostAt != NOT_ASKED && H->o.lostAt != NOT_ASKED && lostOf(L) >= lostOf(H);
}
static void markIdle(Judge **a, int n) {
  const Judge *H = 0;
  for (int i = 0; i < n && !H; i++) if (a[i]->hold) H = a[i];
  for (int i = 0; i < n; i++) a[i]->idle = 0;
  double holdLost = H ? lostOf(H) : 0;
  for (int i = 0; i < n; i++) if (H && clearsNothing(a[i]) && !a[i]->builds && !beatsHold(a[i], H) && !levelsFree(a[i], H)) { a[i]->idle = 1; a[i]->idleLost = holdLost - 0.5; }
}
// THE ONE ORDER, key by key: each key decides only between two lines every key before it leaves equal. Survival first, then the list,
// then the kind of line (plans/gambit-next.md 0).
// A LINE THAT CUTS THE BOARD'S OWN CHAIN SHORT: the board left alone makes a chain (the hold's judging, aloneChain) and with the line
// played it makes a shorter one
static int cutsShort(const Judge *J) {
  if (J->hold || !J->apPlayed) return 0;
  if (ownChainBy > 0 && J->o.j.keepsChain >= 0) return !J->o.j.keepsChain;   // (judge.c ownChainOf: by the frame its last link comes)
  return aloneChain > 1 && J->apWhole < aloneChain;
}
static int firstWalk(const Judge *J) { return J->hold || !J->k.nseq ? 0 : actionsFor(decQ.b->curRow, decQ.b->curCol, CR(J->k.seq[0]), CC(J->k.seq[0]), walkLeft()); }
// (the cursor's actions over the whole line, swap after swap in the order it is pressed, from where the cursor is)
#define WALK_EARN 6     // the actions more a far line may walk than a nearer one that also attacks
#define NEAR_ACTS 2     // the actions a swap toward a break costs: the swap and a cell's walk (breakNear walks a panel a column a swap)
static int lineWalk(const Judge *J) {
  int n = 0, r = decQ.b->curRow, c = decQ.b->curCol;
  for (int i = 0; !J->hold && i < J->k.nseq; i++) { n += actionsFor(r, c, CR(J->k.seq[i]), CC(J->k.seq[i]), walkLeft()); r = CR(J->k.seq[i]); c = CC(J->k.seq[i]); }
  return n;
}
// (THE SAVE A LINE LEAVES: its plan's next break where the plan was asked (readyNext); else the nearest break on the board it leaves
// once everything shown has landed (judge.c readyNear), its walk
// measured there from where the line leaves the cursor (readyWalk; the decision's break walk where that board was not read), pressed so it is done before that board is lost, a cell every TAP_GAP: whether the window has
// those actions then, every action before aged as the window ages. A board with no break in reach has no save; one that lives needs none)
static double lostOf(const Judge *x);
static int saveKept(const Judge *J) {
  if (pressAllowance < 0 || J->o.lives) return 1;
  // (the plan's answer first: a break in reach the window pays for, played on the engine (readyNext) -- or asked and none)
  if (J->readyNext == 1) return 1;
  if (J->readyNext == 0) return 0;
  double lost = lostOf(J);
  if (lost >= 1e9) return 1;
  int32_t nr = J->o.j.readyNear >= 0 ? J->o.j.readyNear : J->o.nearAfter;
  if (nr < 0) return 1;
  if (nr >= NEAR_MISS) return 0;
  int walk = J->o.j.readyWalk > 0 ? J->o.j.readyWalk : breakWalk;
  int32_t end = J->hold ? 0 : J->o.j.endAt, spent = J->hold ? 0 : J->o.j.spent, due = (int32_t)lost - walk * TAP_GAP;
  return allowLeftAt(due > end ? due : end, spent) >= walk;
}
// HOW NEAR THE NEXT BREAK A LINE LEAVES THE BOARD, the one measure every reader asks (the order's survival key, a move beating the hold,
// the tier): the swaps to it (outcome.c nearAfter) -- and with an input window to keep, the actions: the line's own walk and NEAR_ACTS
// a swap left, so a line that walks more than the swaps it saves brings the break no nearer
static int nearActsOf(const Judge *J, int32_t near) { return pressAllowance >= 0 ? lineWalk(J) + (J->o.j.readyWalk > 0 ? J->o.j.readyWalk : NEAR_ACTS * near) : near; }   // (the next break's walk measured on the board the line leaves where it was read)
// (x presses every swap y does, and more, its more chosen for what it does -- a line with work on its way, whose swap clears, brings the
// break nearer or joins colours, or a route, whose second line makes something: y's swaps all among x's, in their order)
static int holdsLine(const Judge *x, const Judge *y) {
  if (!(x->k.way || x->k.route || x->k.pair) || x->hold || y->hold || x->k.nseq <= y->k.nseq || !y->k.nseq) return 0;
  int j = 0;
  for (int i = 0; i < x->k.nseq && j < y->k.nseq; i++) if (x->k.seq[i] == y->k.seq[j]) j++;
  return j == y->k.nseq;
}
// (TRIES: the breaks the next decisions have the time for, a break's time each -- two lines that neither live survive alike when they
// leave as many, or three or more each: run 446, build, a line lost at 266 taken over one lost at 385 that broke more, two tries against
// three. Past three the material decides: run 451, the later loss taken there too, spent the panels -- large_garbage's material under
// garbage 19 where it was 23 -- finish 15 against 17)
// (THE RESERVE, as the survival search keeps it -- search/outlive.c: a line that breaks nothing and leaves the next landing
// without a break's walk in the window -- outcome.c spendsReserve, the window plan)
// (the blocks on their way a line's window keeps break walks for, core/nodes.h windowCover: a break, and any line with no garbage on the
// board or on its way, keeps them all -- breaks and attacks are free while no break is owed -- -- and a line that leaves the
// board no save the window can press (saveKept) keeps none)
static int coverOf(const Judge *J) {
  if (!(decF.under || decF.land != NOT_ASKED)) return WINDOW_ALL;
  if (!saveKept(J)) return 0;
  if (!J->hold && J->apBroke > 0) return WINDOW_ALL;
  return J->hold ? windowCover(0, 0) : windowCover(J->o.j.endAt, J->o.j.spent);
}
// (THE MARGIN a line leaves: on the board once everything shown has landed (judge.c readyTop, readyMat), the rows over the stack, the
// rows of panels under its garbage, the input window's actions then (core/nodes.h windowShareAt), and of the columns under garbage those
// its panels touch (judge.c readyContact: a block resting on one column of six is a block no match reaches) -- each a share of its whole
// (the stack's 12 rows, the window's limit, the columns under garbage), scarcest first (core/nodes.h marginKeyOf): a board dies of the one
// it runs out of first. Read on the board once everything shown has landed; a line whose landed board was not read, on the board it ends on)
#define MARGIN_ROWS 12
// (THE LEAST ROOM: a line dead or spending the next break reads below every board read -- the room share clamps at a stack's height over
// the top, core/nodes.h marginKeyOf -- never a row over, which a board buried under the blocks shown reads worse than)
#define MARGIN_LEAST (2 * MARGIN_ROWS)
// (a line with a plan, the margin its plan leaves: the board its last break leaves once everything shown has landed, and the window once
// the plan has pressed what it presses -- a break is credited with what it converts, plans/gambit-next.md 2; a line whose board was not
// read -- its judging the clock cut -- the board's as it is now: never unknown, so never ranked for not being read)
static int32_t topOn(const Board *b);
static LOCAL double marginShares[4];   // (the last marginKey's four shares as read, room, material, window, contact: the log's mgs=)
static int32_t marginKey(const Judge *J) {
  int plan = J->planMargin[0] >= 0 && J->extSpent != NOT_ASKED;
  // (read once everything shown has landed: a line's landed board (readyTop), or its plan's; else the board it ends on, with the rows
  // still coming after its end counted against its room -- never a board that has not yet taken what is on its way)
  // (ONE READING FOR EVERY LINE: a plan's board is the one everything shown has landed on; a line's landed board is the one the next block
  // lands on, so the rows still coming after it are counted against its room as they are against the board it ends on -- read apart, a
  // line read on the board to come stood rows higher than a plan read under every block shown)
  int32_t t = plan ? J->planMargin[0] : J->o.j.readyTop >= 0 ? J->o.j.readyTop + rowsComing(&decQ, imax(0, J->o.j.readyWait)) : J->o.topLeft >= 0 ? J->o.topLeft + rowsComing(&decQ, J->hold ? 0 : J->o.j.endAt) : -1;
  int32_t m = plan ? J->planMargin[1] : J->o.j.readyMat >= 0 ? J->o.j.readyMat : J->o.matLeft;
  int32_t contact = plan ? J->planMargin[2] : J->o.j.readyContact, under = plan ? J->planMargin[3] : J->o.j.readyUnder;
  // (THE WINDOW AS THE DUES ASK IT: of the rows due, the share the window still covers a break's walk for (core/nodes.h windowCover),
  // with the rows the line's own breaks pay -- a break spends actions and pays rows, a hold spends none and pays none: the pace, not the
  // actions left. With nothing due, the window's own share)
  int32_t endAt = plan ? J->planMargin[4] : J->hold ? 0 : J->o.j.endAt, spent = plan ? J->extSpent : J->hold ? 0 : J->o.j.spent;
  int32_t paid = J->hold ? 0 : imax(0, J->apBroke) / W + (plan ? J->planBreaks : 0);
  double win = winCoverShare(endAt, spent, paid);
  // (A LINE JUDGED DEAD with no plan board read has no board to read a margin on: the fallback below is for a judging the clock cut, and
  // handed to a dead line it reads the board as it is now -- the best margin in the order (1306, combo_storm-3 at 372: a carry dead at 32
  // read 5.5.12.12 and was played over one lost at 260). A dead line's room is below none: the least room, MARGIN_LEAST)
  if (t < 0 && J->o.dead && !J->hold) { t = MARGIN_LEAST; m = m < 0 ? materialOn(decQ.b) : m; if (contact < 0 || under < 0) contactOn(decQ.b, &contact, &under); if (win < 0) win = winCoverShare(0, 0, 0); }
  // (and a line that SPENDS the next break -- it leaves no break to build where the board left alone keeps one, outcome.c -- is lost the
  // frame it is done, however its end board reads: the least room for it too. 1307 combo_storm-7 round 2, 5265: such a line read 4.5.12.12)
  if (J->o.spent && !plan && !J->hold) t = MARGIN_LEAST;
  if (t < 0 || m < 0) { t = topOn(decQ.b) + rowsComing(&decQ, 0); m = materialOn(decQ.b); contactOn(decQ.b, &contact, &under); win = winCoverShare(0, 0, 0); }
  marginShares[0] = (MARGIN_ROWS - t) / (double)MARGIN_ROWS; marginShares[1] = (double)m / W / MARGIN_ROWS; marginShares[2] = win < 0 ? 1 : win;
  marginShares[3] = under > 0 ? (double)contact / under : 1;
  return marginKeyOf(marginShares[0], marginShares[1], marginShares[2], marginShares[3]);
}
// (LOST ALIKE: lost in the same break's time, counted back from the latest loss of the lines ranked together (rankLostRef, sortJudged)
// -- less than a break's time apart buys no break more -- a line lost within a break's time each alone, and one with three breaks'
// time left alike with every other. Bands from one reference, so alike is one relation for every pair and the order one order)
static LOCAL double rankLostRef;
// (the bands are a decision wide (rankReact): the search for the proof is carried from decision to decision (plans/gambit-next.md 3 and
// 7), so a line lost a decision later leaves the search one more decision to find it with -- only lines lost within one decision of each
// other are alike, and among them the margin decides)
static int32_t lostBand(const Judge *J) {
  double l = lostOf(J);
  if (l >= 1e9) return 0x7fffffff;
  int32_t save = imax(1, rankSave), band = imax(1, rankReact);
  if (l < save) return -1 - (int32_t)(l > 0 ? l : 0);   // (within a break's time, or not known -- the hold's -1: alike with nothing)
  if (l >= 3.0 * save) return 0x7ffffffe;
  double back = rankLostRef > l ? rankLostRef - l : 0;
  return (int32_t)(back / band);
}
static int lostAlike(const Judge *x, const Judge *y) {
  int32_t bx = lostBand(x), by = lostBand(y);
  return bx >= 0 && bx != 0x7fffffff && bx == by;
}
// (THE RULE THAT DECIDED: the number of the order's rule the last comparison returned on -- answer.c logs it for the line played over
// one lost later, sooner=play:lost:kRULE)
static LOCAL int32_t cmpKey;
static LOCAL const char *cmpWhy = "";   // (the clause of that rule that decided: proven; now, margin, later; chain; list; value; ideas; first, tie)
// (A LINE LIVES where its board does left alone, or where its plan does: the line, the break its readiness found and the breaks after
// it, played on the engine -- outcome.c readyNextOf, extLost FOREVER)
static int livesOf(const Judge *J) { return J->o.lives || J->extLost == FOREVER; }
// THE LEDGER a line leaves (plans/gambit-next.md): the rows due -- every row of every block shown, at the frame it is due (the
// window plan's landAts) -- against the rows paid -- the line's own breaks, a row each W cells it converts, and its plan's, each a break
// pressed from its frame and popped a break's time on (rankSave); a line that lives is short nothing
static int32_t topOn(const Board *b);
typedef struct { int32_t due, paid, shortBy, at; } Ledger;
static Ledger ledgerOf(const Judge *J) {
  Ledger L = { nLandAts, 0, 0, FOREVER };
  if (J->o.lives || J->extLost == FOREVER) return L;
  int32_t paid[16 + MAXLINE], np = 0, save = imax(1, rankSave);
  if (!J->hold && J->apBroke > 0) { int rows = (J->apBroke + W - 1) / W, at = J->o.j.done > 0 ? J->o.j.done : 0; for (int r = 0; r < rows && np < MAXLINE; r++) paid[np++] = at; }
  for (int k = 0; k < J->planBreaks && np < 16 + MAXLINE; k++) paid[np++] = J->planBreakAt[k] + save;
  L.paid = np;
  // (death as the engine plays it: the plan's own loss frame (lostOf) -- solvent when proven (proofFrame: it stands past the last row
  // shown and the margin); else short by the rows due by then less those its plan paid by then, one at least, from that frame)
  double lost = lostOf(J);
  if (lost >= 1e9) { L.shortBy = imax(1, nLandAts); return L; }   // (a loss not known proves nothing: proofOf)
  if (lost > proofFrame()) return L;   // (solvent: proven, proofOf)
  int32_t at = (int32_t)lost, due = 0, got = 0;
  for (int d = 0; d < nLandAts; d++) due += landAts[d] <= at;
  for (int k = 0; k < np; k++) got += paid[k] <= at;
  L.shortBy = imax(1, due - got); L.at = at;
  return L;
}
static LOCAL const Judge *rankHold;   // (the decision's hold among the lines ranked: rankTogether)
// VALUE FOR MOVES: what a line gives less what it costs, in frames -- the time it buys over the hold (its plan's loss less the hold's),
// a break's time for each row of garbage it converts (rankSave, a row of W cells) and for each block it throws, the actions it takes
// off the next break's walk, less the frames the
// window takes to give back the actions it presses (actionFrames; a tap's frames, TAP_GAP, with no window said) and a break's time for
// each row of panels its clears take beyond what its breaks convert (judge.c netPanels). The exchange rates -- a row converted and a
// block thrown each a break's time -- are the owner's to set (plans/gambit-next.md)
static double valueOf(const Judge *J) {
  double save = imax(1, rankSave), af = actionFrames() > 0 ? actionFrames() : TAP_GAP;
  double lj = lostOf(J), lh = rankHold ? lostOf(rankHold) : lj;
  double t = (lj < 1e6 ? lj : 1e6) - (lh < 1e6 ? lh : 1e6);
  if (J->hold) return t;
  int planned = J->extLost != NOT_ASKED && J->extSpent != NOT_ASKED && lostAtOf(J->extLost, 0) > lostAtOf(J->o.lostAt, 0);
  double spent = planned ? J->extSpent : J->o.j.spent;
  double gain = t + (double)imax(0, J->apBroke) / W * save + (double)thrownOf(J) * save;
  // (and under garbage, the next break brought nearer: the actions its walk is shorter than the hold leaves it, measured on the boards
  // each leaves once everything shown has landed (judge.c readyWalk), each action the frames the window takes to give it back -- a
  // line that only buys time leaves the garbage as far from breaking)
  if (rankHold && J->o.j.readyWalk > 0 && rankHold->o.j.readyWalk > 0) gain += (double)(rankHold->o.j.readyWalk - J->o.j.readyWalk) * af;
  double cost = spent * af + (J->o.j.netPanels < 0 ? (double)-J->o.j.netPanels / W * save : 0);
  return gain - cost;
}
// THE LINE'S CATEGORY, the judge's answer every reader asks (plans/gambit-next.md), best first: lives left alone; lives by its plan;
// breaks garbage now and its plan keeps a save; ready -- its plan's next break in reach, the window paying for it, at the pace the breaks
// due ask (paceKept); buys time -- no break
// in reach, outliving the hold (H, the decision's hold; 0 none); dies
enum { CAT_LIVES, CAT_PLAN, CAT_BREAKS, CAT_READY, CAT_BUYS, CAT_DIES, NCATS };
static const char *catName[NCATS] = { "lives", "plan", "breaks", "ready", "buys", "dies" };
// (THE PACE: a line keeps it when the window still covers as many of the breaks due as holding would (coverOf, the window plan's dues),
// less the rows its own breaks pay -- a line that spends faster than the breaks due ask buys its time out of the window, never ready)
static int coverOf(const Judge *J);
static int paceKept(const Judge *J, const Judge *H) {
  if (!H || J == H || pressAllowance < 0) return 1;
  return coverOf(J) + imax(0, J->apBroke) / W >= coverOf(H);
}
static int catOf(const Judge *J, const Judge *H) {
  if (J->o.lives) return CAT_LIVES;
  if (livesOf(J)) return CAT_PLAN;
  int save = saveKept(J);
  if (!J->hold && J->apBroke > 0 && save) return CAT_BREAKS;
  if ((J->readyNext == 1 || J->o.ready == 1) && save && paceKept(J, H)) return CAT_READY;
  if (H && J != H && lostOf(J) > lostOf(H)) return CAT_BUYS;
  return CAT_DIES;
}
// (A LINE'S PROOF, plans/gambit-next.md 1 and 4: 3 its board lives left alone; 2 it lives by its plan; 1 its plan, played on the engine,
// stands past the last row shown is due and PROOF_ROWS rows' breaks more; 0 unproven -- its loss is a bound, the breaks the searches
// found, not a fact)
// (READY, plans/gambit-next.md The idle frame: the board the line leaves has real play in reach -- a break within the shape math's
// reach, or no garbage on it. Not read (no end board): taken as ready. Read, and in no key of the order: in the proof it played a line
// lost sooner 145 times in a run (1315, 6/24); as a tie-break among proven lines the list ranks alike, 306 times (1316, 14/24).
// The shape math's reach is not the fact it needs to be -- the readiness proposer and the carried break search stand in for it)
static int playReady(const Judge *J) { return J->o.endNear < 0 || J->o.endNear < NEAR_MISS; }
static int playReadyRead(const Judge *J) { return playReady(J); }   // (kept read: answer.c may log it)
static int proofOf(const Judge *J) {
  if (J->o.lives) return 3;
  if (J->extLost == FOREVER) return 2;
  double l = lostOf(J);
  return l < 1e9 && l > proofFrame();
}
// (DEAD BEFORE IT COULD PRESS ANYTHING: unproven and lost within a break's time -- the hold's loss not known among them)
static int diesNow(const Judge *J) { return !livesOf(J) && lostOf(J) < imax(1, rankSave); }
// (A LINE'S LOSS IN WHOLE BREAKS' TIME from now: lostOf over rankSave, a loss not known or never as the most there is)
#define SOON_BREAKS 3   // (a break popping, the next built, the next popping)
static int32_t breaksTo(const Judge *J) { double l = lostOf(J); return l >= 1e8 ? 1 << 30 : (int32_t)(l / imax(1, rankSave)); }
// (THE LINE'S OWN LOSS IN BREAKS' TIME, of an unproven line: its board's, without the readiness break it leads to -- that break is still
// to be pressed after the line, through garbage not yet shown, and the proof is what reads it, with its margin for that garbage)
static int32_t ownBreaksTo(const Judge *J) {
  if (J->idle) return breaksTo(J);
  double l = lostAtOf(J->o.lostAt, J->hold);
  return l >= 1e8 ? 1 << 30 : l < 0 ? -1 : (int32_t)(l / imax(1, rankSave));
}
// (GARBAGE TO BREAK: on the board, or shown on its way -- a block shown lands and is broken as one on the board is)
static int garbHere(void) { return decF.under || (decF.next != NOT_ASKED && decF.next >= 0); }
// (THE LIST'S KEY with no garbage: 0 the first entry met, 1 a line building toward it, 2 nothing fired of the line's own, then each
// fallback by its entry, a wasted three last)
static int listClass(const Judge *J) { return J->met == 0 ? 0 : J->fallback || wastesThree(J) ? 3 + (J->met >= 0 ? J->met : MAXAIMS) : J->builds ? 1 : 2; }
static int compareJudged(const Judge *x, const Judge *y) {
#define K(rule, why, v) return (cmpKey = (rule), cmpWhy = (why), (v))
  // 1. PROVEN FIRST: a line that lives left alone, then one that lives by its plan, then one whose plan meets every row shown with the
  // margin to spare, then the rest
  { int px = proofOf(x), py = proofOf(y); if (px != py) K(1, "proven", py - px);
    // (PROVEN BY ITS PLAN ALONE, of two: the one whose plan stands longer, in whole breaks' time from now -- the plan meets the rows shown,
    // but its loss is where the board still goes, and a break's time more is a break more to find before it; read off each line alone)
    if (px == 1) { int32_t bx = breaksTo(x), by = breaksTo(y); if (bx != by) K(1, "longer", by - bx); }
    // (and of two proven by their plans alike, with garbage on the board or on its way, the one that converts before one that converts
    // none: material only comes from breaking, and a line proven only by a break it has yet to find and press has made none)
    if (px == 1 && garbHere()) { int bx = x->apBroke > 0, by = y->apBroke > 0; if (bx != by) K(1, "converts", bx ? -1 : 1); }
    // (and of two proven alike, the one that leaves the board more of what it is scarcest in -- room, material, the window, contact
    // (marginKey) -- before the list: a share of MARGIN_ENOUGH rows or more is enough, so two lines that both leave enough of everything
    // are alike here and the list decides between them)
    if (px) { int32_t mx = marginKey(x), my = marginKey(y); if (mx != my) K(1, "margin", my > mx ? 1 : -1); }
    // 2. UNPROVEN: THE MOST LEFT TO FIND A PROOF WITH -- a line dead before it could press anything last; then the more of its scarcest
    // resource, then of the next (marginKey: room, material, the window's cover of the rows due, contact, in rows); then the later loss,
    // unless lost alike (lostAlike: the same band of a break's time). The categories fold into this: lives and plan are proven, breaks to dies unproven
    if (!px) {
      int nx = diesNow(x), ny = diesNow(y); if (nx != ny) K(2, "now", nx ? 1 : -1);
      // (THE SAVE CONFIRMED: a three the save asked of found the board outlasting, with the best line on, every line that wastes none by a
      // break's time at least (decide.c ranked) -- the one survival verdict the order has past each line's own, so it is read as one)
      if (x->threeNeeded != y->threeNeeded) K(2, "save", x->threeNeeded ? -1 : 1);
      // (UNDER ATTACK, MATERIAL ONLY COMES FROM BREAKING, plans/gambit-next.md 5: of two unproven lines under garbage, one that converts
      // garbage before one that converts none -- the margin reads material as enough down to three rows, and a board spent from 51 to 22
      // panels on combos reads enough until the block that kills it is landing: 1304 combo_storm-6, 2703 to 3307)
      if (garbHere()) { int bx = x->apBroke > 0, by = y->apBroke > 0; if (bx != by) K(2, "converts", bx ? -1 : 1); }
      // (THE PANELS FIRST: under garbage every later break is made of the board's panels -- of two lines alike in converting, the one
      // that leaves the board more of them (judge.c netPanels: the garbage it converts less the panels its clears take, beyond the board
      // left alone, in threes: a match's worth) first, before the time to a loss: a line that buys time spending panels buys it with the
      // material the next break is to be made of. The lineup and the chain convert a row out of the panels the row before turned into, a
      // combo spends the stack's own; and with a block shown on its way, the panels a clear takes are the ones the block is broken with)
      if (garbHere()) { int nx = x->o.dead ? -(1 << 20) : x->o.j.netPanels / 3, ny = y->o.dead ? -(1 << 20) : y->o.j.netPanels / 3;
        if (nx != ny) K(2, "material", ny - nx); }
      // (THE NEXT BREAK LEFT TO BUILD: of two lines that convert, the one whose board still has a break to build and keeps the floor
      // (judgeCand material: outcome.c nextBuild, floorKept) -- a break that leaves none is the last the board makes. Each key of the
      // order is read off each line alone and is had by every line -- a line with none reads last -- so the order is one order)
      if (decF.under) { int mx = x->material >= 0 ? x->material : 3, my = y->material >= 0 ? y->material : 3; if (mx != my) K(2, "next", mx - my); }
      // (A BOARD LOST BEFORE ITS NEXT BREAK COULD POP: of two lines alike in the panels they leave and the break they leave to build, the one lost later, in breaks' time
      // to its loss up to SOON_BREAKS -- its own break popping, the next one built, then popped; read off each line alone)
      { int32_t sx = imin(ownBreaksTo(x), SOON_BREAKS), sy = imin(ownBreaksTo(y), SOON_BREAKS); if (sx != sy) K(2, "soon", sy - sx); }
      // (THE LONGER LOSS IN WHOLE BREAKS' TIME: of two lines alike in the next break and the material, the one lost a break's time later
      // has a break more to find before it -- the margin and the later loss decide within a break's time; from now, read off each line alone)
      { int32_t lx = ownBreaksTo(x), ly = ownBreaksTo(y); if (lx != ly) K(2, "longer", ly - lx); }
      int32_t mx = marginKey(x), my = marginKey(y); if (mx != my) K(2, "margin", my > mx ? 1 : -1);
      if (!lostAlike(x, y) && lostOf(x) != lostOf(y)) K(2, "later", lostOf(y) > lostOf(x) ? 1 : -1);

    } }
  // (the rules' keep as a key here, among proven lines ahead of the list: 428 plays of a line lost sooner for it, 14/24, run 1323 --
  // it stays the list's own key, step 4)
  // 3. THE BOARD'S OWN CHAIN kept before cut short (the owner: never spoil the board's own chain)
  if (cutsShort(x) != cutsShort(y)) K(3, "chain", cutsShort(x) ? 1 : -1);
  // 4. THE MODE'S RULES: the earlier entry of its list the line meets, as the board asks it (rules.c metOf: in time, the list's own
  // order). Under garbage the rule is to break (the rules' underGarbage): a break that meets an entry, by the entry; then a plain break
  // outside the list -- a three, the last choice; then a line that breaks nothing; and last of all a line the rules' keep puts outside
  // (judgeCand: the rules' floor spent -- outcome.c spendsFloor)
  { int ax = x->met >= 0 ? x->met : MAXAIMS, ay = y->met >= 0 ? y->met : MAXAIMS;
    // (with no garbage the list's first entry first, then a line building toward it, then a line that fires nothing of its own -- the
    // hold among them -- then the fallbacks, in the list's order: the survival keys above are where a fallback the board needs comes first)
    if (!decF.under) { ax = listClass(x); ay = listClass(y); }
    // (under garbage a line that breaks nothing meets no entry: the rule is to break, and an attack that breaks nothing spends the
    // window the next break is pressed out of)
    if (decF.under) { ax = x->apBroke > 0 ? ax : 2 * MAXAIMS + 1; ay = y->apBroke > 0 ? ay : 2 * MAXAIMS + 1; }
    // (a three that breaks nothing, only where the save found the board needs it -- decide.c takes every other out of the order)
    ax += wastesThree(x) && !x->threeNeeded ? 1 : 0; ay += wastesThree(y) && !y->threeNeeded ? 1 : 0;
    ax += x->spends ? 2 * MAXAIMS + 2 : 0; ay += y->spends ? 2 * MAXAIMS + 2 : 0;
    if (ax != ay) K(4, "list", ax - ay); }

  // 5. VALUE FOR MOVES (valueOf): what the line gives -- the time it buys over the hold, the garbage it converts, the blocks it
  // throws -- less what it costs -- its actions, the panels it spends -- all in frames: more moves for less is worse, the line in
  // progress cheaper by what of it is pressed, a far line one that has to earn its walk
  { double vx = valueOf(x), vy = valueOf(y); if (vx != vy) K(5, "value", vx > vy ? -1 : 1); }
  // 6. WITH NO GARBAGE ON THE BOARD, the more ideas left ready (moreIdeas: the owner's several ideas at once)
  if (!decF.under) { int mx = moreIdeas(x, y), my = moreIdeas(y, x); if (mx != my) K(6, "ideas", mx ? -1 : 1); }
  // 7. THE NEARER FIRST SWAP (core/nodes.h actionsFor, as the frame loop walks) -- the hold presses nothing, nearest of all
  { int nx = firstWalk(x), ny = firstWalk(y); if (nx != ny) K(7, "first", nx - ny); }
  K(7, "tie", 0);
#undef K
}
// A LINE IN WALKING ORDER: its swaps pressed in the order the cursor reaches them soonest -- from where the cursor is, each swap's walk
// counted as the frame loop walks it (core/nodes.h actionsFor) -- two swaps on a shared cell kept in the line's own order. Every order
// for a short line (WALK_ALL swaps or fewer), the nearest swap next for a longer one; of two orders that walk alike, the line's own first.
// 0 when the line's own order walks least.
#define WALK_ALL 6
static LOCAL int32_t walkSeq[MAXLINE], walkBest[MAXLINE], walkCost;
static LOCAL int walkUsed[MAXLINE];
static int sharesCell(int32_t a, int32_t b) { return CR(a) == CR(b) && iabs(CC(a) - CC(b)) <= 1; }
static int walkFree(const Cand *k, int i) {
  for (int p = 0; p < i; p++) if (!walkUsed[p] && sharesCell(k->seq[p], k->seq[i])) return 0;
  return 1;
}
static int walkStep(int row, int col, int32_t s) { return actionsFor(row, col, CR(s), CC(s), walkLeft()); }
static void walkAll(const Cand *k, int d, int row, int col, int cost) {
  if (cost >= walkCost) return;
  if (d == k->nseq) { walkCost = cost; for (int i = 0; i < d; i++) walkBest[i] = walkSeq[i]; return; }
  for (int i = 0; i < k->nseq; i++) {
    if (walkUsed[i] || !walkFree(k, i)) continue;
    walkUsed[i] = 1; walkSeq[d] = k->seq[i];
    walkAll(k, d + 1, CR(k->seq[i]), CC(k->seq[i]), cost + walkStep(row, col, k->seq[i]));
    walkUsed[i] = 0;
  }
}
static int walkOrder(const Cand *k, Cand *out) {
  if (k->nseq < 2) return 0;
  int row = decQ.b->curRow, col = decQ.b->curCol, own = 0;
  for (int i = 0, r = row, c = col; i < k->nseq; i++) { own += walkStep(r, c, k->seq[i]); r = CR(k->seq[i]); c = CC(k->seq[i]); }
  memset(walkUsed, 0, sizeof walkUsed);
  walkCost = own;
  if (k->nseq <= WALK_ALL) walkAll(k, 0, row, col, 0);
  else {
    int cost = 0, r = row, c = col;
    for (int d = 0; d < k->nseq; d++) {
      int best = -1, bc = 0;
      for (int i = 0; i < k->nseq; i++) {
        if (walkUsed[i] || !walkFree(k, i)) continue;
        int s = walkStep(r, c, k->seq[i]);
        if (best < 0 || s < bc) { best = i; bc = s; }
      }
      walkUsed[best] = 1; walkSeq[d] = k->seq[best]; cost += bc; r = CR(k->seq[best]); c = CC(k->seq[best]);
    }
    if (cost < walkCost) { walkCost = cost; for (int i = 0; i < k->nseq; i++) walkBest[i] = walkSeq[i]; }
  }
  if (walkCost >= own) return 0;
  *out = *k;
  for (int i = 0; i < k->nseq; i++) out->seq[i] = walkBest[i];
  return 1;
}
static int compareJudged(const Judge *x, const Judge *y);
static void rankTogether(Judge **a, int n);
// A CANDIDATE JUDGED, and in walking order too when that walks less: the walking order is played when the one order puts it no lower --
// what it makes is the engine's, as for every line; only the drops and the log's count are the line's own order's
static int judgeWalked(const Read *R, const Cand *k, Judge *J) {
  int ok = judgeCand(R, k, J);
  static LOCAL Cand w; static LOCAL Judge JW;
  if (clockOut() || !walkOrder(k, &w)) return ok;
  int32_t keepDrops[NPLAYS][NDROPS], keepCut[4], keepCutBr[4]; memcpy(keepDrops, dropped, sizeof dropped); memcpy(keepCut, cutWhy, sizeof cutWhy); memcpy(keepCutBr, cutWhyBreak, sizeof cutWhyBreak);
  int keepUnbroken = unbroken.set;
  int wok = judgeCand(R, &w, &JW);
  memcpy(dropped, keepDrops, sizeof dropped); memcpy(cutWhy, keepCut, sizeof cutWhy); memcpy(cutWhyBreak, keepCutBr, sizeof cutWhyBreak); unbroken.set = keepUnbroken;
  if (wok && ok) { Judge *pair[2] = { J, &JW }; rankTogether(pair, 2); }   // (the pair ranked together: the bands from its own reference)
#ifdef GB_TEST
  { int c = wok && ok ? compareJudged(&JW, J) : 99; gb_trace_walked(ok, wok, c, cmpKey, cmpWhy, J, &JW); }
#endif
  if (!wok || (ok && compareJudged(&JW, J) > 0)) return ok;
  *J = JW;
  return 1;
}
// sorted stably by the one order
// THE LINES RANKED TOGETHER, before any comparison of them: the hold among them, the loss the bands count back from (of the lines
// banded by it), each line's idle marks. Set by every entry to compareJudged -- the sort's, and the walking order's pair (judgeWalked)
// -- never left from another ranking, on this thread or another: each thread's own
static void rankTogether(Judge **a, int n) {
  markIdle(a, n);
  rankHold = 0; for (int i = 0; i < n; i++) if (a[i]->hold) { rankHold = a[i]; break; }
  rankLostRef = 0;
  for (int i = 0; i < n; i++) { double l = lostOf(a[i]); if (l < 3.0 * imax(1, rankSave) && l > rankLostRef) rankLostRef = l; }
}
static void sortJudged(Judge **a, int n) {
  static Judge *tmp[512];
  rankTogether(a, n);
  for (int i = 0; i < n; i++) {
    Judge *h = a[i]; h->holdSunk = 0;
    if (!h->hold || livesOf(h)) continue;
    for (int j = 0; j < n && !h->holdSunk; j++) { const Judge *o = a[j]; if (!o->hold && !livesOf(o) && lostAlike(h, o) && lostOf(h) < lostOf(o) && !cutsShort(o)) h->holdSunk = 1; }
  }
  for (int w = 1; w < n; w *= 2)
    for (int lo = 0; lo < n; lo += 2 * w) {
      int mid = lo + w < n ? lo + w : n, hi = lo + 2 * w < n ? lo + 2 * w : n, i = lo, j = mid, k = lo;
      while (i < mid && j < hi) tmp[k++] = compareJudged(a[j], a[i]) < 0 ? a[j++] : a[i++];
      while (i < mid) tmp[k++] = a[i++];
      while (j < hi) tmp[k++] = a[j++];
      for (k = lo; k < hi; k++) a[k] = tmp[k];
    }
}
