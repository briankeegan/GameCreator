// THE RANK (gambit_judge.js judge, hold, compare, digWaits; plans/decision.md step 4): every candidate a proposer offers, judged by its
// outcome and filtered -- a swap back, outside the list, below the floor, too late -- then given its place: one order for every
// candidate, a line that lives before one that does not; of two that live, the tier and its sub-keys; of two that do not, the one
// whose board is lost later.

// A CANDIDATE (gambit_propose.js cand): the play, its swaps, what the search that found it says it makes (x), the entry it was found
// for (aim, -1 none), whether it extends a cascade, how it is judged (settled: -1 as its play is)
typedef struct {
  int32_t set, play, nseq, seq[MAXLINE], aim, extend, settled;
  Xs x; int32_t xFire, xDone, xNats, xAts[MAXLINE];   // xFire/xDone: -1 not said
} Cand;
// A JUDGED CANDIDATE: its place (tier, sub), its outcome, and what the move played reads (ap)
typedef struct {
  Cand k;
  int32_t settled, aim, wait, hold;
  Tier t;
  Outcome o;
  int32_t apDone, apFire, apNats, apAts[MAXLINE], apChain, apChainAll, apCombo, apBroke, apPlayed;
} Judge;
// why a candidate was dropped, counted per decision for the log (DROP_CODE: b back, o list, t late, f floor, r ready, u unbroken)
enum { DROP_BACK, DROP_LIST, DROP_LATE, DROP_FLOOR, DROP_READY, DROP_UNBROKEN, NDROPS };
static int32_t dropped[NPLAYS][NDROPS], offered[NPLAYS];
static void dropAs(int play, int why) { dropped[play][why]++; }

// the decision's reading of the board, which every candidate is judged by (decide.c read)
typedef struct {
  FactSet F; int32_t enemyTopped;
  List list, aims, listAims; int32_t end;
  int32_t by;                      // NOT_ASKED: none
  int32_t under, topped, breakWaits, belowFloor;
  Keep keep; int32_t keepOn;
  int32_t readyAt;                 // NOT_ASKED: none
  int32_t pop, to, low, up;
  int32_t aloneChain, aloneOut;
  int32_t rule;
} Read;

static int judgeCand(const Read *R, const Cand *k0, Judge *J) {
  memset(J, 0, sizeof *J);
  J->k = *k0;
  Cand *k = &J->k;
  int play = k->play, aim = k->aim;
  int st = k->settled >= 0 ? k->settled : settledPlay(play);
  // (what it makes is the whole line on the engine, as the judge counts it -- not what the search that found it counted; a line the
  // judge could not play out is judged on the search's word)
  Outcome oc = outcome(k->seq, k->nseq, st);
  const Judged *j = oc.dead ? 0 : &oc.j;
  Made m = j ? (Made){ j->made.combo, j->made.chain, j->made.broke, k->x.cells } : (Made){ k->x.combo, k->x.chain, k->x.broke, k->x.cells };
  if (j && k->x.broke > 0 && !(j->made.broke > 0)) dropAs(play, DROP_UNBROKEN);
  if (k->nseq && swapBack(CR(k->seq[0]), CC(k->seq[0]), m.combo > 0 || m.chain > 0 || m.broke > 0)) { dropAs(play, DROP_BACK); return 0; }
  // (it fits the list, or it is no candidate -- the chain as the game counts it)
  if (!(j ? fitsList(&R->list, m, j) : fits(&R->list, m))) { dropAs(play, DROP_LIST); return 0; }
  // (below the rule's material floor a line that clears panels and breaks no garbage spends what the board needs)
  if (R->belowFloor && (m.combo > 0 || m.chain > 0) && !(m.broke > 0)) { dropAs(play, DROP_FLOOR); return 0; }
  int entry = entryOf(&R->aims, m);
  if (entry >= 0 && (aim < 0 || entry < aim)) aim = entry;
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
  tx.combo = m.combo; tx.chain = m.chain; tx.broke = m.broke; tx.done = j ? j->done : (k->xDone >= 0 ? k->xDone : 0); tx.dropAt = j ? j->dropAt : 0;
  J->t = tierOf(play, &tx, aim, R->under, R->enemyTopped, R->topped, R->breakWaits);
  // (topped out, the stop time and the shake are the board's life: a line that keeps it held past what is left now comes first)
  const Board *b = decQ.b;
  int32_t stopNow = imax(b->stopTime + b->preStopTime, b->shakeTime);
  if (R->topped && j && j->dropAt > stopNow) { J->t.tier = 0; J->t.nsub = 2; J->t.sub[0] = aim >= 0 ? aim : 99; J->t.sub[1] = -j->dropAt; }
  J->settled = st; J->aim = aim; J->o = oc;
  J->apDone = j ? j->done : k->xDone; J->apFire = fire;
  if (j) { J->apNats = j->nats; for (int i = 0; i < j->nats; i++) J->apAts[i] = j->ats[i]; }
  else { J->apNats = k->xNats; for (int i = 0; i < k->xNats; i++) J->apAts[i] = k->xAts[i]; }
  J->apChain = m.chain; J->apChainAll = j ? j->chainAll : 0; J->apCombo = m.combo; J->apBroke = m.broke; J->apPlayed = !!j;
  return 1;
}
// THE HOLD, a candidate like any other: nothing pressed, its outcome the board's own -- below every play that fits, above a clear
#define HOLD_TIER 5
static void holdCand(int wait, Judge *J) {
  memset(J, 0, sizeof *J);
  J->o = outcome(0, 0, 0);
  J->k.play = PLAY_HOLD; J->k.aim = -1; J->hold = 1; J->wait = wait; J->aim = -1;
  J->t.tier = HOLD_TIER; J->t.nsub = 1; J->t.sub[0] = wait ? -1 : 0;
  const Judged *j = J->o.dead ? 0 : &J->o.j;
  J->apDone = j ? j->done : -1; J->apFire = -1; J->apChainAll = j ? j->chainAll : 0; J->apPlayed = !!j;
}
// A DIG THAT CAN WAIT: a line toward a break that lives no longer than the hold, and is still done before the hold is lost after one
// more decision (react frames)
static int digWaits(const Judge *k, const Judge *H, int32_t react) {
  return k->k.play == PLAY_TOWARD && !k->o.lives && !H->o.lives && H->o.lostAt != NOT_ASKED && k->o.j.done >= 0 && !k->o.dead &&
         k->o.lostAt <= H->o.lostAt && (double)H->o.lostAt - k->o.j.done > react;
}
// THE ONE ORDER: a line that lives before one that does not; of two that do not, the one whose board is lost later; then the tier, then
// each sub-key in turn
static double lostOf(const Judge *x) { return x->o.lostAt == FOREVER ? 1e300 : x->o.lostAt == NOT_ASKED ? -1 : x->o.lostAt; }
static int compareJudged(const Judge *x, const Judge *y) {
  int lx = !!x->o.lives, ly = !!y->o.lives;
  if (lx != ly) return lx ? -1 : 1;
  if (!lx && lostOf(x) != lostOf(y)) return lostOf(y) > lostOf(x) ? 1 : -1;
  if (x->t.tier != y->t.tier) return x->t.tier - y->t.tier;
  int n = x->t.nsub < y->t.nsub ? x->t.nsub : y->t.nsub;
  for (int q = 0; q < n; q++) if (x->t.sub[q] != y->t.sub[q]) return x->t.sub[q] < y->t.sub[q] ? -1 : 1;
  return 0;
}
// sorted stably by the one order, as Array.prototype.sort is
static void sortJudged(Judge **a, int n) {
  static Judge *tmp[512];
  for (int w = 1; w < n; w *= 2)
    for (int lo = 0; lo < n; lo += 2 * w) {
      int mid = lo + w < n ? lo + w : n, hi = lo + 2 * w < n ? lo + 2 * w : n, i = lo, j = mid, k = lo;
      while (i < mid && j < hi) tmp[k++] = compareJudged(a[j], a[i]) < 0 ? a[j++] : a[i++];
      while (i < mid) tmp[k++] = a[i++];
      while (j < hi) tmp[k++] = a[j++];
      for (k = lo; k < hi; k++) a[k] = tmp[k];
    }
}
