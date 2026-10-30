// A CHAIN GOING IS CONTINUED (as Gambit asks it: a list of aims): from a board mid-cascade (stop time running) or a slab
// popping, the swaps made while it falls that make it longer. A beam over swaps played as the cascade runs, each board ranked by what
// the cascade sends once it settles; per entry of the list the cascade that meets it sending the most, and beside them the one nearest
// the list (near). A line is kept for an aim only when its board keeps the floor and its line passes the shared line check, its last
// swap in time (by).

typedef struct {
  int32_t set, nseq, seq[PLAN_SEQ];
  int32_t cells, chain, combo, broke, done, fire, floor, base, aimIndex;
  double near;
} XLine;
typedef struct { int32_t width, depth; const List *aims; int32_t by; const Keep *keep; double ms; } ExtOpts;
typedef struct { XLine best, nearest; double ms; } Ext;
// a node's cascade once it settles: what it sends, its chain and largest match, the garbage it converted, and whether its board keeps
// the floor (kept: with what it broke, floor: as if it broke nothing)
typedef struct { int32_t ok, cells, chain, combo, broke, kept, floor, done; } Sent;
static LOCAL Ctx *extCtx;
static Sent sendsOf(Ctx *x, int n, const Keep *keep) {
  Sent g; memset(&g, 0, sizeof g);
  int out = settleOf(x, n);
  if (!liveNode(x, out)) return g;
  Stats st; statsOf(x, out, &st);
  Board *b = ensureBoard(x, out);
  g.ok = 1; g.cells = sentCells(&st); g.chain = chainOfStats(&st); g.combo = biggestOf(&st); g.broke = st.broke;
  g.kept = keepsFloor(keep, b, st.broke); g.floor = keepsFloor(keep, b, 0); g.done = NODE(x, out)->t;
  return g;
}
static void extend(const Question *q, const ExtOpts *o, Ext *E) {
  memset(E, 0, sizeof *E);
  double t0 = nowMs(), shareOld = clockShareBegin(t0 + o->ms);
  Ctx *x = extCtx = ctxOf(extCtx);
  Question q0 = *q; q0.narr = 0;   // (the cascade on its own: nothing lands while it is extended)
  int root = rootOf(x, &q0);
  if (root < 0) { clockShareEnd(shareOld); return; }
  Sent base = sendsOf(x, root, o->keep);
  E->best.cells = base.ok ? base.cells : 0; E->best.chain = base.ok ? base.chain : 0; E->best.base = E->best.cells; E->best.aimIndex = -1;
  int32_t baseCells = E->best.cells;
  int na = o->aims ? o->aims->n : 0;
  XLine per[MAXAIMS]; memset(per, 0, sizeof per);
  static LOCAL PItem poolA[PLAN_POOL], poolB[PLAN_POOL];
  static LOCAL int32_t idx[PLAN_POOL], tmpI[PLAN_POOL], keyH[PLAN_POOL], keyS[PLAN_POOL], ms[MAXROWS * W];
  PItem *pool = poolA, *next = poolB;
  int npool = 1;
  memset(&pool[0], 0, sizeof pool[0]); pool[0].n = root;
  for (int d = 1; d <= o->depth && npool && !clockOut(); d++) {
    int nn = 0;
    for (int pi = 0; pi < npool && !clockOut(); pi++) {
      int nm = swapsOfNode(x, pool[pi].n, ms);
      for (int j = 0; j < nm && nn < PLAN_POOL; j++) {
        int out = step(x, pool[pi].n, MK_SWAP, CR(ms[j]), CC(ms[j]), 0);
        if (!liveNode(x, out) || !stepFitsAt(x, out)) continue;
        PItem *k = &next[nn]; memset(k, 0, sizeof *k);
        k->n = out; k->nseq = imin(pool[pi].nseq + 1, PLAN_SEQ);
        for (int q2 = 0; q2 < pool[pi].nseq && q2 < PLAN_SEQ; q2++) k->seq[q2] = pool[pi].seq[q2];
        if (pool[pi].nseq < PLAN_SEQ) k->seq[pool[pi].nseq] = ms[j];
        nn++;
      }
    }
    int nk = 0;
    for (int i = 0; i < nn; i++) {
      PItem *k = &next[i];
      Sent g = clockOut() ? (Sent){ 0 } : sendsOf(x, k->n, o->keep);
      if (!g.ok) continue;
      // (a link added to a falling chain is in time when its swap is: pressed before the link it joins lands, and by the deadline)
      int32_t fire = NODE(x, k->n)->t;
      if (o->by != NOT_ASKED && fire > o->by) g.kept = 0;
      Made made = { g.combo, g.chain, g.broke, g.cells - baseCells };
      #define XFILL(L, ai) do { memset(&(L), 0, sizeof (L)); (L).set = 1; (L).nseq = k->nseq; for (int s_ = 0; s_ < k->nseq; s_++) (L).seq[s_] = k->seq[s_]; \
        (L).cells = g.cells; (L).chain = g.chain; (L).combo = g.combo; (L).broke = g.broke; (L).done = g.done; (L).fire = fire; (L).floor = g.floor; \
        (L).base = baseCells; (L).aimIndex = (ai); } while (0)
      // (the goal before the floor (the owner): a link that makes the list's first entry may spend the board below it -- search/plan.c)
      if (!g.kept && na && meets(&o->aims->aim[0], made) && !(o->by != NOT_ASKED && fire > o->by)) g.kept = 1;
      if (g.kept) {
        double xn = nearList(o->aims, made);
        if (xn > 0 && (!E->nearest.set || xn > E->nearest.near || (xn == E->nearest.near && g.cells > E->nearest.cells)) && lineFits(k->seq, k->nseq, 0)) { XFILL(E->nearest, -1); E->nearest.near = xn; }
        for (int ai = 0; ai < na; ai++)
          if (meets(&o->aims->aim[ai], made) && (!per[ai].set || g.cells > per[ai].cells) && lineFits(k->seq, k->nseq, 0)) XFILL(per[ai], ai);
      }
      #undef XFILL
      k->h = connectedOf(ensureBoard(x, k->n)); k->set = g.cells;   // (set: its score, what it sends)
      next[nk++] = *k;
    }
    // each board once, its best line: ranked by what it sends, then how connected
    int nd = 0;
    for (int i = 0; i < nk; i++) {
      Node *kn = NODE(x, next[i].n);
      int dup = 0;
      for (int q2 = 0; q2 < nd && !dup; q2++) { Node *on = NODE(x, next[q2].n); dup = on->hash == kn->hash && on->keyn == kn->keyn && !memcmp(on->key, kn->key, sizeof(int32_t) * kn->keyn); }
      if (!dup) next[nd++] = next[i];
    }
    for (int i = 0; i < nd; i++) { idx[i] = i; keyH[i] = next[i].h; keyS[i] = next[i].set; }
    sortByKeyDesc(idx, nd, keyH, tmpI);
    sortByKeyDesc(idx, nd, keyS, tmpI);
    int keepN = imin(nd, o->width);
    for (int i = 0; i < keepN; i++) pool[i] = next[idx[i]];
    npool = keepN;
  }
  for (int ai = 0; ai < na; ai++) if (per[ai].set) { E->best = per[ai]; break; }
  E->ms = nowMs() - t0;
  clockShareEnd(shareOld);
}
