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
  int32_t chainAll;             // the chain the line reaches as the game counts it (the chain already falling and every link after it)
  int32_t singles[MAXCOMBOS], nsingles;   // sizes of 4 or more the line clears as a clear of its own, no link of a chain
  int32_t dropAt;               // the frame garbage can next drop once the line is over
  int32_t dead, deadAt, done, fire, nats, ats[MAXLINE];
  int32_t lostAt;               // FOREVER, a frame, or NOT_ASKED
  int32_t ready;                // 1, 0, or NOT_ASKED
  int32_t readyLine[MAXLINE], readyN; // the swaps the readiness found (why), as r * 8 + c
  int32_t readyWait;            // the frame from the root the readiness looked from (its waitTo)
  int32_t readyRow1[W + 1];     // the panel ids of the bottom row of the board the readiness break was found on (what anchors it)
  int32_t late;                 // the clock stopped it: no answer
  int32_t cut;                  // the step a swap was not there to press at (the line played no further), -1 none
  int32_t base;                 // the garbage the board left alone breaks, which the line's own is counted beyond
  int32_t endNode;              // the node the line ends on, in judgeCtx (until the next judging)
} Judged;

static Ctx *judgeCtx;   // the judge's own nodes: a search can ask it while its own nodes stand


// THE LIST FOR ONE STEP (attacker stepFits): its own clears, each no link of a chain, and the chain it reaches -- held to the list when
// the decision has handed the searches one (listOn)
static int32_t listOn;
// the break search's lines are held to the list unless it ends by "default" (every list under garbage): there a break is the default's own
static int32_t listDefault;
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
// A STEP BEGINS A CHAIN, OR ENDS ONE: on a board still falling, its chain so far -- and a plain three, its first link -- is a beginning
// while the list wants a longer chain, held to the list as it ends, on the whole line (lineFits); a combo of its own fits as itself.
static int stepFitsAt(Ctx *x, int i) {
  if (!listOn) return 1;
  Stats s;
  if (!statsOf(x, i, &s)) return 0;
  int32_t own[MAXCOMBOS], n = 0;
  for (int j = 0; j < s.n; j++) if (!(s.chainAt[j] > 1)) own[n++] = s.size[j];
  int32_t chain = chainOfStats(&s);
  if (stepFits(&theList, own, n, chain)) return 1;
  Board *b = ensureBoard(x, i);
  if (!b || !(b->chainCounter > 0 || hasChainingPanels(b) || hasActivePanels(b))) return 0;
  if (chain > MAXCHAIN || !listWantsLonger(&theList, chain > 1 ? chain : 1)) return 0;
  for (int k = 0; k < n; k++) if (own[k] > 3) { Made m = { own[k], 1, 0, 0 }; if (!fits(&theList, m)) return 0; }
  return 1;
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
static int readyDefer;
static int32_t readyRow1Buf[W + 1];
static int32_t breaksAfterLanding(Ctx *x, int n, int32_t wait, int32_t *why, int32_t *whyN) {
  int land = step(x, n, MK_LONG, 0, 0, imax(1, wait - NODE(x, n)->t));
  if (!liveNode(x, land)) return clockOut() ? NOT_ASKED : LOST_FIRST;
  if (readyDefer) return NOT_ASKED;
  int calm = settleOf(x, land);
  if (liveNode(x, calm)) land = calm;
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
// THE JUDGE: the line seq (n swaps, r * 8 + c) from the question, as the options say.
static void judge(const Question *q, const int32_t *seq, int nseq, const JudgeOpts *o, Judged *j) {
  memset(j, 0, sizeof *j);
  j->lostAt = NOT_ASKED; j->ready = NOT_ASKED; j->fire = -1; j->cut = -1;
  Ctx *x = judgeCtx = ctxOf(judgeCtx);
  int root = rootOf(x, q), n = root;
  if (root < 0) { j->dead = 1; return; }
  int base = settleOf(x, root);
  int32_t baseChain = 0, baseCombo = 0, baseBroke = 0;
  Stats bs;
  if (liveNode(x, base) && statsOf(x, base, &bs)) { baseBroke = bs.broke; if (bs.cleared > 0) { baseChain = chainOfStats(&bs); baseCombo = biggestOf(&bs); } }
  j->base = baseBroke;
  int32_t combo = 0, chain = 0, broke = 0, lastAt = 0, single[MAXCOMBOS + 64] = { 0 };
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
    // (a swap not there to press while the board still moves -- its pair still swapping or falling -- is pressed once it is, as the
    // frame loop presses it; one not there on a still board is not there)
    if (!last && !legalAt(x, n, mr, mc)) {
      while (!legalAt(x, n, mr, mc)) {
        Board *bn = ensureBoard(x, n);
        if (!bn || !(hasActivePanels(bn) || bn->swappingCount > 0)) break;
        int w = step(x, n, MK_LONG, 0, 0, 1);
        if (w == STEP_NULL && clockOut()) { j->late = 1; break; }
        if (!liveNode(x, w)) { j->dead = 1; j->deadAt = w == STEP_DEAD ? deadAt : NODE(x, n)->t; break; }
        n = w;
      }
      if (j->late || j->dead) break;
      if (!legalAt(x, n, mr, mc)) { j->cut = k; break; }
    }
    if (!last && j->nats < MAXLINE) j->ats[j->nats++] = NODE(x, n)->t;
    int out = step(x, n, last || o->settled ? MK_SETTLE : MK_SWAP, mr, mc, 0);
    // (a step the clock stopped is no answer: the judging is late, the line not lost)
    if (out == STEP_NULL && clockOut()) { j->late = 1; break; }
    if (!liveNode(x, out)) { j->dead = 1; j->deadAt = out == STEP_DEAD ? deadAt : NODE(x, n)->t; break; }
    Stats st;
    statsOf(x, out, &st);
    for (int i = 0; i < st.n; i++) { if (st.size[i] > combo) combo = st.size[i]; if (!(st.chainAt[i] > 1) && st.size[i] >= 4 && st.size[i] < MAXCOMBOS + 64) single[st.size[i]] = 1; }
    if (chainOfStats(&st) > chain) chain = chainOfStats(&st);
    broke += st.broke;
    j->done = NODE(x, out)->t;
    if (!last) lastAt = j->done;
    n = out;
  }
  j->late = j->late || clockOut();
  // (the garbage the line breaks is what it breaks beyond the board left alone: a slab popping converts its panels whatever is pressed)
  j->made.combo = combo > baseCombo ? combo : 0; j->made.chain = chain > baseChain ? chain : 0; j->made.broke = imax(0, broke - baseBroke);
  j->chainAll = imax(chain, q->b->chainCounter);
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
// A LINE PLAYED ON (the rest of a line begun): each step played to the board's settle, as the planner plays a line,
// the next step pressed once the board has settled from the last (settleFirst); what its last step makes, or 0 when a step is not
// legal or the board dies. wait: the frames until the board has settled first.
typedef struct { int32_t combo, chain, broke, cells, earned, done, fire, wait, nats, ats[MAXLINE]; } Replayed;
static int replay(const Question *q, const int32_t *seq, int nseq, int settleFirst, Replayed *r) {
  memset(r, 0, sizeof *r);
  Ctx *x = judgeCtx = ctxOf(judgeCtx);
  int root = rootOf(x, q), n = root, got = 0;
  if (root < 0) return 0;
  int baseOut = settleOf(x, root);
  int32_t base = 0;
  Stats bs;
  if (liveNode(x, baseOut) && statsOf(x, baseOut, &bs) && bs.cleared > 0) {
    int32_t cells = 0, ch = chainOfStats(&bs);
    for (int j = 0; j < bs.n; j++) cells += comboCells(bs.size[j]);
    base = cells + (ch > 1 ? W * (ch - 1) : 0);
  }
  if (settleFirst) { if (!liveNode(x, baseOut)) return 0; n = baseOut; r->wait = NODE(x, baseOut)->t; }
  for (int k = 0; k < nseq; k++) {
    if (!legalAt(x, n, CR(seq[k]), CC(seq[k]))) break;
    if (r->nats < MAXLINE) r->ats[r->nats++] = NODE(x, n)->t;
    int out = step(x, n, MK_SETTLE, CR(seq[k]), CC(seq[k]), 0);
    if (!liveNode(x, out)) break;
    if (k == nseq - 1) {
      Stats st; statsOf(x, out, &st);
      int32_t ch = chainOfStats(&st), cells = 0;
      for (int j = 0; j < st.n; j++) cells += comboCells(st.size[j]);
      if (ch > 1) cells += W * (ch - 1);
      r->combo = biggestOf(&st); r->chain = ch; r->broke = st.broke; r->cells = imax(0, cells - base); r->earned = st.earned;
      r->done = NODE(x, out)->t; r->fire = r->ats[k]; got = 1;
    }
    n = out;
  }
  return got;
}
