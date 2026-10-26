// THE JUDGE (plans/decision.md step 3): a line played on the engine as the game will press it --
// `settled`, each step once the board has settled from the last (a planned line); else every step at once, one after the other, the
// board then let settle -- each swap pressed when the frame loop presses it (tight: walked held from two cells, pressDelay). What it
// makes is counted over every step and the settle after: the largest match, the longest chain, the garbage broken -- beyond what the
// board left alone makes (a chain already falling is the line's only when the line adds a link to it; a slab already popping converts
// its panels whatever is pressed).
//
// A step not legal ends the judging there, as a board lost does. Every step is the clock's (step(), core/nodes.h): a judging the clock
// stops comes back `late`, and is no answer.

#define MAXLINE 64
#define NOT_ASKED (-1)   // a readiness not asked, or not finished in time
#define FOREVER 0x7fffffff
#define LOST_FIRST 2     // breaksAfterLanding: the board is lost before everything lands   // a board that stands to the horizon: lostAt

typedef struct {
  int32_t settled, tight;
  int32_t readyAt;                   // frames from now the next block lands (NOT_ASKED: no readiness)
  int32_t readyIfLost, readyIfBreak; // readiness only when the board does not stand to lifeTo -- always, or for a line that breaks
  int32_t lifeTo, lifeRest;          // lostAt: whether the board the line ends on stands to lifeTo, and lifeRest past its last swap (-1: not asked)
  int32_t why;                       // keep the line the readiness found (readyLine)
  int32_t waitAt, waitTo;            // (waitTo > 0) before swap waitAt, the board run to frame waitTo and let settle -- a readiness break
                                     // played where the readiness found it
  int32_t lifeStop;                  // lostAt asked past the stop and shake the line ends on too (dropAt + lifeRest): a board held up by a
                                     // stop stands only if it outlives it
  int32_t nmore;                     // (and more waits so, each before swap moreAt[i], run to frame moreTo[i]: a plan's later breaks, each
  const int32_t *moreAt, *moreTo;    // played where its readiness found it -- outcome.c readyNextOf)
  int32_t pressAt0;                  // (> 0: the first swap's walk begins no sooner than this frame -- a line in progress, pressed as the frame
                                     // loop presses it, on the frame it was judged pressed from: decide.c carriedCand)
} JudgeOpts;
typedef struct {
  Made made;                    // beyond the board left alone: { combo, chain, broke }
  int32_t keepsChain;           // the board's own chain reached by the frame it reaches it left alone (ownChainBy): 1, 0, -1 not asked
  Made whole;                   // what the board ends up making with the line played, the chain already under way included (garbage
                                // broken still counted beyond the board left alone): a line that cuts a chain short makes the shorter one
  int32_t aloneChain;           // the chain the board left alone makes
  int32_t chainAll;             // the chain the line reaches as the game counts it (the chain already falling and every link after it)
  int32_t singles[MAXCOMBOS], nsingles;   // sizes of 4 or more the line clears as a clear of its own, no link of a chain
  int32_t threes;               // WASTED THREES: the line's clears of three that break nothing and begin no chain, beyond the board left alone's
  int32_t blocks;               // THE BLOCKS THE LINE THROWS, every attack its own (rules.c blocksOf): each clear of four or more a combo's
                                // pieces, each chain a slab a link past the first -- a line that fires two ideas throws both -- beyond what
                                // the board left alone throws
  int32_t dropAt;               // the frame garbage can next drop once the line is over
  int32_t dead, deadAt, done, fire, nats, ats[MAXLINE];
  int32_t lostAt;               // FOREVER, a frame, or NOT_ASKED
  int32_t ready;                // 1, 0, or NOT_ASKED
  int32_t readyLine[MAXLINE], readyN; // the swaps the readiness found (why), as r * 8 + c
  int32_t readyWait;            // the frame from the root the readiness looked from (its waitTo)
  int32_t readyPend;            // the landed board kept for the decision's readiness, its index + 1 (search/break.c readyPendOf); 0 none
  int32_t readyMat;             // the material that board has -- its panels under the lowest garbage once everything shown has landed
  int32_t readyTop;             // and that board's top row (the stack's height, a panel or garbage): its room is the rows over it
  int32_t readyContact, readyUnder;   // and its columns under garbage, and of them those whose top panel touches it (contactOn); -1 not asked
                                // (facts.c materialOn), -1 not asked: what the next breaks are made of
  int32_t readyNear;            // the swaps to the nearest break on that board by the shape math (breakNear, NEAR_MISS none; 0 no
                                // garbage), -1 not asked
  int32_t readyRow1[W + 1];     // the panel ids of the bottom row of the board the readiness break was found on (what anchors it)
  int32_t late;                 // the clock stopped it: no answer
  int32_t firstMade;            // what the line's first swap made, as the swap back reads it (madeBy)
  int32_t leftEnd;              // the actions the input window leaves once the line's swaps are pressed (allowLeftAt; -1 none said)
  int32_t netPanels;            // THE MATERIAL LEDGER: garbage cells the line converts less the panels its clears take, beyond the board left
                                // alone -- what the line leaves the next break made of (rank.c, under the floor)
  int32_t spent, endAt;         // the actions the line's swaps spend, and the frame from the root its last is pressed by (outcome.c leftAtLanding)
  int32_t aliveTo;              // and the frame from the root the board was judged alive to when it did (0: none)
  int32_t cut;                  // the step a swap was not there to press at (the line played no further), -1 none
  int32_t cutWhy;               // why: 1 its walk over the allowance, 2 no swap there to press, 3 a first walk not begun within a reaction
  int32_t base;                 // the garbage the board left alone breaks, which the line's own is counted beyond
  int32_t endNode;              // the node the line ends on, in judgeCtx (until the next judging)
} Judged;

static LOCAL Ctx *judgeCtx;   // the judge's own nodes: a search can ask it while its own nodes stand


// THE LIST FOR ONE STEP (attacker stepFits): its own clears, each no link of a chain, and the chain it reaches -- held to the list when
// the decision has handed the searches one (listOn)
static int32_t listOn;
// the break search's lines are held to the list unless it ends by "default" (every list under garbage): there a break is the default's own
static LOCAL int32_t listDefault;
#define BREAK_LIST (listOn && !listDefault)
// Whether the list wants a chain longer than `chain`: an entry a longer chain (within MAXCHAIN) meets.
static int listWantsLonger(const List *L, int32_t chain) {
  for (int i = 0; i < L->n; i++) {
    const Aim *a = &L->aim[i];
    if (!a->chain.op) continue;
    for (int32_t c = chain + 1; c <= MAXCHAIN; c++) if (test(c, a->chain)) return 1;
  }
  return 0;
}
// THE ONE RULE, for whatever list a mode passes -- the list is the mode's priorities, in order, and the only thing a mode changes: after
// its entries, A THREE THAT BREAKS GARBAGE (one clear of three, no chain as the game counts it -- chainAll: the chain the board is in);
// and LAST OF ALL, as they cost the board's panels, a clear that makes a chain or a combo the list does not ask for. Nothing else clears.
// The step check (stepFitsAt) and the line's (outcome.c fitsList) ask it; rules.c withRule puts the three in the searches' list and the
// order's, after the entries; a last resort is outside the list (rank.c), ranked after every line within it.
static int breakingThree(Made m, int32_t chainAll) { return m.broke > 0 && m.combo <= 3 && chainOf(m) <= 1 && chainAll <= 1; }
static int lastResort(Made m, int32_t chainAll) { return m.combo >= 4 || imax(chainOf(m), chainAll) >= 2; }
// A CHAIN BEGUN TOWARD THE LIST: a chain the list wants longer than (within MAXCHAIN) is a beginning of one it asks for -- a chain is
// carried on by the decisions after (extend), so one short of the ask is on its way to it, not outside it. A step's (stepFitsAt) and a
// whole line's (outcome.c fitsList) the same.
static int chainBegins(const List *L, int32_t chain) { return chain >= 2 && chain <= MAXCHAIN && listWantsLonger(L, chain); }
// A STEP WITHIN THE RULE: an entry, a three that breaks, a last resort -- or a plain three on a board still falling, a chain's first
// link; the whole line is held to the rule as it ends (lineFits).
static int stepFitsAt(Ctx *x, int i) {
  if (!listOn) return 1;
  Stats s;
  if (!statsOf(x, i, &s)) return 0;
  int32_t own[MAXCOMBOS], n = 0;
  for (int j = 0; j < s.n; j++) if (!(s.chainAt[j] > 1)) own[n++] = s.size[j];
  int32_t chain = chainOfStats(&s);
  int32_t biggest = 0;
  for (int k = 0; k < n; k++) if (own[k] > biggest) biggest = own[k];
  Made sm = { biggest, chain, s.broke, 0 };
  if (breakingThree(sm, chain) || stepFits(&theList, own, n, chain)) return 1;
  if (chain > MAXCHAIN) return 0;
  if (lastResort(sm, chain)) return 1;
  Board *b = ensureBoard(x, i);
  return b && boardMoving(b);
}
static int settleOf(Ctx *x, int i) { return step(x, i, MK_SETTLE, 0, 0, 0); }
// (a step's wasted threes: its clears of three, no link of a chain, in a step that breaks nothing and makes no chain)
// A WASTED THREE -- the one test, the judge's (firstThree) and the press guard's (front.c wastedSwap): g the board on the frame its swap
// is pressed, a the same board with it not pressed, both played on FIRST_LOOK frames side by side -- the first clear g makes that a does
// not (the panels matched on the first frame any are, as the game counts a clear), exactly three, none beside garbage -- and then on till
// both are still (THREE_SETTLE at most): g's fall no longer a chain than
// a's. g and a are played on (the caller's copies).
#define FIRST_LOOK 30
static int garbageCells(const Board *b) { int n = 0; for (int r = 1; r < b->nrows; r++) for (int c = 1; c <= W; c++) n += !!b->p[r][c].f[ISGARBAGE]; return n; }
#define THREE_SETTLE 400
static int wastedThree(Board *g, Board *a) {
  static LOCAL int32_t was[MAXROWS * W * 2], got[MAXROWS * W * 2];
  int nw = 0, ng = 0, touch = 0, first = -1;
  static const int DR[4] = { 1, -1, 0, 0 }, DC[4] = { 0, 0, 1, -1 };
  for (int f = 0; f < FIRST_LOOK && g->gameOverClock <= 0; f++) {
    run(g); run(a); g->input = a->input = 0; g->pressSwap = a->pressSwap = 0;
    for (int r = 1; r < a->nrows; r++) for (int c = 1; c <= W; c++) {
      const int32_t *p = a->p[r][c].f;
      if (p[STATE] != MATCHED || p[ISGARBAGE]) continue;
      int old = 0; for (int q = 0; q < nw && !old; q++) old = was[q] == p[ID];
      if (!old && nw < MAXROWS * W * 2) was[nw++] = p[ID];
    }
    for (int r = 1; r < g->nrows; r++) for (int c = 1; c <= W; c++) {
      const int32_t *p = g->p[r][c].f;
      if (p[STATE] != MATCHED || p[ISGARBAGE]) continue;
      int old = 0; for (int q = 0; q < nw && !old; q++) old = was[q] == p[ID];
      for (int q = 0; q < ng && !old; q++) old = got[q] == p[ID];
      if (old || ng >= MAXROWS * W * 2 || (first >= 0 && f != first)) continue;
      first = f; got[ng++] = p[ID];
      for (int d = 0; d < 4; d++) { int rr = r + DR[d], cc = c + DC[d]; if (rr >= 1 && rr < g->nrows && cc >= 1 && cc <= W && g->p[rr][cc].f[ISGARBAGE]) touch = 1; }
    }
  }
  // (a panel of the three the board alone matches later is the board's own, not the swap's)
  int n = 0; for (int q = 0; q < ng; q++) { int own = 0; for (int k = 0; k < nw && !own; k++) own = was[k] == got[q]; n += !own; }
  if (n != 3 || touch) return 0;
  int32_t gc = g->chainCounter, ac = a->chainCounter;
  for (int k = 0; k < THREE_SETTLE && g->gameOverClock <= 0; k++) {
    run(g); if (a->gameOverClock <= 0) run(a);
    gc = imax(gc, g->chainCounter); ac = imax(ac, a->chainCounter);
    if (!boardMoving(g) && !boardMoving(a)) break;
  }
  return !(gc >= 2 && gc > ac);   // (its fall made a link the board's own did not)
}
// THE FIRST SWAP'S OWN CLEAR (the line's wasted three, as the game makes it): the board the swap is pressed on beside the board left
// alone as long, by the one test
static int32_t firstThree(Ctx *x, int root, int mr, int mc) {
  int a = step(x, root, MK_SWAP, mr, mc, 0);
  if (!liveNode(x, a)) return 0;
  int al = NODE(x, a)->t > NODE(x, root)->t ? step(x, root, MK_LONG, 0, 0, NODE(x, a)->t - NODE(x, root)->t) : root;
  const Board *ba = ensureBoard(x, a), *bl = liveNode(x, al) ? ensureBoard(x, al) : 0;
  if (!ba || !bl) return 0;
  Board *g = nb_new(), *h = nb_new();
  int w = g && h ? (cloneBoard(g, ba), cloneBoard(h, bl), wastedThree(g, h)) : 0;
  if (g) nb_free(g);
  if (h) nb_free(h);
  return w;
}
// THE BOARD'S OWN CHAIN SPOILED -- the one test, the judge's (a swap of a line at a time) and the press guard's (front.c wastedSwap): the
// board at node n left alone to rest makes a chain of two or more, and with the swap at (mr, mc) pressed and let rest a shorter one, no
// more garbage broken -- the three that began the board's chain made for nothing, whatever the line's later swaps make
static int spoilsAt(Ctx *x, int n, int mr, int mc) {
  int al = settleOf(x, n), sw = step(x, n, MK_SETTLE, mr, mc, 0);
  Stats sa, ss;
  if (!liveNode(x, al) || !liveNode(x, sw) || !statsOf(x, al, &sa) || !statsOf(x, sw, &ss)) return 0;
  int32_t ca = sa.cleared > 0 ? chainOfStats(&sa) : 0, cs = ss.cleared > 0 ? chainOfStats(&ss) : 0;
  return ca >= 2 && cs < ca && ss.broke <= sa.broke;
}
// (a step's wasted threes, as the game's own count reads them (front.c countAttacks), a clear at a time: a clear of three that is no link
// of a chain and has no garbage joined to it -- and no chain's link after it in the step, which its fall may have made)
static int32_t threesOf(const Stats *s) {
  int32_t n = 0;
  for (int j = 0; j < s->n; j++) {
    if (s->size[j] != 3 || s->link[j] || s->touch[j]) continue;
    // (the link right after it makes it the first of a chain; a clear between that is no link begins a chain of its own -- a step long
    // enough holds the next chain too, and a three that stood alone is not made a link by one begun after)
    int later = 0; for (int q = j + 1; q < s->n && !later; q++) { if (s->link[q]) later = 1; else break; }
    if (!later) n++;
  }
  return n;
}

// (and the board it breaks on lives through the break's settle, its clears within the list)
static int settles(Ctx *x, int o) { int z = settleOf(x, o); return liveNode(x, z) && stepFitsAt(x, z); }
// READY ONCE EVERYTHING LANDS (attacker breaksAfterLanding): the board the line ends on run to `wait` frames after the root and let
// settle, then a break on it -- the break search's own answer (search/break.c readyBreak), bounded by its share of the time and by no
// count of swaps. 1, 0, LOST_FIRST when the board is lost before it lands, or NOT_ASKED when the clock stops it. why: the break's line.
// readyDefer: the break is not asked (NOT_ASKED), only whether the board lives to the landing -- the decision ranks first and asks it
// of the best-ranked in the time left (decide.c ranked).
static int32_t (*readyBreak)(Ctx *x, int n, int32_t *why, int32_t *whyN);
static int32_t readyPendOf(Ctx *x, int n);
static int readyDefer;
// readyCollect: and while it is deferred, the landed board kept -- searched once a decision, by whichever thread begins it
// (readyPendLast: which) -- and how near a break it is by the shape math (readyNearLast), what the decision asks it in the order of
static int32_t readyCollect; static LOCAL int32_t readyPendLast, readyNearLast, readyMatLast, readyTopLast, readyContactLast, readyUnderLast;
// (the columns of board b under garbage, and of them those whose top panel under their first garbage touches it -- search/bits.c
// bitsShape's contact, read on the board)
static void contactOn(const Board *b, int32_t *contact, int32_t *under) {
  *contact = *under = 0;
  if (!b) { *contact = *under = -1; return; }
  for (int c = 1; c <= W; c++) {
    int g = 0, pk = 0;
    for (int r = 1; r < b->nrows; r++) { const int32_t *f = b->p[r][c].f; if (f[ISGARBAGE]) { g = r; break; } if (f[COLOR]) pk = r; }
    if (g) { (*under)++; if (pk == g - 1) (*contact)++; }
  }
}
static int32_t materialOn(const Board *b); static int32_t topOn(const Board *b);   // (facts.c)
static int nearOf(const Board *b); static int garbageOn(const Board *b);   // (search/break.c)
static LOCAL int32_t readyRow1Buf[W + 1];
// A LINE'S ANCHOR: a bottom-row cell's id, where the cell is a coloured panel at rest -- an empty cell keeps its id too, and goes up
// the stack as each panel above it falls into its place (pa.c switchPanels), so a line anchored to one is found rows above where it was
static int32_t anchorIdAt(const Board *b, int c) {
  if (!b || b->nrows < 2) return NUL;
  const int32_t *f = b->p[1][c].f;
  return f[COLOR] && !f[ISGARBAGE] && f[STATE] == NORMAL ? f[ID] : NUL;
}
static int32_t breaksAfterLanding(Ctx *x, int n, int32_t wait, int32_t *why, int32_t *whyN) {
  readyPendLast = 0; readyNearLast = -1; readyMatLast = -1; readyTopLast = -1; readyContactLast = readyUnderLast = -1;
  // (a line that ends past the landing is ready from where it ends -- never a frame on: the same trajectory, asked from any root,
  // lands on the same board, so a break found on it once is found again by its key)
  int dt = wait - NODE(x, n)->t;
  int land = dt > 0 ? step(x, n, MK_LONG, 0, 0, dt) : n;
  if (!liveNode(x, land)) return clockOut() ? NOT_ASKED : LOST_FIRST;
  if (readyDefer && !readyCollect) return NOT_ASKED;
  int calm = settleOf(x, land);
  if (liveNode(x, calm)) land = calm;
  if (readyDefer) {
    Board *lb = ensureBoard(x, land);
    readyNearLast = lb ? (garbageOn(lb) ? nearOf(lb) : 0) : -1;
    readyMatLast = lb ? materialOn(lb) : -1; readyTopLast = lb ? topOn(lb) : -1; contactOn(lb, &readyContactLast, &readyUnderLast);
    readyPendLast = readyPendOf(x, land);
    return NOT_ASKED;
  }
  { Board *lb = ensureBoard(x, land); for (int c = 1; c <= W; c++) readyRow1Buf[c] = anchorIdAt(lb, c);
    readyMatLast = lb ? materialOn(lb) : -1; readyTopLast = lb ? topOn(lb) : -1; contactOn(lb, &readyContactLast, &readyUnderLast); }
  if (clockOut()) return NOT_ASKED;
  return readyBreak(x, land, why, whyN);
}

// A board lost left alone (attacker lostAlone): the first frame from the root the board at node n, left alone, is lost before `to` --
// FOREVER when it is alive at `to`.
static int32_t lostAlone(Ctx *x, int n, int32_t to) {
  int w = step(x, n, MK_LONG, 0, 0, imax(1, to - NODE(x, n)->t));
  if (w == STEP_DEAD) return deadAt;
  if (w < 0) return NOT_ASKED;   // (the clock stopped it, or the step was refused: no answer -- never a loss at 0)
  return NODE(x, w)->dead ? NODE(x, w)->t : FOREVER;
}
// (a step with the walk tapped, as the frame loop's keys are made before it holds them: where a press is taken -- pressWalk)
static int stepTapped(Ctx *x, int pi, int kind, int mr, int mc, int32_t frames) {
  int32_t t = pressTight; pressTight = 0;
  int r = step(x, pi, kind, mr, mc, frames);
  pressTight = t;
  return r;
}
// THE BOARD'S OWN CHAIN (ownChainOf, each decision a chain falls): the frame the board left alone makes its last link, and that link --
// a line keeps the chain only where its board has reached that link by that frame (keepsChain). The links of a chain the line begins
// count from 2 as the board's do (pa.c chainCounter), so what a line's clears make cannot tell them apart; the frame can.
static int32_t ownChainBy, ownChainN;
static LOCAL Ctx *chainCtx;
static void ownChainOf(const Question *q) {
  ownChainBy = ownChainN = 0;
  Ctx *x = chainCtx = ctxOf(chainCtx);
  int n = rootOf(x, q);
  if (n < 0) return;
  int32_t most = 0, at = 0;
  for (int f = 0; f < SETTLE_CAP; f++) {
    int w = step(x, n, MK_LONG, 0, 0, 1);
    if (!liveNode(x, w)) break;
    Board *b = ensureBoard(x, w);
    if (!b) break;
    if (b->chainCounter > most) { most = b->chainCounter; at = NODE(x, w)->t; }
    if ((most > 0 && b->chainCounter == 0) || (f > 3 && b->quiet && !b->chainCounter)) break;
    n = w;
  }
  if (most >= 2) { ownChainBy = at; ownChainN = most; }
}
// THE GARBAGE THE BOARD BREAKS ALONE BY FRAME t: the root left alone to t, its rows broken. A node breaks when it has broken more by its
// own frame -- the test every search grows a line by (break.c stillAt keeps it per frame) and the swap back reads (madeBy); the judge's
// count over a whole line is its settle against the board alone settled.
static int32_t aloneBrokeAt(Ctx *x, int root, int32_t t) {
  int w = t > NODE(x, root)->t ? step(x, root, MK_LONG, 0, 0, t - NODE(x, root)->t) : root;
  return NODE(x, liveNode(x, w) ? w : root)->brk;
}
// WHAT A SWAP MADE, as the swap back reads it (rules.c swapBack): 2 garbage broken beyond the board alone by then (aloneBrokeAt), 1 panels
// cleared, 0 nothing. Asked of a line's first swap's node: by the searches as they grow it, by the judge as it presses it
// (Judged.firstMade), which the rank and the readiness read.
static int madeBy(Ctx *x, int n, int root) { Stats st; if (!liveNode(x, n) || !statsOf(x, n, &st)) return 0; return NODE(x, n)->brk > aloneBrokeAt(x, root, NODE(x, n)->t) ? 2 : st.cleared > 0; }
// A LINE THAT WASTES A THREE, as the judge saw it: a clear of three it makes for nothing, or the board's own chain left short of the
// link it reaches alone (keepsChain) -- the one test the shared line check (outcome.c lineFits) and the order (rank.c wastesThree) ask
static int judgedWastes(const Judged *j) { return j->threes > 0 || (ownChainBy > 0 && j->keepsChain == 0); }
// A LINE THE JUDGE CUT SHORT -- a walk over the allowance, a swap no longer there, a walk not begun within a reaction -- on a board it
// lives on: the line pressed is not the line judged (asked by lineFits and by the order, rank.c judgeCand)
static int judgedCut(const Judged *j) { return !j->dead && j->cut >= 0; }
// THE JUDGE: the line seq (n swaps, r * 8 + c) from the question, as the options say.
// (THE LINE IN PROGRESS, every judging of it -- the rank's, its readiness, its plan -- pressed as the frame loop presses it: its first
// swap's walk begun no sooner than the frame it was judged pressed from when it was chosen; 0 any other line. decide.c carriedCand)
// A SWAP BACK IN A LINE: a swap that puts two panels back where one of the line's own swaps took them from -- the same two, by their
// ids, wherever the stack has risen them to -- undoes it, two swaps' actions for a wait. No line holds one: the judge cuts a line there
// (cutWhy 2, no swap there to press), and every search that grows a line a swap at a time grows none (search/break.c undoesMoved). A
// swap into a gap moves one panel, and is no pair to put back. (Moved: the line's latest MOVED_N pairs, a left of b before the swap)
#define MOVED_N 8
typedef struct { int32_t a, b; } MovedPair;
typedef struct { int32_t n; MovedPair p[MOVED_N]; } Moved;
static void movedAdd(const Board *b, int32_t mv, Moved *m) {
  if (!b) return;
  MovedPair p = { b->p[CR(mv)][CC(mv)].f[ID], b->p[CR(mv)][CC(mv) + 1].f[ID] };
  m->p[m->n % MOVED_N] = p; m->n++;
}
static int movedUndoes(const Board *b, int32_t mv, const Moved *m) {
  if (!b) return 0;
  int32_t l = b->p[CR(mv)][CC(mv)].f[ID], r = b->p[CR(mv)][CC(mv) + 1].f[ID];
  if (l == NUL || r == NUL) return 0;
  for (int i = 0; i < m->n && i < MOVED_N; i++) if (m->p[i].a == r && m->p[i].b == l) return 1;
  return 0;
}
static LOCAL int32_t lineAt0, lineWaitTo;   // (and lineWaitTo: its board run to that frame and let settle before its first swap)
static void judge(const Question *q, const int32_t *seq, int nseq, const JudgeOpts *o, Judged *j) {
  memset(j, 0, sizeof *j);
  j->lostAt = NOT_ASKED; j->ready = NOT_ASKED; j->threes = 0; j->fire = -1; j->cut = -1; j->cutWhy = 0; j->readyNear = -1; j->readyMat = -1; j->readyTop = -1; j->readyContact = -1; j->readyUnder = -1;
  Ctx *x = judgeCtx = ctxOf(judgeCtx);
  int root = rootOf(x, q), n = root;
  if (root < 0) { j->dead = 1; return; }
  int base = settleOf(x, root);
  int32_t baseChain = 0, baseCombo = 0, baseBroke = 0;
  Stats bs;
  int32_t baseThrees = 0, threes = 0, baseCleared = 0, cleared = 0;
  if (liveNode(x, base) && statsOf(x, base, &bs)) { baseBroke = bs.broke; baseCleared = bs.cleared; baseThrees = threesOf(&bs); if (bs.cleared > 0) { baseChain = chainOfStats(&bs); baseCombo = biggestOf(&bs); } }
  j->base = baseBroke;
  int32_t combo = 0, chain = 0, broke = 0, lastAt = 0, single[MAXCOMBOS + 64] = { 0 }, pieces = 0, links = 0;
  int32_t spent = 0, tight0 = pressTight;   // (the actions the line's swaps spend, and the decision's tightness, put back at the end)
  int kb = root;   // (the line's last node by ownChainBy)
  Moved moved = { 0 };   // (the pairs the line's swaps moved: movedUndoes)
#define KB(m) do { if (ownChainBy > 0 && liveNode(x, (m)) && NODE(x, (m))->t <= ownChainBy) kb = (m); } while (0)
  for (int k = 0; k <= nseq; k++) {
    int last = k == nseq, mr = last ? 0 : CR(seq[k]), mc = last ? 0 : CC(seq[k]);
    if (last && o->settled) break;   // (each step settled already)
    { int32_t to = o->waitTo > 0 && k == o->waitAt ? o->waitTo : k == 0 && !last ? lineWaitTo : 0;
      for (int m = 0; !to && m < o->nmore; m++) if (o->moreTo[m] > 0 && k == o->moreAt[m]) to = o->moreTo[m];
      if (to > 0) {
        int w = step(x, n, MK_LONG, 0, 0, imax(1, to - NODE(x, n)->t));
        if (w == STEP_NULL && clockOut()) { j->late = 1; break; }
        if (!liveNode(x, w)) { j->dead = 1; j->deadAt = w == STEP_DEAD ? deadAt : NODE(x, n)->t; break; }
        int calm = settleOf(x, w);
        n = liveNode(x, calm) ? calm : w;
        KB(n);
      } }
    int32_t at0 = o->pressAt0 > 0 ? o->pressAt0 : lineAt0;
    if (k == 0 && !last && at0 > NODE(x, n)->t) {
      int w = step(x, n, MK_LONG, 0, 0, at0 - NODE(x, n)->t);
      if (w == STEP_NULL && clockOut()) { j->late = 1; break; }
      if (!liveNode(x, w)) { j->dead = 1; j->deadAt = w == STEP_DEAD ? deadAt : NODE(x, n)->t; break; }
      n = w; KB(n);
    }
    // (the allowance this swap is pressed under: the input window at the frame its walk begins, less what the line's swaps before it
    // spent -- core/nodes.h allowLeftAt, actionsFor)
    if (!last && pressAllowance >= 0) {
      Board *bn = ensureBoard(x, n);
      int left = allowLeftAt(NODE(x, n)->t - NODE(x, root)->t, spent);
      pressTight = tightAt(left);
      int acts = bn ? actionsFor(bn->curRow, bn->curCol, mr, mc, left) : 0;
      // (THE PACE AT THIS SWAP: the wait after it as the window it is pressed in sets it -- the frame loop keys every swap with the pace of
      // the window at its frame (front.c fPace), so a line is judged pressed as it will be, at whatever decision it is judged)
      if (nWinAges >= 0) ns_ctx_gap(x, handsGap(paceGap(left, pressAllowance + nWinAges, winLen)));
      // (a swap whose walk is over what the window leaves at its frame is not there to press: the frame loop refuses a first swap's keys
      // -- front.c keysFit, GUARDED -- and drops a line at a later one -- front.c follow -- so the line is cut there)
      if (acts > left) { j->cut = k; j->cutWhy = 1; break; }
      spent += acts;
    }
    int kind = last || o->settled ? MK_SETTLE : MK_SWAP, out;
    if (last) out = step(x, n, kind, mr, mc, 0);
    else {
      // (pressed as the frame loop presses it, core/nodes.h pressWalk: a swap whose pair still moves is walked to from the first frame its
      // walk is taken on, found with the walk tapped as the frame loop's keys are, then pressed as the frame loop walks it -- held, when
      // tight; one refused on a still board is not there to press)
      int from;
      out = pressWalk(x, n, kind, mr, mc, stepTapped, &from);
      if (out == STEP_NULL && clockOut()) { j->late = 1; break; }
      if (out == STEP_NULL) { j->cut = k; j->cutWhy = 2; break; }
      if (from < 0) { j->dead = 1; j->deadAt = deadAt; break; }
      // (a line's first swap whose walk cannot begin within a reaction is one the frame loop does not press -- front.c keysOf refuses it:
      // not there; a later one is pressed from the frame its walk begins (ats), handed on with that frame, its keys made on the board
      // where the walk begins)
      if (k == 0 && NODE(x, from)->t - NODE(x, n)->t > cfgReaction) { j->cut = k; j->cutWhy = 3; break; }
      { Board *fb = ensureBoard(x, from); if (movedUndoes(fb, seq[k], &moved)) { j->cut = k; j->cutWhy = 2; break; } movedAdd(fb, seq[k], &moved); }
      if (pressTight && liveNode(x, out)) out = step(x, from, kind, mr, mc, 0);
      n = from; KB(n);
      if (j->nats < MAXLINE) j->ats[j->nats++] = NODE(x, n)->t;
    }
    // (a step the clock stopped is no answer: the judging is late, the line not lost)
    if (out == STEP_NULL && clockOut()) { j->late = 1; break; }
    if (!last && out == STEP_NULL) { j->cut = k; j->cutWhy = 2; break; }
    if (!liveNode(x, out)) {
      j->dead = 1; j->deadAt = out == STEP_DEAD ? deadAt : NODE(x, n)->t;
      // (a settle the board is lost in: what it made up to the frame before -- the board's own chain is made before it is lost, and a
      // hold judged dead must still say so: rank.c aloneChain)
      if (last && out == STEP_DEAD && j->deadAt - 1 > NODE(x, n)->t) {
        int w = step(x, n, MK_SETTLE, 0, 0, j->deadAt - 1 - NODE(x, n)->t);
        Stats sd;
        if (liveNode(x, w) && statsOf(x, w, &sd)) {
          for (int i = 0; i < sd.n; i++) if (sd.size[i] > combo) combo = sd.size[i];
          if (chainOfStats(&sd) > chain) chain = chainOfStats(&sd);
        }
      }
      break;
    }
    if (k == 0 && !last) j->firstMade = madeBy(x, out, root);
    Stats st;
    statsOf(x, out, &st);
    for (int i = 0; i < st.n; i++) { if (st.size[i] > combo) combo = st.size[i]; if (!(st.chainAt[i] > 1) && st.size[i] >= 4 && st.size[i] < MAXCOMBOS + 64) single[st.size[i]] = 1; }
    for (int i = 0; i < st.n; i++) if (!(st.chainAt[i] > 1)) pieces += blocksOf(st.size[i], 0);
    // (a settled step's chain ends in it, so each is an attack of its own; steps pressed at once are one chain, counted at its longest)
    if (o->settled || last) links += imax(0, chainOfStats(&st) - 1);
    if (chainOfStats(&st) > chain) chain = chainOfStats(&st);
    broke += st.broke; cleared += st.cleared; threes += threesOf(&st);
    // (A SWAP THAT SPOILS THE BOARD'S OWN CHAIN, a swap at a time: the board it is pressed on left alone to rest makes a chain of two or
    // more, and with the swap pressed and let rest a shorter one, no more garbage broken -- the three that began that chain made for
    // nothing, whatever the line's later swaps make; the press guard's test, front.c wastedSwap)
    if (!last && spoilsAt(x, n, mr, mc)) threes++;
    j->done = NODE(x, out)->t;
    if (!last) lastAt = j->done;
    n = out; KB(n);
  }
  pressTight = tight0;
  j->leftEnd = pressAllowance >= 0 && liveNode(x, n) ? allowLeftAt(NODE(x, n)->t - NODE(x, root)->t, spent) : -1;
  j->spent = spent; j->endAt = liveNode(x, n) ? NODE(x, n)->t - NODE(x, root)->t : 0;
  // (the board's own chain, kept: the line's board by the frame the chain's last link comes, the chain counter there. A settled line
  // presses its first swap at once and settles after it: that swap alone, run on to the frame; one that waits for the board first keeps
  // the chain by waiting)
  j->keepsChain = -1;
  if (ownChainBy > 0 && !j->late && nseq > 0) {
    if (o->settled && o->waitTo > 0 && o->waitAt == 0) j->keepsChain = 1;
    else {
      int at = kb;
      if (o->settled) { int from; at = pressWalk(x, root, MK_SWAP, CR(seq[0]), CC(seq[0]), stepTapped, &from); }
      int w = liveNode(x, at) && NODE(x, at)->t < ownChainBy ? step(x, at, MK_LONG, 0, 0, ownChainBy - NODE(x, at)->t) : at;
      Board *wb = liveNode(x, w) ? ensureBoard(x, w) : 0;
      j->keepsChain = wb && wb->chainCounter >= ownChainN ? 1 : 0;
    }
  }
#undef KB
  j->late = j->late || clockOut();
  // (the garbage the line breaks is what it breaks beyond the board left alone: a slab popping converts its panels whatever is pressed)
  j->made.combo = combo > baseCombo ? combo : 0; j->made.chain = chain > baseChain ? chain : 0; j->made.broke = imax(0, broke - baseBroke);
  j->whole = (Made){ combo, chain, j->made.broke, 0 }; j->aloneChain = baseChain;
  j->netPanels = j->made.broke - imax(0, cleared - baseCleared);
  j->chainAll = imax(chain, q->b->chainCounter);
  if (!o->settled) links = imax(links, imax(0, chain - 1));
  j->blocks = imax(0, pieces + links - blocksOf(baseCombo, baseChain));
  j->threes = imax(0, threes - baseThrees);
  // (and the first swap settled alone: a three it makes for nothing is wasted whatever the line does after -- a line pressed straight
  // through takes its first clear into a step its later chain is counted in, where the step's count does not see it)
  if (nseq > 0 && !j->threes) j->threes = firstThree(x, root, CR(seq[0]), CC(seq[0]));
  for (int z = 4; z < MAXCOMBOS + 64; z++) if (single[z] && j->nsingles < MAXCOMBOS) j->singles[j->nsingles++] = z;
  ns_ctx_gap(x, handsGap(__atomic_load_n(&decGap, __ATOMIC_RELAXED)));   // (the decision's pace again for what is searched from the line's end)
  Node *e = NODE(x, n);
  j->endNode = n;
  j->dropAt = j->dead ? 0 : e->t + imax(e->stopTime + e->preStopTime, e->shakeTime);
  j->fire = j->nats ? j->ats[j->nats - 1] : -1;
  if (o->lifeTo >= 0) j->lostAt = j->dead ? j->deadAt : lostAlone(x, n, imax(o->lifeTo, imax(lastAt, o->lifeStop ? j->dropAt : 0) + o->lifeRest));
  // (readiness, the dearer check, only when the board left alone does not stand to lifeTo -- always, or for a line that breaks)
  int standsOut = j->lostAt == FOREVER && (o->readyIfLost || (o->readyIfBreak && j->made.broke > 0));
  if (o->readyAt != NOT_ASKED && !j->dead && !standsOut) {
    // (ready from the frame the line's next decision can act: a line's own end, the hold's a reaction on -- a hold presses nothing
    // until the next decision)
    int32_t from = nseq ? 0 : cfgReaction;
    j->readyWait = imax(1, imax(o->readyAt, from) + 2);
    // (and the break it finds is one the input window pays for at that frame: a break the cursor cannot walk to on what is left is not in
    // reach -- core/nodes.h allowLeftAt, actionsFor)
    static LOCAL int32_t rl[MAXLINE]; int32_t rn = 0, *wl = o->why ? j->readyLine : (pressAllowance >= 0 ? rl : 0), *wn = o->why ? &j->readyN : &rn;
    { int32_t from0 = pressFrom, spent0 = pressSpent;
      pressFrom = from0 + imax(j->readyWait, NODE(x, n)->t); pressSpent = spent0 + spent;   // (the readiness search's window: core/nodes.h pressFrom)
      j->ready = breaksAfterLanding(x, n, j->readyWait, wl, wn);
      pressFrom = from0; pressSpent = spent0; }
    if (j->ready == 1 && pressAllowance >= 0 && wl && *wn > 0) {
      const Board *eb = ensureBoard(x, n);
      int left = allowLeftAt(j->readyWait, spent), r = eb ? eb->curRow : 0, c = eb ? eb->curCol : 0, acts = 0;
      for (int k = 0; k < *wn && eb; k++) { acts += actionsFor(r, c, CR(wl[k]), CC(wl[k]), left - acts); r = CR(wl[k]); c = CC(wl[k]); }
      if (eb && acts > left) j->ready = 0;
    }
    j->readyPend = readyPendLast; j->readyNear = readyNearLast; j->readyMat = readyMatLast; j->readyTop = readyTopLast; j->readyContact = readyContactLast; j->readyUnder = readyUnderLast;
    memcpy(j->readyRow1, readyRow1Buf, sizeof j->readyRow1);
    if (j->ready == LOST_FIRST) j->ready = 0;   // (lost first: not ready)
  }
  j->late = j->late || clockOut();
  if (j->late && !j->dead) j->aliveTo = liveNode(x, n) ? NODE(x, n)->t - NODE(x, root)->t : 0;
}

// ---- for a host's check: the question from a node of a search the host made, and a line judged
static Board *hostBoard;
static Question hostQ;
EXPORT(gb_question) int gb_question(Ctx *hx, int i, int tight) {
  Board *b = ensureBoard(hx, i);
  if (!b) return -1;
  if (!hostBoard) hostBoard = nb_new();
  cloneBoard(hostBoard, b);
  Node *n = NODE(hx, i);
  hostQ.b = hostBoard; hostQ.holdLeft = n->holdLeft; hostQ.holdStarted = n->holdStarted; hostQ.narr = n->narr; hostQ.tight = tight;
  for (int k = 0; k < n->narr; k++) hostQ.arr[k] = n->arr[k];
  return 0;
}
// The question from a board's bytes as a native host logs them (GAMBITB: the head, the queue and the rows, packed), in the io from its
// first word, then narr arrivals (at, width, height) -- for the reach report.
EXPORT(gb_question_bytes) int gb_question_bytes(int nbytes, int narr) {
  if (!hostBoard) hostBoard = nb_new();
  const unsigned char *p = (const unsigned char *)gbIo;
  memcpy(hostBoard, p, BOARD_HEAD);
  if (hostBoard->ninc < 0 || hostBoard->ninc > MAXINC || hostBoard->nrows < 13 || hostBoard->nrows > MAXROWS || narr > MAXARR) return -1;
  unsigned long qn = (unsigned long)hostBoard->ninc * sizeof(Incoming), rn = (unsigned long)hostBoard->nrows * sizeof(Panel) * (W + 1);
  if (BOARD_HEAD + qn + rn != (unsigned long)nbytes) return -1;
  memcpy(hostBoard->inc, p + BOARD_HEAD, qn);
  memcpy(hostBoard->p, p + BOARD_HEAD + qn, rn);
  const int32_t *a = gbIo + (nbytes + 3) / 4;
  memset(&hostQ, 0, sizeof hostQ);
  hostQ.b = hostBoard; hostQ.narr = narr;
  for (int k = 0; k < narr; k++) hostQ.arr[k] = (Arr){ a[3 * k], a[3 * k + 1], a[3 * k + 2], 0, 0 };
  return 0;
}
// THE QUESTION'S CELLS, for a tool that reads a logged board: rows, stop, shake, then per row from the bottom each column's colour
// (0 none), garbage, state
EXPORT(gb_cells) int gb_cells(void) {
  const Board *b = hostBoard;
  if (!b) return 0;
  int k = 0;
  gbIo[k++] = b->nrows; gbIo[k++] = b->stopTime + b->preStopTime; gbIo[k++] = b->shakeTime;
  for (int r = 0; r < b->nrows; r++) for (int c = 1; c <= W; c++) {
    const int32_t *f = b->p[r][c].f;
    gbIo[k++] = f[COLOR] == NUL ? 0 : f[COLOR]; gbIo[k++] = f[ISGARBAGE]; gbIo[k++] = f[STATE];
  }
  return k;
}
EXPORT(gb_list_on) void gb_list_on(int on) { listOn = on; }
// The line in the io body (nseq words, r * 8 + c); the answer back into it: dead, deadAt, combo, chain, broke, chainAll, dropAt, done,
// fire, lostAt, ready, late, nats, ats..., nsingles, singles..., readyN, readyLine...
EXPORT(gb_judge) int gb_judge(int nseq, int settled, int tight, int readyAt, int readyIfLost, int readyIfBreak, int lifeTo, int lifeRest, int why) {
  static int32_t seq[MAXLINE];
  if (nseq < 0 || nseq > MAXLINE) return -1;
  for (int i = 0; i < nseq; i++) seq[i] = gbIo[i];
  JudgeOpts o = { settled, tight, readyAt, readyIfLost, readyIfBreak, lifeTo, lifeRest, why };
  pressTight = tight;
  Judged j;
  judge(&hostQ, seq, nseq, &o, &j);
  int32_t *w = gbIo, k = 0;
  w[k++] = j.dead; w[k++] = j.deadAt; w[k++] = j.made.combo; w[k++] = j.made.chain; w[k++] = j.made.broke; w[k++] = j.chainAll;
  w[k++] = j.dropAt; w[k++] = j.done; w[k++] = j.fire; w[k++] = j.lostAt; w[k++] = j.ready; w[k++] = j.late;
  w[k++] = j.nats; for (int i = 0; i < j.nats; i++) w[k++] = j.ats[i];
  w[k++] = j.nsingles; for (int i = 0; i < j.nsingles; i++) w[k++] = j.singles[i];
  w[k++] = j.readyN; for (int i = 0; i < j.readyN; i++) w[k++] = j.readyLine[i];
  w[k++] = j.cut; w[k++] = j.base;
  return k;
}

// THE FIRST CLEAR OF A LINE THAT IS TO CLEAR NOTHING: each step played to the board's settle, in turn, pressed when
// the frame loop presses it; the index of the first that clears panels and breaks no garbage, -1 if none does
static int firstClear(const Question *q, const int32_t *seq, int nseq) {
  Ctx *x = judgeCtx = ctxOf(judgeCtx);
  int n = rootOf(x, q);
  if (n < 0) return -1;
  for (int k = 0; k < nseq; k++) {
    int out = step(x, n, MK_SETTLE, CR(seq[k]), CC(seq[k]), 0);
    if (!liveNode(x, out)) break;
    Stats st; statsOf(x, out, &st);
    if (st.cleared > 0 && !(st.broke > 0)) return k;
    n = out;
  }
  return -1;
}
