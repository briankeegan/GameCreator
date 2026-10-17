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
static Outcome *cached(const int32_t *seq, int n, int settled, int kind) {
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
  if (!cache || ncache >= CACHEN || n > MAXLINE) return 0;
  Cached *c = &cache[ncache++];
  c->h = lineHash(seq, n, settled, kind); c->n = n; c->settled = settled; c->kind = kind;
  for (int k = 0; k < n; k++) c->seq[k] = seq[k];
  c->o = *o;
  return &c->o;
}

// THE OUTCOME. With garbage on its way, a line that breaks nothing lives only when a break is there once everything has landed --
// ready, however long the stop it stands on lasts; a break, or a board with nothing coming, lives by standing to the horizon too.
// Topped out, readiness counts only for a line that buys stop: the board always has to have some stop.
static Outcome outcome(const int32_t *seq, int n, int settled) {
  Outcome *hit = cached(seq, n, settled, 0);
  if (hit) return *hit;
  int coming = decF.land != NOT_ASKED;
  int timeLeft = decF.timeLeft >= 0 ? decF.timeLeft : leftMsOf() > 0;
  JudgeOpts jo = { settled, decQ.tight, timeLeft && coming ? decF.land : NOT_ASKED, !coming, 1, HORIZON + REST, REST, 0 };
  Outcome o;
  memset(&o, 0, sizeof o);
  judge(&decQ, seq, n, &jo, &o.j);
  o.late = o.j.late;
  o.dead = 1; o.lostAt = o.j.lostAt; o.lives = 0; o.ready = NOT_ASKED;
  if (!o.j.dead) {
    const Board *b = decQ.b;
    int32_t stopNow = imax(b->stopTime + b->preStopTime, b->shakeTime);
    int32_t ready = decF.topped && !(o.j.dropAt > stopNow) ? 0 : o.j.ready;
    int breaks = o.j.made.broke > 0, stands = o.j.lostAt == FOREVER;
    o.dead = 0; o.ready = ready;
    o.lives = breaks || !coming ? (stands || ready == 1) : (ready == 1 || (ready == NOT_ASKED && stands));
    o.fits = fitsList(&theList, o.j.made, &o.j) && imax(o.j.made.chain, o.j.chainAll) <= MAXCHAIN;
  }
  // (a judging the clock stopped is no answer: it is not kept, and the next asking judges it again)
  if (!o.late) keep(seq, n, settled, 0, &o);
  return o;
}
// READY FOR THE NEXT BLOCK: after the line, a break in reach once the next block shown has landed -- what a board that cannot be ready
// for everything (the queue outlasts it) can still be ready for. 1, 0, or NOT_ASKED (nothing coming, or out of time).
static int32_t readyNextOf(const int32_t *seq, int n, int settled) {
  if (decF.next == NOT_ASKED) return NOT_ASKED;
  Outcome *hit = cached(seq, n, settled, 2);
  if (hit) return hit->ready;
  if (clockOut()) return NOT_ASKED;
  JudgeOpts jo = { settled, decQ.tight, decF.next, 1, 1, -1, 0, 0 };
  Outcome o;
  memset(&o, 0, sizeof o);
  judge(&decQ, seq, n, &jo, &o.j);
  if (o.j.late) return NOT_ASKED;
  o.ready = !o.j.dead && o.j.ready == 1;
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
  ncache = 0;
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
