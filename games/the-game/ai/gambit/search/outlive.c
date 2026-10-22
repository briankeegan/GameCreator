// GAMBIT'S SURVIVAL SEARCH: lines of swaps played one after another, a beam of the boards lost latest left alone, of
// those held longest -- the frame the garbage queued could next drop (the line's frames, then the later of stop + pre-stop and the
// shake) -- then with the most room over the stack, then the least garbage; each step's clears held to the list. The first line whose
// board, left alone, is still alive at `to` (frames from now) and `rest` past its own end, and passes the shared line check, is the
// answer; else the line whose board is lost latest. And THE FRAMES UNTIL THE BOARD IS LOST IF NOTHING IS DONE (diesIn).

#define OUT_SEQ 16
#define OUTLIVE_WIDTH 45   // the survival search's beam, as the decision asks it
typedef struct { int32_t n, nseq, seq[OUT_SEQ], room, h, g, lost; } OItem;
typedef struct { int32_t set, nseq, seq[OUT_SEQ], lostAt; } Outlived;
static LOCAL Ctx *outCtx;   // (each thread its own: the survival search runs on a worker beside the decision -- answer.c)
static int32_t heldOf(Ctx *x, int n) { Node *e = NODE(x, n); return e->t + imax(e->stopTime + e->preStopTime, e->shakeTime); }
static Outlived outlive(const Question *q, int32_t to, int32_t rest, double ms, int depth, int width) {
  Outlived best; memset(&best, 0, sizeof best);
  double t0 = nowMs(), perStep = 0;
  Ctx *x = outCtx = ctxOf(outCtx);
  int root = rootOf(x, q);
  if (root < 0) return best;
  BS still; memset(&still, 0, sizeof still); still.x = x; still.root = root;
  static OItem level[PLAN_POOL], kids[PLAN_KIDS];
  static int32_t idx[PLAN_KIDS], tmpI[PLAN_KIDS], kh[PLAN_KIDS], kr[PLAN_KIDS], kg[PLAN_KIDS], kl[PLAN_KIDS], ms1[MAXROWS * W];
  int nlev = 1;
  memset(&level[0], 0, sizeof level[0]); level[0].n = root;
  for (int d = 1; d <= depth && nlev; d++) {
    double tl = nowMs();
    int nsteps = 0;
    for (int i = 0; i < nlev; i++) nsteps += swapsOfNode(x, level[i].n, ms1);
    // (a level is begun only while what the last took a step, over this one's steps, is left)
    if (nowMs() - t0 + perStep * nsteps > ms) break;
    int nk = 0;
    // (the level's swaps stepped on every thread first, then taken in this order: core/nodes.h stepBatch)
    static int32_t bPar[PLAN_KIDS], bMv[PLAN_KIDS], bAt[PLAN_KIDS + 1];
    int nb = 0;
    for (int i = 0; i < nlev; i++) {
      bAt[i] = nb;
      int nm = swapsOfNode(x, level[i].n, ms1);
      for (int j = 0; j < nm && nb < PLAN_KIDS; j++) { bPar[nb] = level[i].n; bMv[nb++] = ms1[j]; }
    }
    bAt[nlev] = nb;
    stepBatch(x, bPar, bMv, MK_SWAP, nb);
    for (int i = 0; i < nlev; i++) {
      for (int b = bAt[i], j = 0; b < bAt[i + 1] && nk < PLAN_KIDS; b++, j++) {
        ms1[j] = bMv[b];
        int out = stepTake(x, b, level[i].n, MK_SWAP, bMv[b]);
        if (!liveNode(x, out) || !stepFitsAt(x, out)) continue;
        if (d == 1) { Stats st; statsOf(x, out, &st); if (!firstOk(CR(ms1[j]), CC(ms1[j]), NODE(x, out)->brk > stillAt(&still, NODE(x, out)->t) ? 2 : st.cleared > 0)) continue; }
        Node *on = NODE(x, out);
        int dup = 0;
        for (int q2 = 0; q2 < nk && !dup; q2++) { Node *kn = NODE(x, kids[q2].n); dup = kn->hash == on->hash && kn->keyn == on->keyn && !memcmp(kn->key, on->key, sizeof(int32_t) * on->keyn); }
        if (dup) continue;
        OItem *k = &kids[nk++]; memset(k, 0, sizeof *k);
        k->n = out; k->nseq = imin(level[i].nseq + 1, OUT_SEQ);
        for (int s2 = 0; s2 < level[i].nseq && s2 < OUT_SEQ; s2++) k->seq[s2] = level[i].seq[s2];
        if (level[i].nseq < OUT_SEQ) k->seq[level[i].nseq] = ms1[j];
        k->room = ensureBoard(x, out)->height - on->top; k->h = heldOf(x, out); k->g = on->garb;
      }
    }
    batchDone();
    // the boards held longest, then with the most room, then the least garbage; each run on alone to the frame it is lost
    for (int i = 0; i < nk; i++) { idx[i] = i; kh[i] = kids[i].h; kr[i] = kids[i].room; kg[i] = -kids[i].g; }
    sortByKeyDesc(idx, nk, kg, tmpI); sortByKeyDesc(idx, nk, kr, tmpI); sortByKeyDesc(idx, nk, kh, tmpI);
    int nkeep = imin(nk, 2 * width);
    static OItem top[PLAN_POOL];
    for (int i = 0; i < nkeep; i++) top[i] = kids[idx[i]];
    for (int i = 0; i < nkeep; i++) {
      top[i].lost = lostAlone(x, top[i].n, imax(to, NODE(x, top[i].n)->t + rest));
      if (top[i].lost == FOREVER && !lineFits(top[i].seq, top[i].nseq, 0)) { top[i].lost = -1; continue; }
      if (!best.set || top[i].lost > best.lostAt) { best.set = 1; best.nseq = top[i].nseq; for (int s2 = 0; s2 < top[i].nseq; s2++) best.seq[s2] = top[i].seq[s2]; best.lostAt = top[i].lost; }
      if (top[i].lost == FOREVER) return best;
    }
    for (int i = 0; i < nkeep; i++) { idx[i] = i; kl[i] = top[i].lost; }
    sortByKeyDesc(idx, nkeep, kl, tmpI);
    nlev = imin(nkeep, width);
    for (int i = 0; i < nlev; i++) level[i] = top[idx[i]];
    perStep = nsteps ? (nowMs() - tl) / nsteps : 0;
  }
  return best;
}
static int32_t diesIn(const Question *q, double horizon) {
  Ctx *x = outCtx = ctxOf(outCtx);
  int root = rootOf(x, q);
  if (root < 0) return 0;
  int32_t h = (int32_t)horizon; if (h < horizon) h++;
  return lostAlone(x, root, imax(1, h));
}
