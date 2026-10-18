// THE BREAK SEARCH (as Gambit asks it: maxDepth 1, no line kept from the default bot's touch line).
// Garbage on the board, a break is a line after which more garbage is broken than the board left alone breaks by the same frame (a
// popping slab goes on converting whatever is pressed). In order, the first that finds one answers:
//   1. a first swap that breaks;
//   2. resting garbage, nothing popping: THE TOUCH BEAM -- lines kept by how near a break they are (breakNear, then how even the stack
//      under the garbage is), grown a swap a level for TOUCH_DEPTH levels, TOUCH_BEAM wide and then TOUCH_WIDER; the lines the last
//      decision was growing (resume) are played again first and carried on;
//   3. a slab popping (wait: the frames of pop left): a first swap after which the pop's end breaks; then the first of a pair; then the
//      aimed lineup (the colours the converting row turns into, met by pairs on top of their columns); then a first swap leaving a
//      break one swap away once the board has settled; then, the cursor being free, the touch beam on the garbage elsewhere.
// Every line is held to the decision's rules as it is grown (stepOk: each step within the list; firstOk: a first swap that is no swap
// back) and a break is taken only through the shared line check (lineFits). Every step is the clock's: past its share the search
// ends with what it has.

#define TOUCH_DEPTH 8
#define TOUCH_BEAM 30
#define TOUCH_WIDE 100     // TOUCH_WIDER, the one wider beam
#define LONGEST (2 * TOUCH_DEPTH)   // a line carried on to the next decision is shorter than this
#define KEEPN TOUCH_BEAM            // the lines carried on
#define LINEUP_BUDGET 400
#define LINEUP_DEPTH 8
#define LINEUP_BEAM 8
#define PAIR 5
#define NEAR_MISS 20
#define MAXPATH 32
#define LINEUP_AFTER 30
#define LINEPOOL 8192   // lines one level holds: TOUCH_WIDE x the swaps of a board

typedef struct { int32_t key, n, s, h, len, kept; int32_t path[MAXPATH]; } Line;
typedef struct { int32_t n, len[KEEPN]; int32_t path[KEEPN][MAXPATH]; } Paths;
// THE ANSWER (breakMoves' return): depth 1 with the first swaps that break (moves) and how -- the line (path), the line-up pairs
// (lines, one per first swap found), or depth 0 with the line nearest a break (toward) and the lines to choose among (towards)
typedef struct {
  int32_t depth, nmoves, moves[MAXROWS * W];
  int32_t at, touch, carried, wide, lineup;        // lineup: 0 none, 1 the pop's end, 2 a pair, 3 aimed, 4 ready
  int32_t built;                                    // the line breakNear builds (the nearest break walked to)
  int32_t pathLen, path[MAXPATH];
  int32_t pairs[MAXROWS * W][2];                    // lines, beside moves (lineup 2 and 4)
  int32_t towardLen, toward[MAXPATH];
  Paths towards;                                    // keepOut's lines, then toward
  Paths keepOut;                                    // what the next decision carries on
} Broke;

static Ctx *breakCtx;
// THE LINES' ROOM: a line carries its own path, so a level's lines are let go once the next level is made -- two arenas a level at a time
// (arena 0 and 1, in turn), and one for what lives through the whole search (the carried lines, the first swaps, the line-ups). A line
// that finds no room ends the search where it is, and says so (Broke.full).
#define LINEARENA 8192
static Line *arena[3]; static int32_t arenaN[3], linesFull;
static Line *lineIn(int a) {
  if (!arena[a]) arena[a] = (Line *)grab(sizeof(Line) * LINEARENA);
  if (!arena[a] || arenaN[a] >= LINEARENA) { linesFull = 1; return 0; }
  return &arena[a][arenaN[a]++];
}
#define KEEPS 2   // the arena of what lives through the search
#define SEARCH_OUT() (clockOut() || linesFull)
static Line *lineNew(void) { return lineIn(KEEPS); }

// ---- the grid (rows 0..height+1, 0 empty, -2 garbage, else the colour)
static int32_t cellAt(const Board *b, int r, int c) { return r < 0 || r > b->height + 1 || c < 1 || c > W ? 0 : gridCell(b, r, c); }
static int32_t gridLen(const Board *b) { return b->height + 2; }
// the lowest row with garbage, from row 1 (G = grid length when none)
static int lowestG(const Board *b) {
  int R = gridLen(b);
  for (int r = 1; r < R; r++) for (int c = 1; c <= W; c++) if (cellAt(b, r, c) < 0) return r;
  return R;
}
// How uneven the stack under the lowest garbage is: each column's shortfall from the tallest, squared
static int32_t uneven(const Board *b) {
  int G = lowestG(b), hi = 0, tops[W + 1];
  for (int c = 1; c <= W; c++) { int t = 0; for (int r = 1; r < G; r++) if (cellAt(b, r, c) > 0) t = r; tops[c] = t; if (t > hi) hi = t; }
  int32_t u = 0;
  for (int c = 1; c <= W; c++) u += (hi - tops[c]) * (hi - tops[c]);
  return u;
}
// HOW MANY SWAPS AWAY THE NEAREST BREAK IS (breakNear): the fewest swaps that line up a match of three with a panel touching garbage --
// each other panel of the match brought along its own row, over cells that hold it up and are not garbage. NEAR_MISS when none.
static int heldAt(const Board *b, int top, int q, int k) {
  int32_t v = q >= 1 && q <= top ? cellAt(b, q, k) : 0, under = q - 1 >= 1 && q - 1 <= top ? cellAt(b, q - 1, k) : 0;
  return v >= 0 && (q == 1 || under != 0);
}
static int32_t cellIn(const Board *b, int top, int q, int k) { return q >= 1 && q <= top ? cellAt(b, q, k) : 0; }
// the swaps that bring a panel of colour want in row q to column k, not taking a column in used: { d, from }, d < 0 for none
static int bring(const Board *b, int top, int q, int k, int32_t want, const int *used, int *from) {
  if (cellIn(b, top, q, k) == want && !used[k]) { *from = k; return 0; }
  int best = -1;
  for (int dir = -1; dir <= 1; dir += 2) {
    int ok = heldAt(b, top, q, k);
    for (int j = k + dir; j >= 1 && j <= W && ok; j += dir) {
      if (cellIn(b, top, q, j) == want && !used[j]) { int d = j > k ? j - k : k - j; if (best < 0 || d < best) { best = d; *from = j; } break; }
      if (!heldAt(b, top, q, j)) ok = 0;
    }
  }
  return best;
}
// the swaps that walk the panel at (q, from) to column k along its row
static int walkTo(int q, int from, int k, int32_t *seq, int n) {
  if (from > k) for (int c = from - 1; c >= k && n < MAXPATH; c--) seq[n++] = q * 8 + c;
  else for (int c = from; c < k && n < MAXPATH; c++) seq[n++] = q * 8 + c;
  return n;
}
// (and the line that makes it: seq, *nseq -- each panel walked in turn; 0 for none)
static int breakNearLine(const Board *b, int32_t *seq, int *nseq) {
  int top = gridLen(b) - 2, best = 1 << 30;
  if (nseq) *nseq = 0;
  for (int r = 1; r <= top; r++) for (int c = 1; c <= W; c++) {
    int32_t k = cellIn(b, top, r, c);
    if (!(k > 0) || !(cellIn(b, top, r + 1, c) < 0 || cellIn(b, top, r - 1, c) < 0 || (c > 1 && cellIn(b, top, r, c - 1) < 0) || (c < W && cellIn(b, top, r, c + 1) < 0))) continue;
    // a column of three through it
    for (int r0 = r - 2; r0 <= r; r0++) {
      if (r0 < 1 || r0 + 2 > top) continue;
      int dv = 0, none[W + 2] = { 0 }, from, fr[3] = { 0 }, qs[3] = { 0 }, nq = 0;
      for (int q = r0; q <= r0 + 2 && dv < best; q++) { if (q == r) continue; int d = bring(b, top, q, c, k, none, &from); if (d >= 0) { dv += d; qs[nq] = q; fr[nq++] = from; } else dv = 1 << 30; }
      if (dv < best) { best = dv; if (seq) { int n = 0; for (int i = 0; i < nq; i++) n = walkTo(qs[i], fr[i], c, seq, n); *nseq = n; } }
    }
    // a row of three through it
    for (int c0 = c - 2; c0 <= c; c0++) {
      if (c0 < 1 || c0 + 2 > W) continue;
      int used[W + 2] = { 0 }, dh = 0, from, fr[3] = { 0 }, ts[3] = { 0 }, nt = 0;
      used[c] = 1;
      for (int t = c0; t <= c0 + 2 && dh < best; t++) { if (t == c) continue; int d = bring(b, top, r, t, k, used, &from); if (d >= 0) { used[from] = 1; dh += d; ts[nt] = t; fr[nt++] = from; } else dh = 1 << 30; }
      if (dh < best) { best = dh; if (seq) { int n = 0; for (int i = 0; i < nt; i++) n = walkTo(r, fr[i], ts[i], seq, n); *nseq = n; } }
    }
  }
  return best;
}
static int breakNear(const Board *b) { return breakNearLine(b, 0, 0); }
static int nearOf(const Board *b) { return imin(breakNear(b), NEAR_MISS); }
static int breakBuildable(const Board *b) { return breakNear(b) < NEAR_MISS; }
static int garbageOn(const Board *b) { return lowestG(b) < gridLen(b); }
// the panels on the board, garbage not counted -- the material every break is made from
static int32_t panelsOn(const Board *b) { int32_t n = 0, R = gridLen(b); for (int r = 1; r < R; r++) for (int c = 1; c <= W; c++) if (cellAt(b, r, c) > 0) n++; return n; }
static int32_t nearScore(const Board *b) { int n = breakNear(b); return -1000 * (n < NEAR_MISS ? n : NEAR_MISS) - uneven(b); }
// How far a board is toward lining up with the converting row `want`: per column, its top panel below the lowest garbage of that colour,
// and the one under it too
static int32_t pairsOf(const Board *b, const int32_t *want) {
  int G = lowestG(b);
  int32_t s = 0;
  for (int c = 1; c <= W; c++) {
    if (!want[c]) continue;
    int t = 0;
    for (int r = 1; r < G; r++) if (cellAt(b, r, c) > 0) t = r;
    if (t && cellAt(b, t, c) == want[c]) s += t > 1 && cellAt(b, t - 1, c) == want[c] ? PAIR : 1;
  }
  return s;
}
// The colours the row a popping slab converts has dealt, per column (0 where none), from the board as the game shows it; 0 if none.
static int converting(const Board *b, int32_t *want) {
  for (int r = 1; r < b->nrows; r++) {
    int any = 0;
    for (int c = 1; c <= W; c++) {
      const int32_t *f = b->p[r][c].f;
      if (f[ISGARBAGE] && f[STATE] == MATCHED && f[COLOR] >= 1 && f[COLOR] <= 8) { want[c] = f[COLOR]; any = 1; } else want[c] = 0;
    }
    if (any) return 1;
  }
  return 0;
}

// ---- the search
typedef struct {
  Ctx *x; int root, wait;
  Broke *out;
  const Paths *resume;
  int32_t *outside;      // per node: made off the rules (stepOk) -- a break counts only on a line within them from its first swap
  int32_t idleT[256], idleB[256], nIdle;
  int32_t anyFound;
  int32_t towardS, haveToward, towardLen, toward[MAXPATH];
  int32_t tries;
} BS;
static int32_t outsideBuf[1 << 20];
// A break is one standing still would not have made by the same frame (still): the root left alone, its breaks at frame t.
static int32_t stillAt(BS *s, int32_t t) {
  for (int i = 0; i < s->nIdle; i++) if (s->idleT[i] == t) return s->idleB[i];
  Ctx *x = s->x;
  int w = t > NODE(x, s->root)->t ? step(x, s->root, MK_LONG, 0, 0, t - NODE(x, s->root)->t) : s->root;
  int32_t b = w >= 0 ? NODE(x, w)->brk : NODE(x, s->root)->brk;
  if (s->nIdle < 256) { s->idleT[s->nIdle] = t; s->idleB[s->nIdle++] = b; }
  return b;
}
static int within(BS *s, int i) { return !(BREAK_LIST && i >= 0 && i < (1 << 20) && s->outside[i]); }
// (every node a step makes is marked as the rules see it: off them when its parent was, when it is a first swap that is a swap back,
// or when its own clears are outside the list)
static void markStep(BS *s, int par, int kind, int mv, int o) {
  Ctx *x = s->x;
  if (!BREAK_LIST || !liveNode(x, o) || o >= (1 << 20)) return;
  int fromRoot = par == s->root, firstBad = 0;
  if (fromRoot && kind == MK_SWAP) {
    Stats st; statsOf(x, o, &st);
    firstBad = !firstOk(CR(mv), CC(mv), NODE(x, o)->brk > stillAt(s, NODE(x, o)->t) ? 2 : st.cleared > 0);
  }
  s->outside[o] = (par >= 0 && par < (1 << 20) && s->outside[par]) || firstBad || !stepFitsAt(x, o);
}
static int stepMarked(BS *s, int par, int kind, int mv, int32_t frames) {
  int o = step(s->x, par, kind, kind == MK_SWAP || kind == MK_SETTLE ? CR(mv) : 0, kind == MK_SWAP || kind == MK_SETTLE ? CC(mv) : 0, frames);
  markStep(s, par, kind, mv, o);
  return o;
}
// THE BREAK: more broken than standing still by then, within the rules, played through its settle within the list,
// and its whole line through the shared line check. Past the clock no check is asked, and nothing breaks.
static int allowedAt(Ctx *x, int o) {
  if (!liveNode(x, o) || !stepFitsAt(x, o)) return 0;
  int z = settleOf(x, o);
  return liveNode(x, z) && stepFitsAt(x, z);
}
static int breaksAt(BS *s, int n, const int32_t *path, int len) {
  Ctx *x = s->x;
  if (!liveNode(x, n) || !within(s, n) || !(NODE(x, n)->brk > stillAt(s, NODE(x, n)->t))) return 0;
  if (clockOut()) return 0;
  return (!BREAK_LIST || allowedAt(x, n)) && (!path || !BREAK_LIST || lineFits(path, len, 0));
}
static int swapsOfNode(Ctx *x, int n, int32_t *ms) { Board *b = ensureBoard(x, n); return b ? legalSwaps(b, ms) : 0; }
static void keepPaths(Paths *p, Line **ls, int n) {
  p->n = 0;
  for (int i = 0; i < n && p->n < KEEPN; i++) {
    if (ls[i]->len >= LONGEST) continue;
    p->len[p->n] = ls[i]->len;
    for (int k = 0; k < ls[i]->len; k++) p->path[p->n][k] = ls[i]->path[k];
    p->n++;
  }
}
static int foundAlready(Broke *o, int32_t key) { for (int i = 0; i < o->nmoves; i++) if (o->moves[i] == key) return i; return -1; }
static int found(Broke *o, int32_t key) { int i = foundAlready(o, key); if (i >= 0) return i; o->moves[o->nmoves] = key; return o->nmoves++; }
static void setPath(Broke *o, const int32_t *path, int len) { o->pathLen = len; for (int k = 0; k < len; k++) o->path[k] = path[k]; }

// THE TOUCH BEAM (touchBeam): the carried lines first, then the first swaps, grown a level at a time
static int touchBeam(BS *s, Line **firsts, int nfirsts) {
  Ctx *x = s->x;
  Broke *o = s->out;
  static Line *seeds[LINEPOOL], *act[LINEPOOL], *nxt[LINEPOOL], *tl0[LINEPOOL], *tl[LINEPOOL], *tn[LINEPOOL], *kept[LINEPOOL];
  static int32_t idx[LINEPOOL], tmp[LINEPOOL], keyS[LINEPOOL], ms[MAXROWS * W];
  // (the search carried on: the lines the last decision's beam was growing, played again swap by swap within the rules)
  int nseeds = 0, nact = 0;
  for (int i = 0; s->resume && i < s->resume->n; i++) {
    if (!(s->resume->len[i] > 0 && s->resume->len[i] < LONGEST)) continue;
    Line *a = lineNew(); if (!a) break;
    a->len = s->resume->len[i]; for (int k = 0; k < a->len; k++) a->path[k] = s->resume->path[i][k];
    a->n = s->root; a->kept = 0;   // kept: the swaps played so far
    act[nact++] = a;
  }
  while (nact && !SEARCH_OUT()) {
    int nn = 0;
    for (int i = 0; i < nact; i++) {
      Line *a = act[i];
      int mv = a->path[a->kept];
      if (!legalAt(x, a->n, CR(mv), CC(mv))) continue;
      int out = stepMarked(s, a->n, MK_SWAP, mv, 0);
      if (!liveNode(x, out) || !within(s, out)) continue;
      a->n = out; a->kept++;
      if (a->kept == a->len) { a->key = a->path[0]; seeds[nseeds++] = a; } else nxt[nn++] = a;
    }
    for (int i = 0; i < nn; i++) act[i] = nxt[i];
    nact = nn;
  }
  if (nseeds) keepPaths(&o->keepOut, seeds, nseeds);
  for (int i = 0; i < nseeds; i++)
    if (breaksAt(s, seeds[i]->n, seeds[i]->path, seeds[i]->len)) {
      found(o, seeds[i]->key); o->touch = 1; o->carried = 1; setPath(o, seeds[i]->path, seeds[i]->len); o->at = NODE(x, seeds[i]->n)->t;
      return 1;
    }
  int n0 = 0;
  for (int i = 0; i < nseeds; i++) tl0[n0++] = seeds[i];
  for (int i = 0; i < nfirsts; i++) if (liveNode(x, firsts[i]->n) && within(s, firsts[i]->n)) tl0[n0++] = firsts[i];
  int tpath = 0;
  for (int tb = 0; tb < 2 && !tpath && !SEARCH_OUT(); tb++) {
    int beam = tb ? TOUCH_WIDE : TOUCH_BEAM, ntl = n0;
    for (int i = 0; i < n0; i++) tl[i] = tl0[i];
    for (int td = 2; td <= TOUCH_DEPTH && ntl && !tpath && !SEARCH_OUT(); td++) {
      // (how near a break each line's board is, read on the board once what the line cleared has fallen -- settled a batch at a
      // time while the clock allows: past it the rest are scored as they stand)
      for (int i = 0; i < ntl; i++) {
        Line *l = tl[i];
        int32_t sc = nearScore(ensureBoard(x, l->n));
        Stats st;
        if (statsOf(x, l->n, &st) && st.cleared > 0) { int w = settleOf(x, l->n); if (liveNode(x, w)) { int32_t s2 = nearScore(ensureBoard(x, w)); if (s2 > sc) sc = s2; } }
        l->s = sc; l->h = (int32_t)NODE(x, l->n)->hash;
        idx[i] = i; keyS[i] = sc;
      }
      sortByKeyDesc(idx, ntl, keyS, tmp);
      for (int i = 0; i < ntl; i++) tn[i] = tl[idx[i]];
      for (int i = 0; i < ntl; i++) tl[i] = tn[i];
      // (the line nearest a break the beam has seen: TOWARD, returned when no break is found)
      if (ntl && (!s->haveToward || tl[0]->s > s->towardS)) { s->haveToward = 1; s->towardS = tl[0]->s; s->towardLen = tl[0]->len; for (int k = 0; k < tl[0]->len; k++) s->toward[k] = tl[0]->path[k]; }
      keepPaths(&o->keepOut, tl, ntl < KEEPN ? ntl : KEEPN);
      // Swaps made in another order often leave the same board: each board is kept once, its best-scoring line.
      int nk = 0;
      for (int i = 0; i < ntl && nk < beam; i++) {
        Line *l = tl[i];
        Node *ln = NODE(x, l->n);
        int dup = 0;
        for (int q = 0; q < nk && !dup; q++) {
          Node *kn = NODE(x, kept[q]->n);
          if ((int32_t)kn->hash != l->h || kn->keyn != ln->keyn) continue;
          dup = memcmp(kn->key, ln->key, sizeof(int32_t) * ln->keyn) == 0;
        }
        if (!dup) kept[nk++] = l;
      }
      ntl = nk;
      for (int i = 0; i < nk; i++) tl[i] = kept[i];
      int ntn = 0, ar = td & 1;
      arenaN[ar] = 0;   // (the level before last: its lines are let go)
      for (int i = 0; i < ntl && !tpath; i++) {
        int nm = swapsOfNode(x, tl[i]->n, ms);
        for (int j = 0; j < nm; j++) {
          int t3 = stepMarked(s, tl[i]->n, MK_SWAP, ms[j], 0);
          if (!liveNode(x, t3)) continue;
          Line *nl = lineIn(ar); if (!nl) break;
          *nl = *tl[i]; nl->n = t3; if (nl->len < MAXPATH) nl->path[nl->len++] = ms[j];
          if (breaksAt(s, t3, nl->path, nl->len)) { found(o, tl[i]->key); setPath(o, nl->path, nl->len); o->at = NODE(x, t3)->t; tpath = 1; break; }
          if (within(s, t3)) tn[ntn++] = nl;
        }
      }
      // (and the level expanded: its boards are its children's now -- the frontier the next decision carries on, in its parents' order)
      if (ntn) keepPaths(&o->keepOut, tn, ntn < KEEPN ? ntn : KEEPN);
      for (int i = 0; i < ntn; i++) tl[i] = tn[i];
      ntl = ntn;
    }
    if (tpath) { o->touch = 1; o->wide = tb; return 1; }
  }
  return 0;
}

// ---- a slab popping: the line-ups (wait > 0)
// whether each node breaks once the pop is over (end: the frame it ends, from the root)
static void linedAll(BS *s, const int *ns, int n, int32_t end, int *out) {
  for (int q = 0; q < n; q++) {
    out[q] = 0;
    if (!liveNode(s->x, ns[q])) continue;
    int w = stepMarked(s, ns[q], MK_LONG, 0, imax(1, end - NODE(s->x, ns[q])->t));
    out[q] = breaksAt(s, w, 0, 0);
  }
}
// Each parent's swaps in turn, as many as `cap` tries leave, till one of them hits: a hit marks the parent's first move and its pair,
// and the next parent goes on (inTurn). hits: 0 the pop's end breaks after the second swap, 1 the second swap itself breaks.
typedef struct { int32_t key, n, m; } Parent;
static void inTurn(BS *s, const Parent *ps, int np, int cap, int hits, int32_t end) {
  Ctx *x = s->x;
  Broke *o = s->out;
  static int32_t ms[MAXROWS * W];
  for (int k = 0; k < np && s->tries < cap && !SEARCH_OUT(); k++) {
    int nm = swapsOfNode(x, ps[k].n, ms);
    for (int j = 0; j < nm && s->tries < cap; j++) {
      s->tries++;
      int n2 = step(x, ps[k].n, MK_SWAP, CR(ms[j]), CC(ms[j]), 0), hit;
      markStep(s, ps[k].n, MK_SWAP, ms[j], n2);
      if (hits == 0) { int one = liveNode(x, n2) && NODE(x, n2)->t < end ? n2 : -1; linedAll(s, &one, 1, end, &hit); }
      else hit = breaksAt(s, n2, 0, 0);
      if (hit) { int f = found(o, ps[k].key); o->pairs[f][0] = ps[k].m; o->pairs[f][1] = ms[j]; s->anyFound = 1; break; }
    }
  }
}
static int lineups(BS *s, Line **firsts, int nfirsts) {
  Ctx *x = s->x;
  Broke *o = s->out;
  int32_t end = NODE(x, s->root)->t + s->wait;
  static int ns[MAXROWS * W], hit[MAXROWS * W];
  static Parent ps[MAXROWS * W];
  for (int q = 0; q < nfirsts; q++) ns[q] = firsts[q]->n;
  linedAll(s, ns, nfirsts, end, hit);
  for (int q = 0; q < nfirsts; q++) if (hit[q]) found(o, firsts[q]->key);
  if (o->nmoves) { o->lineup = 1; return 1; }
  // a pop is long enough for two swaps: the first of a pair that lines up
  int np = 0;
  for (int q = 0; q < nfirsts; q++) if (liveNode(x, firsts[q]->n) && NODE(x, firsts[q]->n)->t < end) { Parent p = { firsts[q]->key, firsts[q]->n, firsts[q]->path[0] }; ps[np++] = p; }
  inTurn(s, ps, np, LINEUP_BUDGET, 0, end);
  if (o->nmoves) { o->lineup = 2; return 1; }
  // further, aimed: the colours the row turns into, met by pairs on top of their columns
  int32_t want[W + 1];
  if (converting(ensureBoard(x, s->root), want)) {
    static Line *level[LINEPOOL], *next[LINEPOOL];
    static int32_t idx[LINEPOOL], tmp[LINEPOOL], keyS[LINEPOOL], ms[MAXROWS * W], n3s[LINEPOOL], scs[LINEPOOL], l3[LINEPOOL], m3[LINEPOOL], from[LINEPOOL];
    int nl = 0, found3 = 0;
    for (int q = 0; q < nfirsts; q++) if (liveNode(x, firsts[q]->n) && NODE(x, firsts[q]->n)->t < end) level[nl++] = firsts[q];
    for (int dpt = 2; dpt <= LINEUP_DEPTH && nl && !found3 && !SEARCH_OUT(); dpt++) {
      for (int i = 0; i < nl; i++) { Board *b = ensureBoard(x, level[i]->n); level[i]->s = 10 * pairsOf(b, want) - uneven(b); idx[i] = i; keyS[i] = level[i]->s; }
      sortByKeyDesc(idx, nl, keyS, tmp);
      for (int i = 0; i < nl; i++) next[i] = level[idx[i]];
      if (nl > LINEUP_BEAM) nl = LINEUP_BEAM;
      for (int i = 0; i < nl; i++) level[i] = next[i];
      // the level's swaps, and the boards that stand up a pair waited to the pop's end
      int n3 = 0;
      for (int i = 0; i < nl; i++) {
        int nm = swapsOfNode(x, level[i]->n, ms);
        for (int j = 0; j < nm && n3 < LINEPOOL; j++) {
          int t3 = stepMarked(s, level[i]->n, MK_SWAP, ms[j], 0);
          n3s[n3] = t3; m3[n3] = ms[j]; from[n3] = i;
          scs[n3] = !liveNode(x, t3) || NODE(x, t3)->t >= end ? -1 : pairsOf(ensureBoard(x, t3), want);
          n3++;
        }
      }
      for (int q = 0; q < n3; q++) { int one = scs[q] >= PAIR ? n3s[q] : -1; linedAll(s, &one, 1, end, &l3[q]); }
      int nn = 0, ar = dpt & 1;
      arenaN[ar] = 0;
      for (int q = 0; q < n3 && !found3; q++) {
        if (scs[q] < 0) continue;
        Line *l = lineIn(ar); if (!l) break;
        *l = *level[from[q]]; l->n = n3s[q]; l->s = scs[q]; if (l->len < MAXPATH) l->path[l->len++] = m3[q];
        if (l3[q]) { found(o, level[from[q]]->key); setPath(o, l->path, l->len); found3 = 1; break; }
        next[nn++] = l;
      }
      for (int i = 0; i < nn; i++) level[i] = next[i];
      nl = nn;
    }
    if (o->nmoves) { o->lineup = 3; return 1; }
  }
  // failing that, a first swap leaving a break one swap away once the board has settled from it (the pop over, its panels down)
  if (s->tries < 2 * LINEUP_BUDGET) {
    np = 0;
    for (int q = 0; q < nfirsts; q++) {
      if (!liveNode(x, firsts[q]->n)) continue;
      int w = stepMarked(s, firsts[q]->n, MK_SETTLE, 0, 0);
      if (liveNode(x, w)) { Parent p = { firsts[q]->key, w, firsts[q]->path[0] }; ps[np++] = p; }
    }
    inTurn(s, ps, np, 2 * LINEUP_BUDGET, 1, end);
  }
  if (o->nmoves) { o->lineup = 4; return 1; }
  return 0;
}

// THE BREAK SEARCH from the decision's question: wait, the frames a popping slab has left (0: none); resume, the lines the last
// decision's beam was growing, on this board. Answers into out.
static void breakMovesIn(const Question *q, int32_t wait, const Paths *resume, Broke *out);
// (the marks of the last search's nodes are let go before the next: every node of a search starts within the rules)
static int breakBusy;
static void breakMoves(const Question *q, int32_t wait, const Paths *resume, Broke *out) {
  static int32_t high;
  memset(outsideBuf, 0, sizeof(int32_t) * (unsigned long)high);
  breakBusy = 1;
  breakMovesIn(q, wait, resume, out);
  breakBusy = 0;
  high = breakCtx && breakCtx->n < (1 << 20) ? breakCtx->n : (1 << 20);
}
static void breakMovesIn(const Question *q, int32_t wait, const Paths *resume, Broke *out) {
  memset(out, 0, sizeof *out);
  Ctx *x = breakCtx = ctxOf(breakCtx);
  arenaN[0] = arenaN[1] = arenaN[KEEPS] = 0; linesFull = 0;
  if (lowestG(q->b) >= gridLen(q->b)) return;   // (no garbage: no break)
  BS s;
  memset(&s, 0, sizeof s);
  s.x = x; s.out = out; s.wait = wait; s.resume = resume; s.outside = outsideBuf;
  s.root = rootOf(x, q);
  if (s.root < 0) return;
  static int32_t ms[MAXROWS * W];
  static Line *firsts[MAXROWS * W];
  int nf = swapsOfNode(x, s.root, ms), nfirsts = 0, at1 = -1;
  for (int i = 0; i < nf; i++) {
    Line *l = lineNew(); if (!l) break;
    l->key = ms[i]; l->len = 1; l->path[0] = ms[i];
    l->n = stepMarked(&s, s.root, MK_SWAP, ms[i], 0);
    firsts[nfirsts++] = l;
  }
  for (int i = 0; i < nfirsts; i++)
    if (breaksAt(&s, firsts[i]->n, firsts[i]->path, 1)) { found(out, firsts[i]->key); int32_t t = NODE(x, firsts[i]->n)->t; if (at1 < 0 || t < at1) at1 = t; }
  if (out->nmoves) { out->depth = 1; out->at = at1; return; }
  // (THE BREAK BUILT: the nearest break's panels walked to it along their rows -- breakNear's own line -- played on the engine)
  if (!(wait > 0)) {
    static int32_t nl[MAXPATH]; int nn = 0;
    if (breakNearLine(q->b, nl, &nn) < NEAR_MISS && nn > 0) {
      int node = s.root;
      for (int i = 0; i < nn && liveNode(x, node); i++) node = stepMarked(&s, node, MK_SWAP, nl[i], 0);
      if (liveNode(x, node) && breaksAt(&s, node, nl, nn)) { found(out, nl[0]); setPath(out, nl, nn); out->depth = 1; out->at = NODE(x, node)->t; out->built = 1; return; }
    }
  }
  if (!(wait > 0) && touchBeam(&s, firsts, nfirsts)) { out->depth = 1; return; }
  if (wait > 0) {
    int w0 = step(x, s.root, MK_LONG, 0, 0, wait);
    if (w0 >= 0 && w0 < (1 << 20)) outsideBuf[w0] = 0;   // (made from the root: within the rules so far)
    if (!breaksAt(&s, w0, 0, 0) && lineups(&s, firsts, nfirsts)) { out->depth = 1; return; }
    // (no line-up of the popping slab breaks again: a break of the garbage elsewhere while it pops, the cursor being free)
    if (touchBeam(&s, firsts, nfirsts)) { out->depth = 1; return; }
  }
  // none found: the line nearest a break, and the lines to choose among -- the frontier the beam has grown furthest, then that line
  out->depth = 0;
  if (s.haveToward) { out->towardLen = s.towardLen; for (int k = 0; k < s.towardLen; k++) out->toward[k] = s.toward[k]; }
  out->towards = out->keepOut;
  if (s.haveToward && out->towards.n < KEEPN) { int t = out->towards.n++; out->towards.len[t] = s.towardLen; for (int k = 0; k < s.towardLen; k++) out->towards.path[t][k] = s.toward[k]; }
}

// ---- for a host's check: the decision's question, the lines carried on in the io body (n lines, each
// its length then its swaps), and the answer back into it
static Broke theBroke;
static Paths hostResume;
static void putPaths(int32_t *w, int *k, const Paths *p) { w[(*k)++] = p->n; for (int i = 0; i < p->n; i++) { w[(*k)++] = p->len[i]; for (int j = 0; j < p->len[i]; j++) w[(*k)++] = p->path[i][j]; } }
EXPORT(gb_break) int gb_break(int wait, int nresume) {
  int k = 0;
  hostResume.n = 0;
  for (int i = 0; i < nresume && i < KEEPN; i++) { int len = gbIo[k++]; hostResume.len[i] = len; for (int j = 0; j < len; j++) hostResume.path[i][j] = gbIo[k++]; hostResume.n++; }
  breakMoves(&decQ, wait, &hostResume, &theBroke);
  Broke *o = &theBroke;
  int32_t *w = gbIo;
  k = 0;
  w[k++] = o->depth; w[k++] = o->at; w[k++] = o->touch; w[k++] = o->carried; w[k++] = o->wide; w[k++] = o->lineup; w[k++] = linesFull;
  w[k++] = o->nmoves; for (int i = 0; i < o->nmoves; i++) { w[k++] = o->moves[i]; w[k++] = o->pairs[i][0]; w[k++] = o->pairs[i][1]; }
  w[k++] = o->pathLen; for (int i = 0; i < o->pathLen; i++) w[k++] = o->path[i];
  w[k++] = o->towardLen; for (int i = 0; i < o->towardLen; i++) w[k++] = o->toward[i];
  putPaths(w, &k, &o->towards);
  putPaths(w, &k, &o->keepOut);
  return k;
}

// READY (judge.c breaksAfterLanding): a break on node n's board -- the break search asked of it, off the list (readiness counts any break,
// as a list ended by "default" does), in its share of the time: a caller asking it of many lines gives each an equal part of the time
// left (readyShare: the time over the askings still to come), and otherwise half the time the decision has left; never past the share
// of the search that asks. Asked inside a break search (its line check judging), it
// answers NOT_ASKED: the search's own context is in use.
static int32_t popLeft(const Board *b);   // (propose.c: the frames a popping slab has left)
static double readyShareMs = -1;
static void readyShare(int asks) { readyShareMs = asks > 0 ? leftMsOf() / (2.0 * asks) : -1; }
static int32_t readyBreakOf(Ctx *x, int n, int32_t *why, int32_t *whyN) {
  if (breakBusy) return NOT_ASKED;
  Board *b = ensureBoard(x, n);
  if (!b) return NOT_ASKED;
  static Question q;
  memset(&q, 0, sizeof q);
  q.b = b; q.holdLeft = NODE(x, n)->holdLeft; q.holdStarted = NODE(x, n)->holdStarted; q.tight = decQ.tight;
  q.narr = NODE(x, n)->narr; for (int i = 0; i < q.narr; i++) q.arr[i] = NODE(x, n)->arr[i];
  int32_t pop = popLeft(b), saved = listDefault;
  static Broke rb;
  double by = nowMs() + (readyShareMs >= 0 ? readyShareMs : leftMsOf() / 2);
  if (clockShare && clockShare < by) by = clockShare;   // (never past the share of the search that asks)
  double old = clockShareBegin(by);
  listDefault = 1;
  breakMoves(&q, pop ? pop + LINEUP_AFTER : 0, 0, &rb);
  listDefault = saved;
  clockShareEnd(old);
  if (!rb.depth) return clockOut() ? NOT_ASKED : 0;
  if (why) {
    int k = 0;
    if (rb.pathLen) for (; k < rb.pathLen && k < MAXLINE; k++) why[k] = rb.path[k];
    else if (rb.nmoves) why[k++] = rb.moves[0];
    *whyN = k;
  }
  return 1;
}
static int32_t (*readyBreak)(Ctx *x, int n, int32_t *why, int32_t *whyN) = readyBreakOf;
// for a tool that reads a logged board: the fewest swaps to the nearest break on the question's board (NEAR_MISS or more: none)
EXPORT(gb_break_near) int gb_break_near(void) { return hostBoard ? breakNear(hostBoard) : -1; }
