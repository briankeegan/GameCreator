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
  int32_t spends;      // outside it for clearing panels below the floor without breaking (decide.c read: belowFloor)
  int32_t met;         // the entry of the list as the board asks it the judged line meets, -1 none (rules.c metOf)
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
// the judge could not press, w a wasted three, j the clock stopped its judging)
enum { DROP_BACK, DROP_LIST, DROP_LATE, DROP_FLOOR, DROP_READY, DROP_UNBROKEN, DROP_CUT, DROP_WASTE, DROP_UNJUDGED, NDROPS };
static int32_t dropped[NPLAYS][NDROPS], offered[NPLAYS];
static void dropAs(int play, int why) { dropped[play][why]++; }
// (the lines cut, by why the judge cut them: judge.c cutWhy -- 1 a first walk over the allowance, 2 no swap there, 3 a walk not begun
// within a reaction -- and how many of them the break search found)
static int32_t cutWhy[4], cutWhyBreak[4];
// THE FIRST LINE OF A DECISION THE BREAK SEARCH SAID BREAKS AND THE JUDGE SAYS DOES NOT: its play, swaps and both counts, for the log
// and the board's dump (two measures of one fact)
static struct { int32_t set, play, nseq, seq[MAXLINE], said, judged; } unbroken;

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
    if (!unbroken.set) { unbroken.set = 1; unbroken.play = play; unbroken.nseq = k->nseq; for (int i = 0; i < k->nseq; i++) unbroken.seq[i] = k->seq[i]; unbroken.said = k->x.broke; unbroken.judged = j->made.broke; }
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
// (A FALLBACK: a line that meets an entry of the mode's list after its first and breaks no garbage. The mode's goals in order: the first
// entry 0, a line that fires no fallback 1 -- the hold, a set-up toward the first entry, a break -- then each fallback, 1 + its entry)
static int fallbackOf(const Judge *J) { return !J->hold && J->met > 0 && !(J->apBroke > 0); }
static int goalKeyOf(const Judge *J) { return J->hold ? 1 : J->met == 0 ? 0 : fallbackOf(J) ? 1 + J->met : 1; }
// A WASTED THREE: a line whose clears break nothing and throw nothing (a combo of three, no chain) -- panels spent for no garbage sent
// and none broken
static int cutsShort(const Judge *J);
static int wastesThree(const Judge *J) {
  if (J->hold) return 0;
  if (J->o.j.threes > 0) return 1;   // (any clear of three the line makes for nothing, whatever else it makes -- a line lost too)
  if (cutsShort(J)) return 1;        // (the board's own chain cut short: the three that began it made for nothing)
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
static int firstWalk(const Judge *J) { return J->hold || !J->k.nseq ? 0 : actionsFor(decQ.b->curRow, decQ.b->curCol, CR(J->k.seq[0]), CC(J->k.seq[0]), HOLDTIGHT + 1); }
// (the cursor's actions over the whole line, swap after swap in the order it is pressed, from where the cursor is)
#define WALK_EARN 6     // the actions more a far line may walk than a nearer one that also attacks
#define BREAK_WALK 20   // the actions a break's line is pressed in, as the allowance keeps them (an estimate: a few swaps and their walks)
static int lineWalk(const Judge *J) {
  int n = 0, r = decQ.b->curRow, c = decQ.b->curCol;
  for (int i = 0; !J->hold && i < J->k.nseq; i++) { n += actionsFor(r, c, CR(J->k.seq[i]), CC(J->k.seq[i]), HOLDTIGHT + 1); r = CR(J->k.seq[i]); c = CC(J->k.seq[i]); }
  return n;
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
static int compareJudged(const Judge *x, const Judge *y) {
  int lx = !!x->o.lives, ly = !!y->o.lives;
  // 1. lives before does not
  if (lx != ly) return (cmpKey = __LINE__, (lx ? -1 : 1));
  // 1. (neither lives) SURVIVAL FIRST: the later loss, unless the two are lost alike (lostAlike: as many breaks' time left) -- every key
  // after decides only between lines that survive alike
  if (!lx && !lostAlike(x, y) && lostOf(x) != lostOf(y)) return (cmpKey = __LINE__, (lostOf(y) > lostOf(x) ? 1 : -1));
  // 1'. THE ALLOWANCE'S RESERVE: of two that survive alike (both live, or lost alike), a line that breaks nothing and walks the input
  // allowance below a break's walk (BREAK_WALK) after one that keeps it -- the next break is pressed out of what is left, and what is
  // spent comes back only a window later, the garbage it is needed for may be told of by then or not
  if (pressAllowance >= 0 && (lx || lostAlike(x, y))) {
    int rx = !(x->apBroke > 0) && pressAllowance - lineWalk(x) < BREAK_WALK, ry = !(y->apBroke > 0) && pressAllowance - lineWalk(y) < BREAK_WALK;
    if (rx != ry) return (cmpKey = __LINE__, (rx ? 1 : -1));
  }
  // 1''. UNDER GARBAGE, THE WINDOW SPENT ON BREAKS: of two that survive alike, a line that breaks before one that breaks nothing, then
  // the one that walks fewer actions -- the hold walks none: under garbage only a break is worth what it spends from the input window,
  // and the rest wait for it to give some back
  if (decF.under && pressAllowance >= 0 && (lx || lostAlike(x, y))) {
    int bx = x->apBroke > 0, by = y->apBroke > 0;
    if (bx != by) return (cmpKey = __LINE__, (bx ? -1 : 1));
    if (!bx) { int wx = lineWalk(x), wy = lineWalk(y); if (wx != wy) return (cmpKey = __LINE__, (wx - wy)); }
    // (of two that break: the one that breaks more garbage for each action it walks -- the window pays for every cell walked)
    else { int64_t px = (int64_t)x->apBroke * imax(1, lineWalk(y)), py = (int64_t)y->apBroke * imax(1, lineWalk(x)); if (px != py) return (cmpKey = __LINE__, (px > py ? -1 : 1)); }
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
    if (cutsShort(x) != cutsShort(y)) { const Judge *keep = cutsShort(x) ? y : x; if (lostOf(keep) >= rankSave) return (cmpKey = __LINE__, (cutsShort(x) ? 1 : -1)); }
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
    double lo = lostOf(x) < lostOf(y) ? lostOf(x) : lostOf(y);
    int alike = lostAlike(x, y);
    // (BOUGHT WITH THE PANELS: with no garbage on the board, the later loss of a line that clears panels below the floor and breaks
    // nothing (spends) is stop time, and stop time holds the stack from rising -- the rows the next panels come in by. Beside one that
    // spends none and leaves the next decision a try, they survive alike: the list (5) puts the one that keeps its panels first. Under
    // garbage the rising stack brings no panels in -- the garbage tops it -- and the list's own exceptions (5) decide)
    if (!alike && !decF.under && lo >= rankSave && x->spends != y->spends && (lostOf(x) > lostOf(y) ? x : y)->spends) alike = 1;
    if (!alike && lostOf(x) != lostOf(y)) return (cmpKey = __LINE__, (lostOf(y) > lostOf(x) ? 1 : -1));
    // (neither lives, lost alike) the board's own chain kept before cut short, as for two that live
    if (cutsShort(x) != cutsShort(y)) return (cmpKey = __LINE__, (cutsShort(x) ? 1 : -1));
    // (neither lives, lost alike) THE ALLOWANCE'S RESERVE: a line that breaks nothing and walks the input allowance below a break's walk
    // (BREAK_WALK) after one that keeps it -- the break the next decisions find has to be pressed out of what is left
    if (pressAllowance >= 0) {
      int rx = !(x->apBroke > 0) && pressAllowance - lineWalk(x) < BREAK_WALK, ry = !(y->apBroke > 0) && pressAllowance - lineWalk(y) < BREAK_WALK;
      if (rx != ry) return (cmpKey = __LINE__, (rx ? 1 : -1));
    }
    // 4. (neither lives) a break in reach once the next block lands
    if (x->readyNext != NOT_ASKED && y->readyNext != NOT_ASKED && x->readyNext != y->readyNext) return (cmpKey = __LINE__, (x->readyNext ? -1 : 1));
    // 5. (neither lives) within the list before outside it -- but not between two breaks under garbage: every mode defends itself while
    // it attacks, and of two breaks that both die the list's ask is not what decides -- the garbage they break (7b) and the material they
    // leave (6, 7a) do (run 441, big chain: a combo that breaks is outside a list of 8-chains, and was ranked below a plain three)
    // -- nor, under garbage, between two that both die where the one outside it spends no panels below the floor: dying, the list's
    // order is not what keeps the board (run 491, large_garbage-6: a hold lost at 194 over a line toward a break lost at 212)
    if (x->outside != y->outside && !(decF.under && x->apBroke > 0 && y->apBroke > 0) && !(decF.under && !x->spends && !y->spends)) return (cmpKey = __LINE__, (x->outside ? 1 : -1));
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
  if (tx.tier == 4 && lx && !decF.under && !clears(x) && !clears(y)) { if (moreIdeas(x, y)) return (cmpKey = __LINE__, (-1)); if (moreIdeas(y, x)) return (cmpKey = __LINE__, (1)); }
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
