// THE FLATTEN SEARCH: under garbage, or with a block on its way, the line that flattens the stack and breaks -- the owner's play on the
// boards the bot died on ("all should be able to drop down the top blocks, or one below, and break with a 3"; "flatten and break").
// Lines of swaps pressed back to back as the frame loop presses them (core/nodes.h step, MK_SWAP: a board kept busy lands nothing), from
// every board kept every legal swap, the boards kept ranked by their shape for a flatten -- fewer empty cells under garbage, more columns
// touching it, a lower peak, an evener stack -- not by the shape math's nearness to a break, which a flatten gets further from first.
// Each line is asked after every swap: once the board has settled, has it broken more garbage than the board left alone has by then?
// A break made by a fall -- panels or a block let down into a match against garbage -- shows only once the board has settled, so the
// swap's own frame is never where it is asked. The line found goes through the shared line check (outcome.c lineCheckOn), as every
// search's does, and is proposed and judged like any other (propose.c).
// (WANTED: garbage on the board resting with a gap under it -- of the columns under the lowest garbage, some whose top panel does not touch
// it (judge.c contactOn): the board the owner's play is for, "drop the top blocks down and break with a three". Elsewhere the break search
// and the extension reach every break a flatten would)
static int flatWanted(const Board *b) { int32_t c, u; contactOn(b, &c, &u); return u > 0 && c < u; }
#define FLAT_BEAM 60
#define FLAT_DEPTH 8
#define FLAT_MS 120
static LOCAL Ctx *flatCtx;
static int32_t flatAsked, flatFound, flatLen, flatSteps; static double flatMsUsed;   // (the decision's, for its log line: fs=)
static uint32_t flatKey(const Board *b) {
  uint32_t h = 2166136261u;
  for (int r = 1; r < b->nrows && r <= b->height + 1; r++) for (int c = 1; c <= W; c++) {
    const int32_t *f = b->p[r][c].f; uint32_t v = f[ISGARBAGE] ? 99u + (uint32_t)(f[GARBAGEID] & 63) : (uint32_t)(f[COLOR] > 0 ? f[COLOR] : 0);
    h = (h ^ v) * 16777619u; }
  h = (h ^ (uint32_t)b->curRow) * 16777619u; h = (h ^ (uint32_t)b->curCol) * 16777619u;
  return h;
}
static int32_t flatShape(const Board *b) {
  static LOCAL BoardShape FS; static LOCAL Bits FB;
  bitsOf(b, &FB); bitsShape(&FB, &FS);
  return -(imin(FS.hollow, 255) << 20) + (imin(FS.contact, 15) << 16) - (imin(FS.top, 63) << 8) - imin(FS.even, 255);
}
// (the board left alone's garbage broken by frame t, from the root: asked once a frame)
static LOCAL int32_t flatStillT[256], flatStillB[256], flatStillN;
static int32_t flatStill(Ctx *x, int root, int32_t t) {
  for (int i = 0; i < flatStillN; i++) if (flatStillT[i] == t) return flatStillB[i];
  int32_t b = aloneBrokeAt(x, root, t);
  if (flatStillN < 256) { flatStillT[flatStillN] = t; flatStillB[flatStillN++] = b; }
  return b;
}
// The line into path (row * 8 + col), its length into *n; 1 found, 0 none in the time (`ms`) or the depth.
static int flattenBreak(const Question *q, double ms, int32_t *path, int *n) {
  *n = 0; flatAsked = 1; flatFound = 0; flatLen = 0; flatSteps = 0;
  if (ms < 1) return 0;
  double t0 = nowMs();
  Ctx *x = flatCtx = ctxOf(flatCtx);
  double old = clockShareBegin(nowMs() + ms);
  int root = rootOf(x, q), found = 0;
  flatStillN = 0;
  static LOCAL int32_t cur[FLAT_BEAM], curMv[FLAT_BEAM], curFrom[FLAT_BEAM], prevNode[FLAT_BEAM];
  static LOCAL int32_t nxt[FLAT_BEAM * MAXROWS * W], par[FLAT_BEAM * MAXROWS * W], mv[FLAT_BEAM * MAXROWS * W], sc[FLAT_BEAM * MAXROWS * W];
  static LOCAL int32_t hist[FLAT_DEPTH + 1][FLAT_BEAM][2];   // (each kept board's parent slot and swap, a level: the line read back)
  static LOCAL uint32_t seen[1 << 12];
  memset(seen, 0, sizeof seen);
  int ncur = root >= 0 ? 1 : 0; if (ncur) { cur[0] = root; curMv[0] = 0; curFrom[0] = -1; }
  for (int d = 0; d < FLAT_DEPTH && ncur && !found && !clockOut(); d++) {
    int nn = 0;
    for (int i = 0; i < ncur && !found && !clockOut(); i++) {
      Board *b = ensureBoard(x, cur[i]); if (!b) continue;
      int32_t ms2[MAXROWS * W]; int nm = legalSwaps(b, ms2);
      for (int k = 0; k < nm && nn < FLAT_BEAM * MAXROWS * W && !clockOut(); k++) {
        // (the owner's rule, rules.c putBackFor: the pair the last swap swapped is never put back for nothing; and a first swap within
        // the rules' first-swap test, as every search's)
        if (curFrom[i] >= 0 && ms2[k] == curMv[i] && NODE(x, cur[i])->cleared == NODE(x, curFrom[i])->cleared && NODE(x, cur[i])->brk == NODE(x, curFrom[i])->brk) continue;
        int c = step(x, cur[i], MK_SWAP, CR(ms2[k]), CC(ms2[k]), 0); flatSteps++;
        if (!liveNode(x, c)) continue;
        if (d == 0 && !firstOk(CR(ms2[k]), CC(ms2[k]), madeBy(x, c, root))) continue;
        int st = settleOf(x, c);
        if (liveNode(x, st) && NODE(x, st)->brk > flatStill(x, root, NODE(x, st)->t)) {
          int32_t line[FLAT_DEPTH + 1]; int L = d + 1; line[d] = ms2[k];
          for (int dd = d - 1, slot = i; dd >= 0; dd--) { line[dd] = hist[dd + 1][slot][1]; slot = hist[dd + 1][slot][0]; }
          if (lineCheckOn(q, line, L, 0, breakOpen ? 0 : CHECK_WASTE)) { for (int j = 0; j < L; j++) path[j] = line[j]; *n = L; found = 1; break; }
          continue;
        }
        Board *cb = ensureBoard(x, c); if (!cb) continue;
        uint32_t key = flatKey(cb), slot = key & ((1 << 12) - 1);
        if (seen[slot] == key) continue;
        seen[slot] = key;
        nxt[nn] = c; par[nn] = i; mv[nn] = ms2[k]; sc[nn] = flatShape(cb); nn++;
      }
    }
    if (found || !nn || d + 1 >= FLAT_DEPTH) break;
    // (the beam kept: the best shapes)
    int keep = nn < FLAT_BEAM ? nn : FLAT_BEAM;
    for (int a = 0; a < keep; a++) {
      int best = a; for (int z = a + 1; z < nn; z++) if (sc[z] > sc[best]) best = z;
      int32_t t;
      t = nxt[a]; nxt[a] = nxt[best]; nxt[best] = t; t = par[a]; par[a] = par[best]; par[best] = t;
      t = mv[a]; mv[a] = mv[best]; mv[best] = t; t = sc[a]; sc[a] = sc[best]; sc[best] = t;
    }
    for (int a = 0; a < ncur; a++) prevNode[a] = cur[a];
    for (int a = 0; a < keep; a++) { curFrom[a] = prevNode[par[a]]; curMv[a] = mv[a]; cur[a] = nxt[a]; hist[d + 1][a][0] = par[a]; hist[d + 1][a][1] = mv[a]; }
    ncur = keep;
  }
  clockShareEnd(old);
  flatFound = found; flatLen = *n; flatMsUsed = nowMs() - t0;
  return found;
}

// (A JOB OF ITS OWN, answer.c JOB_FLAT: on a worker for the decision's whole search time, with garbage over a gap (flatWanted). Its
// answer is taken in searchMerge (propose.c) once the jobs are back)
static int32_t flatOk, flatOutN, flatOut[MAXPATH], flatDone, flatJobOn;
static void flatJobRun(double by) {
  flatOk = 0; flatOutN = 0;
  int n = 0;
  if (flattenBreak(&decQ, by - nowMs(), flatOut, &n)) { flatOutN = n; flatOk = 1; }
}
