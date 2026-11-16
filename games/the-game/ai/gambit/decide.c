// GAMBIT'S DECISION (plans/decision.md): read the board, propose, judge, rank, play -- in that order, once a decision.

// THE QUESTION'S OWN FACTS from the host (answer.c gb_answer): the enemy as the host sends it, whether a raise may begin
typedef struct { int32_t has, out, topKnown, top, stopKnown, stop; } Opp;
static Opp theOpp;
static int32_t garbageSeen;   // (garbage has been on the board or on its way this game)
static int32_t canRaiseNow, gambitHit, modeRule = -1, hostTopped, surviveAsked;
#define OPENER_SUM 8
#define OPENER_LEAST 3
#define OPENER_CHAINS 3
static int32_t openerOver, openerChained, openerThrown, openerSum;   // (the opener played out; the longest link of the chain falling; the chains of OPENER_LEAST or more thrown, and their links added: the log's osum=)
static int32_t openerAt;     // (and the frame it was played out on: a fight's switching begins there -- answer.c modeAt)
static int32_t nswitch; static int32_t modeAt(int32_t at);   // (answer.c)
static int32_t thenRule = -1;
static int32_t carryNone;   // (why no line in progress was offered: carriedCand)
static int32_t carryJudgeDrop = -1;   // (and for 19, why the judging dropped it: rank.c DROP_*, -1 none said)
static int32_t rescues;   // (decisions whose lines were all judged again past the clock: ranked, nothing judged in time)   // (the mode a named opener gives way to at the top-out; -1: none)

// 1. READ: the facts of both boards, the mode and its list, the deadline, the floor every line keeps
#define RAISE_MS 150
static int32_t raiseRefill;   // (the raise asked is the floor's, not the opening's: answer.c lets nothing go before it)
static int32_t raiseOpening, raiseTo, raiseRows;   // (the raise asked this decision: the opening's, and the rows it raises to -- the log's raiseFor)
static int32_t refillAsked, refillReady, refillAlive;   // (the floor's raise: the rows asked, ready, alive -- the log's)
static int32_t raiseWait; static Board *raiseWaitBoard;   // (the floor's raise put off to the frame the stack takes one, and that board)
static int32_t opLineOn;
#define TA_LINKS 13        // a design this long is built at once
#define TA_DESIGN_MS 600   // the time searched on a design before it is built, at most -- a short start fired soon; the chain is
                           // taken on while it falls
#define TA_MAXSW 10        // the swaps a design may take
#define TA_EXT_WIDTH 80    // the chain going's search: the lines a level keeps, and its swaps deep (the chain puzzles: 80 and 9 went
#define TA_EXT_DEPTH 8     // furthest on the huge tower, 12 links where 40 and 6 reached 8 to 11)
#define TA_TOP 10          // the stack's top at which a design is built whatever it holds, and the raise's -- a chain is taken to 13 only
                           // with the panels for it: the chain going finds its next link 46% of the time at 8 links, 25% at 10
#define TA_MARGIN 30       // the frames to spare when the trigger goes down
#define TA_SWAP_FRAMES 16  // a design's swap, walked to and pressed: the frames it takes, near enough to know a build will be in time
#define TA_EVEN 2          // the rows the tallest column may stand over the shortest with the stack still raised to TA_TOP
#define TA_DANGER 120      // the frames left alone under which a time-attack board is played for its life: about two and a half rows of
                           // the level-11 rise (45 frames a row at rest, measured: 281 at seven rows, 374 at four)
#define TA_STAND 190      // the frames a time-attack board, raised, still stands left alone: a design's TA_MAXSW swaps walked and pressed,
                           // TA_MARGIN to spare
#define TA_STEP 4          // the design's swaps handed on a decision
#define TA_FULL 6          // the full rows a board has before a design is searched on it
// (a judged line that clears anything: a combo, a chain, a three, a clear of its own)
static int taClears(const Judge *J) {
  const Judged *j = &J->o.j;
  return j->made.cells > 0 || j->made.combo > 0 || j->made.chain > 0 || j->threes > 0 || j->nsingles > 0 || j->chainAll > 0;
}
static int32_t taxBase, taxLong, taxN, taxMs;   // (the chain going, the log's: the chain left alone, the longest found, its swaps, the ms given)
static int32_t taLog;      // (the log's: 3 the chain going taken on, 1 swaps handed, 2 the trigger, -1 the design lost, -2 no order, -3 not in time, -4 too few full rows, -10 - the judge's drop)   // (the planned opener handed on and not yet done: carried, not grown over)
static int carryHeld(void);
#define OP_TRIES 3            // (the opening plans judged in a decision, the best first)
#define CD_GROW 0.6   // (the share of the countdown's decision time left that grows the opening's plan: the judging of what it finds takes the rest)
#define OPEN_SWAP_FRAMES 16   // (the frames a planned set-up takes to press, its walk with it: the plan's set-ups pressed before the next block lands -- 16.5 measured, the countdown plans of 100 opener games, their trigger's frame over their swaps)
#define OPEN_FIRE_BY 330      // (the frame the opener's trigger is pressed by while no garbage is shown: the first garbage lands at 339 in every pattern, 99 opener games)
#define NEAR_SAVE 3   // (the breaks' time within which a three that buys a break's time more is a save, asked of no search)
#define LOW_ROWS 6   // a stack under this many rows of panels is raised (the floor's raise)
#define PRESS_FRAMES 3   // the frames an action of a break's walk is pressed in, held walks and taps between
#define OPENING_RAISE 600   // the opening raise's frames: the countdown and the seconds before garbage first lands (340-400 in the garbage patterns)
#define RAISE_WAIT 120   // the frames the floor's raise waits for the stack to take one, at most
static int32_t savingPanels;   // (saving panels up, across decisions; a new game ends it -- gb_new_game)
// THE FLOOR A LINE'S BOARD KEEPS, as the rule in force tests it (facts.c keepsFloor, the line's breaks aside): outcome.c asks it of the
// board every line ends on
static Keep floorKeep; static int32_t floorKeepOn;
#define MODE_DEBOUNCE 60   // the frames a mode the enemy's board calls must hold before it is played (a second): modes.js's too
// THE CHAIN THE ENEMY'S ROOM ASKS (the owner: modes are dynamic -- fill with chains, top out with a small combo, keep the next coming):
// a list's aim {"chain":"fill"} is the chains that fit the rows the enemy will have free when they land, leaving it one -- an n-chain
// lands as n - 1 rows, FILL_FLIGHT frames after it is made and FILL_LINK more a link, and the enemy rises a row every
// SPEED_TO_RISE_TIME frames of it not held by its stop (its height is the row four of its six columns reach and the rows on their way:
// GambitNative opponentOf, rowsOnItsWay).
// Every chain of three or more that fits is the mode's -- one that fills the room exactly first, then the longer -- never a 2x (the
// owner: a 3x and a 4x, or two 3x, as well as a 6x). No three-chain fits: a three-chain all the same -- fill plays chains, never combos.
#define FILL_FLIGHT 151
// (a link: its three flashing, faced and popped, the panels above hovering and falling a row -- FILL_FALL, the engine's -- read off the
// board, so every level's own: 66 at level 11)
#define FILL_FALL 15
#define FILL_LINK (decQ.b->fFLASH + decQ.b->fFACE + 3 * decQ.b->fPOP + decQ.b->fHOVER + FILL_FALL)
#define FILL_ROWS (decQ.b->height ? decQ.b->height : 12)   // (the enemy's rows: the level is both boards')
static int32_t fillN = NOT_ASKED;   // (the longest chain the room took this decision, 0 none: the log's)
static void fillList(List *L) {
  int at = -1;
  for (int i = 0; i < L->n && at < 0; i++) if (L->aim[i].chain.op == OP_FILL) at = i;
  if (at < 0) { fillN = NOT_ASKED; return; }
  int32_t top = theOpp.has && theOpp.topKnown ? theOpp.top : 0, free = FILL_ROWS - top, stop = theOpp.stopKnown ? imax(0, theOpp.stop) : 0;
  int32_t perRow = decQ.b->speed >= 1 && decQ.b->speed <= 99 ? SPEED_TO_RISE_TIME[decQ.b->speed - 1] : 120, nmax = 0;
  for (int n = MAXCHAIN; n >= 3 && !nmax; n--) { int32_t risen = imax(0, FILL_FLIGHT + FILL_LINK * (n - 1) - stop) / perRow; if (n - 1 <= free - risen - 1) nmax = n; }
  List out; memset(&out, 0, sizeof out);
  for (int n = imax(3, nmax); n >= 3 && out.n < MAXAIMS; n--) { Aim a; memset(&a, 0, sizeof a); a.chain.op = OP_EQ; a.chain.n = n; a.chain.near = 1; a.brk = -1; out.aim[out.n++] = a; }
  *L = out; fillN = nmax;
}
static int decisionFloor(const Board *b) { return floorKeepOn ? keepsFloor(&floorKeep, b, 0) : -1; }
// (TIME ATTACK'S RAISE, ON THE ENGINE'S CLOCK: the rows the board, raised, still stands `stand` frames through left alone -- the rise never
// stops, and a raise brings the top nearer by every row it lifts: a board raised into its last frames has no time left to build on)
static int32_t taRaiseRows(const Board *b, int32_t rows, int32_t stand) {
  static Board *st; if (!st) st = nb_new();
  if (!st || rows <= 0) return 0;
  int32_t ok = 0, top0 = fullTop(b);
  for (int k = 1; k <= rows; k++) {
    cloneBoard(st, b);
    int32_t f = 0;
    while (fullTop(st) < top0 + k && st->gameOverClock <= 0 && f < 40 * k) { st->input = RAISE_IN; run(st); f++; }
    if (st->gameOverClock > 0 || fullTop(st) < top0 + k) break;
    for (int32_t g = 0; g < stand && st->gameOverClock <= 0; g++) { st->input = 0; run(st); }
    if (st->gameOverClock > 0) break;
    ok = k;
  }
  return ok;
}
#define OP_FIRE_HOLD 120   // (the frames after the opener's trigger is handed on that its first clear and fall are its chain's, a link or not)
static int32_t opFiredAt;   // (the clock the opener's trigger was handed on, -1 none: defined with the opener's falling rule)
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
  R->enemyTopped = theOpp.has && theOpp.out; raceOn = R->enemyTopped;
  // (the frames until the board is lost if nothing is done, from the engine with the garbage the game shows landing when it lands:
  // sooner than the rise alone takes, the garbage on its way decides it -- queueKills)
  int32_t alone = diesIn(&decQ, F->v[FACT_US_DIES]);
  // (no answer -- the clock stopped it: NOT_ASKED, -1 -- is no death in -1 frames: the stack's own estimate stands; read as a frame count
  // it made the planner's urgency and the log's `dies` say the board was safe at the end of a game)
  if (alone >= 0 && alone < F->v[FACT_US_DIES]) { factSet(F, FACT_US_QUEUEKILLS, 1); F->v[FACT_US_DIES] = alone; }
  // (the rule: the mode in force, else the first whose `when` the facts hold -- with no opponent to read, the rule asking `enemy.none`;
  // else the first of the rules, so a board with nobody across still plays)
  // (THE OPENER: in a fight with no mode named, from the game's start until its chain is thrown or either board tops out -- garbage
  // landed above its top row, not garbage sent -- the opener's rule, big chains; then the mode the enemy's board picks)
  // (the opener named and a mode to follow it -- the profile's `then`, answer.c gb_then: at the top-out the named mode becomes that one,
  // nothing carried let go, as the opener gives way to the enemy's mode in a fight)
  // (THE OPENER IS OVER ONCE ITS CHAINS ADD UP -- the owner: chains to eight or more, a 3x and a 5x or two 4x alike, and a 2x counts for
  // nothing: each chain thrown its longest link, the board's chain counter at its height before it ends, counted where it is
  // OPENER_LEAST or more; over at OPENER_SUM, or OPENER_CHAINS such chains thrown, or a board topped out first)
  if (decQ.b->chainCounter > openerChained) openerChained = decQ.b->chainCounter;
  else if (openerChained && decQ.b->chainCounter == 0) { if (openerChained >= OPENER_LEAST) { openerSum += openerChained; openerThrown++; } openerChained = 0; }
  int thrown = openerSum >= OPENER_SUM || openerThrown >= OPENER_CHAINS;
  // (our board topped out with the opener's own chain still falling: the opener goes on until it lands -- the chain's stop time holds the
  // board, and the mode after it would play on the falling chain as if it were not the opener's)
  int ownFalling = decQ.b->chainCounter > 0 || (opFiredAt >= 0 && decQ.b->clock - opFiredAt <= OP_FIRE_HOLD && (cascadeLive(decQ.b) || popLeft(decQ.b) > 0));
  // (garbage on our board and the board left alone lost within the planner's urgent time, no chain of ours falling: the opener gives way --
  // its next chain is built on a board that will not be there, and the mode after it breaks the garbage that is)
  int buried = F->known[FACT_US_CONTACT] && F->v[FACT_US_DIES] > 0 && F->v[FACT_US_DIES] < PLAN_URGENT;
  if ((((F->v[FACT_US_TOPPED] || buried) && !ownFalling) || (theOpp.has && theOpp.out) || thrown) && !openerOver) {
    openerOver = 1; openerAt = decQ.b->clock;
    if (nswitch && modeRule < 0) modeRule = modeAt(0);   // (switching: the schedule's first mode from the opener's end on)
    int ni = modeRule >= 0 && thenRule >= 0 ? namedRule(modeRule) : -1;
    if (thenRule >= 0 && ((ni >= 0 && theTables.r[ni].table == 2) || modeRule < 0)) modeRule = thenRule;
  }
  int oi = -1;
  for (int i = 0; i < theTables.n && oi < 0 && !openerOver && modeRule < 0; i++) if (theTables.r[i].table == 2) oi = i;
  int ri = oi >= 0 ? oi : modeRule >= 0 ? namedRule(modeRule) : chooseRule(F);
  // (THE MODE DEBOUNCED -- the owner: a board flickering at a line does not switch the mode back and forth: the enemy topped out calls
  // finish them at once; any other change of the mode the facts call is played once it has been called MODE_DEBOUNCE frames running)
  if (oi < 0 && modeRule < 0 && ri >= 0) {
    static int32_t steady = -1, cand = -1, candAt = 0, lastClk = -1; int32_t now = decQ.b->clock;
    if (now < lastClk) steady = cand = -1;
    lastClk = now;
    if (steady < 0 || ri == steady || (theOpp.has && theOpp.out)) { steady = ri; cand = -1; }
    else { if (cand != ri) { cand = ri; candAt = now; } if (now - candAt >= MODE_DEBOUNCE) { steady = ri; cand = -1; } else ri = steady; }
  }
  if (ri < 0 && !theOpp.has && theTables.n > 0) ri = 0;
  if (ri < 0) return 0;
  const Rule *rule = &theTables.r[ri];
  R->rule = ri;
  ruleNoEnemy = asksNoEnemy(rule);
  // (A GAME WITH GARBAGE IN IT: garbage on the board once this game, or on its way -- a stack topped by its own rise is none. The floor,
  // the searches' and the rank's, and the floor's raise are the next break's material; with no garbage ever, endless, they hold the stack
  // seven rows high at forty-seven frames a row)
  if (F->known[FACT_US_CONTACT] || decQ.narr > 0 || decQ.b->ninc > 0) garbageSeen = 1;
  int garbageGame = garbageSeen;
  R->keep = rule->keep.on ? rule->keep : theTables.keep; R->keepOn = R->keep.on && garbageGame;
  floorKeep = R->keep; floorKeepOn = R->keepOn; floorOf = decisionFloor;
  R->list = rule->list; R->end = rule->end;
  fillList(&R->list);
  R->guides = R->list;
  R->by = deadlineOf(F, rule);
  // (THE OPENER BEFORE THE GARBAGE: an opening chain fires before the next block lands, or it is not begun -- a chain the block lands on
  // spends the panels the board digs out with; one already begun is the line in progress, never dropped for the frame: rank.c judgeCand)
  if (oi >= 0 && ri == oi && decF.next != NOT_ASKED && decF.next > 0 && (R->by == NOT_ASKED || decF.next < R->by)) R->by = decF.next;
  // (below the material floor a step that clears and breaks nothing is out, as the judge drops it)
  R->belowFloor = garbageGame && R->keepOn && R->keep.t[KEEP_MATERIAL].op && !test(F->v[FACT_US_MATERIAL], R->keep.t[KEEP_MATERIAL]);
  theList = R->list; listOn = 1; decF.belowFloor = R->belowFloor;
  // (an eight is set up ahead wherever some mode asks one -- outcome.c twinAfter, rank.c 7d)
  twinWanted = 0;
  for (int i = 0; i < theTables.n && !twinWanted; i++) for (int k = 0; k < theTables.r[i].list.n; k++) { const Test *t = &theTables.r[i].list.aim[k].combo; if ((t->op == OP_GE || t->op == OP_GT) && t->n + (t->op == OP_GT) >= 8) twinWanted = 1; }
  // (garbage on the board: the search asks every entry to break it too; garbage on it or topped out, the deadline is a break's -- before
  // the board dies; the rule's `by` is an attack's)
  R->under = !theTables.underIgnore && F->known[FACT_US_CONTACT];
  if (R->under) { for (int i = 0; i < R->guides.n; i++) R->guides.aim[i].brk = 1; R->end = 1; }
  decF.under = R->under;
  // (the owner: the reason is dying -- the rise tops the board out as surely as garbage lands on it, and the moves that keep it alive are
  // the same)
  R->dying = R->under || (F->known[FACT_US_DIES] && F->v[FACT_US_DIES] > 0 && F->v[FACT_US_DIES] < HORIZON + REST);
  // (time attack's own line: the rise is never still, so at level 11 a board under eight rows is within HORIZON + REST of its top all
  // the time; the raise, the design and the hold give way to the board's life inside TA_DANGER frames only)
  R->taDying = R->under || (F->known[FACT_US_DIES] && F->v[FACT_US_DIES] > 0 && F->v[FACT_US_DIES] < AT_LEVEL(TA_DANGER));
  // (and after its entries, the one rule's three that breaks (rules.c withRule): the list as the board asks it, the searches' and the
  // rank's alike)
  // (the rank's list is the mode's as written -- a combo of eight is ranked before one of six whatever the searches are led toward)
  R->asked = R->guides;
  if (R->under) guideShort(&R->guides);
  if (R->under) { withRule(&R->guides); withRule(&R->asked); }
  if (R->under) { withAttacks(&R->guides, &R->list); withAttacks(&R->asked, &R->list); }
  // (A LIST ENDED BY "default" -- every list under garbage -- falls back to the default's own move when none of it can be made: the
  // break search looks off it when it finds no break within it (breakSearch), the searches that aim keep to it, and the order takes a
  // line off it only by living where nothing within it does)
  R->topped = !!F->v[FACT_US_TOPPED]; R->breakWaits = !!F->v[FACT_US_BREAKWAITS];
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
  // (the opening raise: until garbage first reaches the board, below `to` rows and no chain running -- and after it, the rules' material
  // floor kept by raising, a reserve: below it, not topped, the panels under `to` -- garbage on them aside, a slab is no panel to break
  // with -- the rows the next break is made of brought in)
  int32_t to = rule->raiseTo ? rule->raiseTo : theTables.raiseTo;
  int opening = !gambitHit && !F->known[FACT_US_CONTACT] && !R->topped && decQ.b->clock < OPENING_RAISE;
  // (and A LOW STACK: under LOW_ROWS rows of panels, not topped, it is raised all the same -- the owner's rule: below six rows, raise high;
  // in a game garbage has reached or is on its way to -- the owner: the opener raise changed only where it kills, and with no garbage
  // ever it does: endless at level 11, 15 of 28 raising, 25 of 28 not)
  int refill = !opening && garbageGame && (R->belowFloor || panelTop(decQ.b) < LOW_ROWS) && !R->topped;
  // (TIME ATTACK'S RAISE: no design being built and the stack under its top -- the owner: flatten, raise to the top, then the chain; no
  // garbage is coming, so the rows are raised as they are, never held to a break's readiness. The top is TA_TOP less each row the tallest
  // column stands over the shortest past TA_EVEN: an uneven stack raised to TA_TOP puts its tallest column where the rise ends it)
  int32_t taTo = TA_TOP - imax(0, evenOf(decQ.b) - TA_EVEN);
  int taRaise = ruleNoEnemy && !opening && !refill && !R->topped && !R->taDying && !taOn && panelTop(decQ.b) < taTo;
  if (taRaise) to = taTo;
  raiseRefill = refill; raiseOpening = opening; raiseTo = to;
  int32_t rowsUp = to - (opening ? fullTop(decQ.b) : panelTop(decQ.b));
  raiseRows = rowsUp;
  R->low = to && (opening || refill || taRaise) && rowsUp > 0; R->up = R->low && !cascadeLive(decQ.b) && canRaiseNow;
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
    raiseOpens = opening;
    int32_t rows = taRaise ? taRaiseRows(rq.b, rowsUp, AT_LEVEL(TA_STAND)) : raiseReady(&rq, rowsUp, l < RAISE_MS ? l : RAISE_MS);
    // (THE FLOOR'S RAISE ON A BOARD TOO SHORT TO BREAK: below the floor, no row count leaves a break once everything lands -- the panels
    // a break is made of are what the board lacks -- so the rows the board lives through once everything lands are raised all the same:
    // the panels are the next break's material, and the opening's raise is held to readiness, never the floor's)
    // (and THE OPENER'S RAISE, the same -- the owner: the opener raises the moment it is flat; its plan is built on the board raised and
    // fired before the block lands, so the readiness it is held to is its own, not the raise's)
    refillAsked = refill ? rowsUp : 0; refillReady = rows; refillAlive = raiseAlive;
    int opRaise = opening && R->rule >= 0 && theTables.r[R->rule].table == 2;
    if (rows <= 0 && (refill || opRaise)) rows = raiseAlive;
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
static int32_t orderN;   // (the lines in the order the move was picked from: decide's n)
static int32_t phaseMs[3];
static Outlived svJob; static int32_t svJobDone;   // (the survival search already searched on a worker: answer.c breakJob)
static int carriedCand(const Read *R, Cand *k, int *wait);
static void pvKeep(const Judge *k, int first, int32_t qid); static int32_t pvSet, pvId, pvNew, pvKind, pvV[5];   // (pvKind: 0 not asked, 1 same, 2 not played, 3 the line ends past this frame, 4 lost, 5 clock, 6 rows, 9 a cell -- pvV its row, column, field, foreseen, real -- 10 a head field -- its index in pa.c HEAD from 1, foreseen, real -- 11 the rise timer, thousandths)
static int32_t carryRule(void);   // (the mode the line in progress was begun in)
static int carriedFromReady(void), carryWaitsOut(void);
static void readySpread(int n), readyStop(void);
static int keptJudged(const Read *R, int n), routeJudged(const Read *R, int n);
static const Judge *carriedJ;   // the line in progress among the ranked, for the log
// (THE OPENER'S LINE IN PROGRESS -- the owner: the opener is one continuous string; only a line no longer possible is put down: the
// carried line, whatever the filters after its judging take out, while it lives or presses its last swap before the next block lands)
static const Judge *opCarried;
static int32_t carrySave;   // (the line in progress was begun on a three let through as the save: carryOf -- it keeps that leave while it is carried on)
static int32_t carryTwo;   // (and begun on a 2x let through: it keeps that leave too)
static const Judge *strippedCarry;   // (the line in progress without the swap that makes its three: THE THREE TAKEN OUT)
// THE BOARD AFTER A LINE AND THE BEST ON (contLostOf): the line played to its end, the survival search asked of the board it leaves with
// the garbage still on its way, for `give` ms (SAVE_MS at most, an equal part of the decision's own time each); the frame that board is lost, 1e9 if it lives, -1 if
// it could not be asked. The hold's board is the board left alone. A line lost before its end is lost where the judge saw it lost, and a
// board the search finds no line on is lost where it is lost left alone.
#define SAVE_MS 10
#define SAVE_KEEP_MS 4
static int32_t saveAsked, saveNot, saveOk;   // (saves asked of the survival search this decision, the threes it found not needed, and whether it found one needed: the log's, and the frame loop's count)
static int32_t saveBlind;   // (a three kept as the save because the save check gave no answer this decision: the log's)
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
  Outlived c = outlive(&q2, HORIZON + REST, REST, give, OUT_DEPTH, 30);
  int32_t lost = c.set ? c.lostAt : diesIn(&q2, HORIZON + REST);
  if (lost < 0) return -1;
  return lost == FOREVER ? 1e9 : (double)dt + lost;
}
static int32_t noopWaits;   // (swaps of the line played handed on as a wait: a swap and its swap back -- playOf)
static int32_t twoDropped, windowCut;   // (lines taken out as a 2x not taken to three -- the log's)
static int32_t twoWhy; static double twoLostLog, twoKeptLog;   // (what let the 2x rule take one out: 1 a line kept lives, 2 one is lost a break's time on, 3 the 2x is lost no later -- the log's)
static int32_t samesTrimmed;   // (the line played judged again without its swaps of one colour -- the log's)
static int32_t opGrew;   // (the opening grown this decision: 1 for its plan, 2 grown only, the stack being raised -- the log's)
static int32_t chainUp, chainNow, chainAfter;   // (the opener's second hand this decision: 2 a trigger fired, 1 a set-up pressed, -1 turned down; the trigger chain before and after: the log's)
static int32_t opFallBar, opFallExt;   // (under the falling chain: the chain the hold reaches, the extension's played, 0 none -- the log's fallBar=)
static int32_t opTried, opFallHeld, opFalling, opFallAt = -1, opFiredAt = -1;   // (the opening plans judged this decision; the lines the opener's falling chain held off this decision: the log's; the opener's chain still falling)
static int32_t carryBeganAt = -1, carryBeganPlay = -1;
static int32_t freeSetup;   // (the second hand this decision: 1 a set-up swap pressed over the hold, -1 asked and turned down, 0 not asked: the log's)
static int32_t needlessTrimmed;   // (swaps taken out of the line played that it lost nothing without: the log's)
static int32_t combosDropped;   // (combos the mode does not ask for, played as a line without one: the log's)
static void dropCombo(const Read *R, Judge *J) {
  static Judge t;
  // (in the time to the move's own frame, the host's hard stop, where there is one)
  double due = clockDue, share = clockShare;
  if (clockFrameOut) { clockDue = 0; clockShare = 0; }
  for (int i = 0; i < J->k.nseq && J->k.nseq >= 2 && !clockOut(); i++) {
    Cand c = J->k; c.nseq = J->k.nseq - 1;
    for (int q = i; q < c.nseq; q++) c.seq[q] = J->k.seq[q + 1];
    if (!judgeCand(R, &c, &t) || t.o.dead || J->o.dead || comboOutside(&t)) continue;
    if (!!t.o.lives < !!J->o.lives || lostOf(&t) < lostOf(J) || imax(0, t.apBroke) < imax(0, J->apBroke) || goalKeyOf(&t) > goalKeyOf(J)) continue;
    if ((wastesThree(&t) && !wastesThree(J)) || (cutsShort(&t) && !cutsShort(J))) continue;
    t.carried = J->carried; t.first = J->first; t.wait = J->wait; t.waitMax = J->waitMax; t.saving = J->saving; t.material = J->material;
    *J = t; combosDropped++; break;
  }
  clockDue = due; clockShare = share;
}
// A 2x MADE A PLAIN BREAK, AS AN OPTION (the owner: a 2x that cannot go to three may be made a plain break instead): the line is
// judged with each of its swaps left out in turn, and the first that makes no 2x not taken to three, lives as long, is lost no sooner
// and breaks as much is offered beside it
static int twoMadeThree(const Read *R, const Judge *J, Judge *out) {
  Judge t;
  double due = clockDue, share = clockShare;
  if (clockFrameOut) { clockDue = 0; clockShare = 0; }
  int done = 0;
  for (int i = 0; i < J->k.nseq && J->k.nseq >= 2 && !clockOut() && !done; i++) {
    Cand c = J->k; c.nseq = J->k.nseq - 1;
    for (int q = i; q < c.nseq; q++) c.seq[q] = J->k.seq[q + 1];
    if (!judgeCand(R, &c, &t) || shortChain(&t)) continue;
    if (!!t.o.lives < !!J->o.lives || lostOf(&t) < lostOf(J) || imax(0, t.apBroke) < imax(0, J->apBroke)) continue;
    if ((wastesThree(&t) && !wastesThree(J)) || (cutsShort(&t) && !cutsShort(J))) continue;
    t.carried = 0; t.first = J->first; t.wait = J->wait; t.waitMax = J->waitMax; t.saving = J->saving; t.material = J->material;
    *out = t; done = 1;
  }
  clockDue = due; clockShare = share;
  return done;
}
static int32_t twoRemade;   // (2x lines made a plain break: the log's)
static int ranked(const Read *R, const Found *S) {
  memset(dropped, 0, sizeof dropped); memset(offered, 0, sizeof offered); memset(cutWhy, 0, sizeof cutWhy); memset(cutWhyBreak, 0, sizeof cutWhyBreak);
  carriedJ = 0; opCarried = 0; orderN = 0; twoDropped = 0; windowCut = 0; twoWhy = 0; twoRemade = 0; samesTrimmed = 0; needlessTrimmed = 0; noopWaits = 0; unbroken.set = 0; saveAsked = saveNot = saveOk = saveBlind = 0; saveCw = saveCk = -1; svLost = -1; svClean = 0;
  ideaAims = &R->guides; ideasAsks = 0;
  double t0 = nowMs();
  int nc = fairShare(theCands, proposeAll(R, S, theCands, PROPOSED), MAXCANDS), n = 0;
  double t1 = nowMs();
  for (int i = 0; i < nc; i++) offered[theCands[i].play]++;
  readyDefer = 1;   // (the proposers above ask readiness whole; the judging below ranks first)
  readyStop(); readyPendClear(); readyCollect = 1;   // (and keeps each landed board: searched once, its nearest break measured)
  rankReact = C2.reaction + 1;
  rankSave = rankReact + decQ.b->fFLASH + decQ.b->fFACE + decQ.b->fPOP * (3 + W);   // (pa.c matchGarbagePanels: a row of W cells)
  for (int i = 0; i < nc; i++) if (judgeWalked(R, &theCands[i], &theJudged[n])) { order[n] = &theJudged[n]; n++; }
  // (NOTHING JUDGED IN TIME: the searches and the proposing took the decision's time and the clock stopped the judge on every line --
  // every line is judged again up to the move's own frame, the host's hard stop (clockFrameOut): a board is never held for want of a
  // look at its lines. The line in progress and the hold are judged in that time too.)
  double rescueDue = clockDue, rescueShare = clockShare; int rescue = 0;
  if (!n && nc && clockFrameOut && clockOut()) {
    rescue = 1; clockDue = 0; clockShare = 0;
    for (int i = 0; i < nc; i++) if (judgeWalked(R, &theCands[i], &theJudged[n])) { order[n] = &theJudged[n]; n++; }
  }
  n = keptJudged(R, n);   // (the intentions the last decision kept, found again)
  // (the line in progress: first of its tier when its next step is due now; one whose next step must wait for the board is a hold
  // until then -- it ranks with the hold)
  Cand ck; int cwait = 0, cc = 0;
  carryNone = 21;
  carryJudgeDrop = -1;
  if (R->guides.n && (cc = carriedCand(R, &ck, &cwait))) { lastDrop = -1; if (!judgeCand(R, &ck, &theJudged[n])) { carryNone = 19; carryJudgeDrop = lastDrop; } }
  if (R->guides.n && cc && carryNone != 19) {
    carryNone = 0;
    Judge *cj = &theJudged[n];
    cj->wait = cwait;
    if (cwait) cj->waitMax = 1; else if (!carriedFromReady()) cj->first = 1;   // (its place: rank.c tierView)
    // (A WAIT THAT DOES NOT END: a line that has waited CARRY_WAITS decisions for a board that has not settled -- under garbage it may
    // never -- is offered beside the same line pressed straight through, below, ranked with the hold as every wait is: the owner, no lazy
    // waits -- a wait is taken only where it outranks every line that presses -- and a line is put down only when it is no longer there)
    if (cwait && carryWaitsOut()) { cj->carried = 1; order[n] = cj; n++; carriedJ = cj; carryNone = 22; }
    // (A LINE BEGUN IN ANOTHER MODE -- the owner: the modes as the enemy's board calls them: past a switch the line in progress is carried
    // on only where it meets the new mode's first entry or breaks garbage; else it is offered as any line, ranked on what it makes)
    else if (carryRule() != R->rule && !goalLine(cj) && !(cj->apBroke > 0)) { order[n] = cj; n++; carryNone = 23; }
    else { cj->carried = 1; order[n] = cj; n++; carriedJ = cj; if (opLineOn && (cj->o.lives || decF.next == NOT_ASKED || (cj->apNats > 0 && cj->apAts[cj->apNats - 1] < decF.next))) opCarried = cj; }
    // (and, the board still moving, the same line pressed straight through -- each swap as soon as the board lets it, not once the
    // board has settled: a slab converting is frames the line can be pressed in)
    static Judge thru;
    Cand k2 = ck; k2.settled = 0; k2.play = PLAY_CARRY;
    if (cwait && judgeCand(R, &k2, &thru)) { thru.carried = 1; order[n] = &thru; n++; }
  }
  // (the hold, always: the chain the board makes alone is the board's, however far past the list it runs -- never one to stop)
  Judge *H = &theJudged[n];
  holdCand(R, 0, H);
  if (rescue) { clockDue = rescueDue; clockShare = rescueShare; rescues++; }
  order[n] = H; n++;
  for (int i = 0; i < n; i++) if (order[i] != H && digWaits(order[i], H, C2.reaction + 1)) order[i]->wait = 1;
  breakOffered = 0; for (int i = 0; i < n && !breakOffered; i++) breakOffered = order[i]->apBroke > 0;
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
    Outlived sv = svDone ? svJob : outliveSave(&decQ, HORIZON + REST, REST, leftMs(), OUT_DEPTH, 30);
    offered[PLAY_SURVIVE] = sv.set && sv.nseq ? 1 : 0;
    Cand sk;
    if (sv.set && sv.nseq && candOf(&sk, PLAY_SURVIVE, sv.seq, sv.nseq, -1, 0)) { sk.settled = 0; if (judgeCand(R, &sk, &theJudged[n + 1])) { readyNextFor(&theJudged[n + 1]); svClean = !wastesThree(&theJudged[n + 1]); order[n] = &theJudged[n + 1]; n++; sortJudged(order, n); } }
    if (sv.set) svLost = sv.lostAt == FOREVER ? 1e9 : sv.lostAt;
  }
  // THE THREE TAKEN OUT: each of the best lines that waste a three, judged again with one of its swaps left out at a time -- the line
  // without the swap that makes the three, where it does as well, is a line the order below keeps
  strippedCarry = 0;
  { int ns = 0, tried = 0, none = !(n && order[0]->o.lives), n0 = n;
    // (the line in progress first, whatever its place: without the swap that makes its three it is still the line in progress -- carried,
    // its swaps pressed so far not for nothing -- where otherwise the order puts it down whole as a wasted three)
    // (not where the list asks a chain: a chain's line is its swaps' order, and one swap left out is a chain begun from another place --
    // fill on seed 86, 25 and 23 against 26 and 26 with it on)
    int asksChain = 0; for (int i = 0; i < theList.n; i++) if (theList.aim[i].chain.op) asksChain = 1;
    int ci = -1; if (!asksChain) for (int i = 0; i < n0; i++) if (order[i] == carriedJ) ci = i;
    for (int i0 = -1; i0 < n0 && tried < STRIP_LINES && ns < NSTRIP && leftMs() > 0; i0++) {
      int i = i0 < 0 ? ci : i0;
      if (i < 0 || (i0 >= 0 && i == ci)) continue;
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
        if (J == carriedJ && !asksChain && !strippedCarry) { stripped[ns].carried = 1; strippedCarry = &stripped[ns]; }
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
    // (A SAVE NEAR THE END: every line that keeps its threes lost within NEAR_SAVE breaks' time, and the three lost a break's time later or
    // lives -- the three is the save, asked of no search: by the time the rule's break's time comes the window is too short to press it.
    // Live p65, r661, 8348: the hold lost in 104 frames, a break's time and seven, the line that would have lived 242 frames longer
    // dropped as a wasted three, and the board lost 50 frames later)
    int nearSave = raceOn && keptLost >= 0 && keptLost < NEAR_SAVE * rankSave && (wasteLives || wasteLost - keptLost >= rankSave);
    // (the owner: don't die -- a three is kept out only where a line that keeps it lives, or is lost no sooner than the best that wastes one)
    if (!keeps && !wasteLives && keptLost >= 0 && wasteLost <= keptLost) keeps = 1;
    if (!keeps && nearSave) saveOk = 1;
    // (THE SAVE ASKED: where the rule would let a three through, the best line that wastes one and the best that does not -- the hold
    // among them -- are each played to their end and the survival search asked of the boards they leave, the garbage on its way
    // landing as it would. A three whose board, with the best line on, outlasts the other's by nothing was not needed not to die: it
    // is wasted)
    if (!keeps && !saveOk && saveRoomMs() > SAVE_KEEP_MS + 2) {
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
        // (and the survival search's own loss on the three's side where its line wastes one: each side is bounded below by what the
        // decision's longer search already found for it, not only the one without)
        if (svLost >= 0 && !svClean && cw >= 0 && svLost > cw) cw = svLost;
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
    // (A SAVE THE CHECK COULD NOT ANSWER -- no time left to ask it, or no answer in the time it had: every line that keeps its threes is
    // lost within a break's time and the three lives or is lost later, so the three is the save -- death is never an option. Only a
    // check that answered takes a three out)
    if (!keeps && !saveOk && (wasteLives || wasteLost >= 0) && !(saveAsked && saveCw >= 0 && saveCk >= 0)) { saveOk = 1; saveBlind = 1; }
    // (only a three the save confirmed is played: any other line that wastes one goes, the hold always left -- the press guard refuses
    // what the order lets through, a walk spent for nothing)
    // (and never the line in progress begun on its three as the save: the input pressed of it is spent, and taken out now it is spent for
    // nothing)
    if (!saveOk) { int m = 0; for (int i = 0; i < n; i++) { if (wastesThree(order[i]) && order[i] != opCarried && !(order[i] == carriedJ && carrySave)) { dropAs(order[i]->k.play, DROP_WASTE); if (order[i] == carriedJ) { carriedJ = strippedCarry; if (!carriedJ) carryNone = 20; } } else order[m++] = order[i]; } n = m; } }
  // THE WINDOW BACK BEFORE THE TOP (no garbage: the board is lost to its own rise, and saved only by a clear the window has the actions
  // for): a line -- the hold too -- after which the window does not hold a break's walk (BREAK_WALK) again, with the frames to press it
  // (PRESS_FRAMES an action), before its board is lost, leaves a board that cannot save itself; where another line does, it is taken out.
  // The rise and the window both counted: the presses leaving the window by each frame (core/nodes.h allowLeftAt), the frame each line's
  // board is lost (diesAt). Endless on main: the deaths with 5-12 actions left; held whatever the rise, 21 of 28 (idea354)
  if (!garbageSeen && pressAllowance >= 0) {
    int n0w = n;
    int ok[MAXCANDS + 5 + NINTENT + NROUTE + NSTRIP], anyOk = 0;
    for (int i = 0; i < n; i++) {
      const Judge *J = order[i]; ok[i] = 1;
      if (J->o.lives || J->apBroke > 0) { anyOk = 1; continue; }
      double d = diesAt(J); if (d < 0 || d >= 1e299) { anyOk = 1; continue; }
      int walk = J->hold ? 0 : lineWalk(J), back = -1;
      // (the window is whole again once its length has passed -- every action in it gone -- so the frames asked end there: a board lost
      // far off asked to its frame was millions of steps, 5 s a decision and the board lost holding: endless on seed 86, 15754)
      int last = d < winLen ? (int)d : winLen;
      for (int t = 0; t <= last; t += 4) if (allowLeftAt(t, walk) >= BREAK_WALK) { back = t; break; }
      ok[i] = back >= 0 && back + BREAK_WALK * PRESS_FRAMES <= d;
      if (ok[i]) anyOk = 1;
    }
    if (anyOk) { int m = 0; for (int i = 0; i < n; i++) { if (!ok[i] && order[i] != opCarried) { if (order[i] == carriedJ) { carriedJ = 0; carryNone = 25; } } else order[m++] = order[i]; } n = m; windowCut = n0w - n; }
  }
  // NO 2x NOT TAKEN TO THREE (the owner: a 2x is taken to three, and one that cannot be is not made): a line whose chain ends at two
  // (rank.c shortChain) is taken out of the order -- unless every other line is lost within a break's time (rankSave) and a 2x lives,
  // or is lost later: only there is a 2x a save
  // (each such line, the best ranked first, offered beside it as a plain break where it can be: twoMadeThree)
  { static Judge remade[4]; int n0 = n;
    for (int i = 0, tries = 0; i < n0 && tries < 4 && n < MAXCANDS + 5 + NINTENT + NROUTE + NSTRIP && !clockOut(); i++)
      if (shortChain(order[i])) { if (twoMadeThree(R, order[i], &remade[tries])) { order[n++] = &remade[tries]; twoRemade++; } tries++; }
    if (twoRemade) sortJudged(order, n); }
  { int keeps = 0, twoLives = 0; double twoLost = -1, keptLost = -1;
    for (int i = 0; i < n; i++) {
      if (shortChain(order[i])) { if (order[i]->o.lives) twoLives = 1; else if (lostOf(order[i]) > twoLost) twoLost = lostOf(order[i]); }
      else if (spendsReserve(order[i])) continue;   // (a line that spends the window the next break is pressed from keeps nothing)
      else if (order[i]->o.lives) keeps = 1; else if (lostOf(order[i]) > keptLost) keptLost = lostOf(order[i]);
    }
    int why = keeps ? 1 : 0;
    // (the owner: don't die -- a 2x is kept out only where a line that makes none lives, or is lost no sooner than the best 2x)
    if (!keeps && !twoLives && keptLost >= 0 && twoLost <= keptLost) keeps = 1, why = 3;
    twoWhy = why; twoLostLog = twoLives ? 1e300 : twoLost; twoKeptLog = keptLost;
    // (not where the list asks no chain: a 2x taken to three is a bigger slab the mode does not ask)
    // (nor the line in progress begun on its 2x: the input pressed of it is spent, and taken out now it is spent for nothing)
    if (keeps && listChainCap() > 0) { int m = 0; for (int i = 0; i < n; i++) { if (shortChain(order[i]) && order[i] != opCarried && !(order[i] == carriedJ && carryTwo)) { dropAs(order[i]->k.play, DROP_TWO); twoDropped++; if (order[i] == carriedJ) { carriedJ = 0; carryNone = 24; } } else order[m++] = order[i]; } n = m; } }
  // (NO COMBO THE MODE DOES NOT ASK FOR, where a three does as well: the line ranked first making one is played with each of its swaps
  // left out in turn, and one that makes none, lives as long, breaks as much and makes as much of the list is the line -- a fourth panel
  // walked in by a swap the break did not need is a panel and a walk for nothing (the owner: no mode asks a combo of four))
  if (n && order[0] && !order[0]->hold && comboOutside(order[0])) dropCombo(R, order[0]);
  // (EVERY SWAP THE LINE NEEDS, NO OTHER -- the owner: everything is about efficiency: the line ranked first, each of its swaps left
  // out in turn; one it loses nothing without -- it lives as long, breaks as much, chains and combos as much, leaves its next break no
  // farther, and is ranked no lower -- is taken out and the line judged again: the walk to that swap and its press are inputs for
  // nothing. A swap and its swap back, a swap of two panels alike and a swap back of the last pair pressed are such swaps.)
  for (int pass = 0; pass < 4 && n && order[0] && !order[0]->hold && order[0]->k.nseq >= 2 && !clockOut(); pass++) {
    static Cand w; static Judge JL; Judge *J = order[0]; int took = 0;
    for (int i = 0; i < J->k.nseq && !took && !clockOut(); i++) {
      w = J->k; w.nseq = 0; w.xNats = 0;
      for (int q = 0; q < J->k.nseq; q++) if (q != i) w.seq[w.nseq++] = J->k.seq[q];
      if (!judgeCand(R, &w, &JL) || JL.o.dead) continue;
      if (!JL.o.lives && (J->o.lives || diesAt(&JL) < diesAt(J))) continue;
      if (imax(0, JL.apBroke) < imax(0, J->apBroke) || JL.apChain < J->apChain || JL.apCombo < J->apCombo) continue;
      if (J->o.nearAfter >= 0 && JL.o.nearAfter > J->o.nearAfter) continue;
      if (compareJudged(&JL, J) > 0) continue;
      JL.carried = J->carried; *J = JL; took = 1; needlessTrimmed++;
    }
    if (!took) break;
  }
  // (and a line of nothing but swaps of two panels alike is the hold: the board it leaves is the board as it is)
  if (n && order[0] && !order[0]->hold && order[0]->o.j.sames && order[0]->k.nseq >= 1) {
    Judge *J = order[0]; int all = 1;
    for (int i = 0; i < J->k.nseq && all; i++) if (!(i < 64 && (J->o.j.sames >> i & 1))) all = 0;
    if (all) for (int i = 1; i < n; i++) if (order[i]->hold) { Judge *h = order[i]; for (int k = i; k > 0; k--) order[k] = order[k - 1]; order[0] = h; samesTrimmed = 2; break; }
  }
  phaseMs[0] = (int32_t)(t1 - t0); phaseMs[1] = (int32_t)(t2 - t1); phaseMs[2] = (int32_t)(nowMs() - t2);
  return n;
}

// 5. PLAY: the raise when the opening calls for it, a hold while the raise waits for a busy board, else the first candidate in the one
// order -- a line's first swap, or the hold
typedef struct { const Judge *top, *line; int32_t name, nlive, ncands, urgent, wait, deferred; } Played;
// (the hold put in a line's place only where the board it leaves is lost no sooner, as the engine has it: the owner -- you can't choose to
// die)
static int taHoldNoSooner(const Judge *line, int n) {
  if (!line) return 1;
  for (int i = 0; i < n; i++) if (order[i]->k.play == PLAY_HOLD) return diesAt(order[i]) >= diesAt(line);
  return 0;
}
// THE BOARD THE OPENER BUILDS ON (opTarget): the question's board flattened -- search/level.c's swap, played and settled, again and again
// while one is found, OP_FLAT at most, into opFlat -- then raised `rows` rows on the engine, the raise key held as the game would take
// it. 0 where the board is lost on the way.
#define OP_FLAT 8
static int32_t opFlat[OP_FLAT], opFlatN, opFlatPlayed;
static Ctx *opTCtx;
static int opTarget(const Question *q, int32_t rows, Question *out) {
  static Board *cur, *tgt; if (!cur) { cur = nb_new(); tgt = nb_new(); } if (!cur || !tgt) return 0;
  cloneBoard(cur, q->b); opFlatN = 0;
  for (int k = 0; k < OP_FLAT && !clockOut(); k++) {
    Question t = *q; t.b = cur; t.narr = 0;
    int32_t sw = level(&t, NOT_ASKED);
    if (!sw) break;
    Ctx *x = opTCtx = ctxOf(opTCtx);
    int root = rootOf(x, &t); if (root < 0) break;
    int nd = step(x, root, MK_SETTLE, CR(sw), CC(sw), 0);
    if (!liveNode(x, nd)) break;
    const Board *b = ensureBoard(x, nd); if (!b) break;
    cloneBoard(cur, b); opFlat[opFlatN++] = sw;
  }
  cloneBoard(tgt, cur);
  int32_t top0 = fullTop(tgt);
  for (int32_t f = 0; fullTop(tgt) < top0 + rows && tgt->gameOverClock <= 0 && f < 60 * rows; f++) { tgt->input = RAISE_IN; run(tgt); }
  if (tgt->gameOverClock > 0) return 0;
  tgt->input = 0;
  *out = *q; out->b = tgt; out->narr = 0;
  return 1;
}
// (an opening plan the decision may press: set-ups to press, a chain longer than the board's own trigger's and one the mode asks for,
// its set-ups pressed before the next block lands)
// (and, no garbage shown yet, its trigger pressed by OPEN_FIRE_BY: the opener's chain goes before anything can land on it)
static int opBefore(void) { return decF.next == NOT_ASKED && decQ.b->clock < OPEN_FIRE_BY; }
// (pass 0: a chain the mode asks for, fired by OPEN_FIRE_BY; 1: a chain of OP_FAST_CH or more fired by then -- a chain going is a board
// that cannot top out, and the extension grows it while it falls; 2: a chain the mode asks for, fired when it can)
#define OP_FAST_CH 3
static int opFits(const OpPath *p, int32_t trigCh, int pass) {
  int32_t frames = (p->len + 1) * OPEN_SWAP_FRAMES; int by = pass < 2;
  return p->len > 0 && p->ch > trigCh && (pass == 1 ? p->ch >= OP_FAST_CH : opAsked(p->ch)) && !(decF.next != NOT_ASKED && decF.next <= frames) &&
         !(by && opBefore() && decQ.b->clock + frames > OPEN_FIRE_BY + OPEN_SWAP_FRAMES);
}
// THE SECOND CHAIN BUILT UNDER THE FIRST (the owner: two 4-chains): the board the falling chain leaves once it has landed, the opening's
// plan grown there in a share of the decision's time; the plan's next set-up pressed now where it would be pressed then -- its two panels,
// and every panel under them in their columns, where they will be once the chain lands and none of them moving -- and only where the
// chain falls on as long as it does left alone. 0 where there is none.
#define OP_SECOND_SHARE 0.5
static int opDesign(const Board *b, double ms, OpPath *out);
static int32_t opSecondCh, opSecondWhy;   // (the second chain's plan, its chain; how far the try went -- 1 begun, 2 a landed board, 3 time, 4 a plan, 5 a swap on the board, 6 still panels, 7 pressed: the log's)
static const Judge *opSecondSwap(const Read *R, int n) {
  static Board *landed; static Ctx *sx;
  if (!landed) landed = nb_new();
  opSecondWhy = 1;
  if (!landed || clockOut()) return 0;
  sx = ctxOf(sx);
  int root = rootOf(sx, &decQ), calm = root >= 0 ? settleOf(sx, root) : -1;
  const Board *lb = liveNode(sx, calm) ? ensureBoard(sx, calm) : 0;
  opSecondWhy = 2;
  if (!lb || lb->chainCounter != 0 || lb->nrows != decQ.b->nrows) return 0;
  cloneBoard(landed, lb);
  Question lq = decQ; lq.b = landed;
  double left = C2.due ? C2.due - C2.margin - nowMs() : 50, ms = left * OP_SECOND_SHARE;
  opSecondWhy = 3;
  if (ms < 2) return 0;
  double keepDue = clockDue, keepShare = clockShare; clockDue = 0; clockShare = 0;
  // (the landed board is the same board every decision of the fall: the plan grown on it is grown on, decision after decision)
  static int32_t grownFor = -1;
  if (grownFor != opFallAt) { openingReset(); grownFor = opFallAt; }
  { double sh = clockShareBegin(nowMs() + ms); openingGrow(&lq, decQ.b); clockShareEnd(sh); }
  clockDue = keepDue; clockShare = keepShare;
  opSecondWhy = 4; opSecondCh = opHave ? opBest.ch : -1;
  // (the designer's chain first: its whole plan in a few milliseconds; the beam's where it finds none)
  static OpPath dp; const OpPath *pl = 0;
  if (opDesign(landed, ms * 0.5, &dp) && dp.len >= 1) pl = &dp;
  else if (opHave && opBest.len >= 1 && opBest.ch >= OP_TWO_FROM) pl = &opBest;
  if (!pl) return 0;
  opSecondCh = pl->ch;
  int32_t sw = pl->path[0], r = CR(sw), c = CC(sw);
  const Board *b = decQ.b;
  opSecondWhy = 5;
  if (r < 1 || r >= b->nrows || c < 1 || c >= W) return 0;
  for (int cc = c; cc <= c + 1; cc++) for (int rr = 1; rr <= r; rr++) {
    const int32_t *now = b->p[rr][cc].f, *then = landed->p[rr][cc].f;
    if (now[ID] != then[ID] || (now[ID] > 0 && now[STATE] != NORMAL)) return 0;
  }
  opSecondWhy = 6;
  // (and the chain no shorter for it: the hold's chain, all of it, is the bar)
  int32_t bar = 0; for (int i = 0; i < n; i++) if (order[i]->hold) bar = order[i]->apChainAll;
  static Judge J; Cand k; int32_t one[1] = { sw };
  if (!candOf(&k, PLAY_SETUP, one, 1, -1, 0)) return 0;
  k.settled = 0; lastDrop = -1;
  if (!judgeCand(R, &k, &J) || J.o.dead || J.apChainAll < bar) return 0;
  opSecondWhy = 7; opPressed = sw;
  return &J;
}
// THE OPENER'S CHAIN DESIGNED (search/chainbuild.c, time attack's designer): the board's full rows ordered, a swap at a time, into the
// best chain OP_CB_MAXSW swaps or fewer make, a swap worth OP_CB_COST of a chain's score -- the opener's chains are a few swaps, never time
// attack's long builds -- and its swaps put in an order that sets nothing off, the trigger last: a plan, into *out, where its chain is
// OP_TWO_FROM or more
#define OP_CB_COST 30
#define OP_CB_MAXSW 14
static int32_t opDesigned;   // (the chain of the design offered this decision, 0 none: the log's)
static int opDesign(const Board *b, double ms, OpPath *out) {
  static CbGrid G, D; static int32_t seq[CB_MAXSWAPS + 1];
  cbOfBoard(b, &G);
  int full = 0; for (int r = 1; r <= G.rows; r++) full += cbFull(&G, r);
  if (!full || ms < 1) return 0;
  int keepSw = cbJMaxSw; int32_t keepCost = cbJSwapCost; cbJMaxSw = OP_CB_MAXSW; cbJSwapCost = OP_CB_COST;
  int32_t tr = 0; int links = 0, sw = 0;
  int32_t v = cbDesignAll(&G, 0, ms, &D, &tr, &links, &sw);
  cbJMaxSw = keepSw; cbJSwapCost = keepCost;
  if (v <= 0 || !tr || links < OP_TWO_FROM) return 0;
  int n = cbOrder(&G, &D, tr, seq, OP_DEPTH + 1);
  if (n < 1) return 0;
  memset(out, 0, sizeof *out);
  out->len = n - 1; for (int i = 0; i < n - 1; i++) out->path[i] = seq[i]; out->trig = seq[n - 1]; out->ch = links;
  opDesigned = links;
  return 1;
}
// THE PLANS' FALLS EXTENDED (the countdown's: the owner's three seconds): each plan kept, its chain OP_FAST_CH or more, played to its trigger
// on the engine and its fall searched for the longest extension in an equal share of `ms` -- the chain it reaches into chx; the best
// ranked again
#define OP_EXT_PLANS 6
static int32_t opExtBest;   // (the longest chain a plan's fall reached extended: the log's opgrew /x)
static void opExtendAll(const Question *q, double ms) {
  const OpPath *pl[OP_EXT_PLANS]; OpPath *mut[OP_EXT_PLANS]; int np = 0; opExtBest = 0;
  for (int ln = 1; ln <= OP_DEPTH && np < OP_EXT_PLANS; ln++) if (opByLenHave[ln] && opByLen[ln].ch >= OP_FAST_CH) { pl[np] = &opByLen[ln]; mut[np++] = &opByLen[ln]; }
  if (!np) return;
  static Ctx *ex; Ctx *x = ex = ctxOf(ex);
  for (int i = 0; i < np && !clockOut(); i++) {
    int root = rootOf(x, q); if (root < 0) return;
    int at = opReplay(x, root, pl[i]); if (at < 0) continue;
    int out = step(x, at, MK_SWAP, CR(pl[i]->trig), CC(pl[i]->trig), 0);
    for (int k = 0; k < 6 && liveNode(x, out); k++) { const Board *bb = ensureBoard(x, out); if (bb && cascadeLive(bb)) break; out = step(x, out, MK_LONG, 0, 0, 2); }
    const Board *fb = liveNode(x, out) ? ensureBoard(x, out) : 0;
    if (!fb || !cascadeLive(fb)) continue;
    static Board *fall; if (!fall) fall = nb_new(); if (!fall) return;
    cloneBoard(fall, fb);
    Question fq = *q; fq.b = fall;
    List L; memset(&L, 0, sizeof L); L.n = 1; L.aim[0].chain.op = OP_GE; L.aim[0].chain.n = 2; L.aim[0].brk = -1;
    ExtOpts eo = { 40, 6, &L, NOT_ASKED, 0, ms / np };
    static Ext E; extend(&fq, &eo, &E);
    int32_t c = E.longest.set ? E.longest.chain : E.baseChain;
    mut[i]->chx = c; if (c > opExtBest) opExtBest = c;
    x = ex = ctxOf(ex);
  }
  for (int ln = 1; ln <= OP_DEPTH; ln++) if (opByLenHave[ln] && (!opHave || opPacier(&opByLen[ln], &opBest))) { opBest = opByLen[ln]; opHave = 1; }
}
static Played playOf(const Read *R, int n) {
  Played P; memset(&P, 0, sizeof P);
  // (the opening's wait for the raise is a hold, so only while the hold lives: where it does not, the order decides -- a line that lives
  // is never passed over for a raise to come)
  int holdLivesNow = 0;
  for (int i = 0; i < n; i++) if (order[i]->hold && order[i]->o.lives) holdLivesNow = 1;
  // (and never while a chain falls: the raise cannot come then, and the chain is extended)
  P.wait = R->low && !R->up && !(n && order[0]->k.extend) && holdLivesNow && !cascadeLive(decQ.b) && decQ.b->chainCounter == 0 && !cdAsk;
  P.top = R->up || P.wait ? 0 : (n ? order[0] : 0);
  // (the line in progress that waits for the board is played as it was judged: its next swap from the frame the judge pressed it from)
  P.line = P.top && !P.top->hold && (!P.top->wait || P.top->k.play == PLAY_CARRYWAIT) ? P.top : 0;
  // (A SWAP AND ITS SWAP BACK ARE A WAIT -- the owner: no flip and back: two swaps of the line played that swap a pair and straight back
  // (judge.c noops) leave the board as it stood, so the line is handed on without them, every swap left pressed from the frame the judge
  // pressed it from; a line of nothing else is the hold)
  if (P.line && !P.line->o.dead && P.line->o.j.noops) {
    static Judge Wt; const Judge *L = P.line; int64_t m = L->o.j.noops; int q = 0, nq = 0;
    Wt = *L;
    for (int i = 0; i < L->k.nseq; i++) {
      if (i + 1 < L->k.nseq && i + 1 < 64 && ((m >> (i + 1)) & 1)) { i++; noopWaits++; continue; }
      Wt.k.seq[q] = L->k.seq[i];
      if (i < L->apNats) Wt.apAts[nq++] = L->apAts[i];
      q++;
    }
    Wt.k.nseq = q; Wt.apNats = nq;
    P.line = q ? &Wt : 0;
  }
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
  // (THE SECOND HAND -- the owner: set up between moves, never at the cost of the board's life: where the decision is the hold, the next
  // swap toward the eight kept as the target (propose.c twinNextSwap), judged on the engine, is pressed instead -- only where it lives
  // as the hold does or is lost no sooner, breaks the board's chain no shorter, wastes no three and keeps the window's reserve)
  freeSetup = 0;
  if (!P.line && P.top && P.top->hold && !P.deferred && !R->up && !P.wait && twinWanted && !clockOut()) {
    int32_t sw;
    if (twinNextSwap(decQ.b, &sw)) {
      static Judge FS; Cand k; int32_t one[1] = { sw };
      const Judge *H = P.top;
      if (candOf(&k, PLAY_SETUP, one, 1, -1, 0)) {
        k.settled = 0; k.twin = 2; freeSetup = -1;
        // (turned down: -1 not played out, -2 lost sooner, -3 the chain cut short, -4 a wasted three, -5 the reserve -- the swap is the kept
        // eight's own, so it brings that eight a swap nearer by its making)
        if (!judgeCand(R, &k, &FS) || FS.o.dead) freeSetup = -1;
        else if (!(H->o.lives ? FS.o.lives : (FS.o.lives || (FS.o.lostAt != NOT_ASKED && diesAt(&FS) >= diesAt(H))))) freeSetup = -2;   // (an unknown loss is never no sooner)
        else if (cutsShort(&FS)) freeSetup = -3;
        else if (wastesThree(&FS)) freeSetup = -4;
        else if (spendsReserve(&FS)) freeSetup = -5;
        else { P.line = &FS; freeSetup = 1; }
      }
    }
  }
  // (THE OPENER'S SECOND HAND -- the owner: the opener has the time to set its chain up and goes for its goal: where its decision is the
  // hold, on a board with no garbage on it and not raising (a block on its way is judged with the line), the trigger of a chain the mode's first entry asks for is
  // pressed, else the set-up swap the trigger chain is longest after (search/chainup.c) -- each judged as any line, pressed only living)
  chainUp = chainNow = chainAfter = 0; opTried = 0; opFallHeld = 0; opSecondCh = 0; opSecondWhy = 0; extLogged = 0; opFallBar = opFallExt = 0; opDesigned = 0; opGrew = 0;
  // (not while a chain falls: that chain is extended -- the extension's lines are the move -- and nothing is begun or flattened under it)
  int opWants = !R->under && R->rule >= 0 && theTables.r[R->rule].table == 2 && theList.n > 0 && theList.aim[0].chain.op && clockFrameOut && !clockFrameOut() &&
                !cascadeLive(decQ.b) && decQ.b->chainCounter == 0;
  // (THE OPENER AS ONE PLAN -- the owner: the opener includes everything it is going to do, the flattening too, and raises the moment
  // it is flat: while the opening raise is due and done before the next block lands, the plan is made on the board it will build on -- the stack
  // flattened (opFlatten), then raised the rows the raise asks on the engine -- and grown there in the decision's time. The flattening
  // is pressed first, as one line; with none left, the raise; then the plan, kept through the rows risen)
  opFlatPlayed = 0;
  // (not the countdown's: a plan made on the board raised is made on rows not yet dealt -- the countdown plans the board as it is, and
  // the raise is play's)
  if (opWants && !opLineOn && raiseOpening && !cdAsk) {
    double keepDue = clockDue, keepShare = clockShare; clockDue = 0; clockShare = 0;
    double left = C2.due ? C2.due - C2.margin - nowMs() : 100, grow = left * (cdAsk ? CD_GROW : 0.7); if (grow < 2) grow = 2;
    opGrowMs = (int32_t)grow; readyStop();
    static Question tq; tq = decQ;
    // (the flattening and the raise done before the next block lands: the plan is built on the board raised, the block judged with it)
    if (opTarget(&decQ, raiseRows, &tq) && (R->readyAt == NOT_ASKED || R->readyAt > tq.b->clock - decQ.b->clock)) {
      double sh = clockShareBegin(nowMs() + grow); openingGrow(&tq, decQ.b); clockShareEnd(sh);
      opGrew = 2;
      if (opFlatN > 0) {
        static Judge FL; Cand k;
        if (candOf(&k, PLAY_LEVEL, opFlat, opFlatN, -1, 0)) { k.settled = 1; if (judgeCand(R, &k, &FL) && !FL.o.dead && (FL.o.lives || !P.top || diesAt(&FL) >= diesAt(P.top))) { P.line = P.top = &FL; P.wait = 0; opFlatPlayed = 1; } }
      }
    }
    clockDue = keepDue; clockShare = keepShare;
  }
  // (the plan takes the move whenever the move chosen lives and breaks nothing -- a level, a set-up, a line in progress, the hold -- not
  // only where the hold was chosen: the opening's whole time is the plan's)
  const Judge *opTop = P.line ? P.line : P.top;
  // (the planned opener in progress goes on: no plan is grown or begun over it -- the carry presses it, and survival alone puts it down)
  // (and no other line takes its place while it can still be pressed and either lives or presses its last swap before the next block
  // lands -- one that cannot fire in time is survival's to decide)
  if (opLineOn && opCarried && !(P.line && P.line->carried)) { P.line = P.top = opCarried; P.wait = 0; P.deferred = 0; }
  // (THE OPENER'S CHAIN FALLING -- the owner: as long as you extend, you can't die: the stack is still while it falls and the garbage
  // waits for it, so nothing is pressed under it but its extension -- a swap of anything else is a link taken from it)
  // (the opener's chain: one falling while the opener is the mode, held to until it lands whatever mode comes after it)
  // (the opener's chain: from the frame its trigger was handed on -- its first clear and the fall after it, before the chain counter
  // shows a link -- while the board still moves, and on while the chain counter runs; a slab popping with no trigger of ours is none)
  { int ours = opFiredAt >= 0 && decQ.b->clock - opFiredAt <= OP_FIRE_HOLD && (cascadeLive(decQ.b) || popLeft(decQ.b) > 0);
    int falling = decQ.b->chainCounter > 0 || ours;
    if (!falling) { opFalling = 0; if (opFiredAt >= 0 && decQ.b->clock - opFiredAt > OP_FIRE_HOLD) opFiredAt = -1; }
    else if (!opFalling && R->rule >= 0 && theTables.r[R->rule].table == 2) { opFalling = 1; opFallAt = decQ.b->clock; } }
  if (opFalling) {
    // (the best extension the order holds is played, the line on top too, whatever it is called; with none, the second chain's set-up or the hold)
    // (AN EXTENSION ONLY PAST THE CHAIN PLANNED -- the owner: planned for a 4x, the extension is only needed at the 5x: a line is played
    // only where its chain, as judged all of it, is longer than the chain left alone reaches -- the longest of them; anything else holds,
    // and the planned links fall untouched)
    const Judge *ext = 0; int32_t bar = 0;
    for (int i = 0; i < n; i++) if (order[i]->hold) bar = order[i]->apChainAll;
    for (int i = 0; i < n; i++) {
      const Judge *J = order[i];
      if (J->hold || J->o.dead || !(J->k.play == PLAY_EXTEND || (J->carried && carryBeganPlay == PLAY_EXTEND))) continue;
      if (J->apChainAll <= bar) continue;
      if (!ext || J->apChainAll > ext->apChainAll) ext = J;
    }
    opFallBar = bar; opFallExt = ext ? ext->apChainAll : 0;
    P.wait = 0; P.deferred = 0; opFallHeld++;
    const Judge *two = ext ? 0 : opSecondSwap(R, n);
    if (ext) P.line = P.top = ext;
    else if (two) P.line = P.top = two;
    else { P.line = 0; for (int i = 0; i < n; i++) if (order[i]->hold) { P.top = order[i]; break; } } }
  if (opLineOn && !(carryHeld() && P.line && P.line->carried)) opLineOn = 0;
  // (in its order: the flattening pressed, then the raise -- no plan begun over either)
  if (opWants && !opLineOn && !opFlatPlayed && opTop && opTop->o.lives && !(opTop->apBroke > 0) && !P.deferred && !R->up && !P.wait) {
    double keepDue = clockDue, keepShare = clockShare; clockDue = 0; clockShare = 0;
    // (THE OPENING PLANNED, search/opening.c: the plan grown in the most of this decision's time the judging leaves, its next set-up
    // pressed while the plan's chain is longer than the chain of the trigger the board has now, its set-ups can be pressed before the next block lands and
    // its chain is one the mode asks for; else that trigger fires, if its chain is one the mode asks for)
    double left = C2.due ? C2.due - C2.margin - nowMs() : 100;
    double grow = left * (cdAsk ? CD_GROW : 0.7); if (grow < 2) grow = 2;
    opGrowMs = (int32_t)grow;
    // (the pool taken back from the readiness beside the decision, which would search on past it: the beam is scored on every thread)
    readyStop();
    { double sh = clockShareBegin(nowMs() + grow); openingGrow(&decQ, decQ.b); clockShareEnd(sh); }
    // (and the design: a chain the board's full rows make, offered as a plan beside the beam's -- in the countdown's time, or a slice of
    // the decision's)
    { double l3 = C2.due ? C2.due - C2.margin - nowMs() : 0, dms = cdAsk ? l3 * 0.3 : l3 * 0.2; OpPath dp;
      if (opDesign(decQ.b, dms, &dp)) {
        if (!opHave || opPacier(&dp, &opBest)) { opBest = dp; opHave = 1; }
        if (!opByLenHave[dp.len] || opPacier(&dp, &opByLen[dp.len])) { opByLen[dp.len] = dp; opByLenHave[dp.len] = 1; } } }
    // (the countdown's: the plans kept scored on the second chain each leaves, in the time the grow left)
    if (cdAsk) { double l2 = C2.due ? C2.due - C2.margin - nowMs() : 0; if (l2 > 4) { double sh = clockShareBegin(nowMs() + l2 * 0.6); opExtendAll(&decQ, l2 * 0.55); clockShareEnd(sh); } }
    opGrew = 1;
    int32_t trig = 0, trigCh = 0;
    triggerSendOf(&decQ, &trig, &trigCh);
    chainNow = trigCh; chainAfter = opHave ? opBest.sent : 0;
    // (ONE MOVE, START TO FINISH -- the owner: the opener is a continuous move; once started it goes on, nothing stops or replans it but
    // survival: the plan's set-ups and its trigger handed on as one line, judged whole, then carried as the line in progress)
    // (THE PLANS TRIED, a pass at a time (opFits): each pass's plans, OP_TRIES at most, the best first -- the best of each length, ranked as
    // the plan is (search/opening.c opPacier) -- judged in turn; a plan that does not live, or as judged fires past OPEN_FIRE_BY in a pass
    // that asks it by then, gives way to the next, and a pass that plays none to the next pass; with none in any, the board's own trigger)
    opTried = 0;
    for (int pass = 0; pass < 3 && chainUp <= 0; pass++) {
      const OpPath *tries[OP_TRIES]; int nt = 0;
      if (opHave && opFits(&opBest, trigCh, pass)) tries[nt++] = &opBest;
      for (int ln = 1; ln <= OP_DEPTH; ln++) {
        const OpPath *c = &opByLen[ln];
        if (!opByLenHave[ln] || !opFits(c, trigCh, pass) || (nt && tries[0] == &opBest && !memcmp(c, &opBest, sizeof *c))) continue;
        int at = nt < OP_TRIES ? nt++ : OP_TRIES;
        if (at == OP_TRIES) { if (!opPacier(c, tries[OP_TRIES - 1])) continue; at = OP_TRIES - 1; }
        tries[at] = c;
        for (int j = at; j > 0 && opPacier(tries[j], tries[j - 1]) && !(tries[j - 1] == &opBest); j--) { const OpPath *t = tries[j]; tries[j] = tries[j - 1]; tries[j - 1] = t; }
      }
      for (int t = 0; t < nt && chainUp <= 0; t++) {
        int32_t seq[OP_DEPTH + 1]; int ns = 0;
        const OpPath *pl = tries[t]; for (int k = 0; k < pl->len; k++) seq[ns++] = pl->path[k]; seq[ns++] = pl->trig; opTried++;
        static Judge CU; Cand k;
        if (!candOf(&k, PLAY_ENTRY, seq, ns, -1, 0)) continue;
        k.settled = 1;
        // (turned down: -10 less the judge's drop code where it took it out (rank.c DROP_*), -2 its board is lost, -3 it does not live,
        // -4 it fires past OPEN_FIRE_BY in a pass that asks it by then, -5 a second chain under the floor, -6 judged short of the chain asked:
        // the log's, the first plan's)
        lastDrop = -1;
        int jok = judgeCand(R, &k, &CU);
        int why = !jok ? -10 - lastDrop : CU.o.dead ? -2 : !CU.o.lives ? -3 : 0;
        if (!why && pass < 2 && opBefore() && decQ.b->clock + (CU.apFire >= 0 ? CU.apFire : CU.apNats > 0 ? CU.apAts[CU.apNats - 1] : 0) > OPEN_FIRE_BY) why = -4;
        // (-5 a second chain, in a garbage game, that leaves the board under its material floor: the panels the garbage is dug with)
        if (!why && openerThrown >= 1 && garbageSeen && CU.o.floorKept == 0) why = -5;
        // (-6 the chain as judged is not the chain the pass asks -- the judge plays the plan as the game will, the stack rising under it and
        // the rows it brings up, so a plan the search counts a chain and the judge counts none is a plan on a board that never was)
        if (!why && (pass == 1 ? CU.apChainAll < OP_FAST_CH : !opAsked(CU.apChainAll))) why = -6;
        if (!why) { P.line = &CU; chainUp = 3; openingReset(); opLineOn = 1; }
        else if (!chainUp) chainUp = why;
      }
    }
    if (chainUp <= 0 && trig && opAsked(trigCh)) {
      static Judge CT; Cand k; int32_t one[1] = { trig };
      if (candOf(&k, PLAY_ENTRY, one, 1, -1, 0)) { k.settled = 0; lastDrop = -1; if (judgeCand(R, &k, &CT) && !CT.o.dead && CT.o.lives) { P.line = &CT; chainUp = 2; openingReset(); opLineOn = 0; } }
    }
    clockDue = keepDue; clockShare = keepShare;
  }
  // (TIME ATTACK, THE CHAIN DESIGNED -- the owner: flatten, raise to the top, then one chain that uses every block, up to 13, again and
  // again; the score is all there is, a combo is worth nothing: the design searched on in each decision's time (search/chainbuild.c) until
  // it holds TA_LINKS links, TA_DESIGN_MS have gone on it, or the stack is at the top; then its swaps are pressed TA_STEP at a time, worked
  // out afresh each decision from the board as it is, and its trigger last. A design the board no longer holds is let go.)
  taLog = 0; taxMs = -1;
  // (A CHAIN GOING, TIME ATTACK: the extension given the decision's time, and its longest line -- up to 13 -- played, every decision the
  // chain falls; the panel-game puzzles' way: a chain is taken a link at a time, a swap a link, in the time its own clears stop the rise)
  if (ruleNoEnemy && !R->under && !R->topped && clockFrameOut && !clockFrameOut() && (cascadeLive(decQ.b) || decQ.b->chainCounter > 0)) {
    double keepDue = clockDue, keepShare = clockShare; clockDue = 0; clockShare = 0;
    double left = C2.due ? C2.due - C2.margin - nowMs() : 100, ms = left * 0.8; if (ms < 2) ms = 2;
    readyStop();
    List L; memset(&L, 0, sizeof L); L.n = 1; L.aim[0].chain.op = OP_GE; L.aim[0].chain.n = 2; L.aim[0].brk = -1;
    ExtOpts eo = { TA_EXT_WIDTH, TA_EXT_DEPTH, &L, NOT_ASKED, 0, ms };
    static Ext E; extend(&decQ, &eo, &E);
    taxBase = E.baseChain; taxLong = E.longest.set ? E.longest.chain : 0; taxN = E.longest.set ? E.longest.nseq : 0; taxMs = (int32_t)ms;
    if (E.longest.set && E.longest.nseq > 0) {
      static Judge CU; Cand k;
      if (candOf(&k, PLAY_EXTEND, E.longest.seq, E.longest.nseq, -1, 1)) {
        k.settled = 0; lastDrop = -1;
        // (never a sooner death: the extension in the rank's place only where it lives or its board is lost no sooner than the rank's line's
        // -- a chain taken on over a tower ends with the tower at the top)
        if (judgeCand(R, &k, &CU) && !CU.o.dead && (CU.o.lives || !P.line || diesAt(&CU) >= diesAt(P.line))) { P.line = &CU; taLog = 3; }
        else taLog = -20 - lastDrop;
      }
    }
    clockDue = keepDue; clockShare = keepShare;
  }
  else if (ruleNoEnemy && !R->under && !R->topped && clockFrameOut && !clockFrameOut() && !cascadeLive(decQ.b) && !R->pop) {
    double keepDue = clockDue, keepShare = clockShare; clockDue = 0; clockShare = 0;
    static CbGrid G; cbOfBoard(decQ.b, &G);
    if (taHave) { int sft = cbShiftOf(&G, &taD); if (sft < 0) { taReset(); taLog = -1; } else cbShiftUp(&taD, &G, sft); }
    int nfull = 0; for (int r = 1; r <= G.rows; r++) nfull += cbFull(&G, r);
    // (flattened and raised first -- the owner's order: a design is searched only on a board with TA_FULL full rows; till then the board
    // is played as any is, levelled and raised)
    if (!taOn && nfull < TA_FULL) { if (taHave) { taReset(); taLog = -4; } }
    else if (!taOn) {
      double left = C2.due ? C2.due - C2.margin - nowMs() : 100, ms = left * 0.7; if (ms < 2) ms = 2;
      readyStop();
      static CbGrid D; int32_t tr = 0; int links = 0, sw = 0;
      // (no more swaps than the board lives to press: the frames it has left alone, a swap's frames each, TA_MARGIN to spare)
      int32_t dies = R->F.known[FACT_US_DIES] && R->F.v[FACT_US_DIES] > 0 ? (int32_t)R->F.v[FACT_US_DIES] : NOT_ASKED;
      cbJMaxSw = imin(TA_MAXSW, dies == NOT_ASKED ? CB_MAXSWAPS : imax(1, (dies - TA_MARGIN) / TA_SWAP_FRAMES - 1));
      if (taHave && cbSwapsTo(&G, &taD) > cbJMaxSw) { taReset(); taLog = -3; }
      int32_t v = cbDesignAll(&G, taHave ? &taD : 0, ms, &D, &tr, &links, &sw);
      taMs += ms;
      if (tr && v > 0 && (!taHave || v >= taVal)) { taD = D; taTr = tr; taLinks = links; taSwaps = sw; taVal = v; taHave = 1; }
      if (taHave && (taLinks >= TA_LINKS || taMs >= TA_DESIGN_MS || panelTop(decQ.b) >= TA_TOP)) taOn = 1;
      // (and while it is searched, the board is left as it is -- a swap played meanwhile changes the rows the design is of -- unless it
      // is dying or raised: a raise only lifts the rows)
      else if (taHave && !R->taDying && !R->up && taHoldNoSooner(P.line, n)) P.line = 0;
    }
    // (both held to the engine's clock: the hold is put in the line's place only where it tops the board out no sooner -- an uneven stack
    // whose tall column a clear brings down is never held up while the rise takes it to the top)
    // (and till a design is on, nothing cleared on a board that lives -- the owner: flatten, raise, then the chain that uses every block; a
    // clear made on the way spends the panels the design is made of, and starts a chain too short to take to 13)
    if (!taOn && !R->taDying && P.line && taClears(P.line) && taHoldNoSooner(P.line, n)) P.line = 0;
    if (taOn) {
      int32_t seq[CB_MAXSWAPS + 1]; int n = cbOrder(&G, &taD, taTr, seq, CB_MAXSWAPS + 1);
      // (never a build the board does not live through -- the owner: you can't choose to die: the swaps left and the trigger, walked and
      // pressed, inside the frames the board has left alone with TA_MARGIN to spare -- the chain's clears stop the rise; else the design is
      // let go and the board is played for its life)
      int32_t dies = R->F.known[FACT_US_DIES] && R->F.v[FACT_US_DIES] > 0 ? (int32_t)R->F.v[FACT_US_DIES] : NOT_ASKED;
      if (n > 0 && dies != NOT_ASKED && dies < n * TA_SWAP_FRAMES + TA_MARGIN) { taReset(); taLog = -3; n = 0; }
      else if (n <= 0) { taReset(); taLog = -2; }
      else {
        int hand = n == 1 ? 1 : imin(TA_STEP, n - 1);
        static Judge CU; Cand k;
        if (candOf(&k, PLAY_ENTRY, seq, hand, -1, 0)) {
          k.settled = 1; lastDrop = -1;
          int jok = judgeCand(R, &k, &CU);
          if (jok && !CU.o.dead) { P.line = &CU; taStep = hand; taLog = n == 1 ? 2 : 1; if (n == 1) taReset(); }
          else { taLog = -10 - lastDrop; if (n == 1) taReset(); }
        }
      }
    }
    clockDue = keepDue; clockShare = keepShare;
  }
  P.name = P.line ? P.line->k.play : R->up ? -2 : PLAY_HOLD;   // -2: the raise
  for (int i = 0; i < n; i++) if (order[i]->o.lives) P.nlive++;
  P.ncands = n; orderN = n;
  // (the opener's trigger handed on now -- its line's last swap, or a plan or trigger it begins with nothing before: the chain it fires is
  // held to from here, its first clear and fall too)
  if (P.line && P.line->k.nseq == 1 && R->rule >= 0 && theTables.r[R->rule].table == 2 && ((opLineOn && P.line->carried) || chainUp >= 2)) opFiredAt = decQ.b->clock;
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
// (made: what the line was ranked as making when it was played -- the judge's count, or the search's word for a line whose board is lost
// during it (rank.c judgeCand): the rest of such a line is read on it too, carriedCand)
enum { WHY_NONE, WHY_CHAIN, WHY_COMBO, WHY_BREAK, WHY_TWIN, WHY_FLAT, WHY_ZIP, WHY_DROP, WHY_LIVE, WHY_READY };   // (WHY_NONE: no reason -- a bug)
typedef struct { int32_t kind, a, b; } Why;
typedef struct { int32_t set, id, nrest, rest[MAXLINE], risen[MAXLINE], settled, hasAim, broke, popping, ready, anchorRow, anchorCol, anchorId, waits, rule; Aim aim; Made made; Why why; } Carry;   // (rule: the mode it was begun in; why: the reason it was begun, the log's aim=)
static Carry theCarry;
static int carryHeld(void) { return theCarry.set; }
// THE BREAK A LINE LIVES BY, NEXT: a line played that lives only by a break in reach once everything lands (its readiness) carries that
// break too, to be the line in progress once the line's own swaps are pressed -- the next decisions need not find it again
static Carry theCarryNext;
static int carriedFromReady(void) { return theCarry.ready; }
#define CARRY_WAITS 2
static int carryWaitsOut(void) { return theCarry.waits >= CARRY_WAITS; }
static int32_t carryFrom = -1, carryPressed;
static Judged carryJ;   // (the line in progress as its own judging found it: the log's cj=)
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
// (WHY THE LINE PLAYED WAS NOT HANDED ON, for the log: 0 it was, 1 no line, 2 it waits, 3 nothing of it left, 4 a tier past the set-ups
// that breaks nothing, 5 no bottom-row panel to anchor it to; -1 none asked)
static int32_t carrySkip = -1;
// (THE LINE IN PROGRESS, WHERE IT BEGAN: the frame and the kind of line it was begun as -- carried on, it is played as `carry` from then on;
// the log's `from`, so a reader sees what the swap pressed now is for)
// (WHAT LAST LET THE LINE IN PROGRESS GO, for the log of a decision that found none carried (answer.c ended 16): 1-5 the decision before
// played no line to hand on (carrySkip's), 6 a hold's break in reach not anchored, 7 the mode changed, 8 a new game)
static int32_t carryClr;
// (A SAVE: the line played outlives the hold -- it lives where the hold does not, or both are lost and it is lost later. Its swaps after
// the first are what the board lives by, whatever its tier: the next decision is asked before they are pressed, often with little
// time, and without the line in progress its answer -- a hold -- takes their keys' place)
static int savesOverHold(const Judge *k) {
  const Judge *H = 0;
  for (int i = 0; i < orderN && !H; i++) if (order[i]->hold) H = order[i];
  if (!H || !k || k->hold || k->o.dead || H->o.lives) return 0;
  return k->o.lives || diesAt(k) > diesAt(H);
}
static void carryOf(const Read *R, const Judge *k, int32_t qid, int first) {
  pvKeep(k, first, qid);
  if (k && !k->carried && !k->hold) { carryBeganAt = decQ.b ? decQ.b->clock : -1; carryBeganPlay = k->k.play; }
  else if (!k) carryBeganAt = carryBeganPlay = -1;
  int32_t waits = k && k->k.play == PLAY_CARRYWAIT ? theCarry.waits + 1 : 0;
  Why keepWhy = k && k->carried ? theCarry.why : (Why){ WHY_NONE, 0, 0 };
  carrySave = k && !k->hold && ((k->carried && carrySave) || wastesThree(k));
  carryTwo = k && !k->hold && ((k->carried && carryTwo) || shortChain(k));
  memset(&theCarry, 0, sizeof theCarry);
  theCarry.why = keepWhy;
  theCarry.waits = waits; carriedSunk = -1;
  // (a line that breaks garbage is carried whatever its tier: under garbage while the break waits, a breaking line ranks in the last
  // tier, and its swaps after the first are the break it was chosen for)
  carrySkip = !k ? 1 : (k->wait && k->k.play != PLAY_CARRYWAIT) ? 2 : k->k.nseq < first + 1 ? 3 : (k->t.tier > 4 && !(k->apBroke > 0) && !savesOverHold(k)) ? 4 : 0;
  if (carrySkip) { carryClr = carrySkip; return; }
  int32_t row1[W + 1];
  for (int c = 1; c <= W; c++) row1[c] = anchorIdAt(decQ.b, c);
  if (!anchorOf(row1, k->k.seq, k->k.nseq)) { carrySkip = 5; carryClr = 5; return; }
  // (each swap kept in the rows of the board it was begun on: a swap the judge pressed after the stack rose is named in the rows of the
  // board it is pressed on, so the rows risen by then are taken off, and only the rows risen since the line began beyond those are put
  // back when it is carried on -- a rise foreseen is never counted twice)
  theCarry.set = 1; theCarry.id = qid; theCarry.nrest = k->k.nseq - first;
  for (int i = first; i < k->k.nseq; i++) { int32_t up = i < MAXLINE ? k->o.j.risen[i] : 0; theCarry.rest[i - first] = (CR(k->k.seq[i]) - up) * 8 + CC(k->k.seq[i]); theCarry.risen[i - first] = up; }
  theCarry.settled = k->settled; theCarry.broke = k->apBroke > 0; theCarry.popping = popLeft(decQ.b) > 0;
  theCarry.made = (Made){ k->apCombo, k->apChain, k->apBroke, k->k.x.cells };
  carriedSunk = lineWalk(k);
  if (k->aim >= 0) { theCarry.hasAim = 1; theCarry.aim = R->guides.aim[k->aim]; }
  theCarry.rule = R->rule;
}
static int32_t carryRule(void) { return theCarry.rule; }
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
  theCarryNext.settled = 0; theCarryNext.broke = 1; theCarryNext.ready = 1; theCarryNext.made = (Made){ 0, 0, 1, 0 };
}
static void carryReady(const Judge *H, int32_t qid) {
  const Judged *j = &H->o.j;
  if ((!H->hold && H->k.nseq != 1) || H->o.ready != 1 || j->readyN < 1) return;
  memset(&theCarry, 0, sizeof theCarry);
  if (!anchorOf(j->readyRow1, j->readyLine, j->readyN)) { carryClr = 6; return; }
  theCarry.set = 1; theCarry.id = qid; theCarry.nrest = j->readyN;
  for (int i = 0; i < j->readyN; i++) theCarry.rest[i] = j->readyLine[i];
  theCarry.settled = 0; theCarry.broke = 1; theCarry.popping = popLeft(decQ.b) > 0; theCarry.ready = !H->hold; theCarry.made = (Made){ 0, 0, 1, 0 };
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
    // (a line taken from a chain falling or a slab popping is timed to it: the board a decision later is not the one it was found on)
    if (I->play == PLAY_EXTEND || I->play == PLAY_LINEUP) continue;
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
    if (J->wait || J->o.dead || !clearsSomething(J) || !J->settled || J->k.route || J->k.play == PLAY_EXTEND || J->k.play == PLAY_LINEUP) continue;
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
// press, 3 it no longer breaks and its swaps pressed did not, 4 it no longer makes what it was begun for)
static int carryDrop;
static int carryLate;   // (the line in progress dropped only because the clock stopped its judging: answer.c gives no answer then)
// (and for the log, the line dropped: the steps it had left, and for 2 how the judge ended it -- cut at, the steps it pressed)
static int32_t carryDropN, carryDropRest[MAXLINE], carryDropDead, carryDropCut, carryDropWhy, carryDropNats;
// (WHY NO LINE IN PROGRESS WAS OFFERED, for the frame loop's count of what ended its line -- answer.c ended: 0 one was; 16 none was
// carried by the last answer; 17 the frame loop asked on another line than the one carried; 18 every swap of it pressed; 19 the judge
// gave no judgement of it; 20 it wastes a three the save did not confirm; 21 the mode's list asks nothing)
// THE PLAN'S BOARD CHECKED (the log's pv=): the board the decision that played the line in progress was asked on, the swaps of it
// pressed since pressed on it as soon as the board lets them, run on to this frame -- against the board as it is: pv=same, or the first
// thing that differs
static Board *pvBoard; static Question pvQ; static int32_t pvSeq[MAXLINE], pvN, pvFirst;
static void pvKeep(const Judge *k, int first, int32_t qid) {
  // (a hold or a wait keeps the line before it: nothing is pressed, and the board it foresaw is checked on)
  if (!k || k->hold || !decQ.b) return;
  pvSet = 0; pvId = qid; pvNew = 1;
  if (!pvBoard) pvBoard = nb_new();
  if (!pvBoard) return;
  cloneBoard(pvBoard, decQ.b); pvQ = decQ; pvQ.b = pvBoard; pvN = imin(k->k.nseq, MAXLINE); for (int i = 0; i < pvN; i++) pvSeq[i] = k->k.seq[i]; pvFirst = first; pvSet = 1;
}
#define PV_UNSEEN_ROWS 70   // (unseenRows' place in pa.c HEAD, unseenBreaks after it)
static void pvCheckIn(int32_t skip) {
  pvKind = 0;
  int32_t pressed = pvFirst + skip;
  if (!pvSet || pressed <= 0 || pressed > pvN) return;
  Question q = pvQ;
  static Ctx *pvCtx; Ctx *x = pvCtx = ctxOf(pvCtx);   // (its own nodes: the judge's are read on after it)
  int n = rootOf(x, &q);
  for (int i = 0; n >= 0 && i < pressed; i++) {
    int from, out = pressWalk(x, n, MK_SWAP, CR(pvSeq[i]), CC(pvSeq[i]), stepTapped, &from);
    n = liveNode(x, out) ? out : -1;
  }
  if (n < 0 || !liveNode(x, n)) { pvKind = 2; return; }
  int t = decQ.b->clock - pvBoard->clock - NODE(x, n)->t;
  if (t < 0) { pvKind = 3; pvV[0] = -t; return; }
  if (t > 0) n = step(x, n, MK_LONG, 0, 0, t);
  const Board *p = liveNode(x, n) ? ensureBoard(x, n) : 0, *b = decQ.b;
  if (!p) { pvKind = 4; return; }
#define PV(k, a, bb) do { pvKind = (k); pvV[0] = (a); pvV[1] = (bb); return; } while (0)
  if (p->clock != b->clock) PV(5, p->clock, b->clock);
  if (p->nrows != b->nrows) PV(6, p->nrows, b->nrows);
  if (p->riseTimer != b->riseTimer) PV(11, (int32_t)(p->riseTimer * 1000), (int32_t)(b->riseTimer * 1000));
#undef PV
  // (every field of the stack's head, as the host loads it -- pa.c HEAD: 10 its index there, riseTimer first -- but the count of rows
  // and breaks dealt unseen, which the host does not keep)
  { int hi = 1;
#define PVH(f, lua) if ((double)p->f != (double)b->f && hi != PV_UNSEEN_ROWS && hi != PV_UNSEEN_ROWS + 1) { pvKind = 10; pvV[0] = hi; pvV[1] = (int32_t)p->f; pvV[2] = (int32_t)b->f; return; } hi++;
    HEAD(PVH)
#undef PVH
  }
  // (and every field of every panel, the row coming up included -- 9: row, column, field, foreseen, real)
  for (int r = 0; r < p->nrows; r++) for (int c = 1; c <= W; c++) for (int f = 0; f < NF; f++) {
    if (f == COLOR && p->p[r][c].f[COLOR] >= 30) continue;
    if (p->p[r][c].f[f] != b->p[r][c].f[f]) { pvKind = 9; pvV[0] = r; pvV[1] = c; pvV[2] = f; pvV[3] = p->p[r][c].f[f]; pvV[4] = b->p[r][c].f[f]; return; }
  }
  pvKind = 1;
}
// (a log's check, never the decision's: run whatever the clock says, and its work not charged to the decision)
static void pvCheck(int32_t skip) {
  int64_t w0 = clockWork;
  __atomic_store_n(&clockIgnore, 1, __ATOMIC_RELAXED);
  pvCheckIn(skip);
  __atomic_store_n(&clockIgnore, 0, __ATOMIC_RELAXED);
  clockWork = w0;
}
static int carriedCand(const Read *R, Cand *k, int *wait) {
  Carry *C = &theCarry;
  *wait = 0; carryDrop = 0; carryLate = 0;
  carryNone = !C->set ? 16 : C->id != carryFrom ? 17 : 0;
  int skip = C->id == carryFrom ? carryPressed : 0;
  if (C->set && C->nrest <= skip && theCarryNext.set) {
    // (the line's own swaps all pressed: the break it lived by is the line in progress now, popping or not as the board is now)
    *C = theCarryNext; memset(&theCarryNext, 0, sizeof theCarryNext); carriedSunk = -1; C->popping = popLeft(decQ.b) > 0; skip = 0;
  }
  if (C->set && C->nrest <= skip) carryNone = 18;
  if (!C->set || C->nrest <= skip) return 0;
  int dr = NOT_ASKED;
  // (from the row not yet risen: the board a waited-for break was found on may have risen past this one)
  for (int r = 0; r < decQ.b->nrows && dr == NOT_ASKED; r++) if (decQ.b->p[r][C->anchorCol].f[ID] == C->anchorId) dr = r - C->anchorRow;
  if (dr == NOT_ASKED) { carryDrop = 1; return 0; }
  int32_t rest[MAXLINE], nrest = C->nrest - skip;
  // (each swap named on the board as it is now: the rows risen since; the judge presses it where its panels have risen to by the frame
  // it is pressed -- rooted -- and the line is handed on named so, the rows the stack rose while it was pressed put back)
  for (int i = 0; i < nrest; i++) rest[i] = (CR(C->rest[skip + i]) + dr) * 8 + CC(C->rest[skip + i]);
  // (judged as every line is -- one replayer, what the line makes counted one way -- each step settled when the line was begun so; a
  // settled line waits while the board still moves)
  // (a settled line's next step is pressed on the board settled from the step before, as it was judged: on a board still moving the
  // step is judged once it has settled -- waitTo -- not cut for a walk that cannot begin within a reaction; and a break the readiness
  // found, on the board once everything lands, is pressed on that board: on one still moving it waits as a settled line does)
  int moving = (C->settled || C->ready) && (hasActivePanels(decQ.b) || decQ.b->swappingCount > 0);
  JudgeOpts jo = { C->settled, decQ.tight, NOT_ASKED, 0, 0, -1, 0, 0, 0, moving ? 1 : 0, 0, 1 };
  Judged j;
  judge(&decQ, rest, nrest, &jo, &j);
  for (int i = 0; i < j.nats && i < nrest; i++) rest[i] = (CR(rest[i]) + j.risen[i]) * 8 + CC(rest[i]);
  carryJ = j;
  carryDropN = nrest; for (int i = 0; i < nrest; i++) carryDropRest[i] = rest[i];
  // (a step no longer legal: the judge pressed fewer than the line has. A line the board is lost on is offered all the same -- judged
  // lost, as any line is, and ranked by its loss: where every line is lost, the line in progress may be lost latest)
  if (!j.dead && j.nats < nrest) { carryDrop = 2; carryLate = j.late || clockOut(); carryDropDead = -1; carryDropCut = j.cut; carryDropWhy = j.cutWhy; carryDropNats = j.nats; return 0; }
  *wait = moving;
  // (the chain as the game counts it -- one already falling is the line's, begun by its first swap -- as the list's check counts it)
  // (A REST THE BOARD IS LOST DURING is read on what the line was played as making, as the rank reads a line the judge could not play
  // out on the search's word (rank.c judgeCand). The judge and the rank then say of this line what they said when it was begun; the
  // next judging ranks it by its loss, as any line lost)
  // (but not for a line that has waited out (carryWaitsOut): nothing of it is pressed while it waits, and read on the search's word it
  // would be the break first every decision it waits. It is read on the judge's count, which counts the step the board is lost in up
  // to the frame before (judge.c): a break made and the board lost in the settle after it is a break made, and the line is carried on)
  Made x = j.dead && !(moving && carryWaitsOut()) ? C->made : (Made){ j.made.combo, imax(j.made.chain, j.chainAll), j.made.broke, 0 };
  int32_t done = j.done, fire = j.fire, nats = j.nats, ats[MAXLINE];
  for (int i = 0; i < nats; i++) ats[i] = j.ats[i];
  // (a line begun for a break whose swaps pressed so far made it -- the slab popping now, none when it was begun -- is carried on for
  // what the rest of it makes: the rest is what the line was judged to live by)
  if (C->broke && !(x.broke > 0) && !(!C->popping && popLeft(decQ.b) > 0)) { carryDrop = 3; return 0; }
  // (the rest no longer meeting the entry it was begun for -- the swaps pressed so far made part of it -- it is carried on for no entry,
  // ranked as the line in progress is: rank.c 1a)
  int aimGone = C->hasAim && !meets(&C->aim, x);
  if (aimGone) carryDrop = 5;
  int aim = -1;
  if (C->hasAim && !aimGone) for (int i = 0; i < R->guides.n && aim < 0; i++) if (!memcmp(&R->guides.aim[i], &C->aim, sizeof(Aim))) aim = i;
  if (!candOf(k, *wait ? PLAY_CARRYWAIT : PLAY_CARRY, rest, nrest, aim, 0)) return 0;
  k->settled = C->settled;
  k->x.combo = x.combo; k->x.chain = x.chain; k->x.broke = x.broke; k->x.cells = x.cells; k->xDone = done; k->xFire = fire;
  k->xNats = nats; for (int i = 0; i < nats; i++) k->xAts[i] = ats[i];
  return 1;
}
// WHY THE MOVE PLAYED (the log's aim=, every decision that presses a swap -- the owner: no move without its reason): what the line makes,
// or for a move that shapes the stack the shape it leaves, or what the board it leaves fires one swap on, or the combo a set-up sorts;
// none of them is a move made for nothing -- a bug, logged as such
static int32_t bumpOf(const Board *b) {
  int32_t hg[W + 2] = { 0 }, bump = 0;
  for (int c = 1; c <= W; c++) for (int r = 1; r < b->nrows; r++) if (b->p[r][c].f[COLOR] > 0 || b->p[r][c].f[ISGARBAGE]) hg[c] = r;
  for (int c = 1; c < W; c++) bump += iabs(hg[c] - hg[c + 1]);
  return bump;
}
static Ctx *whyCtx;
#define WHY_TRIES 6   // (the lines after the one chosen asked for a reason, where it has none)
static int32_t noReason;
static Why whyPlayed;   // (the reason of the move played, measured when it was chosen: the log's aim=)   // (the log's: 1 the line chosen had no reason and the next with one was played, 2 none had one and the hold was)
static Why moveWhy(const Judge *L) {
  Why w = { WHY_NONE, 0, 0 };
  if (!L || L->hold || L->k.nseq < 1) return w;
  int play = L->k.play;
  // (what it makes, the line itself)
  int shapes = play == PLAY_LEVEL || play == PLAY_ZIP || play == PLAY_SURVIVE || play == PLAY_READY || play == PLAY_TOWARD;
  if (!shapes || L->apBroke > 0) {
    // (a line that breaks garbage with a chain of two is for the break: the 2x is what the dig makes, never its goal)
    if (L->apBroke > 0 && L->apChain <= 2) { w.kind = WHY_BREAK; w.a = L->apBroke; return w; }
    if (L->apChain >= 2) { w.kind = WHY_CHAIN; w.a = L->apChain; return w; }
    if (L->apBroke > 0) { w.kind = WHY_BREAK; w.a = L->apBroke; return w; }
    if (L->apCombo >= 3 && !shapes) { w.kind = WHY_COMBO; w.a = L->apCombo; return w; }
  }
  if (L->k.drop) { w.kind = WHY_DROP; return w; }
  // (the board it leaves: every swap played, settled -- after the decision, outside its clock)
  __atomic_store_n(&clockIgnore, 1, __ATOMIC_RELAXED);
  Ctx *x = whyCtx = ctxOf(whyCtx);
  int nd = rootOf(x, &decQ), n0 = nd;
  for (int q = 0; q < L->k.nseq && liveNode(x, nd); q++) { int o = step(x, nd, MK_SETTLE, CR(L->k.seq[q]), CC(L->k.seq[q]), 0); if (!liveNode(x, o)) break; nd = o; }
  const Board *eb = liveNode(x, nd) ? ensureBoard(x, nd) : 0;
  if (eb && play == PLAY_LEVEL) { w.kind = WHY_FLAT; w.a = bumpOf(decQ.b); w.b = bumpOf(eb); }
  else if (eb && play == PLAY_ZIP) { w.kind = WHY_ZIP; w.a = spreadOf(decQ.b); w.b = spreadOf(eb); }
  else if (play == PLAY_READY || play == PLAY_TOWARD) { w.kind = WHY_READY; w.a = L->k.readyGain > 0 ? L->k.readyGain : 1; }
  else if (play == PLAY_SURVIVE) {
    const Judge *H = 0; for (int i = 0; i < orderN && !H; i++) if (order[i]->hold) H = order[i];
    w.kind = WHY_LIVE; w.a = H && !H->o.lives && !L->o.lives ? (int32_t)(diesAt(L) - diesAt(H)) : 0;
    w.b = H && !H->o.lives && L->o.lives ? 1 : !H || H->o.lives || w.a <= 0 ? 2 : 0;   // (1 it lives where the hold does not, 2 it gains nothing on the hold: the log's)
  }
  if (w.kind == WHY_NONE && eb && nd != n0) {
    // (what the board it leaves fires one swap on: the longest chain, else the biggest combo)
    static int32_t ms[MAXROWS * W];
    int m = swapsOfNode(x, nd, ms), bestX = 0, bestC = 0;
    for (int i = 0; i < m; i++) {
      int o = step(x, nd, MK_SETTLE, CR(ms[i]), CC(ms[i]), 0);
      Stats st; if (!liveNode(x, o) || !statsOf(x, o, &st)) continue;
      for (int c = 0; c < st.n && c < MAXCOMBOS; c++) { if (st.chainAt[c] > bestX) bestX = st.chainAt[c]; if (st.size[c] > bestC) bestC = st.size[c]; }
    }
    if (bestX >= 2) { w.kind = WHY_CHAIN; w.a = bestX; }
    else if (L->k.aimC > 0 && L->k.aimLeft > 1) { w.kind = WHY_TWIN; w.a = L->k.aimC; w.b = L->k.aimLeft; }
    else if (bestC >= 3) { w.kind = WHY_COMBO; w.a = bestC; }
  }
  if (w.kind == WHY_NONE && L->k.aimC > 0) { w.kind = WHY_TWIN; w.a = L->k.aimC; w.b = L->k.aimLeft; }
  ns_reset(x);
  __atomic_store_n(&clockIgnore, 0, __ATOMIC_RELAXED);
  // (and the board's life: a line that lives where the hold does not, or is lost later than the hold, is pressed for the frames it buys)
  if (w.kind == WHY_NONE && !L->o.dead) {
    const Judge *H = 0; for (int i = 0; i < orderN && !H; i++) if (order[i]->hold) H = order[i];
    if (H && !H->o.lives && (L->o.lives || diesAt(L) > diesAt(H))) { w.kind = WHY_LIVE; w.a = L->o.lives ? 0 : (int32_t)(diesAt(L) - diesAt(H)); w.b = L->o.lives ? 1 : 0; }
  }
  return w;
}
