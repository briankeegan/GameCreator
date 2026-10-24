// THE OUTCOME OF A LINE (plans/decision.md step 3): the whole line judged once a decision, and every fact the
// decision reads about it taken from that one judging -- no search, filter or rank works one out for itself. And THE SHARED LINE CHECK
// (lineFits): the line every search keeps only when the ranking would take it. Both cached per decision (gb_decision_start).
//
// What the decision knows of the board (Facts) comes from its reading of it.

#define HORIZON 240   // a board stands when it is alive this long after now
#define REST 120      // and this long after the line's last swap

typedef struct {
  int32_t land;        // frames until the last block shown lands (NOT_ASKED: none coming) -- JUDGE.lastLanding
  int32_t topped;      // the board is topped out
  int32_t timeLeft;    // the decision's searches still have time (c.left() > 0): readiness is asked only then
  int32_t under;       // garbage on the board, as the decision reads it (decide.c read: R->under) -- the one under-garbage test
  int32_t next;        // frames until the next block shown lands (NOT_ASKED: none coming)
} Facts;
typedef struct {
  int32_t dead, lostAt, lives, fits, ready, late;
  int32_t spent;   // under the material floor (outcomeOf)
  int32_t nextBuild; // a line that breaks: the board it leaves has a break to build, or no garbage left (outcomeOf); -1 not asked
  int32_t panelsLeft; // the panels on the board the line leaves (outcomeOf); -1 not asked
  int32_t lifeLeft;    // the life the board it leaves has by its panels (lifeOf), -1 not asked
  int32_t floorKept;   // the board the line leaves keeps the rule's floor, as the floor is tested (floorOf), the line's breaks aside; -1 not asked
  int32_t matLeft;     // the material the board the line leaves has: its panels under the lowest garbage, the next break's (materialOn); -1 not asked
  int32_t nearAfter;   // under garbage: the swaps to the nearest break on the board the line leaves (breakNear; NEAR_MISS none), -1 not asked
  Judged j;
} Outcome;

// WHETHER WHAT A LINE MAKES FITS THE LIST: what it makes, the chain it reaches as the game counts it, and
// every clear of its own
static int fitsWithin(const List *L, Made m, const Judged *j);
// (the rule, judge.c: within the list -- an entry, a chain begun toward one, a three that breaks -- and with `last`, a last resort too)
static int fitsList(const List *L, Made m, const Judged *j, int last) {
  return breakingThree(m, j->chainAll) || fitsWithin(L, m, j) || (last && lastResort(m, j->chainAll));
}
static int fitsWithin(const List *L, Made m, const Judged *j) {
  // (a chain shorter than the list asks is begun toward it (judge.c chainBegins): within the list, its own clears held to it as ever;
  // ranked after every line that meets an entry, as it meets none)
  int32_t chain = imax(chainOf(m), j->chainAll);
  int begun = chainBegins(L, chain);
  if (!begun && !fits(L, m)) return 0;
  if (!begun && j->chainAll >= 2) { Made c = { 0, j->chainAll, 0, 0 }; if (!fits(L, c)) return 0; }
  for (int i = 0; i < j->nsingles; i++) { Made s = { j->singles[i], 1, 0, 0 }; if (!fits(L, s)) return 0; }
  return 1;
}

// ---- the decision's cache: every line judged once
#define CACHEN 4096
typedef struct { uint32_t h; int32_t settled, n, kind; int32_t seq[MAXLINE]; Outcome o; } Cached;
static LOCAL Cached *cache; static LOCAL int32_t ncache;   // (each thread its own: the break search judges on a worker -- answer.c)
static Question decQ; static Facts decF;
static uint32_t lineHash(const int32_t *seq, int n, int settled, int kind) {
  uint32_t h = 2166136261u ^ (uint32_t)(settled * 7 + kind * 131);
  for (int i = 0; i < n; i++) h = (h ^ (uint32_t)seq[i]) * 16777619u;
  return h;
}
static int readyFresh;   // (the readiness asked now: an outcome kept without it is judged again, and replaced)
static int endWanted;    // (lineEnd: the line is judged again and the board it ends on kept)
static int endNoKeep;    // (and that judging not kept in the cache: asked once the rank has the line's whole outcome -- rank.c ideasOf)
static Outcome *cached(const int32_t *seq, int n, int settled, int kind) {
  if ((readyFresh || endWanted) && kind == 0) return 0;
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

// THE LIFE A BOARD HAS WITH `panels` ON IT, in frames (core/material.h: measured on Gambit's own games, made by material.c: ./build.sh material)
#include "core/material.h"
static int32_t lifeOf(int32_t panels) { return LIFE[panels < 0 ? 0 : panels > LIFEMAX ? LIFEMAX : panels]; }
// the panels a board lives longest with (the table's peak): more than that, a panel cleared is life
static int32_t lifePeakOf(void) { static int32_t peak = -1; if (peak < 0) { peak = 0; for (int p = 1; p <= LIFEMAX; p++) if (LIFE[p] > LIFE[peak]) peak = p; } return peak; }
// THE OUTCOME. With garbage on its way, a line that breaks nothing lives only when a break is there once everything has landed --
// ready, however long the stop it stands on lasts; a break, or a board with nothing coming, lives by standing to the horizon and past
// the stop and shake it ends on (lifeStop), or by a break in reach once it is over: a board a stop holds up is ready for the next break
// or it dies when the stop runs out. A line that lives only by being ready lives as its readiness break does, played where the
// readiness found it and judged as any break is (waitTo): a break kept for later is worth no more than the break played.
static Outcome outcomeOf(const int32_t *seq, int n, int settled, int waitAt, int32_t waitTo);
static int breakBuildable(const Board *b);   // (search/break.c: a break the panels touching garbage can be walked into)
static int garbageOn(const Board *b);        // (search/break.c: garbage on the board)
static int32_t panelsOn(const Board *b);     // (search/break.c: the panels on the board)
static int nearOf(const Board *b);           // (search/break.c: the swaps to the nearest break, NEAR_MISS none)
// (THE BOARD LEFT ALONE, settled as a line is: whether it still has a break to build -- or no garbage to break. Asked once a decision:
// what a line is measured against when it spends the next break's material)
// (THE NEXT BREAK TO BUILD on a board, the one test: a break its panels touching garbage can be walked into, or no garbage to break)
static int buildsNext(const Board *b) { return !garbageOn(b) || breakBuildable(b); }
static int32_t rootBuildable = NOT_ASKED;
static int32_t aloneBuildable(void) {
  if (rootBuildable != NOT_ASKED) return rootBuildable;
  JudgeOpts jo = { 0, decQ.tight, NOT_ASKED, 0, 0, -1, 0, 0, 0, 0, 0 };
  Judged a;
  judge(&decQ, 0, 0, &jo, &a);
  const Board *eb = a.dead || a.late ? 0 : ensureBoard(judgeCtx, a.endNode);
  if (!eb) return 0;   // (no answer: nothing measured, nothing spent -- asked again)
  return rootBuildable = buildsNext(eb);
}
static Board *endBoard;                      // (lineEnd's board)
static int (*floorOf)(const Board *b);       // (the decision's floor test, decide.c read: 1 kept, 0 not, -1 no floor)
static int32_t materialOn(const Board *b);   // (facts.c: the panels under the lowest garbage, as the facts read the material)
// THE FLOOR SPENT, the one test every reader asks (the shared line check, the rank's keep): a line that clears panels and breaks nothing,
// leaving a board the rules' keep does not hold (floorKept: floorOf on the board the line leaves -- facts.c keepsFloor)
static int spendsFloor(Made m, int32_t floorKept) { return floorKept == 0 && (m.combo > 0 || m.chain > 0) && !(m.broke > 0); }
// THE RESERVE SPENT, beside it: with garbage on the board or on its way, a line that breaks nothing and leaves the window fewer than
// RESERVE actions (core/nodes.h) has spent what the next break is pressed out of
static int spendsReserve(Made m, const Judged *j) { return (decF.under || decF.land != NOT_ASKED) && !(m.broke > 0) && j->leftEnd >= 0 && j->leftEnd < RESERVE; }
// (what the one line check asks of the list, a last resort too with last, and of the floor and the reserve -- lineOk below, the order's
// outcome and rank.c judgeCand asking the same)
static int lineInList(const Judged *j, int last) { return fitsList(&theList, j->made, j, last) && imax(j->made.chain, j->chainAll) <= MAXCHAIN; }
static int lineSpends(const Judged *j, int32_t floorKept) { return spendsFloor(j->made, floorKept) || spendsReserve(j->made, j); }
static Outcome outcome(const int32_t *seq, int n, int settled) { return outcomeOf(seq, n, settled, 0, 0); }
static Outcome outcomeOf(const int32_t *seq, int n, int settled, int waitAt, int32_t waitTo) {
  Outcome *hit = waitTo ? 0 : cached(seq, n, settled, 0);
  if (hit) return *hit;
  // (the board left alone asked first: its judging is the judge's own nodes, which the line's end board is read from below)
  int32_t alone = n > 0 && !waitTo && decF.under ? aloneBuildable() : 0;
  int coming = decF.land != NOT_ASKED;
  int timeLeft = decF.timeLeft >= 0 ? decF.timeLeft : timeLeftMs() > 0;
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
    o.fits = lineInList(&o.j, 1);
    // (a break: whether the board it leaves still has a break to build -- the material the next one needs)
    o.nextBuild = -1;
    o.panelsLeft = -1; o.nearAfter = -1; o.lifeLeft = -1; o.floorKept = -1; o.matLeft = -1;
    if (!waitTo) {
      const Board *eb = ensureBoard(judgeCtx, o.j.endNode);
      if (eb) { o.panelsLeft = panelsOn(eb); o.lifeLeft = lifeOf(o.panelsLeft); o.floorKept = floorOf ? floorOf(eb) : -1; o.matLeft = materialOn(eb); }
      if (eb && endWanted == 1) { if (!endBoard) endBoard = nb_new(); if (endBoard) { cloneBoard(endBoard, eb); endWanted = 2; } }
      // (under garbage, how near the next break is on the board it leaves: a garbage-free board has no break to be near)
      if (eb && decF.under) o.nearAfter = garbageOn(eb) ? nearOf(eb) : 0;
      if (breaks) o.nextBuild = eb ? buildsNext(eb) : -1;
    }
    // (THE NEXT BREAK SPENT: under garbage, a line that breaks nothing, does not stand and leaves no break to build where the board left
    // alone keeps one has spent what the next break needs -- it is lost the frame it is done)
    if (n > 0 && !breaks && !stands && !waitTo && decF.under) {
      const Board *eb = alone ? ensureBoard(judgeCtx, o.j.endNode) : 0;
      if (eb && !buildsNext(eb)) { o.lives = 0; o.spent = 1; o.lostAt = o.j.lostAt = imax(1, o.j.done); }
    }
    // (A PROMISED BREAK IS A REAL ONE: a line that lives only by being ready lives only when its readiness break, played where the
    // readiness found it, lives too -- one that cannot be played out (no line kept, too long, the clock) promises nothing)
    if (o.lives && !breaks && ready == 1 && !(stands && !coming) && !waitTo) {
      if (o.j.readyN > 0 && n + o.j.readyN <= MAXLINE) {
        int32_t ext[MAXLINE];
        for (int k = 0; k < n; k++) ext[k] = seq[k];
        for (int k = 0; k < o.j.readyN; k++) ext[n + k] = o.j.readyLine[k];
        Outcome e = outcomeOf(ext, n + o.j.readyN, settled, n, o.j.readyWait);
        if (e.late) o.late = 1;
        if (e.late || !e.lives) o.lives = 0;
      } else o.lives = 0;
    }
  }
  // (a judging the clock stopped is no answer: it is not kept, and the next asking judges it again)
  if (!o.late && !waitTo && !endNoKeep) keep(seq, n, settled, 0, &o);
  return o;
}
// THE BOARD A LINE ENDS ON, as the judge plays it (the land a proposer reads what falls from: search/fill.c), judged as the proposers
// judge it (readiness deferred to the rank); 0 when the judge could not play the line out. Kept until the next asking.
static Board *lineEnd(const int32_t *seq, int n, int settled) {
  int d = readyDefer; readyDefer = 1; endWanted = 1;
  outcome(seq, n, settled);
  int got = endWanted == 2; endWanted = 0; readyDefer = d;
  return got ? endBoard : 0;
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
// THE ONE LINE CHECK, every search's and the order's: of a line judged (judge.c), what the caller holds it to. Always: not dead, its
// chain within MAXCHAIN, pressed whole (judgedCut). With CHECK_WASTE, no three wasted (judgedWastes); with CHECK_LIST and a list held,
// within the list (lineInList, a last resort too) spending neither the rules' floor nor the reserve (lineSpends). The order drops what
// fails the first two and ranks outside what fails the list (rank.c judgeCand), so a search held to them looks on past a line the order
// would drop. Each line judged once a decision (the cache), whatever it is held to; a check not begun by the deadline keeps no line.
#define CHECK_LIST 1
#define CHECK_WASTE 2
static int lineOk(const Outcome *o, int flags) {
  const Judged *j = &o->j;
  if (j->dead || j->late || imax(j->made.chain, j->chainAll) > MAXCHAIN || judgedCut(j)) return 0;
  if ((flags & CHECK_WASTE) && judgedWastes(j)) return 0;
  if ((flags & CHECK_LIST) && listOn && !(lineInList(j, 1) && !lineSpends(j, o->floorKept))) return 0;
  return 1;
}
// (judged on the question the asking search is rooted at -- the decision's, kept in its cache, or a readiness search's landed board)
static int lineCheckOn(const Question *q, const int32_t *seq, int n, int settled, int flags) {
  int own = q == &decQ;
  Outcome *hit = own ? cached(seq, n, settled, 1) : 0;
  if (hit) return lineOk(hit, flags);
  if (clockOut()) return 0;
  JudgeOpts jo = { settled, q->tight, NOT_ASKED, 0, 0, -1, 0, 0 };
  Outcome o;
  memset(&o, 0, sizeof o);
  judge(q, seq, n, &jo, &o.j);
  if (o.j.late) return 0;
  const Board *eb = o.j.dead || !floorOf ? 0 : ensureBoard(judgeCtx, o.j.endNode);
  o.floorKept = eb ? floorOf(eb) : -1;
  if (own) keep(seq, n, settled, 1, &o);
  return lineOk(&o, flags);
}
static int lineCheck(const int32_t *seq, int n, int settled, int flags) { return lineCheckOn(&decQ, seq, n, settled, flags); }
// (the searches' check: the list, no three wasted; the survival search's: neither -- a line that lives is taken whatever list it is
// outside, and a three the board needs comes from it)
static int lineFits(const int32_t *seq, int n, int settled) { return lineCheck(seq, n, settled, CHECK_LIST | CHECK_WASTE); }
static int lineKept(const int32_t *seq, int n, int settled) { return lineCheck(seq, n, settled, 0); }

// ---- a decision begun: the question (from a node of a host search, until the decision reads its own) and the facts; every line is
// judged again
EXPORT(gb_decision_on) int gb_decision_on(int land, int topped, int timeLeft);
EXPORT(gb_decision_start) int gb_decision_start(Ctx *hx, int i, int tight, int land, int topped, int timeLeft) {
  if (gb_question(hx, i, tight) < 0) return -1;
  return gb_decision_on(land, topped, timeLeft);
}
// the same, on the question already set (gb_question_bytes)
EXPORT(gb_decision_on) int gb_decision_on(int land, int topped, int timeLeft) {
  decQ = hostQ; decQ.b = hostBoard; backBoard = hostBoard;
  Facts f = { land, topped, timeLeft };
  floorOf = 0;   // (a host's question holds no rules' keep: decide.c sets the decision's)
  decF = f;
  ncache = 0; rootBuildable = NOT_ASKED;
  return 0;
}
// (and the decision's press, for a search asked of a logged board: the allowance left, and the pace's gap -- native.c dumpBoard's a, g)
EXPORT(gb_press) void gb_press(int allow, int gap) {
  pressAllowance = allow; decQ.tight = pressTight = allow >= 0 && tightAt(allow); decGap = gap;
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
