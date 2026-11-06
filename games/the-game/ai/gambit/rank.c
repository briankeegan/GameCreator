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
  int32_t twin;    // two columns sorted row by row, then one swap that clears both (propose.c twinLines): 1 the line, 2 the set-up alone
  Xs x; int32_t xFire, xDone, xNats, xAts[MAXLINE];   // xFire/xDone: -1 not said
} Cand;
// A JUDGED CANDIDATE: its place (tier, sub), its outcome, and what the move played reads (ap)
typedef struct {
  Cand k;
  int32_t settled, aim, wait, hold, back;   // back: its first swap swaps back the pair the last swap pressed swapped (rules.c swappedBack)
  Tier t;
  Outcome o;
  int32_t apDone, apFire, apNats, apAts[MAXLINE], apChain, apChainAll, apCombo, apBroke, apPlayed;
  int32_t apWhole;     // the chain the board ends up making with the line played (Judged.whole)
  int32_t readyNext;   // a break in reach once the next block lands (readyNextOf), asked when none lives; NOT_ASKED: not asked
  int32_t extLost;     // and where that break leads: the line and the break played, lost then (readyNextOf); NOT_ASKED: not asked
  int32_t outside;     // outside the list, taken as the default's own move (a list ended by "default")
  int32_t spends;      // outside it for clearing panels below the floor without breaking (decide.c read: belowFloor)
  int32_t met;         // the entry of the list as the board asks it the judged line meets, -1 none (rules.c metOf)
  int32_t modeFirst;   // it meets the mode's own first entry, its break or not (under garbage R->asked holds each entry twice: rules.c withAttacks)
  int32_t first;       // the line in progress, its next step due now: first of its tier (decide.c ranked)
  int32_t carried;     // the line in progress, carried on from the last decision (decide.c carriedCand)
  int32_t idle;        // a line that clears nothing and does no better than the hold (markIdle): ranked after the hold
  double idleLost;     // and, of two that do not live, lost as the hold is and a half frame sooner (an unknown is not shown better)
  int32_t waitMax;     // a line waiting, ranked with the hold at the hold's tier or its own when lower (the line in progress)
  int32_t saving;      // a break under garbage while the board saves panels up (decide.c read): its panels weighed before the list
  int32_t material;    // a break under garbage: 0 leaves a break to build and keeps the floor, 1 keeps one of them, 2 neither; -1 none
  int32_t ideas, ideasAsked;   // the ideas the board the line leaves holds (search/ideas.c; -1 the clock left none), asked when a key needs it
} Judge;
// why a candidate was dropped, counted per decision for the log (DROP_CODE: b back, o list, t late, f floor, r ready, u unbroken, c a swap
// the judge could not press, w a wasted three, j the clock stopped its judging, 2 a 2x not taken to three)
enum { DROP_BACK, DROP_LIST, DROP_LATE, DROP_FLOOR, DROP_READY, DROP_UNBROKEN, DROP_CUT, DROP_WASTE, DROP_UNJUDGED, DROP_TWO, NDROPS };
static int32_t dropped[NPLAYS][NDROPS], offered[NPLAYS];
static void dropAs(int play, int why) { dropped[play][why]++; }
// (the lines cut, by why the judge cut them: judge.c cutWhy -- 1 a first walk over the allowance, 2 no swap there, 3 a walk not begun
// within a reaction -- and how many of them the break search found)
static int32_t cutWhy[4], cutWhyBreak[4];
// THE FIRST LINE OF A DECISION THE BREAK SEARCH SAID BREAKS AND THE JUDGE SAYS DOES NOT: its play, swaps and both counts, for the log
// and the board's dump (two measures of one fact)
static struct { int32_t set, play, nseq, seq[MAXLINE], said, judged, alone; } unbroken;   // (alone: what the board left alone breaks in the line's time)

// the decision's reading of the board, which every candidate is judged by (decide.c read)
typedef struct {
  FactSet F; int32_t enemyTopped;
  List list, asked, guides; int32_t end;
  // (list: the rule's, its priorities; guides: the list as the board asks it -- every entry a break under garbage, then the one rule's
  // three that breaks -- the searches', a proposal's aim indexes it; asked: the same, the rank's)
  int32_t by;                      // NOT_ASKED: none
  int32_t under, topped, breakWaits, belowFloor;
  int32_t saving;                  // saving panels up: breaks that leave the most come before the list (decide.c read)
  int32_t full;                    // more panels than the board lives longest with (outcome.c lifePeakOf): every line's life by them before the list
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
static int judgeCand(const Read *R, const Cand *k0, Judge *J) {
  memset(J, 0, sizeof *J);
  J->readyNext = NOT_ASKED; J->extLost = NOT_ASKED;
  J->k = *k0;
  Cand *k = &J->k;
  int play = k->play, aim = k->aim;
  int st = k->settled >= 0 ? k->settled : settledPlay(play);
  // (STEADY, NOT IN BURSTS -- the owner: while a slab pops, a line that would wait for the board to stop before each swap is judged pressed
  // straight through, each swap as soon as its pair is free: its swaps spread over the pop, not saved for its end -- unless it is found to
  // break garbage, whose break is timed on the board settled)
  if (k->settled < 0 && st && popLeft(decQ.b) > 0 && !(k->x.broke > 0) && (play == PLAY_ENTRY || play == PLAY_NEAREST || play == PLAY_BREAKLINE || play == PLAY_CLEAR)) st = 0;
  // (what it makes is the whole line on the engine, as the judge counts it -- not what the search that found it counted; a line the
  // judge could not play out is judged on the search's word)
  // (the line in progress waiting for the board to settle: judged on the board settled, as carriedCand found it)
  Outcome oc = play == PLAY_CARRYWAIT ? outcomeOf(k->seq, k->nseq, st, 0, 1) : outcome(k->seq, k->nseq, st);
  // (A LINE THE JUDGE COULD NOT PLAY OUT IS NO LINE: a swap not there to press, however long the board is let settle, and the line
  // stops -- its board is not the one the line makes, so it is not ranked as if it were)
  if (!oc.dead && oc.j.cut >= 0) { dropAs(play, DROP_CUT); int w = oc.j.cutWhy >= 1 && oc.j.cutWhy <= 3 ? oc.j.cutWhy : 0; cutWhy[w]++; if (play == PLAY_BREAKSEARCH || play == PLAY_LINEUPBREAK) cutWhyBreak[w]++; return 0; }
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
    if (!unbroken.set) { unbroken.set = 1; unbroken.play = play; unbroken.nseq = k->nseq; for (int i = 0; i < k->nseq; i++) unbroken.seq[i] = k->seq[i]; unbroken.said = k->x.broke; unbroken.judged = j->made.broke; unbroken.alone = j->base; }
  }
  if (k->nseq && swapBack(CR(k->seq[0]), CC(k->seq[0]), m.broke > 0 ? 2 : m.combo > 0 || m.chain > 0)) { dropAs(play, DROP_BACK); return 0; }
  // (it fits the list -- the chain as the game counts it -- or it is outside it: ranked after every line within it that lives, and kept,
  // so a list never chooses a death. Below the rule's material floor a line that clears panels and breaks no garbage spends what the
  // board needs: outside too)
  if (m.chain > MAXCHAIN) { dropAs(play, DROP_LIST); return 0; }
  if (!(j ? fitsList(&R->list, m, j, 0) : fits(&R->list, m))) J->outside = 1;
  if (R->belowFloor && (m.combo > 0 || m.chain > 0) && !(m.broke > 0)) J->outside = J->spends = 1;
  // (THE ENTRY A LINE MEETS, the one the list's key and the tier's keys read: of the list as the board asks it (R->asked) -- its
  // entries, then the one rule's three that breaks)
  // (read off what the board ends up making, the chain already under way included: a swap that cuts it short meets what is left of it,
  // and leaving it alone -- the hold -- meets what it makes)
  int entry = metOf(&R->asked, j ? (Made){ j->whole.combo, j->whole.chain, j->whole.broke, m.cells } : m);
  J->met = j ? entry : -1;
  { int nl = R->list.n; J->modeFirst = J->met == 0 || (R->topped && nl > 0 && J->met == nl + 1); }   // (the one rule's three that breaks is the mode's first only topped out -- the owner: a three is for survival)
  J->saving = R->saving && R->under && m.broke > 0;
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
    if (R->under && oc.nearAfter >= 0) { tierInsert(&J->t, J->t.nlist, oc.nearAfter); tierInsert(&J->t, J->t.nlist + 1, -(double)oc.lifeLeft); }
    else {
      tierInsert(&J->t, J->t.nlist, -(double)oc.lifeLeft);
      if (oc.nearAfter >= 0) tierInsert(&J->t, J->t.nlist + 1, oc.nearAfter);
    }
  }
  J->settled = st; J->aim = aim; J->o = oc; J->back = k->nseq > 0 && swappedBack(CR(k->seq[0]), CC(k->seq[0]));
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
  { int nl = R->list.n; J->modeFirst = J->met == 0 || (R->topped && nl > 0 && J->met == nl + 1); }   // (the one rule's three that breaks is the mode's first only topped out -- the owner: a three is for survival)
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
  J->readyNext = readyNextOf(J->k.seq, J->k.nseq, J->hold ? 0 : J->settled, &J->extLost);
}
static int digWaits(const Judge *k, const Judge *H, int32_t react) {
  return k->k.play == PLAY_TOWARD && !k->o.lives && !H->o.lives && H->o.lostAt != NOT_ASKED && k->o.j.done >= 0 && !k->o.dead &&
         k->o.lostAt <= H->o.lostAt && (double)H->o.lostAt - k->o.j.done > react;
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
static double lostAtOf(int32_t t, int hold) { return t == FOREVER ? 1e300 : t == NOT_ASKED ? (hold ? -1 : 1e299) : t; }
// (THE WALK COUNTED IN THE LOSS: a line's loss less WALK_FRAMES for each action the cursor walks for it -- an action spent comes back a
// window later, as the survival search counts it (search/outlive.c OUT_ACT) -- so a line across the board is the later loss only where
// it buys that much more time than one at hand. At 16 the bot walks too little to live: switching 3/48)
#define WALK_FRAMES 8
#define TWIN_KEY_REACH 12   // (the farthest eight the set-up key 7d reads: an eight within a line's reach)
#define TWIN_STEP 2   // (swaps nearer an eight that decide between two lines otherwise equal: 7d)
static int lineWalk(const Judge *J);
static double lostOf(const Judge *x);
// THE FRAME THE BOARD IS LOST, as the engine has it -- the line's own loss or its readiness's, no walk charged (lostOf charges the walk:
// the order's preference for the nearer, not a loss): what a set-up that must never cost the board's life is held to
static double diesAt(const Judge *x) {
  double own = lostAtOf(x->o.lostAt, x->hold);
  if (!x->hold && x->extLost != NOT_ASKED) { double ext = lostAtOf(x->extLost, 0); if (ext > own) own = ext; }
  return own;
}
// (THE WALK NEVER TURNS A LIFE INTO A DEATH: two boards lost a break's time apart or more on the frame each is lost, the later of them,
// whatever the walk charges -- the judge pressed each line on its walks already, and the charge is the order's preference for the nearer,
// never a break's time of life: the walked line's board 140 frames alive past the hold's was put after it)
static int walkTurns(const Judge *x, const Judge *y) {
  if (x->o.lives || y->o.lives) return 0;
  double dx = diesAt(x), dy = diesAt(y);
  if (dx >= 1e299 || dy >= 1e299 || dx < 0 || dy < 0 || (dx > dy ? dx - dy : dy - dx) < rankSave) return 0;
  return (dx > dy) != (lostOf(x) > lostOf(y));
}
static double lostOf(const Judge *x) {
  if (x->idle) return x->idleLost;   // (a move must beat doing nothing: markIdle)
  double own = lostAtOf(x->o.lostAt, x->hold);
  if (!x->hold && x->extLost != NOT_ASKED) { double ext = lostAtOf(x->extLost, 0); if (ext > own) own = ext; }
  if (x->hold || own >= 1e299 || own < 0) return own;
  return own - (double)WALK_FRAMES * lineWalk(x);
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
static int clears(const Judge *J) { return J->apCombo > 0 || J->apChain > 0 || J->apBroke > 0; }
// THE IDEAS A LINE LEAVES (search/ideas.c, several ideas at once): the board it ends on, the attacks one swap from fired there -- asked
// the first time a key compares them, and kept with the line
// (only with no garbage on the board -- under it the list's entries are breaks, and one a swap away is the break search's to find --
// and IDEAS_ASKS lines a decision at most: each is a judging and a settle of every swap, taken from the decision's own time)
#define IDEAS_ASKS 8
static const List *ideaAims;   // (the list they meet: the rank's, decide.c ranked)
static int32_t ideasAsks;      // (asked this decision)
static int ideasOf(const Judge *J0) {
  Judge *J = (Judge *)J0;
  if (!J->ideasAsked) {
    J->ideasAsked = 1;
    if (decF.under || ideasAsks >= IDEAS_ASKS) { J->ideas = -1; return -1; }
    ideasAsks++;
    endNoKeep = 1;
    const Board *e = clockOut() || J->o.dead ? 0 : J->hold ? lineEnd(0, 0, 0) : lineEnd(J->k.seq, J->k.nseq, J->settled);
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
// (A FALLBACK: a line that meets an entry of the mode's list after its first and breaks no garbage. The mode's goals in order (the
// owner: a mode plays its first entry, builds toward it otherwise): the first entry 0, a set-up toward it or a break 1, the hold and
// any other line that fires no fallback 2, then each fallback, 2 + its entry, and last a clear outside the list that breaks nothing --
// the owner: a combo or chain the list does not ask for is the last resort, after every fallback)
static int fallbackOf(const Judge *J) { return !J->hold && J->met > 0 && !(J->apBroke > 0); }
static int goalKeyOf(const Judge *J) {
  if (J->hold) return 2;
  if (J->met == 0 || J->modeFirst) return 0;   // (the mode's first entry, under garbage too where it breaks nothing: the mode is played there)
  if (fallbackOf(J)) return 2 + J->met;
  if (J->outside && !(J->apBroke > 0) && (J->apCombo > 0 || J->apChain > 0)) return 3 + MAXAIMS;
  return J->apBroke > 0 || setupPlay(J->k.play) ? 1 : 2;
}
// A WASTED THREE: a line whose clears break nothing and throw nothing (a combo of three, no chain) -- panels spent for no garbage sent
// and none broken
// (a line that breaks garbage beyond the board left alone (apBroke, the judge's count) made its threes on the way to the break -- a block
// let down, the panels in the break's way cleared -- as the rules let a three break garbage (rules.c fits, judge.c breakingThree): not
// wasted. The board's own chain cut short is, whatever the line breaks)
static int cutsShort(const Judge *J);
// A COMBO THE MODE DOES NOT ASK FOR (the owner: combos only where the enemy is topped out -- finish them -- or the board dies without
// one): four or more panels at once, no chain, outside the mode's list
static int comboOutside(const Judge *J) { return !J->hold && J->outside && J->apCombo >= 4 && J->apChain < 2; }
// (the garbage a line breaks as the judge played it: a line whose board is lost while it plays out is ranked on the search's word -- a
// line in progress on what it was begun for -- and that word is no break the judge saw)
static int32_t brokeSeen(const Judge *J) { return J->o.dead ? J->o.j.made.broke : J->apBroke; }
// (the entry of the mode's list a line meets where it asks a combo, MAXAIMS where it meets none that does)
// (THE FINISH: the list asks a combo of eight or more and no chain -- finish them, the enemy near the top: a slab two rows tall or more is
// up to 76 frames of shake it lives through, the 8's pieces are a few cells each -- the owner: big chains near the top give it time)
#define ZIP_WALK 2   // (the actions more a dig may walk for the zip: rank.c the dig zipped)
static int finishAsked(void) {
  int big = 0;
  for (int i = 0; i < theList.n; i++) { const Test *c = &theList.aim[i].combo, *h = &theList.aim[i].chain;
    if (h->op) return 0;
    if ((c->op == OP_GE || c->op == OP_GT) && c->n + (c->op == OP_GT) >= 8) big = 1; }
  return big;
}
static int comboEntry(const Judge *J) { return J->met >= 0 && J->met < theList.n && theList.aim[J->met].combo.op ? J->met : MAXAIMS; }
// (the lowest garbage row of the decision's board, read once a board: search/break.c lowestG)
#define GARBAGE_AWAY 4
static int awayFromGarbage(const Judge *J) {
  static LOCAL const Board *forB; static LOCAL int32_t forClock = -1, lowG = 0;
  if (J->hold || !J->k.nseq || brokeSeen(J) > 0 || !decQ.b) return 0;
  if (forB != decQ.b || forClock != decQ.b->clock) { forB = decQ.b; forClock = decQ.b->clock; lowG = lowestG(decQ.b); }
  return lowG < gridLen(decQ.b) && lowG - CR(J->k.seq[0]) >= GARBAGE_AWAY;
}
// (A BREAK BY A THREE: a line that breaks garbage with no combo of four or more and no chain of two or more. Not topped out, of two that
// both live it is no break to put first -- the owner: a three is for survival only, topped out; the mode's attacks break the garbage)
static int threeBreakOnly(const Judge *J) { return J->apBroke > 0 && J->apCombo < 4 && J->apChain < 2; }
// (A SET-UP OF ANY KIND: a set-up, a lineup, a line toward the next break or nearest the list, a level -- a move that makes the next
// thing, no hold)
static int setupKind(const Judge *J) {
  int p = J->k.play;
  return !J->hold && (p == PLAY_SETUP || p == PLAY_LINEUP || p == PLAY_TOWARD || p == PLAY_NEAREST || p == PLAY_LEVEL);
}
static int breaksFirst(const Judge *J, int lx) { return J->apBroke > 0 && !(lx && !decF.topped && threeBreakOnly(J)); }
static int wastesThree(const Judge *J) {
  if (J->hold) return 0;
  // (any clear of three that breaks nothing and begins no chain, whatever the line breaks after it -- the owner: never a three unless
  // it follows through; a line dropped before its later break leaves the three made for nothing. A line lost too)
  if (J->o.j.threes > 0) return 1;
  if (comboOutside(J) && !(J->apBroke > 0)) return 1;   // (a combo the mode does not ask for that breaks nothing: the owner, only where the board dies without it)
  if (cutsShort(J) && !(J->apBroke > 0)) return 1;   // (the board's own chain cut short: the three that began it made for nothing -- unless the
  // line breaks more garbage than the board left alone, its chain and all: a break is never a three for nothing, the chain key weighs it)
  return (J->apCombo > 0 || J->apChain > 0) && !(J->apBroke > 0) && J->apCombo <= 3 && J->apChain <= 1 && thrownOf(J) == 0;
}
static int beatsHold(const Judge *L, const Judge *H) {
  int32_t l = L->o.lostAt, h = H->o.lostAt;
  // (a known death beats holding only when the hold's is one too, and later: two deaths are two frames)
  if (l != NOT_ASKED && (!L->o.dead || H->o.dead) && (l == FOREVER ? h != FOREVER : h != FOREVER && h != NOT_ASKED && l > h)) return 1;
  if (L->o.nearAfter >= 0 && H->o.nearAfter >= 0 && L->o.nearAfter < H->o.nearAfter) return 1;
  // (a break lost no sooner than the hold: the garbage it converts is the board's next panels -- run 491, large_garbage-4, 7531: two
  // breaks lost at 44 put after a hold lost at 44)
  if (L->apBroke > 0 && l != NOT_ASKED && h != NOT_ASKED && (l == FOREVER || (h != FOREVER && l >= h))) return 1;
  if (L->o.ready == 1 && H->o.ready != 1) return 1;
  if (L->readyNext == 1 && H->readyNext != NOT_ASKED && H->readyNext != 1) return 1;
  // (A SET-UP: with no garbage on the board, a line that lives where the hold does and leaves more ideas ready than the hold -- an attack
  // made ready is something done)
  if (!decF.under && L->o.lives && H->o.lives && moreIdeas(L, H)) return 1;
  return 0;
}
static double lostOf(const Judge *x);
// (FLATTENING WHEN THERE IS NOTHING TO DO: a level line -- the stack walked flatter, nothing cleared -- known to do no worse than
// holding beats holding; it is still the last of the lines that do something, tier 4's last)
static int levelsFree(const Judge *L, const Judge *H) {
  if (L->k.play != PLAY_LEVEL || L->o.dead) return 0;
  if (L->o.lives) return 1;
  return !H->o.lives && L->o.lostAt != NOT_ASKED && H->o.lostAt != NOT_ASKED && lostOf(L) >= lostOf(H);
}
// (TWO COLUMNS LOADED AHEAD: a set-up for an eight is not doing nothing where it lives, or is lost no sooner than the
// hold -- the mode that fires it has no time to build it; propose.c twinLines)
// (the time to build one: not topped, no chain going and no slab popping -- under garbage too, on the rows at rest below it: garbage
// on its way lands on top of the rows sorted, and a break is put before it (1'') -- it is built where the bot would otherwise hold)
static int twinTime(int under, int topped) { (void)under; return !topped && decQ.b->chainCounter < 2 && popLeft(decQ.b) <= 0; }
static int loadsFree(const Judge *L, const Judge *H) {
  if (L->k.twin != 2 || L->o.dead || !twinTime(decF.under, 0)) return 0;
  if (L->o.lives) return 1;
  return !H->o.lives && L->o.lostAt != NOT_ASKED && H->o.lostAt != NOT_ASKED && lostOf(L) >= lostOf(H);
}
static void markIdle(Judge **a, int n) {
  const Judge *H = 0;
  for (int i = 0; i < n && !H; i++) if (a[i]->hold) H = a[i];
  for (int i = 0; i < n; i++) a[i]->idle = 0;
  double holdLost = H ? lostOf(H) : 0;
  for (int i = 0; i < n; i++) if (H && clearsNothing(a[i]) && !beatsHold(a[i], H) && !levelsFree(a[i], H) && !loadsFree(a[i], H)) { a[i]->idle = 1; a[i]->idleLost = holdLost - 0.5; }
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
#define FLAT_ROWS 2
#define BREAK_WALK 20   // the actions a break's line is pressed in, as the allowance keeps them (an estimate: a few swaps and their walks)
static int downtime(void) {
  return !decF.under && (decF.next == NOT_ASKED || decF.next > 2 * rankSave) && decQ.b->chainCounter < 2 &&
         (pressAllowance < 0 || pressAllowance >= 2 * BREAK_WALK);
}
#define FOCUS_NEAR 2
#define FOCUS_FAR 5
static int focusBand(const Judge *J) {
  int d = iabs(CR(J->k.seq[0]) - decQ.b->curRow) + iabs(CC(J->k.seq[0]) - decQ.b->curCol);
  return d <= FOCUS_NEAR ? 0 : d >= FOCUS_FAR ? 2 : 1;
}
static int firstWalk(const Judge *J) { return J->hold || !J->k.nseq ? 0 : actionsFor(decQ.b->curRow, decQ.b->curCol, CR(J->k.seq[0]), CC(J->k.seq[0]), HOLDTIGHT + 1); }
// (the cursor's actions over the whole line, swap after swap in the order it is pressed, from where the cursor is)
#define WALK_EARN 6     // the actions more a far line may walk than a nearer one that also attacks
static int32_t carriedSunk = -1;   // (the actions the line in progress was judged to walk in all when played: decide.c carryOf; -1 not known)
static int lineWalk(const Judge *J) {
  int n = 0, r = decQ.b->curRow, c = decQ.b->curCol;
  for (int i = 0; !J->hold && i < J->k.nseq; i++) { n += actionsFor(r, c, CR(J->k.seq[i]), CC(J->k.seq[i]), HOLDTIGHT + 1); r = CR(J->k.seq[i]); c = CC(J->k.seq[i]); }
  return n;
}
// (a line that breaks nothing and walks the input allowance below a break's walk: the next break is pressed out of what is left)
// (how far below a break's walk a line that breaks nothing leaves the allowance: 0 when it keeps it, or breaks -- the window already
// short, the line that spends less of what is left keeps more of the next break)
static int reserveShort(const Judge *J) { return pressAllowance < 0 || J->apBroke > 0 ? 0 : imax(0, BREAK_WALK - (pressAllowance - lineWalk(J))); }
static int spendsReserve(const Judge *J) { return pressAllowance >= 0 && !(J->apBroke > 0) && pressAllowance - lineWalk(J) < BREAK_WALK; }
// A SWAP TOWARD AN EIGHT THAT COSTS NOTHING: a leaves the board nearer a two-column eight than b (outcome.c twinAfter, the one distance
// the set-ups are proposed by too: propose.c twinScan to TWIN_REACH), is lost no sooner (or lives), and leaves the window its reserve --
// the set-up built between moves, of what is spare: a swap nearer is a swap nearer
static int nearerEight(const Judge *a, const Judge *b) {
  if (a->o.twinAfter < 0 || b->o.twinAfter < 0 || a->o.twinAfter >= b->o.twinAfter || b->o.twinAfter >= 99 || spendsReserve(a)) return 0;
  return a->o.lives || (!b->o.lives && diesAt(a) >= diesAt(b));
}
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
static int lostAlike(const Judge *x, const Judge *y) {
  double lo = lostOf(x) < lostOf(y) ? lostOf(x) : lostOf(y), hi = lostOf(x) < lostOf(y) ? lostOf(y) : lostOf(x);
  int tlo = (int)(lo / rankSave), thi = (int)(hi / rankSave);
  return lo >= rankSave && (tlo == thi || tlo >= 3 || hi - lo < rankSave);   // (or lost less than a break's time apart: the later buys no break more)
}
// (THE KEY THAT DECIDED: the line of the last return compareJudged took -- answer.c logs it for the line played over one lost later)
static int32_t cmpKey;
// (BOUGHT WITH THE PANELS: the later loss of a line that clears panels below the floor and breaks nothing is stop time, bought with the
// panels the next break is made from. Beside one that spends none and leaves the next decision a break's time (rankSave), the two
// survive alike, and the list puts the one that keeps its panels first -- under garbage too: a chain fired for its stop leaves the
// garbage where it is and fewer panels to break it with)
static int boughtWithPanels(const Judge *x, const Judge *y) {
  double lo = lostOf(x) < lostOf(y) ? lostOf(x) : lostOf(y);
  return lo >= rankSave && x->spends != y->spends && (lostOf(x) > lostOf(y) ? x : y)->spends;
}
// (A COMBO OF FOUR OUTSIDE THE LIST: panels spent for a small piece the mode does not ask for -- the owner: a last resort)
static int wastesFour(const Judge *J) { return !J->hold && !J->o.dead && J->outside && J->o.j.made.combo == 4 && J->o.j.made.chain < 2; }
// (THE CHAIN FALLING GROWN: the longest chain the mode's list asks -- an entry of "or more" its target, the length it asks at least: a
// link past the target is presses and panels the list does not ask for)
static int32_t listChainCap(void) {
  int32_t cap = 0;
  for (int i = 0; i < theList.n; i++) { const Test *t = &theList.aim[i].chain; int32_t c = t->op == OP_GE || t->op == OP_EQ || t->op == OP_LE ? t->n : t->op == OP_GT ? t->n + 1 : 0; if (c > cap) cap = c; }
  return cap;
}
#define BACK_CALM 1   // (breaks' time, rankSave: a loss nearer than this, the line that does best plays whether it swaps back or not)
static int32_t chainReach(const Judge *J) { return J->o.dead ? 0 : J->o.j.chainAll; }
// (A 2x ITS LINE DOES NOT CONTINUE: the chain the line makes ends at two -- read on the judge's count whether or not the board is lost
// while the line plays out: a line on a board lost later makes its 2x all the same)
static int shortChain(const Judge *J) { int32_t reach = J->o.dead ? imax(J->apChain, J->o.j.chainAll) : chainReach(J); return !J->hold && J->apChain >= 2 && reach == 2; }
// (THE PLAN IN PROGRESS STANDS WHILE IT STANDS THE HORIZON: lives is a line on the board's life -- HORIZON frames from now and REST after
// its last swap -- and a line near it is judged on one side of it one decision and the other the next, as the horizon moves on and garbage
// is told. The line in progress keeps its place while it stands HORIZON frames from now, so it is put down only where it fails, not where
// the next decision's horizon reaches a frame further: every swap of a plan put down is a move for nothing)
static int goalLine(const Judge *J) { return !J->hold && (J->met == 0 || J->modeFirst); }
// (OFF THE MODE: a line whose attack the mode's list does not ask -- a chain where it asks combos, a 2x or a chain past its length, a combo
// of four or more it does not ask -- the board's own chain going on counted, as every line has it alike)
#define OFF_MODE_LIFE 2   // (breaks' time, rankSave: the life a line that keeps to the mode needs for the off-mode one to go after it)
static int offMode(const Judge *J) { return !J->hold && !J->o.dead && J->met < 0 && (chainReach(J) >= 2 || J->o.j.whole.combo >= 4); }
static int livesOn(const Judge *J) { return J->o.lives || (J->carried && !J->o.dead && J->o.lostAt != NOT_ASKED && J->o.lostAt >= HORIZON); }
static int compareJudged(const Judge *x, const Judge *y) {
  int lx = livesOn(x), ly = livesOn(y);
  // 1. lives before does not -- the line in progress that lives by the horizon alone beside a line of the mode's first entry lost no sooner
  // than it, the two alike: the mode gives way to survival only (the owner), never to a plan that lives by the horizon alone
  if (lx != ly) {
    const Judge *l = lx ? x : y, *o = lx ? y : x;
    if (!(!l->o.lives && goalLine(o) && !o->o.dead && o->o.lostAt != NOT_ASKED && diesAt(o) >= diesAt(l))) return (cmpKey = __LINE__, (lx ? -1 : 1));
    lx = ly = 1;
  }
  // 1. THE MODE, NOT THE MOST LIFE (the owner: the mode is respected always, garbage on the board or not; a lower stack is more time): a
  // line off the mode after one that keeps to it and leaves the board OFF_MODE_LIFE breaks' time or more -- the next decisions keep the
  // stack down; the life an off-mode attack buys past that is the mode thrown away. Under garbage, only one that breaks as much of it
  if (offMode(x) != offMode(y)) {
    const Judge *f = offMode(x) ? x : y, *o = f == x ? y : x;
    if ((livesOn(o) || (!o->o.dead && diesAt(o) >= OFF_MODE_LIFE * rankSave)) && (!decF.under || imax(0, brokeSeen(o)) >= imax(0, brokeSeen(f))))
      return (cmpKey = __LINE__, (f == x ? 1 : -1));
  }
  // 1. (neither lives) SURVIVAL FIRST: the later loss, unless the two are lost alike (lostAlike: as many breaks' time left) -- every key
  // after decides only between lines that survive alike
  // 1. (neither lives, garbage on the board or on its way, below the material floor) THE BREAK'S MATERIAL KEPT (the owner: low, spend
  // less and break) (the owner: the board spent to three rows and
  // dying for want of panels): a clear that breaks nothing (spends) after a line that keeps the panels and is lost a break's time away or
  // more -- the panels it spends to stall are the next break's; it is played only where every line that keeps them is lost within one
  // (and only where the line that keeps them leaves more of them: a board the garbage lands on loses its panels under the lowest garbage
  // held or not, and a hold that leaves no more of them keeps nothing -- outcome.c matLeft)
  if (!lx && (decF.under || decQ.narr > 0) && x->spends != y->spends) {
    const Judge *o = x->spends ? y : x, *sp = x->spends ? x : y;
    // (and only where the spend buys less than a break's time more: one that keeps the board alive a break's time longer buys the next
    // break's chance -- death is never an option)
    if (diesAt(o) >= rankSave && o->o.matLeft >= 0 && sp->o.matLeft >= 0 && o->o.matLeft > sp->o.matLeft && diesAt(sp) - diesAt(o) < rankSave)
      return (cmpKey = __LINE__, (x->spends ? 1 : -1));
  }
  // (survival as the board is lost: a line that meets the mode's first entry and is lost no sooner is never passed over for the walk the
  // order charges it -- the mode gives way to survival only)
  int goalNoSooner = goalLine(x) != goalLine(y) && diesAt(goalLine(x) ? x : y) >= diesAt(goalLine(x) ? y : x);
  if (!lx && walkTurns(x, y)) return (cmpKey = __LINE__, (diesAt(y) > diesAt(x) ? 1 : -1));
  if (!lx && !lostAlike(x, y) && !boughtWithPanels(x, y) && !goalNoSooner && lostOf(x) != lostOf(y)) return (cmpKey = __LINE__, (lostOf(y) > lostOf(x) ? 1 : -1));
  // 1'2. NO 2x WHERE THE BOARD IS SAFE (the owner: a 2x is continued or not made -- one made with nothing to survive is for nothing): of
  // two that live, no garbage on the board and the board making no chain of its own, a line whose chain ends at two after one that makes
  // none and breaks as much
  if (lx && !decF.under && aloneChain < 2 && shortChain(x) != shortChain(y)) {
    const Judge *sc = shortChain(x) ? x : y, *o = shortChain(x) ? y : x;
    if (imax(0, o->apBroke) >= imax(0, sc->apBroke)) return (cmpKey = __LINE__, (shortChain(x) ? 1 : -1));
  }
  // 1'. THE CHAIN FALLING, CARRIED ON (the owner: a chain going is continued unless continuing kills the board): while the board chains,
  // of two that survive alike, the one that takes the chain further, up to the longest the list asks -- before every key but survival,
  // under garbage too: a chain left to end short of the target is the attack thrown away
  // (and a chain the board is about to make on its own -- garbage converting into a match, panels falling -- is a chain going too: the
  // line that takes it further is chosen while it can still be reached, not once its second link has popped)
  if (decQ.b && (decQ.b->chainCounter >= 2 || aloneChain >= 2) && (lx || lostAlike(x, y)) && !finishAsked()) {
    int32_t cap = imax(listChainCap(), 3);   // (at least to three: the owner)
    {
      int32_t cx = imin(chainReach(x), cap), cy = imin(chainReach(y), cap);
      // (neither living: a 2x is still taken on to three -- the owner: a 2x is continued unless that kills the board -- but a chain longer
      // than that only where it breaks as much garbage as the other: passed over, a break is the board's life)
      const Judge *lc = cx > cy ? x : y, *sc = cx > cy ? y : x;
      if (!lx && imax(0, lc->apBroke) < imax(0, sc->apBroke)) { cx = imin(cx, 3); cy = imin(cy, 3); }
      // (and a line that breaks more and is lost no sooner is never passed over for a chain past three, nor one that is lost later for a
      // 2x taken to three: the break is the longer life)
      int brokeMore = !lx && imax(0, sc->apBroke) > imax(0, lc->apBroke) && (imin(cx, cy) >= 3 ? lostOf(sc) >= lostOf(lc) : lostOf(sc) > lostOf(lc));
      // (a chain taken further on the window the next break is pressed from is not -- nor, garbage on the board, one that leaves the
      // window under half a break's walk where the other leaves it more: the next break would not be there to press)
      int spends = (spendsReserve(lc) && !spendsReserve(sc)) ||
                   (decF.under && pressAllowance >= 0 && pressAllowance - lineWalk(lc) < BREAK_WALK / 2 && reserveShort(lc) > reserveShort(sc));
      if (cx != cy && !brokeMore && !spends) return (cmpKey = __LINE__, (cy - cx));
    }
  }
  // 1'f. NO SLAB AT THE FINISH: where the list is the finish (finishAsked), of two that survive alike, the line that sends no slab of two
  // rows or more (a chain of three or longer, the board's own going on included) before one that does, whatever either breaks -- the
  // owner: no big chains at the finish; a chain is played there only where nothing else lives as long
  if (finishAsked() && (lx || lostAlike(x, y))) {
    int bx = chainReach(x) >= 3, by = chainReach(y) >= 3;
    if (bx != by) return (cmpKey = __LINE__, (bx ? 1 : -1));
  }
  // 1'L. UNDER GARBAGE, BREAK (the owner: it waits too long to break garbage; low, spend less and focus on breaking): garbage on the
  // board, of two that both live, or are lost alike with the break lost no sooner, a line that breaks garbage before one that breaks none
  // and meets nothing the mode asks for (the hold, a set-up) -- waiting meets the mode no more than the break does, and the garbage left
  // is the board's danger; below the material floor before any line that breaks none, the list's or not: the break is the panels the
  // board lacks, and a board waited on below the floor finds no break later
  if (decF.under && (lx || lostAlike(x, y)) && breaksFirst(x, lx) != breaksFirst(y, lx)) {
    const Judge *b = breaksFirst(x, lx) ? x : y, *o = breaksFirst(x, lx) ? y : x;
    if ((lx || diesAt(b) >= diesAt(o)) && (decF.belowFloor || !goalLine(o))) return (cmpKey = __LINE__, (b == x ? -1 : 1));
  }
  // 1'g. UNDER GARBAGE, NOT AWAY FROM IT (the owner: the garbage at the top, a move at the bottom makes no sense): of two that survive
  // alike, a line that breaks nothing and whose first swap is GARBAGE_AWAY rows or more under the lowest garbage after one that does not
  // go there, breaks as much, meets the mode as much and is lost no sooner -- the walk down and back is the window spent for nothing
  if (decF.under && (lx || lostAlike(x, y))) {
    int fx = awayFromGarbage(x), fy = awayFromGarbage(y);
    if (fx != fy) {
      const Judge *f = fx ? x : y, *o = fx ? y : x;
      if (imax(0, brokeSeen(o)) >= imax(0, brokeSeen(f)) && !(goalLine(f) && !goalLine(o)) && (lx || diesAt(o) >= diesAt(f))) return (cmpKey = __LINE__, (fx ? 1 : -1));
    }
  }
  // 1'r. READY FOR THE NEXT BLOCK: of two lost alike, neither living, the line that leaves a break in reach once the next block lands
  // (readyNext) before one that does not and breaks no more garbage now -- a board that cannot break what lands next is the loss
  // survival's horizon does not reach yet; a break now is never given up for it
  if (!lx && lostAlike(x, y) && x->readyNext != NOT_ASKED && y->readyNext != NOT_ASKED && (x->readyNext == 1) != (y->readyNext == 1)) {
    const Judge *r = x->readyNext == 1 ? x : y, *o = x->readyNext == 1 ? y : x;
    if (imax(0, r->apBroke) >= imax(0, o->apBroke)) return (cmpKey = __LINE__, (x->readyNext == 1 ? -1 : 1));
  }
  // 1'b. COMBOS ONLY WHERE THE MODE ASKS (the owner): of two that survive alike, a combo the mode does not ask for after a line that makes
  // none and breaks as much garbage -- a combo that breaks more is the break, a combo that breaks no more is the panels of an attack the
  // mode does not want
  if ((lx || lostAlike(x, y)) && comboOutside(x) != comboOutside(y)) {
    const Judge *cb = comboOutside(x) ? x : y, *o = comboOutside(x) ? y : x;
    if (imax(0, o->apBroke) >= imax(0, cb->apBroke)) return (cmpKey = __LINE__, (comboOutside(x) ? 1 : -1));
  }
  // 1'a. THE ALLOWANCE'S RESERVE: of two that survive alike (both live, or lost alike), a line that breaks nothing and walks the input
  // allowance below a break's walk (BREAK_WALK) after one that keeps it, and of two that leave it short the one that leaves it shorter
  // after -- the next break is pressed out of what is left, and what is spent comes back only a window later, the garbage it is needed
  // for may be told of by then or not
  if (pressAllowance >= 0 && (lx || lostAlike(x, y))) {
    int rx = reserveShort(x), ry = reserveShort(y);
    if (rx != ry) return (cmpKey = __LINE__, (rx - ry));
  }
  // 1'u. NO SWAP BACK (the owner: no flip and back): of two that both live, or are lost alike and BACK_CALM breaks' time off or more, a line whose first swap swaps back the pair the last swap
  // pressed swapped after one that does not and breaks as much -- the two swaps are inputs spent to stand where the board stood
  if ((lx || (lostAlike(x, y) && (lostOf(x) < lostOf(y) ? lostOf(x) : lostOf(y)) >= BACK_CALM * rankSave)) && !x->hold && !y->hold && x->back != y->back) {
    const Judge *b = x->back ? x : y, *o = x->back ? y : x;
    if (imax(0, o->apBroke) >= imax(0, b->apBroke)) return (cmpKey = __LINE__, (x->back ? 1 : -1));
  }
  // 1'f. FOCUS (the owner: precise, efficient -- the cursor kept where the work is): of two that survive alike and both break garbage or
  // both do not, the one begun nearer the cursor -- within FOCUS_NEAR cells, then short of FOCUS_FAR, then farther: the board is
  // worked where the cursor is, and left only for what survives better or breaks where the near one does not
  // (of two that break garbage, begun nearer is no saving where the nearer walks more for the break -- a swap put in front of the break the
  // other already has: the fewer actions for as much garbage decides first, 1'' below)
  if ((lx || lostAlike(x, y)) && !x->hold && !y->hold && (x->apBroke > 0) == (y->apBroke > 0) && x->k.nseq && y->k.nseq &&
      !(x->apBroke > 0 && imax(0, x->apBroke) == imax(0, y->apBroke) && lineWalk(x) != lineWalk(y))) {
    int bx = focusBand(x), by = focusBand(y);
    // (and a far line that breaks more garbage than the near one is not left for it: the near one is worked only where it breaks as much
    // -- the garbage broken for the walk decides, 1'' below)
    const Judge *nr = bx < by ? x : y, *fr = bx < by ? y : x;
    if (bx != by && !(nr->apBroke > 0 && imax(0, nr->apBroke) < imax(0, fr->apBroke))) return (cmpKey = __LINE__, (bx - by));
  }
  // 1'0. THE LINE IN PROGRESS OVER ONE IT OUTLASTS AND OUTBREAKS (the owner: a move is wasted only where survival asks it): of two that
  // survive alike, the line the last decision was playing before another lost no later that breaks no more garbage -- every swap
  // pressed of a line put down is spent from the input window for nothing
  if (x->carried != y->carried && !x->hold && !y->hold && (lx || lostAlike(x, y))) {
    const Judge *c = x->carried ? x : y, *o = x->carried ? y : x;
    if (lostOf(c) >= lostOf(o) && imax(0, c->apBroke) >= imax(0, o->apBroke) && !(goalLine(o) && !goalLine(c))) return (cmpKey = __LINE__, (x->carried ? -1 : 1));
  }
  // 1''. UNDER GARBAGE, THE WINDOW SPENT ON BREAKS: of two that survive alike, a line that breaks before one that breaks nothing, then
  // the one that walks fewer actions -- the hold walks none: under garbage only a break is worth what it spends from the input window,
  // and the rest wait for it to give some back
  if (decF.under && pressAllowance >= 0 && (lx || lostAlike(x, y))) {
    int bx = breaksFirst(x, lx), by = breaksFirst(y, lx);
    // (but not over the mode's first entry thrown where the break meets none of it: the mode is played under garbage too -- the goal
    // decides between them, 1b)
    if (bx != by && !((bx ? y : x)->modeFirst && !(bx ? x : y)->modeFirst)) return (cmpKey = __LINE__, (bx ? -1 : 1));
    // (of two that break nothing: a fallback after a line that fires none -- the mode's list before the walk; then the fewer actions)
    if (!bx) {
      int fx = fallbackOf(x), fy = fallbackOf(y);
      if (fx != fy) return (cmpKey = __LINE__, (fx ? 1 : -1));
      // (and a swap toward an eight, lost no sooner and the reserve kept, before the wait -- set up between moves: rank.c nearerEight)
      int ex = nearerEight(x, y), ey = nearerEight(y, x);
      if (ex != ey) return (cmpKey = __LINE__, (ex ? -1 : 1));
      // (WHILE GARBAGE POPS, THE CURSOR FREE (the owner: it holds too much -- it can do things while garbage is breaking): a set-up --
      // a set-up, a lineup, a line toward the next break or nearest the list; no clear of three for nothing, the reserve kept, lost no
      // sooner -- before the hold, whatever it walks: the wait buys nothing the pop does not. A line the survival search found is no
      // set-up: pressed for nothing it spends the window the next break needs)
      // (and while the board's own chain falls -- the owner: set up and started, it can do something else; it just sits there waiting for
      // it to finish: a set-up that keeps the chain as far as the hold does, the same)
      // (and every other time too -- the owner: hold is dumb, a set-up or flattening is better 90% of the time; swaps over distance, the
      // set-up is key: a set-up, a lineup, a line toward the next break or nearest the list, or a level, before the hold and before a
      // line of another kind, whatever either walks)
      int chaining = decQ.b && (decQ.b->chainCounter >= 2 || aloneChain >= 2);
      int sx = setupKind(x), sy = setupKind(y);
      if (sx != sy) {
        const Judge *m = sx ? x : y, *h = sx ? y : x;
        if (m->k.nseq && !wastesThree(m) && !spendsReserve(m) && (lx || diesAt(m) >= diesAt(h)) && (!chaining || (chainReach(m) >= chainReach(h) && !cutsShort(m))))
          return (cmpKey = __LINE__, (sx ? -1 : 1));
      }
      // (of two set-ups: the one that leaves more crossed seams -- a swap finishing two colours at once, the players' 8+ combo)
      if (sx && sy && x->o.j.seams != y->o.j.seams) return (cmpKey = __LINE__, (x->o.j.seams > y->o.j.seams ? -1 : 1));
      int wx = lineWalk(x), wy = lineWalk(y); if (wx != wy) return (cmpKey = __LINE__, (wx - wy));
    }
    // (of two that break: one that leaves a break in reach once the next block lands, where neither lives -- a dig runs dry on the
    // break it did not keep; then the one that breaks more garbage for each action it walks -- the window pays for every cell walked)
    // (of two that break: one that breaks as much garbage without a combo of four the list does not ask for, before one that spends it)
    else if (wastesFour(x) != wastesFour(y) && (wastesFour(x) ? y : x)->apBroke >= (wastesFour(x) ? x : y)->apBroke) return (cmpKey = __LINE__, (wastesFour(x) ? 1 : -1));
    else if (x->readyNext != NOT_ASKED && y->readyNext != NOT_ASKED && (x->readyNext == 1) != (y->readyNext == 1)) return (cmpKey = __LINE__, (x->readyNext == 1 ? -1 : 1));
    // (of two that break: the one that meets the earlier combo entry of the mode's list -- the combo the mode asks goes with the break)
    else if (comboEntry(x) != comboEntry(y)) return (cmpKey = __LINE__, (comboEntry(x) - comboEntry(y)));
    // (of two that break: the one that meets the mode's first entry, chain or combo -- the mode's attack under garbage, the break with
    // it: the owner, the mode passed over for survival only)
    else if (goalLine(x) != goalLine(y)) return (cmpKey = __LINE__, (goalLine(x) ? -1 : 1));
    // (a line put down for another throws away the actions pressed of it: the other is charged them -- the walk the line in progress was
    // played for, less what is left of it)
    else {
      int sx = lineWalk(x), sy = lineWalk(y);
      if (carriedSunk >= 0 && x->carried != y->carried) { const Judge *c = x->carried ? x : y; int sunk = imax(0, carriedSunk - lineWalk(c)); if (c == x) sy += sunk; else sx += sunk; }
      // (THE DIG ZIPPED -- the owner: digging goes for the zipper: of two that break as much garbage, walking within ZIP_WALK actions of
      // each other, the one that leaves the colours more zippered -- fewer of a colour touching, more a swap apart: judge.c spreadOf)
      if (x->apBroke == y->apBroke && iabs(sx - sy) <= ZIP_WALK && x->o.j.spread != y->o.j.spread) return (cmpKey = __LINE__, (x->o.j.spread > y->o.j.spread ? -1 : 1));
      int64_t px = (int64_t)x->apBroke * imax(1, sy), py = (int64_t)y->apBroke * imax(1, sx); if (px != py) return (cmpKey = __LINE__, (px > py ? -1 : 1));
    }
  }
  // 1a. THE LINE IN PROGRESS KEPT: of two that both live or both do not, the line the last decision was playing, judged again on the
  // board as it is, before another -- unless the other is lost later and not alike (neither lives: lostAlike, as 3 counts them) or meets
  // an earlier entry of the list (both live). A line put down halfway leaves a board its forecast never judged.
  // (and not over a break where neither lives and the line in progress breaks nothing: the break is put first (2) -- the panels it
  // converts are the board's next, and only a break gives back what a clear spends)
  if (x->carried != y->carried && !x->hold && !y->hold) {
    const Judge *c = x->carried ? x : y, *o = x->carried ? y : x;
    int oBreaks = o->apBroke > 0 && lostOf(o) >= rankSave && !(c->apBroke > 0) && (decF.belowFloor || lostOf(c) - lostOf(o) < rankSave);
    int keep = lx ? !(o->met >= 0 && (c->met < 0 || o->met < c->met)) : (lostOf(o) <= lostOf(c) || lostAlike(c, o)) && !oBreaks;
    // (and under garbage, a break in progress over another break that costs more presses than what is left of it -- switching spends the
    // window on swaps pressed for nothing -- unless the one in progress is lost within a break's time)
    if (!keep && decF.under && c->apBroke > 0 && o->apBroke > 0 && lineWalk(o) > lineWalk(c) && lostOf(c) >= rankSave) keep = 1;
    if (keep) return (cmpKey = __LINE__, (x->carried ? -1 : 1));
  }
  // 1b. THE MODE'S GOALS (the owner: a mode plays its first entry, builds toward it otherwise, and takes a fallback only where the board
  // dies without it -- survival first): of two that survive alike -- both live, or both lost no sooner than a break's time and less than
  // a break's time apart, where the later buys no break more -- and keep the board's own chain alike, the first entry, then a line that
  // fires no fallback, then each fallback in the list's order (goalKeyOf)
  if (cutsShort(x) == cutsShort(y)) {
    double lo = lostOf(x) < lostOf(y) ? lostOf(x) : lostOf(y), hi = lostOf(x) < lostOf(y) ? lostOf(y) : lostOf(x);
    if (lx || (lo >= rankSave && hi - lo < rankSave)) {
      int gx = goalKeyOf(x), gy = goalKeyOf(y);
      if (gx != gy) return (cmpKey = __LINE__, (gx - gy));
      // (and of two that make the first entry, or two set-ups toward it, the fewer presses: the owner, the goal first and the shortest
      // way to it, the set-up included -- a press is a press, a cursor step or a swap)
      int sx = !x->hold && setupPlay(x->k.play), sy = !y->hold && setupPlay(y->k.play);
      if (gx == 0 || (sx && sy)) { int wx = lineWalk(x), wy = lineWalk(y); if (wx != wy) return (cmpKey = __LINE__, (wx - wy)); }
    }
  }
  // 1c. DOWNTIME, FLAT (the owner: flatter boards give more options): with no garbage on the board or due within two breaks' time,
  // the board not chaining and the window holding two breaks' walks, of two that live and meet the mode's list alike, the one that
  // leaves the board flatter by FLAT_ROWS or more -- the hold too
  if (lx && downtime() && x->o.j.even >= 0 && y->o.j.even >= 0 && iabs(x->o.j.even - y->o.j.even) >= FLAT_ROWS)
    return (cmpKey = __LINE__, (x->o.j.even - y->o.j.even));
  if (lx) {
    // 2. (both live) the board's own chain kept before cut short: a chain the board is making is never stopped by a line that need not
    if (cutsShort(x) != cutsShort(y)) return (cmpKey = __LINE__, (cutsShort(x) ? 1 : -1));
    // 2. (both live) within the list before outside it
    if (x->outside != y->outside) return (cmpKey = __LINE__, (x->outside ? 1 : -1));
    // 2b. (both live) the line that throws before one that throws nothing -- a three that breaks, a set-up, the hold: a board that lives
    // either way sends garbage (the owner: twice as aggressive, no threes)
    if ((thrownOf(x) > 0) != (thrownOf(y) > 0)) return (cmpKey = __LINE__, (thrownOf(x) > 0 ? -1 : 1));
    // 3. (both live) a hold that lives by the break it waits for is that break played later: a line that breaks and lives now first
    int hx = x->hold && x->o.ready == 1 && !(y->hold) && y->apBroke > 0, hy = y->hold && y->o.ready == 1 && !(x->hold) && x->apBroke > 0;
    if (hx != hy) return (cmpKey = __LINE__, (hx ? 1 : -1));
  } else {
    // 1b. (neither lives) THE BOARD'S OWN CHAIN KEPT: a line that cuts the chain the board is making short ranks after one that keeps it
    // -- unless keeping it loses the board within a break's time (rankSave): a chain begun is the attack the board already has, and the
    // three that began it is wasted once it is cut (the owner: never spoil the board's own chain)
    // -- or the board is short of panels (below the floor) and the cut breaks garbage the keeping does not, lost a break's time later: the
    // chain spends the panels a break is made from, and a board short of them finds none after it
    if (cutsShort(x) != cutsShort(y)) { const Judge *keep = cutsShort(x) ? y : x, *cut = cutsShort(x) ? x : y;
      int spends = decF.belowFloor && cut->apBroke > 0 && !(keep->apBroke > 0) && lostOf(cut) - lostOf(keep) >= rankSave;
      if (lostOf(keep) >= rankSave && !spends) return (cmpKey = __LINE__, (cutsShort(x) ? 1 : -1)); }
    // 2. (neither lives) one that breaks garbage, while it leaves the next decision the time a break takes (rankSave): the panels a
    // break converts are what the next is made from -- a break lost before the next could be made converts them for nothing
    // -- on a board short of panels (below the floor) always; on one with panels to spare, not over a line lost a break's time later (run
    // 443, pressure, 47 panels: a break lost at 193 played over a line lost at 335). Short, the panels a break converts are the next
    // break's (run 444: large_garbage 7 to 3 of 8 with the break held to the later loss everywhere)
    int bx = x->apBroke > 0 && lostOf(x) >= rankSave, by = y->apBroke > 0 && lostOf(y) >= rankSave;
    if (bx != by) { const Judge *b = bx ? x : y, *o = bx ? y : x; if (decF.belowFloor || lostOf(o) - lostOf(b) < rankSave) return (cmpKey = __LINE__, (bx ? -1 : 1)); }
    // 2'. (neither lives, under garbage) THE LINEUP FIRST: of two that break, the one that converts more full rows of the block -- the
    // lineup that keeps a slab breaking, row after row -- unless it is lost a break's time sooner: a row a line leaves is a row a later
    // break must make, and the board dies when the rows on it and coming outrun the rows broken (1d596973)
    if (decF.under && bx && by) { int rx = imax(0, x->apBroke) / W, ry = imax(0, y->apBroke) / W;
      if (rx != ry && (lostAlike(x, y) || (rx > ry) == (lostOf(x) > lostOf(y)))) return (cmpKey = __LINE__, (ry - rx)); }
    // 3. (neither lives) the later loss -- unless both leave the next decision the time a break takes (rankSave): those survive alike, and
    // the material, the saving and the list decide between them before the later loss does (10). Not alike: one that leaves the board
    // only that one break's time, beside one that leaves it a break's time more -- the next decision has one try where it had two.
    int alike = lostAlike(x, y);
    // (bought with the panels: alike -- boughtWithPanels)
    if (!alike && boughtWithPanels(x, y)) alike = 1;
    if (!alike && lostOf(x) != lostOf(y)) return (cmpKey = __LINE__, (lostOf(y) > lostOf(x) ? 1 : -1));
    // (neither lives, lost alike) the board's own chain kept before cut short, as for two that live
    if (cutsShort(x) != cutsShort(y)) return (cmpKey = __LINE__, (cutsShort(x) ? 1 : -1));
    // (neither lives, lost alike) THE ALLOWANCE'S RESERVE: a line that breaks nothing and walks the input allowance below a break's walk
    // (BREAK_WALK) after one that keeps it -- the break the next decisions find has to be pressed out of what is left
    if (pressAllowance >= 0) {
      int rx = reserveShort(x), ry = reserveShort(y);
      if (rx != ry) return (cmpKey = __LINE__, (rx - ry));
    }
    // 4. (neither lives) a break in reach once the next block lands
    if (x->readyNext != NOT_ASKED && y->readyNext != NOT_ASKED && x->readyNext != y->readyNext) return (cmpKey = __LINE__, (x->readyNext ? -1 : 1));
    // 5. (neither lives) within the list before outside it -- but not between two breaks under garbage: every mode defends itself while
    // it attacks, and of two breaks that both die the list's ask is not what decides -- the garbage they break (7b) and the material they
    // leave (6, 7a) do (run 441, big chain: a combo that breaks is outside a list of 8-chains, and was ranked below a plain three)
    // -- nor, under garbage, between two that both die where the one outside it spends no panels below the floor: dying, the list's
    // order is not what keeps the board (run 491, large_garbage-6: a hold lost at 194 over a line toward a break lost at 212)
    // -- nor the hold over a line lost a break's time later: holding is no entry of the list, and lost alike past three breaks' time
    // (lostAlike) the hold put first by the list is the board left to the frame it dies, the tower growing while a line that lives on waits
    if (x->outside != y->outside && !(decF.under && x->apBroke > 0 && y->apBroke > 0) && !(decF.under && !x->spends && !y->spends) &&
        !((x->hold || y->hold) && (lostOf(x) > lostOf(y) ? lostOf(x) - lostOf(y) : lostOf(y) - lostOf(x)) >= rankSave)) return (cmpKey = __LINE__, (x->outside ? 1 : -1));
  }
  // 5a. TWO THAT LIVE: the list before the material -- a board that lives either way throws the attack the list asks, not the cheaper
  // break (the owner: twice as aggressive)
  // -- and a far line earns its walk only within WALK_EARN actions of the nearer: of two that live and both attack, the one the cursor
  // walks much less is played (the owner: no big corner-to-corner moves; the far idea is still there next decision, nearer)
  if (lx && x->met >= 0 && y->met >= 0 && !x->hold && !y->hold) { int wx = lineWalk(x), wy = lineWalk(y); if (iabs(wx - wy) > WALK_EARN) return (cmpKey = __LINE__, (wx - wy)); }
  if (lx) { int ax = x->met >= 0 ? x->met : MAXAIMS, ay = y->met >= 0 ? y->met : MAXAIMS; if (ax != ay) return (cmpKey = __LINE__, (ax - ay)); }
  // 6. THE NEXT BREAK'S MATERIAL: of two breaks under garbage, the one that leaves a break to build (outcome.c nextBuild) and keeps the
  // board's floor -- before the list's entry: the list orders the breaks the board can afford
  if (x->material >= 0 && y->material >= 0 && x->material != y->material) return (cmpKey = __LINE__, (x->material - y->material));
  // 7. SAVING PANELS UP (decide.c read: begun topped and short, kept until the list's largest combo is sure): of two breaks under
  // garbage, the one whose board has more life by its panels -- before the list's entry: the board's life is its next breaks
  if (x->saving && y->saving && x->o.lifeLeft != y->o.lifeLeft) return (cmpKey = __LINE__, (x->o.lifeLeft > y->o.lifeLeft ? -1 : 1));
  // 7a. THE NEXT BREAKS' PANELS (topped under garbage, or below the floor -- a board that cannot raise, or is short): of two breaks, the
  // one that leaves more panels under the lowest garbage once everything shown has landed (judge.c readyMat, the board the readiness
  // lands) -- what a break converts lands there, and the next breaks are made of it; the board the line ends on where that was not asked
  if (decF.under && (decF.topped || decF.belowFloor) && x->apBroke > 0 && y->apBroke > 0) {
    int lx2 = x->o.j.readyMat >= 0 && y->o.j.readyMat >= 0;
    int32_t mx = lx2 ? x->o.j.readyMat : x->o.matLeft, my = lx2 ? y->o.j.readyMat : y->o.matLeft;
    if (mx >= 0 && my >= 0 && mx != my) return (cmpKey = __LINE__, (mx > my ? -1 : 1));
  }
  // 7a'. THE BREAK THAT ATTACKS (the owner: break first, but with the lineup, not a three -- attack under pressure, as the mode asks):
  // of two breaks under garbage alike so far, the one that meets the earlier entry of the list, then the one that throws more blocks,
  // then the one that makes a chain on the way -- the break is a link, and the attack goes with it
  if (!lx && decF.under && x->apBroke > 0 && y->apBroke > 0 && !x->hold && !y->hold) {
    int ax = x->met >= 0 ? x->met : MAXAIMS, ay = y->met >= 0 ? y->met : MAXAIMS;
    if (ax != ay) return (cmpKey = __LINE__, (ax - ay));
    if (x->o.j.blocks != y->o.j.blocks) return (cmpKey = __LINE__, (y->o.j.blocks - x->o.j.blocks));
    int cx = x->apWhole >= 2, cy = y->apWhole >= 2;
    if (cx != cy) return (cmpKey = __LINE__, (cx ? -1 : 1));
  }
  // 7b. UNDER GARBAGE THE RULE IS TO BREAK (the rules' underGarbage): of two breaks under garbage that neither lives, the one that breaks
  // more of it -- before the list's entry: the board's life is the garbage it gets off
  if (!lx && decF.under && x->apBroke > 0 && y->apBroke > 0 && x->apBroke != y->apBroke) return (cmpKey = __LINE__, (x->apBroke > y->apBroke ? -1 : 1));
  // 7c. THE BREAK SOONER: of two such breaks alike so far, the one whose last swap is pressed sooner -- a break put off is one a later
  // decision may put off again, each new line a few frames longer lived, till the board has no time left to make it (run 457,
  // combo_storm-6: 1585 to 1816, a break of 24 to 28 cells in every line played, never made). After the material: put before it, the
  // sooner break spends the panels the next is made of
  if (!lx && decF.under && x->apBroke > 0 && y->apBroke > 0 && x->apFire >= 0 && y->apFire >= 0 && x->apFire != y->apFire) return (cmpKey = __LINE__, (x->apFire - y->apFire));
  // 7d. AN EIGHT NEARER (the owner: an eight is set up outside the mode that fires it, in the modes leading up to the top-out, and between
  // moves -- the move that leaves a better set-up): of two lines every key above leaves equal, the one whose board is TWIN_STEP swaps or
  // more nearer a two-column combo of eight (outcome.c twinAfter) -- survival, the chain, the breaks and their material all decide first
  // (only where the nearer is lost no sooner: a set-up is never paid for with the board's life)
  // (and only within TWIN_KEY_REACH swaps: an eight farther off is set up of the moves that cost nothing -- 1'', nearerEight -- not by
  // this key over every key after it)
  int t8x = x->o.twinAfter > TWIN_KEY_REACH ? 99 : x->o.twinAfter, t8y = y->o.twinAfter > TWIN_KEY_REACH ? 99 : y->o.twinAfter;
  if (t8x >= 0 && t8y >= 0 && iabs(t8x - t8y) >= TWIN_STEP) {
    const Judge *nr = t8x < t8y ? x : y, *fr = nr == x ? y : x;
    if (nr->o.lives || (!fr->o.lives && diesAt(nr) >= diesAt(fr))) return (cmpKey = __LINE__, (t8x - t8y));
  }
  // 8. THE LIST: the earlier entry the judged line meets, its break as the entry asks it (rules.c metOf) -- before the kind of line, so a
  // line that keeps a topped board held is ordered by the list like every other
  { int ax = x->met >= 0 ? x->met : MAXAIMS, ay = y->met >= 0 ? y->met : MAXAIMS; if (ax != ay) return (cmpKey = __LINE__, (ax - ay));
    // 8a. MORE THROWN (several ideas at once): of two that live and meet the same entry, the one that throws more blocks, every attack
    // its own -- two ideas fired before one. (Not of two that die: there the panels a line spends are the next break's material.)
    if (ax < MAXAIMS && lx) { int tx = thrownOf(x), ty = thrownOf(y); if (tx != ty) return (cmpKey = __LINE__, (ty - tx)); }
    // 8b. MORE DONE ON THE WAY: of two that meet the same entry, one that presses every swap of the other and more that helps -- work
    // on its way (propose.c wayLines), a second line made one with it (decide.c routeJudged), a second idea fired (search/plan.c pair)
    // -- first: the keys above found it no worse, and every step the cursor takes does something rather than only going there
    if (ax < MAXAIMS) { int cx = holdsLine(x, y), cy = holdsLine(y, x); if (cx != cy) return (cmpKey = __LINE__, (cx ? -1 : 1)); }
    // 8c. THE IDEAS KEPT: of two that live, meet the same entry and throw alike, the one whose board holds more ideas ready -- one
    // fired, the others kept, each to be fired on its own
    if (ax < MAXAIMS && lx) { if (moreIdeas(x, y)) return (cmpKey = __LINE__, (-1)); if (moreIdeas(y, x)) return (cmpKey = __LINE__, (1)); }
    // 8d. THE NEARER LINE: of two that meet the same entry, the one the cursor walks less -- a far line has to earn its walk
    if (ax < MAXAIMS) { int wx = lineWalk(x), wy = lineWalk(y); if (wx != wy) return (cmpKey = __LINE__, (wx - wy)); } }
  // 9. the tier, then its keys in turn (facts.c tierOf; the life its panels leave and the nearest break after the list's own keys)
  // (two that do not live and survive alike: the later loss, before the kind of line)
  // -- under garbage, of two alike (as many tries left) the one nearer its next break first: with no break in reach, the frames a hold
  // keeps are frames nothing is built in (run 495: large_garbage held in 1028 decisions with no break in reach and a stop of over 60)
  if (!lx && decF.under && x->o.nearAfter >= 0 && y->o.nearAfter >= 0 && x->o.nearAfter != y->o.nearAfter) {
    double lo = lostOf(x) < lostOf(y) ? lostOf(x) : lostOf(y), hi = lostOf(x) < lostOf(y) ? lostOf(y) : lostOf(x);
    int tlo = (int)(lo / rankSave), thi = (int)(hi / rankSave);
    // (and only a nearer line the input allowance affords with a break's walk to spare (BREAK_WALK): one that walks the allowance down
    // to nothing is nearer a break it cannot then press)
    const Judge *nr = x->o.nearAfter < y->o.nearAfter ? x : y;
    if (lo >= rankSave && tlo == thi && (pressAllowance < 0 || pressAllowance - lineWalk(nr) >= BREAK_WALK)) return (cmpKey = __LINE__, (x->o.nearAfter - y->o.nearAfter));
  }
  if (!lx && lostOf(x) != lostOf(y)) return (cmpKey = __LINE__, (lostOf(y) > lostOf(x) ? 1 : -1));
  Tier tx = tierView(x), ty = tierView(y);
  if (tx.tier != ty.tier) return (cmpKey = __LINE__, (tx.tier - ty.tier));
  // 9a. (two set-ups that live, neither clearing anything, no garbage on the board) the one that leaves more ideas ready -- before the kind of set-up
  if (tx.tier == 4 && lx && !decF.under && !clears(x) && !clears(y)) { if (moreIdeas(x, y)) return (cmpKey = __LINE__, (-1)); if (moreIdeas(y, x)) return (cmpKey = __LINE__, (1));
    if (x->o.j.seams != y->o.j.seams) return (cmpKey = __LINE__, (x->o.j.seams > y->o.j.seams ? -1 : 1));
    }
  int n = tx.nsub < ty.nsub ? tx.nsub : ty.nsub;
  for (int q = 0; q < n; q++) if (tx.sub[q] != ty.sub[q]) return (cmpKey = __LINE__, (tx.sub[q] < ty.sub[q] ? -1 : 1));
  // 10. THE PLAN KEPT (plans/gambit-infra.md F, stable): of two lines every key leaves equal, the one the last decision kept (an
  // intention) -- a plan that does not thrash is one the cursor does not swing for
  if (x->k.kept != y->k.kept) return (cmpKey = __LINE__, (x->k.kept ? -1 : 1));
  // 11. THE NEARER FIRST SWAP: of two lines every key leaves equal, the one whose first swap the cursor reaches in fewer actions
  // (core/nodes.h actionsFor, as the frame loop walks) -- the hold presses nothing, nearest of all
  { int nx = firstWalk(x), ny = firstWalk(y); if (nx != ny) return (cmpKey = __LINE__, (nx - ny)); }
  return (cmpKey = __LINE__, (0));
}
// A LINE IN WALKING ORDER: its swaps pressed in the order the cursor reaches them soonest -- from where the cursor is, each swap's walk
// counted as the frame loop walks it (core/nodes.h actionsFor) -- two swaps on a shared cell kept in the line's own order. Every order
// for a short line (WALK_ALL swaps or fewer), the nearest swap next for a longer one; of two orders that walk alike, the line's own first.
// 0 when the line's own order walks least.
#define WALK_ALL 6
static int32_t walkSeq[MAXLINE], walkBest[MAXLINE], walkCost;
static int walkUsed[MAXLINE];
static int sharesCell(int32_t a, int32_t b) { return CR(a) == CR(b) && iabs(CC(a) - CC(b)) <= 1; }
static int walkFree(const Cand *k, int i) {
  for (int p = 0; p < i; p++) if (!walkUsed[p] && sharesCell(k->seq[p], k->seq[i])) return 0;
  return 1;
}
static int walkStep(int row, int col, int32_t s) { return actionsFor(row, col, CR(s), CC(s), HOLDTIGHT + 1); }
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
// STEADY, NOT IN BURSTS (the owner): a line judged settled -- each swap once the board has stopped moving -- waits out a popping slab and
// then presses the rest at once. While a slab pops it is judged pressed straight through as well, each swap as soon as its pair is free,
// and that one is the line unless the order puts it after the settled one: the same swaps spread over the pop
static int judgeWalked(const Read *R, const Cand *k, Judge *J) {
  int ok = judgeCand(R, k, J);
  static Cand w; static Judge JW;
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
  for (int w = 1; w < n; w *= 2)
    for (int lo = 0; lo < n; lo += 2 * w) {
      int mid = lo + w < n ? lo + w : n, hi = lo + 2 * w < n ? lo + 2 * w : n, i = lo, j = mid, k = lo;
      while (i < mid && j < hi) tmp[k++] = compareJudged(a[j], a[i]) < 0 ? a[j++] : a[i++];
      while (i < mid) tmp[k++] = a[i++];
      while (j < hi) tmp[k++] = a[j++];
      for (k = lo; k < hi; k++) a[k] = tmp[k];
    }
}
