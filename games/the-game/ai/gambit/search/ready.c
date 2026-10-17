// READINESS (readyLines, raiseReady): whether the board can break the garbage on its way once it lands, and
// the moves that make it so -- every one asked of breaksAfterLanding (judge.c), the readiness every move that breaks nothing is held to.

static Ctx *readyCtx;
// READY FOR THE GARBAGE ON ITS WAY (readyFor): the board run to the frame the first arrival lands, a break then within two swaps; not
// ready, the first swap after which it is (never the swap back). ready 1/0; setup the swap (0: none).
typedef struct { int32_t ready, setup, at; double ms; } Readied;
static Readied readyFor(const Question *q, double ms) {
  Readied out = { 1, 0, 0, 0 };
  int32_t first = NOT_ASKED;
  for (int i = 0; i < q->narr; i++) if (first == NOT_ASKED || q->arr[i].at < first) first = q->arr[i].at;
  if (first == NOT_ASKED) return out;
  double t0 = nowMs();
  Ctx *x = readyCtx = ctxOf(readyCtx);
  int root = rootOf(x, q);
  out.at = first; out.ready = 0;
  if (root < 0) return out;
  int32_t wait = imax(1, first + 2);
  int now = breaksAfterLanding(x, root, wait, 0, 0);
  if (now == LOST_FIRST || now == 1) { out.ready = now == 1; out.ms = nowMs() - t0; return out; }
  static int32_t ms1[MAXROWS * W];
  int n1 = swapsOfNode(x, root, ms1);
  double shareOld = clockShareBegin(t0 + ms);
  for (int i = 0; i < n1 && !out.setup && !clockOut(); i++) {
    if (!firstOk(CR(ms1[i]), CC(ms1[i]), 0)) continue;   // (a setup clears nothing: never the swap back)
    int n = step(x, root, MK_SWAP, CR(ms1[i]), CC(ms1[i]), 0);
    if (!liveNode(x, n)) continue;
    readyShare(n1 - i);
    if (breaksAfterLanding(x, n, wait, 0, 0) == 1) out.setup = ms1[i];
  }
  readyShare(0);
  clockShareEnd(shareOld);
  out.ms = nowMs() - t0;
  return out;
}

// THE ORDER OF THE FIRST SWAPS: nearest the top of the stack first. The comparator says "b first" only when b is strictly nearer; the
// order it leaves (a run found and turned, then binary insertion) is part of what the search finds first, so it is kept exactly
static int nearerFirst(int32_t a, int32_t b, int32_t top) { int da = CR(a) - top, db = CR(b) - top; if (da < 0) da = -da; if (db < 0) db = -db; return db < da ? 1 : -1; }
static void sortNearTop(int32_t *a, int n, int32_t top) {
  if (n < 2) return;
  int run = 2, desc = nearerFirst(a[1], a[0], top) < 0;
  for (int i = 2; i < n; i++) { int o = nearerFirst(a[i], a[i - 1], top); if (desc ? o >= 0 : o < 0) break; run++; }
  if (desc) for (int i = 0, j = run - 1; i < j; i++, j--) { int32_t t = a[i]; a[i] = a[j]; a[j] = t; }
  for (int s = run; s < n; s++) {
    int32_t pivot = a[s];
    int lo = 0, hi = s;
    while (lo < hi) { int mid = lo + ((hi - lo) >> 1); if (nearerFirst(pivot, a[mid], top) < 0) hi = mid; else lo = mid + 1; }
    for (int k = s; k > lo; k--) a[k] = a[k - 1];
    a[lo] = pivot;
  }
}
// A LINE THAT LEAVES A PLAN (readyLines): of the lines of one swap, then of two from the first swaps that live, the first that, played as
// pressed and run on until the last block shown has landed, leaves a break within two swaps -- each judged on the engine, for as long
// as ms lasts. 1 with seq (one or two swaps) and at (when it is done), else 0.
static int readyLines(const Question *q, int32_t land, double ms, int32_t *seq, int *nseq, int32_t *at) {
  double t0 = nowMs(), shareOld = clockShareBegin(t0 + ms);
  static int32_t firsts[MAXROWS * W], live[MAXROWS * W], seconds[MAXROWS * W];
  int nf = legalSwaps(q->b, firsts), nl = 0, found = 0;
  sortNearTop(firsts, nf, fullTop(q->b));
  JudgeOpts jo = { 0, q->tight, land, 0, 0, -1, 0, 0 };
  Judged j;
  for (int i = 0; i < nf && !clockOut() && !found; i++) {
    judge(q, &firsts[i], 1, &jo, &j);
    if (j.dead || j.late) continue;
    if (!firstOk(CR(firsts[i]), CC(firsts[i]), j.made.combo > 0 || j.made.chain > 0 || j.made.broke > 0)) continue;
    if (j.ready == 1 && lineFits(&firsts[i], 1, 0)) { seq[0] = firsts[i]; *nseq = 1; *at = j.done; found = 1; break; }
    live[nl++] = firsts[i];
  }
  static Board *b1;
  if (!b1) b1 = nb_new();
  for (int i = 0; i < nl && !clockOut() && !found; i++) {
    cloneBoard(b1, q->b); b1->curRow = CR(live[i]); b1->curCol = CC(live[i]);
    if (!tryQueueSwap(b1, CR(live[i]), CC(live[i]))) continue;
    int ns = legalSwaps(b1, seconds);
    for (int k = 0; k < ns && !clockOut(); k++) {
      int32_t two[2] = { live[i], seconds[k] };
      judge(q, two, 2, &jo, &j);
      if (!j.dead && !j.late && j.ready == 1 && firstOk(CR(live[i]), CC(live[i]), j.made.combo > 0 || j.made.chain > 0 || j.made.broke > 0) && lineFits(two, 2, 0)) {
        seq[0] = two[0]; seq[1] = two[1]; *nseq = 2; *at = j.done; found = 1; break;
      }
    }
  }
  clockShareEnd(shareOld);
  return found;
}

// THE ROWS THE RAISE MAY HOLD (raiseReady): the most rows, of `rows`, the stack can be raised by and still have a plan once all the
// garbage shown has landed -- the board raised on the engine, every block landed when the game lands it, then breaksAfterLanding.
#define RAISE_IN 32       // the raise key (IN_RAISE)
#define SETTLE_MAX 600    // frames the board may still be busy after the last block is delivered
static Board *landedAll(const Board *b0, const Arr *arr, int narr, int32_t last, Board *st) {
  cloneBoard(st, b0);
  Arr pend[MAXARR]; int np = 0;
  for (int i = 0; i < narr; i++) pend[np++] = arr[i];
  for (int i = 0; i < last + 2 + SETTLE_MAX && st->gameOverClock <= 0; i++) {
    if (i > last + 1 && !np && !st->ninc && !hasFallingGarbage(st)) return st;
    st->input = 0; run(st);
    int k = 0;
    for (int a = 0; a < np; a++) {
      if (pend[a].at <= i + 1) { Incoming g = { pend[a].width, pend[a].height, pend[a].isChain, pend[a].isMetal & 1, st->stopWatch, 1 }; receiveGarbage(st, &g); }
      else pend[k++] = pend[a];
    }
    np = k;
  }
  return 0;
}
static int32_t raiseReady(const Question *q, int32_t rows, double ms) {
  int32_t last = NOT_ASKED;
  for (int i = 0; i < q->narr; i++) if (last == NOT_ASKED || q->arr[i].at > last) last = q->arr[i].at;
  if (last == NOT_ASKED || rows <= 0) return imax(0, rows);
  double t0 = nowMs();
  int32_t ok = 0, top0 = fullTop(q->b);
  static Board *st, *at;
  if (!st) { st = nb_new(); at = nb_new(); }
  Ctx *x = readyCtx = ctxOf(readyCtx);
  for (int k = 1; k <= rows; k++) {
    cloneBoard(st, q->b);
    int32_t f = 0;
    while (fullTop(st) < top0 + k && st->gameOverClock <= 0 && f < 40 * k) { st->input = RAISE_IN; run(st); f++; }
    if (st->gameOverClock > 0 || fullTop(st) < top0 + k) break;
    Arr left[MAXARR];
    for (int i = 0; i < q->narr; i++) { left[i] = q->arr[i]; left[i].at = imax(0, q->arr[i].at - f); }
    Board *got = landedAll(st, left, q->narr, imax(0, last - f), at);
    if (!got || nowMs() - t0 > ms) break;
    // (a plan once landed: the readiness every move is held to -- a break within two swaps that the list allows)
    Question q2 = *q; q2.b = got; q2.narr = 0;
    int rt = rootOf(x, &q2);
    readyShare(rows - k + 1);
    int r = rt < 0 ? 0 : breaksAfterLanding(x, rt, 1, 0, 0);
    readyShare(0);
    if (r != 1) break;
    ok = k;
  }
  return ok;
}
