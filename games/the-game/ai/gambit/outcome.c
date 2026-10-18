// THE OUTCOME OF A LINE (plans/decision.md step 3): the whole line judged once a decision, and every fact the
// decision reads about it taken from that one judging -- no search, filter or rank works one out for itself. And THE SHARED LINE CHECK
// (lineFits): the line every search keeps only when the ranking would take it. Both cached per decision (gb_decision_start).
//
// What the decision knows of the board (Facts) comes from its reading of it.

static double leftMsOf(void);   // (propose.c leftMs: the time the decision's searches have left)
#define HORIZON 240   // a board stands when it is alive this long after now
#define REST 120      // and this long after the line's last swap

typedef struct {
  int32_t land;        // frames until the last block shown lands (NOT_ASKED: none coming) -- JUDGE.lastLanding
  int32_t topped;      // the board is topped out
  int32_t timeLeft;    // the decision's searches still have time (c.left() > 0): readiness is asked only then
  int32_t belowFloor;  // below the rule's material floor: a line that clears panels and breaks nothing is no candidate
  int32_t next;        // frames until the next block shown lands (NOT_ASKED: none coming)
} Facts;
typedef struct {
  int32_t dead, lostAt, lives, fits, ready, late;
  int32_t spent;   // under the material floor (outcomeOf)
  Judged j;
} Outcome;

// WHETHER WHAT A LINE MAKES FITS THE LIST: what it makes, the chain it reaches as the game counts it, and
// every clear of its own
static int fitsList(const List *L, Made m, const Judged *j) {
  if (!fits(L, m)) return 0;
  if (j->chainAll >= 2) { Made c = { 0, j->chainAll, 0, 0 }; if (!fits(L, c)) return 0; }
  for (int i = 0; i < j->nsingles; i++) { Made s = { j->singles[i], 1, 0, 0 }; if (!fits(L, s)) return 0; }
  return 1;
}

// ---- the decision's cache: every line judged once
#define CACHEN 4096
typedef struct { uint32_t h; int32_t settled, n, kind; int32_t seq[MAXLINE]; Outcome o; } Cached;
static Cached *cache; static int32_t ncache;
static Question decQ; static Facts decF;
static uint32_t lineHash(const int32_t *seq, int n, int settled, int kind) {
  uint32_t h = 2166136261u ^ (uint32_t)(settled * 7 + kind * 131);
  for (int i = 0; i < n; i++) h = (h ^ (uint32_t)seq[i]) * 16777619u;
  return h;
}
static int readyFresh;   // (the readiness asked now: an outcome kept without it is judged again, and replaced)
static Outcome *cached(const int32_t *seq, int n, int settled, int kind) {
  if (readyFresh && kind == 0) return 0;
  uint32_t h = lineHash(seq, n, settled, kind);
  for (int i = 0; i < ncache; i++) {
    Cached *c = &cache[i];
    if (c->h != h || c->n != n || c->settled != settled || c->kind != kind) continue;
    int same = 1;
    for (int k = 0; k < n && same; k++) same = c->seq[k] == seq[k];
    if (same) return &c->o;
  }
  return 0;
}
static Outcome *keep(const int32_t *seq, int n, int settled, int kind, const Outcome *o) {
  if (!cache) cache = (Cached *)grab(sizeof(Cached) * CACHEN);
  if (!cache || n > MAXLINE) return 0;
  uint32_t h = lineHash(seq, n, settled, kind);
  Cached *c = 0;
  for (int i = 0; i < ncache && !c; i++) {
    Cached *e = &cache[i];
    if (e->h != h || e->n != n || e->settled != settled || e->kind != kind) continue;
    int same = 1;
    for (int k = 0; k < n && same; k++) same = e->seq[k] == seq[k];
    if (same) c = e;
  }
  if (!c) { if (ncache >= CACHEN) return 0; c = &cache[ncache++]; }
  c->h = lineHash(seq, n, settled, kind); c->n = n; c->settled = settled; c->kind = kind;
  for (int k = 0; k < n; k++) c->seq[k] = seq[k];
  c->o = *o;
  return &c->o;
}

// THE OUTCOME. With garbage on its way, a line that breaks nothing lives only when a break is there once everything has landed --
// ready, however long the stop it stands on lasts; a break, or a board with nothing coming, lives by standing to the horizon and past
// the stop and shake it ends on (lifeStop), or by a break in reach once it is over: a board a stop holds up is ready for the next break
// or it dies when the stop runs out. A line that lives only by being ready lives as its readiness break does, played where the
// readiness found it and judged as any break is (waitTo): a break kept for later is worth no more than the break played.
static Outcome outcomeOf(const int32_t *seq, int n, int settled, int waitAt, int32_t waitTo);
static int breakBuildable(const Board *b);   // (search/break.c: a break the panels touching garbage can be walked into)
static int garbageOn(const Board *b);        // (search/break.c: garbage on the board)
static int32_t rootBuildable = NOT_ASKED;    // (the question's board, asked once a decision)
static int32_t rootComing = NOT_ASKED;       // (the question's board left alone, once the next block has landed: asked once a decision)
// a break to build on the board at node, run to `at` frames from the root and let settle -- the next block landed
static int buildableAt(Ctx *x, int node, int32_t at) {
  int w = step(x, node, MK_LONG, 0, 0, imax(1, at - NODE(x, node)->t));
  if (!liveNode(x, w)) return 0;
  int z = settleOf(x, w);
  if (liveNode(x, z)) w = z;
  Board *b = ensureBoard(x, w);
  return b && breakBuildable(b);
}
static Outcome outcome(const int32_t *seq, int n, int settled) { return outcomeOf(seq, n, settled, 0, 0); }
static Outcome outcomeOf(const int32_t *seq, int n, int settled, int waitAt, int32_t waitTo) {
  Outcome *hit = waitTo ? 0 : cached(seq, n, settled, 0);
  if (hit) return *hit;
  int coming = decF.land != NOT_ASKED;
  int timeLeft = decF.timeLeft >= 0 ? decF.timeLeft : leftMsOf() > 0;
  JudgeOpts jo = { settled, decQ.tight, timeLeft ? (coming ? decF.land : 0) : NOT_ASKED, !coming, 1, HORIZON + REST, REST, !waitTo, waitAt, waitTo, 1 };
  Outcome o;
  memset(&o, 0, sizeof o);
  judge(&decQ, seq, n, &jo, &o.j);
  o.late = o.j.late;
  o.dead = 1; o.lostAt = o.j.lostAt; o.lives = 0; o.ready = NOT_ASKED;
  if (!o.j.dead) {
    int32_t ready = o.j.ready;
    int breaks = o.j.made.broke > 0, stands = o.j.lostAt == FOREVER;
    o.dead = 0; o.ready = ready;
    o.lives = breaks || !coming ? (stands || ready == 1) : (ready == 1 || (ready == NOT_ASKED && stands));
    o.fits = fitsList(&theList, o.j.made, &o.j) && imax(o.j.made.chain, o.j.chainAll) <= MAXCHAIN;
    // (THE MATERIAL FLOOR: under garbage, a line that breaks nothing, does not stand and leaves no break to build where the board had
    // one has spent what the next break needs -- it is lost the frame it is done)
    if (n > 0 && !breaks && !stands && !waitTo && garbageOn(decQ.b)) {
      if (rootBuildable == NOT_ASKED) rootBuildable = breakBuildable(decQ.b);
      const Board *eb = rootBuildable ? ensureBoard(judgeCtx, o.j.endNode) : 0;
      if (eb && !breakBuildable(eb)) { o.lives = 0; o.spent = 1; o.lostAt = o.j.lostAt = imax(1, o.j.done); }
    }
    // (AND FOR THE BLOCK ON ITS WAY: a line that breaks nothing, does not stand and leaves no break to build once the next block has
    // landed, where the board left alone would have one, has spent what that block's break needs -- lost the frame it is done)
    else if (n > 0 && !breaks && !stands && !waitTo && decF.next != NOT_ASKED && !garbageOn(decQ.b)) {
      if (!buildableAt(judgeCtx, o.j.endNode, decF.next)) {
        if (rootComing == NOT_ASKED) { int r = rootOf(judgeCtx, &decQ); rootComing = r >= 0 ? buildableAt(judgeCtx, r, decF.next) : 0; }
        if (rootComing) { o.lives = 0; o.spent = 1; o.lostAt = o.j.lostAt = imax(1, o.j.done); }
      }
    }
    if (o.lives && !breaks && ready == 1 && !(stands && !coming) && !waitTo && o.j.readyN > 0 && n + o.j.readyN <= MAXLINE) {
      int32_t ext[MAXLINE];
      for (int k = 0; k < n; k++) ext[k] = seq[k];
      for (int k = 0; k < o.j.readyN; k++) ext[n + k] = o.j.readyLine[k];
      Outcome e = outcomeOf(ext, n + o.j.readyN, settled, n, o.j.readyWait);
      if (e.late) o.late = 1; else if (!e.lives) o.lives = 0;
    }
  }
  // (a judging the clock stopped is no answer: it is not kept, and the next asking judges it again)
  if (!o.late && !waitTo) keep(seq, n, settled, 0, &o);
  return o;
}
// THE BOARD LEFT ALONE, as the proposers read it: its readiness, a break search of its own, is the ranking's to ask (decide.c ranked)
static Outcome leftAlone(void) { int d = readyDefer; readyDefer = 1; Outcome o = outcome(0, 0, 0); readyDefer = d; return o; }
// READY FOR THE NEXT BLOCK: after the line, a break in reach once the next block shown has landed -- what a board that cannot be ready
// for everything (the queue outlasts it) can still be ready for. 1, 0, or NOT_ASKED (nothing coming, or out of time). A line that
// presses something and is ready is worth what its readiness break leads to: the line and the break played on the engine, where the
// readiness found it (extLost: the frame that board is lost, FOREVER, or NOT_ASKED)
static int32_t readyNextOf(const int32_t *seq, int n, int settled, int32_t *extLost) {
  *extLost = NOT_ASKED;
  if (decF.next == NOT_ASKED) return NOT_ASKED;
  Outcome *hit = cached(seq, n, settled, 2);
  if (hit) { *extLost = hit->lostAt; return hit->ready; }
  if (clockOut()) return NOT_ASKED;
  JudgeOpts jo = { settled, decQ.tight, decF.next, 1, 1, -1, 0, 1 };
  Outcome o;
  memset(&o, 0, sizeof o);
  judge(&decQ, seq, n, &jo, &o.j);
  if (o.j.late) return NOT_ASKED;
  o.ready = !o.j.dead && o.j.ready == 1;
  o.lostAt = NOT_ASKED;
  if (o.ready && n > 0 && o.j.readyN > 0 && n + o.j.readyN <= MAXLINE) {
    int32_t ext[MAXLINE];
    for (int k = 0; k < n; k++) ext[k] = seq[k];
    for (int k = 0; k < o.j.readyN; k++) ext[n + k] = o.j.readyLine[k];
    Outcome e = outcomeOf(ext, n + o.j.readyN, settled, n, o.j.readyWait);
    if (!e.late) o.lostAt = e.dead ? (e.j.deadAt > 0 ? e.j.deadAt : NOT_ASKED) : e.lostAt;
  }
  *extLost = o.lostAt;
  keep(seq, n, settled, 2, &o);
  return o.ready;
}
// THE SHARED LINE CHECK: what the line makes and sets off fits the list, the chain is within MAXCHAIN, and below the rule's material
// floor it does not clear panels and break nothing. A check not begun by the decision's deadline keeps no line.
static int lineFits(const int32_t *seq, int n, int settled) {
  Outcome *hit = cached(seq, n, settled, 1);
  if (hit) return hit->fits;
  if (clockOut()) return 0;
  JudgeOpts jo = { settled, decQ.tight, NOT_ASKED, 0, 0, -1, 0, 0 };
  Outcome o;
  memset(&o, 0, sizeof o);
  judge(&decQ, seq, n, &jo, &o.j);
  Made m = o.j.made;
  o.fits = !o.j.dead && fitsList(&theList, m, &o.j) && imax(m.chain, o.j.chainAll) <= MAXCHAIN &&
           !(decF.belowFloor && (m.combo > 0 || m.chain > 0) && !(m.broke > 0));
  // (a list ended by "default": a line outside it is the default's own, kept while the board lives through it)
  if (!listOn) o.fits = !o.j.dead && imax(m.chain, o.j.chainAll) <= MAXCHAIN;   // (the host's own check, a line held to no list)
  if (o.j.late) return 0;
  keep(seq, n, settled, 1, &o);
  return o.fits;
}

// ---- a decision begun: the question (from a node of a host search, until the decision reads its own) and the facts; every line is
// judged again
EXPORT(gb_decision_on) int gb_decision_on(int land, int topped, int timeLeft, int belowFloor);
EXPORT(gb_decision_start) int gb_decision_start(Ctx *hx, int i, int tight, int land, int topped, int timeLeft, int belowFloor) {
  if (gb_question(hx, i, tight) < 0) return -1;
  return gb_decision_on(land, topped, timeLeft, belowFloor);
}
// the same, on the question already set (gb_question_bytes)
EXPORT(gb_decision_on) int gb_decision_on(int land, int topped, int timeLeft, int belowFloor) {
  decQ = hostQ; decQ.b = hostBoard; backBoard = hostBoard;
  Facts f = { land, topped, timeLeft, belowFloor };
  decF = f;
  ncache = 0; rootBuildable = NOT_ASKED; rootComing = NOT_ASKED;
  return 0;
}
// The line in the io body (nseq words); back: dead, lostAt, lives, fits, ready, late, then the judge's answer as gb_judge writes it.
EXPORT(gb_outcome) int gb_outcome(int nseq, int settled) {
  static int32_t seq[MAXLINE];
  if (nseq < 0 || nseq > MAXLINE) return -1;
  for (int i = 0; i < nseq; i++) seq[i] = gbIo[i];
  Outcome o = outcome(seq, nseq, settled);
  int32_t *w = gbIo, k = 0;
  w[k++] = o.dead; w[k++] = o.lostAt; w[k++] = o.lives; w[k++] = o.fits; w[k++] = o.ready; w[k++] = o.late;
  w[k++] = o.j.made.combo; w[k++] = o.j.made.chain; w[k++] = o.j.made.broke; w[k++] = o.j.chainAll; w[k++] = o.j.dropAt; w[k++] = o.j.done; w[k++] = o.j.fire;
  w[k++] = o.j.nats; for (int q = 0; q < o.j.nats; q++) w[k++] = o.j.ats[q];
  return k;
}
EXPORT(gb_line_fits) int gb_line_fits(int nseq, int settled) {
  static int32_t seq[MAXLINE];
  if (nseq < 0 || nseq > MAXLINE) return -1;
  for (int i = 0; i < nseq; i++) seq[i] = gbIo[i];
  return lineFits(seq, nseq, settled);
}
