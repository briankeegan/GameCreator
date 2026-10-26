// THE FRONTIERS CARRIED ON (plans/gambit-state.md): every search's lines, kept at the end of a decision and resumed by the next -- one
// store, one way in and one way out, whatever the search. A frontier is the search's lines as it left them, anchored to a bottom-row
// panel the move played and the swaps handed on did not touch, with what was played; the next decision re-roots it the one way: the
// swaps played since taken off a line they began, a line they never touched carried whole, the rows the stack has risen since added.
// A frontier keyed to something else (the board a block lands on: its frame) is carried while that holds, its lines as they were.
// The frontiers live in the carried state ring (answer.c Carried): what was pressed is the answer played's.
enum { FR_BREAK, FR_PLAN, FR_LANDED, FR_SURVIVE, NFRONT };
static const char *const frontName[NFRONT] = { "break", "plan", "landed", "survive" };
typedef struct {
  int32_t set, gid, anchorRow, anchorCol, anchorId, id, playedHold, played, nhanded, handed[MAXLINE], ntoward, toward[MAXPATH];
  int32_t keyed, key;   // keyed: carried while `key` holds, not re-rooted (FR_LANDED: the frame its block lands)
  Paths paths;
} Kept;
static Kept theFront[NFRONT];
// (the log's, per frontier and decision: the lines kept, those carried in, and why a whole frontier was let go -- 1 the garbage dug
// at changed, 2 the anchor panel gone, 3 its key no longer held)
static int32_t frontHeld[NFRONT], frontIn[NFRONT], frontWhy[NFRONT];

// ---- the garbage a frontier digs toward: the id of the lowest block on the board
static int lowestGarbageRowOf(const Board *b) {
  for (int r = 1; r < b->nrows; r++) for (int c = 1; c <= W; c++) if (b->p[r][c].f[ISGARBAGE]) return r;
  return 0;
}
static int32_t digTargetOf(const Board *b) {
  int r = lowestGarbageRowOf(b);
  if (r) for (int k = 1; k <= W; k++) if (b->p[r][k].f[ISGARBAGE]) return b->p[r][k].f[GARBAGEID];
  return NUL;
}
static int32_t riseSince(const Board *b, int row, int col, int32_t id) {
  for (int r = 1; r < b->nrows; r++) if (b->p[r][col].f[ID] == id) return r - row;
  return NOT_ASKED;
}
static int playedSince(const Kept *K, int32_t lineFrom, int32_t linePressed, int32_t *pre) {
  int n = lineFrom == K->id && K->nhanded ? imin(linePressed, K->nhanded) : 0, k = 0;
  if (!K->playedHold) pre[k++] = K->played;
  for (int i = 0; i < n; i++) pre[k++] = K->handed[i];
  return k;
}
static int touchedBy(const int32_t *p, int np, const int32_t *pre, int npre) {
  for (int i = 0; i < npre; i++) for (int k = 0; k < np; k++) if (CR(pre[i]) == CR(p[k]) && CC(pre[i]) - CC(p[k]) <= 1 && CC(p[k]) - CC(pre[i]) <= 1) return 1;
  return 0;
}
static int startsWith(const int32_t *p, int np, const int32_t *pre, int npre) { if (np <= npre) return 0; for (int i = 0; i < npre; i++) if (p[i] != pre[i]) return 0; return 1; }

// THE WAY IN: frontier `kind` kept from `paths` -- anchored to the first bottom-row panel the move (kind 0 hold, 1 swap) and the swaps
// handed on do not touch, with what was played; `toward`, the line toward a break played (the break frontier's), may be 0
static void frontierKeep(int kind, const Paths *paths, int moveKind, int32_t move, const int32_t *handed, int nhanded, int32_t qid,
                         const int32_t *toward, int ntoward) {
  Kept *K = &theFront[kind];
  memset(K, 0, sizeof *K);
  if (!paths || !paths->n || !(moveKind == 0 || moveKind == 1)) return;
  const Board *b = decQ.b;
  for (int col = 1; col <= W; col++) {
    int32_t id = b->p[1][col].f[ID];
    if (id == NUL) continue;
    int touched = 0;
    if (moveKind == 1 && CR(move) == 1 && (CC(move) == col || CC(move) + 1 == col)) touched = 1;
    for (int i = 0; i < nhanded; i++) if (CR(handed[i]) == 1 && (CC(handed[i]) == col || CC(handed[i]) + 1 == col)) touched = 1;
    if (touched) continue;
    K->set = 1; K->paths = *paths; K->gid = digTargetOf(b); K->anchorRow = 1; K->anchorCol = col; K->anchorId = id; K->id = qid;
    K->playedHold = moveKind == 0; K->played = move; K->nhanded = nhanded; for (int i = 0; i < nhanded; i++) K->handed[i] = handed[i];
    K->ntoward = toward ? ntoward : 0; for (int i = 0; i < K->ntoward; i++) K->toward[i] = toward[i];
    return;
  }
}
// (and one keyed to something other than the board: carried while `key` holds, its lines as they were)
static void frontierKeepKeyed(int kind, const Paths *paths, int32_t key) {
  Kept *K = &theFront[kind];
  memset(K, 0, sizeof *K);
  if (!paths || !paths->n) return;
  K->set = 1; K->keyed = 1; K->key = key; K->paths = *paths;
}
// THE WAY OUT: frontier `kind` re-rooted on board `b` into `out`; `digs`: let go when the garbage it dug toward is no longer the lowest;
// `rest`, when not 0, the rest of the line toward a break played (the break frontier's). 0 when nothing came on.
static int frontierResume(int kind, const Board *b, int32_t lineFrom, int32_t linePressed, int digs, Paths *out, int32_t *rest, int *nrest) {
  out->n = 0; if (nrest) *nrest = 0;
  Kept *K = &theFront[kind];
  frontHeld[kind] = K->set ? K->paths.n : 0; frontIn[kind] = 0; frontWhy[kind] = 0;
  if (!K->set || !K->paths.n || K->keyed) return 0;
  if (digs && digTargetOf(b) != K->gid) { frontWhy[kind] = 1; return 0; }
  int32_t dr = riseSince(b, K->anchorRow, K->anchorCol, K->anchorId);
  if (dr == NOT_ASKED) { frontWhy[kind] = 2; return 0; }
  int32_t pre[MAXLINE + 1];
  int npre = playedSince(K, lineFrom, linePressed, pre);
  // (THE LINE TOWARD A BREAK BEGUN: the rest of the one played last, the same moves taken off)
  if (rest && nrest && K->ntoward && startsWith(K->toward, K->ntoward, pre, npre)) {
    *nrest = K->ntoward - npre;
    for (int i = 0; i < *nrest; i++) rest[i] = (CR(K->toward[npre + i]) + dr) * 8 + CC(K->toward[npre + i]);
  }
  // (a line the swaps played since began is carried on from where they left it; one they never touched -- no swap played on a cell its
  // swaps move, or beside one -- is carried on whole: what was played elsewhere changed nothing it presses, and the search plays it again
  // swap by swap within the rules before it grows it)
  for (int i = 0; i < K->paths.n && out->n < KEEPN; i++) {
    int from;
    if (startsWith(K->paths.path[i], K->paths.len[i], pre, npre)) from = npre;
    else if (!touchedBy(K->paths.path[i], K->paths.len[i], pre, npre)) from = 0;
    else continue;
    int t = out->n++;
    out->len[t] = K->paths.len[i] - from;
    for (int k = 0; k < out->len[t]; k++) out->path[t][k] = (CR(K->paths.path[i][from + k]) + dr) * 8 + CC(K->paths.path[i][from + k]);
  }
  frontIn[kind] = out->n;
  return 1;
}
// (a keyed frontier out: its lines as they were, while its key holds)
static int frontierResumeKeyed(int kind, int32_t key, Paths *out) {
  out->n = 0;
  Kept *K = &theFront[kind];
  frontHeld[kind] = K->set ? K->paths.n : 0; frontIn[kind] = 0; frontWhy[kind] = 0;
  if (!K->set || !K->paths.n || !K->keyed) return 0;
  if (K->key != key) { frontWhy[kind] = 3; return 0; }
  *out = K->paths; frontIn[kind] = out->n;
  return 1;
}
