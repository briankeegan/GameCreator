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
} JudgeOpts;
typedef struct {
  Made made;                    // beyond the board left alone: { combo, chain, broke }
  Made whole;                   // what the board ends up making with the line played, the chain already under way included (garbage
                                // broken still counted beyond the board left alone): a line that cuts a chain short makes the shorter one
  int32_t aloneChain;           // the chain the board left alone makes
  int32_t chainAll;             // the chain the line reaches as the game counts it (the chain already falling and every link after it)
  int32_t singles[MAXCOMBOS], nsingles;   // sizes of 4 or more the line clears as a clear of its own, no link of a chain
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
  int32_t readyNear;            // the swaps to the nearest break on that board by the shape math (breakNear, NEAR_MISS none; 0 no
                                // garbage), -1 not asked
  int32_t readyRow1[W + 1];     // the panel ids of the bottom row of the board the readiness break was found on (what anchors it)
  int32_t late;                 // the clock stopped it: no answer
  int32_t cut;                  // the step a swap was not there to press at (the line played no further), -1 none
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
  return b && (b->chainCounter > 0 || hasChainingPanels(b) || hasActivePanels(b));
}
static int settleOf(Ctx *x, int i) { return step(x, i, MK_SETTLE, 0, 0, 0); }

// (the garbage the board left alone has broken by frame t, from the board landed: cached per frame)
static int32_t still_(Ctx *x, int land, int32_t t, int32_t *idleT, int32_t *idleB, int32_t *nIdle) {
  for (int i = 0; i < *nIdle; i++) if (idleT[i] == t) return idleB[i];
  int w = t > NODE(x, land)->t ? step(x, land, MK_LONG, 0, 0, t - NODE(x, land)->t) : land;
  int32_t b = liveNode(x, w) ? NODE(x, w)->brk : NODE(x, land)->brk;
  if (*nIdle < 64) { idleT[*nIdle] = t; idleB[*nIdle] = b; (*nIdle)++; }
  return b;
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
static int32_t readyCollect; static LOCAL int32_t readyPendLast, readyNearLast;
static int nearOf(const Board *b); static int garbageOn(const Board *b);   // (search/break.c)
static LOCAL int32_t readyRow1Buf[W + 1];
static int32_t breaksAfterLanding(Ctx *x, int n, int32_t wait, int32_t *why, int32_t *whyN) {
  readyPendLast = 0; readyNearLast = -1;
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
    readyPendLast = readyPendOf(x, land);
    return NOT_ASKED;
  }
  { Board *lb = ensureBoard(x, land); for (int c = 1; c <= W; c++) readyRow1Buf[c] = lb && lb->nrows > 1 ? lb->p[1][c].f[ID] : NUL; }
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
// THE JUDGE: the line seq (n swaps, r * 8 + c) from the question, as the options say.
static void judge(const Question *q, const int32_t *seq, int nseq, const JudgeOpts *o, Judged *j) {
  memset(j, 0, sizeof *j);
  j->lostAt = NOT_ASKED; j->ready = NOT_ASKED; j->fire = -1; j->cut = -1; j->readyNear = -1;
  Ctx *x = judgeCtx = ctxOf(judgeCtx);
  int root = rootOf(x, q), n = root;
  if (root < 0) { j->dead = 1; return; }
  int base = settleOf(x, root);
  int32_t baseChain = 0, baseCombo = 0, baseBroke = 0;
  Stats bs;
  if (liveNode(x, base) && statsOf(x, base, &bs)) { baseBroke = bs.broke; if (bs.cleared > 0) { baseChain = chainOfStats(&bs); baseCombo = biggestOf(&bs); } }
  j->base = baseBroke;
  int32_t combo = 0, chain = 0, broke = 0, lastAt = 0, single[MAXCOMBOS + 64] = { 0 }, pieces = 0, links = 0;
  int32_t spent = 0, tight0 = pressTight;   // (the actions the line's swaps spend, and the decision's tightness, put back at the end)
  for (int k = 0; k <= nseq; k++) {
    int last = k == nseq, mr = last ? 0 : CR(seq[k]), mc = last ? 0 : CC(seq[k]);
    if (last && o->settled) break;   // (each step settled already)
    if (o->waitTo > 0 && k == o->waitAt) {
      int w = step(x, n, MK_LONG, 0, 0, imax(1, o->waitTo - NODE(x, n)->t));
      if (w == STEP_NULL && clockOut()) { j->late = 1; break; }
      if (!liveNode(x, w)) { j->dead = 1; j->deadAt = w == STEP_DEAD ? deadAt : NODE(x, n)->t; break; }
      int calm = settleOf(x, w);
      n = liveNode(x, calm) ? calm : w;
    }
    // (the allowance this swap is pressed under: the decision's less what the line's swaps before it spent -- core/nodes.h actionsFor)
    if (!last && pressAllowance >= 0) {
      Board *bn = ensureBoard(x, n);
      int left = pressAllowance - spent;
      pressTight = left <= HOLDTIGHT;
      int acts = bn ? actionsFor(bn->curRow, bn->curCol, mr, mc, left) : 0;
      // (a first swap whose walk is over what the allowance leaves is not there to press: the frame loop refuses its keys -- front.c
      // keysFit, GUARDED -- so the line is cut as one whose swap is gone; a later swap is held to the allowance at its own frame, by the
      // frame loop as it follows the line -- front.c follow)
      if (k == 0 && acts > left) { j->cut = k; break; }
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
      if (out == STEP_NULL) { j->cut = k; break; }
      if (from < 0) { j->dead = 1; j->deadAt = deadAt; break; }
      // (a swap whose walk cannot begin within a reaction is one the frame loop does not press -- front.c keysOf refuses it: not there)
      if (NODE(x, from)->t - NODE(x, n)->t > cfgReaction) { j->cut = k; break; }
      if (pressTight && liveNode(x, out)) out = step(x, from, kind, mr, mc, 0);
      n = from;
      if (j->nats < MAXLINE) j->ats[j->nats++] = NODE(x, n)->t;
    }
    // (a step the clock stopped is no answer: the judging is late, the line not lost)
    if (out == STEP_NULL && clockOut()) { j->late = 1; break; }
    if (!last && out == STEP_NULL) { j->cut = k; break; }
    if (!liveNode(x, out)) { j->dead = 1; j->deadAt = out == STEP_DEAD ? deadAt : NODE(x, n)->t; break; }
    Stats st;
    statsOf(x, out, &st);
    for (int i = 0; i < st.n; i++) { if (st.size[i] > combo) combo = st.size[i]; if (!(st.chainAt[i] > 1) && st.size[i] >= 4 && st.size[i] < MAXCOMBOS + 64) single[st.size[i]] = 1; }
    for (int i = 0; i < st.n; i++) if (!(st.chainAt[i] > 1)) pieces += blocksOf(st.size[i], 0);
    // (a settled step's chain ends in it, so each is an attack of its own; steps pressed at once are one chain, counted at its longest)
    if (o->settled || last) links += imax(0, chainOfStats(&st) - 1);
    if (chainOfStats(&st) > chain) chain = chainOfStats(&st);
    broke += st.broke;
    j->done = NODE(x, out)->t;
    if (!last) lastAt = j->done;
    n = out;
  }
  pressTight = tight0;
  j->late = j->late || clockOut();
  // (the garbage the line breaks is what it breaks beyond the board left alone: a slab popping converts its panels whatever is pressed)
  j->made.combo = combo > baseCombo ? combo : 0; j->made.chain = chain > baseChain ? chain : 0; j->made.broke = imax(0, broke - baseBroke);
  j->whole = (Made){ combo, chain, j->made.broke, 0 }; j->aloneChain = baseChain;
  j->chainAll = imax(chain, q->b->chainCounter);
  if (!o->settled) links = imax(links, imax(0, chain - 1));
  j->blocks = imax(0, pieces + links - blocksOf(baseCombo, baseChain));
  for (int z = 4; z < MAXCOMBOS + 64; z++) if (single[z] && j->nsingles < MAXCOMBOS) j->singles[j->nsingles++] = z;
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
    j->ready = breaksAfterLanding(x, n, j->readyWait, o->why ? j->readyLine : 0, &j->readyN);
    j->readyPend = readyPendLast; j->readyNear = readyNearLast;
    memcpy(j->readyRow1, readyRow1Buf, sizeof j->readyRow1);
    if (j->ready == LOST_FIRST) j->ready = 0;   // (lost first: not ready)
  }
  j->late = j->late || clockOut();
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
  pressTight = tight; pressMemoClear();
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
