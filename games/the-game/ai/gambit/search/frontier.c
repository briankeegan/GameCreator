// THE FRONTIERS CARRIED ON (plans/gambit-state.md): every search's lines, kept at the end of a decision and resumed by the next -- one
// store, one way in and one way out, whatever the search. A frontier is the search's lines as it left them, anchored to a bottom-row
// panel the move played and the swaps handed on did not touch, with what was played; the next decision re-roots it the one way: the
// swaps played since taken off a line they began, a line they never touched carried whole, the rows the stack has risen since added.
// Each swap of a line is kept with the panel it moves as well (pid, side: the panel in its left cell, or in its right where the left is
// empty, as the line's own swaps before it leave the row), and a line is re-rooted by those panels where they are now -- risen, fallen,
// moved by what was played -- so a line the played swaps touched is carried too, and the search's replay judges it within the rules.
// A frontier keyed to something else (the board a block lands on: its frame) is carried while that holds, its lines as they were.
// The frontiers live in the carried state ring (answer.c Carried): what was pressed is the answer played's.
enum { FR_BREAK, FR_PLAN, FR_LANDED, FR_SURVIVE, NFRONT };
static const char *const frontName[NFRONT] = { "break", "plan", "landed", "survive" };
typedef struct {
  int32_t set, gid, anchorRow, anchorCol, anchorId, id, playedHold, played, nhanded, handed[MAXLINE], ntoward, toward[MAXPATH];
  int32_t keyed, key, key2;   // keyed: carried while its key holds, not re-rooted (FR_LANDED: the frame its block lands, near enough, and the block's shape)
  Paths paths;
  int32_t pid[KEEPN][MAXPATH]; uint8_t side[KEEPN][MAXPATH];   // (each swap's panel, and the cell of the pair it is in)
} Kept;
static Kept theFront[NFRONT];
static const Board *frontKeepOn;   // (the board a frontier is kept on, where not the decision's: answer.c onStop, the board a break leaves)
// (the log's, per frontier and decision: the lines kept, those carried in, and why a whole frontier was let go -- 1 the garbage dug
// at changed, 2 the anchor panel gone, 3 its key no longer held)
static int32_t frontLinesHeld[NFRONT], frontLinesIn[NFRONT], frontLetGo[NFRONT], frontById[NFRONT];   // (by id: carried by their panels that the cells alone would have let go)

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
// ---- the panels a line's swaps move: the board's panel ids by cell (garbage and empty cells NUL), each swap played on them in turn
typedef struct { int rows; int32_t g[MAXROWS][W + 2]; } IdGrid;
static void idGridOf(const Board *b, IdGrid *G) {
  G->rows = b->nrows < MAXROWS ? b->nrows : MAXROWS;
  for (int r = 0; r < G->rows; r++) for (int c = 0; c <= W + 1; c++) {
    const int32_t *f = c >= 1 && c <= W && r >= 1 ? b->p[r][c].f : 0;
    G->g[r][c] = f && f[COLOR] && !f[ISGARBAGE] ? f[ID] : NUL;
  }
}
static void idsOf(IdGrid *G, const int32_t *path, int n, int32_t *pid, uint8_t *side) {
  for (int k = 0; k < n; k++) {
    int r = CR(path[k]), c = CC(path[k]);
    if (r < 1 || r >= G->rows || c < 1 || c >= W) { pid[k] = NUL; side[k] = 0; continue; }
    side[k] = G->g[r][c] == NUL; pid[k] = G->g[r][c + side[k]];
    int32_t t = G->g[r][c]; G->g[r][c] = G->g[r][c + 1]; G->g[r][c + 1] = t;
  }
}
// (swaps from..n of a line, by their panels on the grid G: 0 where a panel is gone or its pair is off the row)
static int byIds(IdGrid *G, const int32_t *pid, const uint8_t *side, int from, int n, int32_t *out) {
  for (int k = from; k < n; k++) {
    if (pid[k] == NUL) return 0;
    int rr = -1, cc = -1;
    for (int r = 1; r < G->rows && rr < 0; r++) for (int c = 1; c <= W; c++) if (G->g[r][c] == pid[k]) { rr = r; cc = c; break; }
    int col = cc - side[k];
    if (rr < 0 || col < 1 || col >= W) return 0;
    out[k - from] = rr * 8 + col;
    int32_t t = G->g[rr][col]; G->g[rr][col] = G->g[rr][col + 1]; G->g[rr][col + 1] = t;
  }
  return 1;
}

// THE WAY IN: frontier `kind` kept from `paths` -- anchored to the first bottom-row panel the move (kind 0 hold, 1 swap) and the swaps
// handed on do not touch, with what was played; `toward`, the line toward a break played (the break frontier's), may be 0
static void frontierKeep(int kind, const Paths *paths, int moveKind, int32_t move, const int32_t *handed, int nhanded, int32_t qid,
                         const int32_t *toward, int ntoward) {
  Kept *K = &theFront[kind];
  memset(K, 0, sizeof *K);
  if (!paths || !paths->n || !(moveKind == 0 || moveKind == 1)) return;
  const Board *b = frontKeepOn ? frontKeepOn : decQ.b;
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
    static LOCAL IdGrid G0, G;
    idGridOf(b, &G0);
    for (int i = 0; i < K->paths.n; i++) { G = G0; idsOf(&G, K->paths.path[i], K->paths.len[i], K->pid[i], K->side[i]); }
    return;
  }
}
// (and one keyed to something other than the board: carried while `key` holds, its lines as they were)
// (KEYED TO A BLOCK ON ITS WAY: the frame it lands is an estimate -- a clear's stop or a raise moves it -- so the same block is the same
// shape landing within KEY_SLACK frames of where it was to)
#define KEY_SLACK 120
static void frontierKeepKeyed(int kind, const Paths *paths, int32_t key, int32_t key2) {
  Kept *K = &theFront[kind];
  memset(K, 0, sizeof *K);
  if (!paths || !paths->n) return;
  K->set = 1; K->keyed = 1; K->key = key; K->key2 = key2; K->paths = *paths;
}
// THE WAY OUT: frontier `kind` re-rooted on board `b` into `out` -- never let go whole for what changed: the garbage dug toward no longer
// the lowest, the anchor panel gone, each line comes in by its panels and the search's replay judges it (`digs` kept for the log: the
// garbage changed, 1); `rest`, when not 0, the rest of the line toward a break played (the break frontier's). 0 when nothing came on.
static int frontierResume(int kind, const Board *b, int32_t lineFrom, int32_t linePressed, int digs, Paths *out, int32_t *rest, int *nrest) {
  out->n = 0; if (nrest) *nrest = 0;
  Kept *K = &theFront[kind];
  frontLinesHeld[kind] = K->set ? K->paths.n : 0; frontLinesIn[kind] = 0; frontLetGo[kind] = 0; frontById[kind] = 0;
  if (!K->set || !K->paths.n || K->keyed) return 0;
  if (digs && digTargetOf(b) != K->gid) frontLetGo[kind] = 1;
  int32_t dr = riseSince(b, K->anchorRow, K->anchorCol, K->anchorId), cells = dr != NOT_ASKED;   // (cells: the anchor found, the rows risen known)
  if (!cells) { frontLetGo[kind] = 2; dr = 0; }
  int32_t pre[MAXLINE + 1];
  int npre = playedSince(K, lineFrom, linePressed, pre);
  // (THE LINE TOWARD A BREAK BEGUN: the rest of the one played last, the same moves taken off)
  if (cells && rest && nrest && K->ntoward && startsWith(K->toward, K->ntoward, pre, npre)) {
    *nrest = K->ntoward - npre;
    for (int i = 0; i < *nrest; i++) rest[i] = (CR(K->toward[npre + i]) + dr) * 8 + CC(K->toward[npre + i]);
  }
  // (a line the swaps played since began is carried on from where they left it, the rest whole; each swap pressed on the panel it moves,
  // where that panel is now -- and where a panel is gone, a line the played swaps never touched (no swap played on a cell its swaps move,
  // or beside one) on its cells, risen with the stack. The search plays each again swap by swap within the rules before it grows it)
  static LOCAL IdGrid G0, G;
  idGridOf(b, &G0);
  for (int i = 0; i < K->paths.n && out->n < KEEPN; i++) {
    int from = startsWith(K->paths.path[i], K->paths.len[i], pre, npre) ? npre : 0, t = out->n;
    G = G0;
    if (byIds(&G, K->pid[i], K->side[i], from, K->paths.len[i], out->path[t])) {
      if (!from && touchedBy(K->paths.path[i], K->paths.len[i], pre, npre)) frontById[kind]++;
    } else if (cells && (from || !touchedBy(K->paths.path[i], K->paths.len[i], pre, npre))) {
      for (int k = 0; k < K->paths.len[i] - from; k++) out->path[t][k] = (CR(K->paths.path[i][from + k]) + dr) * 8 + CC(K->paths.path[i][from + k]);
    } else continue;
    out->len[t] = K->paths.len[i] - from;
    out->n++;
  }
  frontLinesIn[kind] = out->n;
  return 1;
}
// (a keyed frontier out: its lines as they were, while its key holds)
static int frontierResumeKeyed(int kind, int32_t key, int32_t key2, Paths *out) {
  out->n = 0;
  Kept *K = &theFront[kind];
  frontLinesHeld[kind] = K->set ? K->paths.n : 0; frontLinesIn[kind] = 0; frontLetGo[kind] = 0;
  if (!K->set || !K->paths.n || !K->keyed) return 0;
  if (K->key2 != key2 || K->key - key > KEY_SLACK || key - K->key > KEY_SLACK) { frontLetGo[kind] = 3; return 0; }
  *out = K->paths; frontLinesIn[kind] = out->n;
  return 1;
}
