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
  int32_t extLost;     // and where that break leads: the line and the break played, lost then (readyNextOf); NOT_ASKED: not asked
  int32_t outside;     // outside the list, taken as the default's own move (a list ended by "default")
  int32_t spends;      // outside it for spending the rules' floor or the reserve (outcome.c spendsFloor, spendsReserve)
  int32_t met;         // the entry of the list as the board asks it the judged line meets, -1 none (rules.c metOf)
  int32_t first;       // the line in progress, its next step due now: first of its tier (decide.c ranked)
  int32_t carried;     // the line in progress, carried on from the last decision (decide.c carriedCand)
  int32_t idle;        // a line that clears nothing and does no better than the hold (markIdle): ranked after the hold
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
static int judgeCand(const Read *R, const Cand *k0, Judge *J) {
  memset(J, 0, sizeof *J);
  J->readyNext = NOT_ASKED; J->extLost = NOT_ASKED;
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
  // what it makes on the search's word: never a board that lasts, and never dropped for a hold that dies sooner)
  if (oc.late) {
    if (oc.j.aliveTo <= 0) { dropAs(play, DROP_UNJUDGED); return 0; }
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
    if (fc == 0) { play = PLAY_CLEAR; memset(&x, 0, sizeof x); x.combo = 3; x.chain = 1; x.floor = -1; m.combo = 3; m.chain = 1; m.broke = 0; m.cells = 0; }
    else if (fc > 0) k->nseq = fc;
  }
  k->play = play;
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
  J->readyNext = NOT_ASKED; J->extLost = NOT_ASKED;
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
static void readyNextFor(Judge *J) {
  if (J->o.lives || J->readyNext != NOT_ASKED) return;
  if (!J->hold) asLine(&J->k);
  J->readyNext = readyNextOf(J->k.seq, J->k.nseq, J->hold ? 0 : J->settled, &J->extLost);
  if (!J->hold) unLine();
}
static double lostOf(const Judge *x);
static int digWaits(const Judge *k, const Judge *H, int32_t react) {
  return k->k.play == PLAY_TOWARD && !k->o.lives && !H->o.lives && H->o.lostAt != NOT_ASKED && k->o.j.done >= 0 && !k->o.dead &&
         lostOf(k) <= lostOf(H) && lostOf(H) - k->o.j.done > react;
}
// THE ONE ORDER: a line that lives before one that does not; of two that live, the one within the list before the default's own (a
// list that cannot be made -- nothing within it lives -- falls back to it); of two that do not live, the one whose board is lost later,
// then the one with a break in reach once the next block lands (a death sooner is never taken for readiness); then the tier, then each
// sub-key in turn
// (a line whose judging the clock cut is not known to die: it ranks after every board that stands and before every known loss -- a
// death known is never chosen over a line that may live)
// (a line ready for the next block is lost where its readiness break leads, when that is later; a hold is not credited for the break
// it waits for -- that break is a candidate of its own)
static int32_t rankReact;   // (frames to the next decision: a reaction and a frame, set by the decision -- decide.c ranked)
static int32_t rankSave;    // (and the frames one break takes after it: a full-width slab's row popped -- flash, face, a pop a cell)
static int32_t rankLow;     // (the board low on panels: decide.c lowOnPanels)
static double lostAtOf(int32_t t, int hold) { return t == FOREVER ? 1e300 : t == NOT_ASKED ? (hold ? -1 : 1e299) : t; }
static double lostOf(const Judge *x) {
  if (x->idle) return x->idleLost;   // (a move must beat doing nothing: markIdle)
  double own = lostAtOf(x->o.lostAt, x->hold);
  if (x->hold || x->extLost == NOT_ASKED) return own;
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
  for (int i = 0; i < n; i++) if (H && clearsNothing(a[i]) && !beatsHold(a[i], H) && !levelsFree(a[i], H)) { a[i]->idle = 1; a[i]->idleLost = holdLost - 0.5; }
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
// HOW NEAR THE NEXT BREAK A LINE LEAVES THE BOARD, the one measure every reader asks (the order's survival key, a move beating the hold,
// the tier): the swaps to it (outcome.c nearAfter) -- and with an input window to keep, the actions: the line's own walk and NEAR_ACTS
// a swap left, so a line that walks more than the swaps it saves brings the break no nearer
static int nearActsOf(const Judge *J, int32_t near) { return pressAllowance >= 0 ? lineWalk(J) + NEAR_ACTS * near : near; }
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
// board or on its way, keeps them all -- breaks and attacks are free while no break is owed)
static int coverOf(const Judge *J) {
  if (!(decF.under || decF.land != NOT_ASKED)) return WINDOW_ALL;
  if (!J->hold && J->apBroke > 0) return WINDOW_ALL;
  return J->hold ? windowCover(0, 0) : windowCover(J->o.j.endAt, J->o.j.spent);
}
// (THE MARGIN a line leaves: on the board once everything shown has landed (judge.c readyTop, readyMat), the rows over the stack, the
// rows of panels under its garbage, the input window's actions then (core/nodes.h windowShareAt), and of the columns under garbage those
// its panels touch (judge.c readyContact: a block resting on one column of six is a block no match reaches) -- each a share of its whole
// (the stack's 12 rows, the window's limit, the columns under garbage), the least: a board dies of the one it runs out of first; -1 not asked)
#define MARGIN_ROWS 12
// (read on the board once everything shown has landed; a line whose landed board was not read, on the board it ends on; -1 neither --
// the least margin, so the margin is one key for every pair)
static double marginOf(const Judge *J) {
  int32_t t = J->o.j.readyTop >= 0 ? J->o.j.readyTop : J->o.topLeft, m = J->o.j.readyMat >= 0 ? J->o.j.readyMat : J->o.matLeft;
  if (t < 0 || m < 0) return -1;
  double room = (MARGIN_ROWS - t) / (double)MARGIN_ROWS, mat = (double)m / W / MARGIN_ROWS, r = room < mat ? room : mat;
  double win = J->hold ? windowShareAt(0, 0) : windowShareAt(J->o.j.endAt, J->o.j.spent);
  if (win >= 0 && win < r) r = win;
  if (J->o.j.readyUnder > 0) { double touch = (double)J->o.j.readyContact / J->o.j.readyUnder; if (touch < r) r = touch; }
  return r;
}
// (LOST ALIKE: lost in the same break's time, counted back from the latest loss of the lines ranked together (rankLostRef, sortJudged)
// -- less than a break's time apart buys no break more -- a line lost within a break's time each alone, and one with three breaks'
// time left alike with every other. Bands from one reference, so alike is one relation for every pair and the order one order)
static double rankLostRef;
// (A LINE'S LOSS NET OF WHAT IT SPENDS: the frame it is lost, less the frames the window takes to give back the actions its swaps spend
// (core/nodes.h actionFrames) -- between lines lost alike, every one searched as far from now, so a fresh line spends more to be lost
// later than the line in progress, which has pressed part of its own: the window is time. The hold spends none)
static double lostNetOf(const Judge *J) {
  double l = lostOf(J);
  if (l >= 1e9 || J->hold) return l;
  double net = l - J->o.j.spent * actionFrames();
  return net > 0 ? net : 0;   // (a line that spends more than it buys is lost now)
}
static int32_t lostBand(const Judge *J) {
  double l = lostOf(J);
  if (l >= 1e9) return 0x7fffffff;
  int32_t save = imax(1, rankSave);
  if (l < save) return -1 - (int32_t)l;
  if (l >= 3.0 * save) return 0x7ffffffe;
  double back = rankLostRef > l ? rankLostRef - l : 0;
  return (int32_t)(back / save);
}
static int lostAlike(const Judge *x, const Judge *y) {
  int32_t bx = lostBand(x), by = lostBand(y);
  return bx >= 0 && bx != 0x7fffffff && bx == by;
}
// (THE RULE THAT DECIDED: the number of the order's rule the last comparison returned on -- answer.c logs it for the line played over
// one lost later, sooner=play:lost:kRULE)
static LOCAL int32_t cmpKey;
static LOCAL const char *cmpWhy = "";   // (the clause of that rule that decided: lives, reserve, later, hold, net, margin, ledger, material, ready, nearer, near; chain; list; carried, kept; thrown; walk; later; tier; first, tie)
// (A LINE LIVES where its board does left alone, or where its plan does: the line, the break its readiness found and the breaks after
// it, played on the engine -- outcome.c readyNextOf, extLost FOREVER)
static int livesOf(const Judge *J) { return J->o.lives || (!J->hold && J->extLost == FOREVER); }
static int compareJudged(const Judge *x, const Judge *y) {
  int lx = livesOf(x), ly = livesOf(y);
#define K(rule, why, v) return (cmpKey = (rule), cmpWhy = (why), (v))
  // 1. SURVIVAL: a line that lives before one that does not; of two that do not, the later loss -- unless they are lost alike (lostAlike:
  // as many breaks' time left, or less than a break's time apart). What a line can press is the judge's: the input window it is pressed
  // in (judge.c), every swap's own walk; what it must not do is the order's filter before it (decide.c: a wasted three, a chain spoiled)
  if (lx != ly) K(1, "lives", lx ? -1 : 1);
  // (of two that do not live, one that spends the next break's walk comes first only where the spend pays (core/nodes.h spendPays): lost
  // after the window has given the walk back, or the line that keeps it lost before it could press it. The break the board needs is
  // pressed out of what is left -- the survival search's own rule. Breaks first, never dying on the way. The hold is a move like any
  // other here: it keeps the walk)
  // (the keeper: the line whose window keeps break walks for more of the blocks on their way -- windowCover, a count, not whether the
  // next alone is kept)
  if (!lx) { int cx = coverOf(x), cy = coverOf(y);
    if (cx != cy) { const Judge *sp = cx < cy ? x : y, *kp = cx < cy ? y : x;
      if (!spendPays(lostOf(sp) < 1e9 ? (int32_t)lostOf(sp) : FOREVER, sp->o.j.endAt, sp->o.j.spent, lostOf(kp) < 1e9 ? (int32_t)lostOf(kp) : FOREVER,
                     kp->hold ? 0 : kp->o.j.endAt)) K(1, "reserve", cx < cy ? 1 : -1); } }
  if (!lx && !lostAlike(x, y) && lostOf(x) != lostOf(y)) K(1, "later", lostOf(y) > lostOf(x) ? 1 : -1);
  // (and a hold lost sooner than a line that keeps the board's own chain never comes first by anything after: it leaves the board as it
  // is with less time, so the walk it saves, the break it leaves where it was, are the next decision's to spend again)
  // (the hold's own, for the lines it is ranked with: below every line lost alike once any of them that keeps the chain is lost later --
  // one place for every pair, so the margin after it never ranks it over one it is under)
  if (!lx && x->hold != y->hold) { const Judge *h = x->hold ? x : y;
    if (h->holdSunk && lostAlike(x, y)) K(1, "hold", h == x ? 1 : -1); }
  // -- and of two lost alike, the one that leaves the board more MARGIN once everything shown has landed (marginOf): where the loss
  // cannot tell two lines apart, the room the board keeps can -- every line read on the board the same garbage has landed on
  if (!lx && lostAlike(x, y)) { double mx = marginOf(x), my = marginOf(y); if (mx != my) K(1, "margin", mx > my ? -1 : 1); }
  // -- and of two lost alike that leave the board as much margin, the later loss net of what each spends (lostNetOf)
  if (!lx && lostAlike(x, y)) { double nx = lostNetOf(x), ny = lostNetOf(y); if (nx != ny) K(1, "net", ny > nx ? 1 : -1); }
  // -- and low on panels (decide.c lowOnPanels), of two that survive alike, the one whose ledger is not in debt: it converts as many
  // cells as its clears take (judge.c netPanels) -- low, a board spends only what its breaks give back
  // (survival first: two lines that live, or two lost in the same band of a break's time -- never one lost sooner by more)
  if (rankLow && (lx || lostBand(x) == lostBand(y))) { int gx = x->o.j.netPanels >= 0, gy = y->o.j.netPanels >= 0; if (gx != gy) K(1, "ledger", gx ? -1 : 1); }
  // -- and under garbage, of two breaks lost alike, the board's next break: the one that leaves a break to build and keeps the floor (outcome.c
  // nextBuild, floorKept), then the more panels under the lowest garbage once everything shown has landed (judge.c readyMat; else the
  // board the line ends on, outcome.c matLeft) -- what a break converts is what the next is made of; a hold, keeping every panel, is no
  // break and never preferred by it; two that live, the list first (3). Of two that break nothing, the next break lined up: the fewer
  // swaps to it on the board the line leaves (outcome.c nearAfter) -- a line that only buys time leaves the garbage as far from breaking.
  // With an input window to keep, nearer is counted in actions: the line's own walk and NEAR_ACTS for each swap it leaves to the break
  // -- a line that walks more to bring the break nearer than the swaps it saves is no nearer; of two alike, the nearer board
  if (!lx && decF.under && x->apBroke > 0 && y->apBroke > 0) {
    if (x->material >= 0 && y->material >= 0 && x->material != y->material) K(1, "material", x->material - y->material);
    int bothReady = x->o.j.readyMat >= 0 && y->o.j.readyMat >= 0;
    int32_t mx = bothReady ? x->o.j.readyMat : x->o.matLeft, my = bothReady ? y->o.j.readyMat : y->o.matLeft;
    if (mx >= 0 && my >= 0 && mx != my) K(1, "ready", mx > my ? -1 : 1);
  }
  if (!lx && decF.under && x->apBroke <= 0 && y->apBroke <= 0 && x->o.nearAfter >= 0 && y->o.nearAfter >= 0) {
    { int ax = nearActsOf(x, x->o.nearAfter), ay = nearActsOf(y, y->o.nearAfter); if (ax != ay) K(1, "nearer", ax - ay); }
    if (x->o.nearAfter != y->o.nearAfter) K(1, "near", x->o.nearAfter - y->o.nearAfter);
  }
  // 2. THE BOARD'S OWN CHAIN kept before cut short (the owner: never spoil the board's own chain)
  if (cutsShort(x) != cutsShort(y)) K(2, "chain", cutsShort(x) ? 1 : -1);
  // 3. THE MODE'S RULES: the earlier entry of its list the line meets, as the board asks it (rules.c metOf: in time, the list's own
  // order). Under garbage the rule is to break (the rules' underGarbage): a break that meets an entry, by the entry; then a plain break
  // outside the list -- a three, the last choice; then a line that breaks nothing; and last of all a line the rules' keep puts outside
  // (judgeCand: the rules' floor spent -- outcome.c spendsFloor)
  { int ax = x->met >= 0 ? x->met : MAXAIMS, ay = y->met >= 0 ? y->met : MAXAIMS;
    // (under garbage a line that breaks nothing meets no entry: the rule is to break, and an attack that breaks nothing spends the
    // window the next break is pressed out of)
    if (decF.under) { ax = x->apBroke > 0 ? ax : 2 * MAXAIMS + 1; ay = y->apBroke > 0 ? ay : 2 * MAXAIMS + 1; }
    ax += x->spends ? 2 * MAXAIMS + 2 : 0; ay += y->spends ? 2 * MAXAIMS + 2 : 0;
    if (ax != ay) K(3, "list", ax - ay); }
  // 4. WITHIN ONE ENTRY: the line in progress kept -- a line put down halfway leaves a board its forecast never judged -- then the plan
  // the last decision kept (an intention)
  if (x->carried != y->carried && !x->hold && !y->hold) K(4, "carried", x->carried ? -1 : 1);
  if (x->k.kept != y->k.kept) K(4, "kept", x->k.kept ? -1 : 1);
  // 5. MORE THROWN: the more blocks the line sends, every attack its own
  { int tx = thrownOf(x), ty = thrownOf(y); if (tx != ty) K(5, "thrown", ty - tx); }
  // 7. THE FEWER ACTIONS: the input window pays for every cell the cursor walks -- before the later loss, which two lines lost alike
  // differ by less than a break's time in: the actions are the next break's
  if (pressAllowance >= 0) { int wx = lineWalk(x), wy = lineWalk(y); if (wx != wy) K(7, "walk", wx - wy); }
  // 6. THE LATER LOSS, of two lost alike
  if (!lx && lostOf(x) != lostOf(y)) K(6, "later", lostOf(y) > lostOf(x) ? 1 : -1);
  // 8. THE KIND OF LINE: its tier, then the tier's own keys (facts.c tierOf)
  { Tier tx = tierView(x), ty = tierView(y);
    if (tx.tier != ty.tier) K(8, "tier", tx.tier - ty.tier);
    int n = tx.nsub < ty.nsub ? tx.nsub : ty.nsub;
    for (int q = 0; q < n; q++) if (tx.sub[q] != ty.sub[q]) K(8, "tier", tx.sub[q] < ty.sub[q] ? -1 : 1); }
  // 9. THE NEARER FIRST SWAP (core/nodes.h actionsFor, as the frame loop walks) -- the hold presses nothing, nearest of all
  { int nx = firstWalk(x), ny = firstWalk(y); if (nx != ny) K(9, "first", nx - ny); }
  K(9, "tie", 0);
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
  if (!wok || (ok && compareJudged(&JW, J) > 0)) return ok;
  *J = JW;
  return 1;
}
// sorted stably by the one order
static void sortJudged(Judge **a, int n) {
  static Judge *tmp[512];
  markIdle(a, n);
  rankLostRef = 0;
  for (int i = 0; i < n; i++) { double l = lostOf(a[i]); if (l < 3.0 * imax(1, rankSave) && l > rankLostRef) rankLostRef = l; }   // (of the lines banded by it)
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
