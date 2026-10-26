// GAMBIT'S SURVIVAL SEARCH: lines of swaps played one after another, a beam of the boards lost latest left alone, of
// those held longest -- the frame the garbage queued could next drop (the line's frames, then the later of stop + pre-stop and the
// shake) -- then with the most room over the stack, then the least garbage; each step's clears held to the list. The first line whose
// board, left alone, is still alive at `to` (frames from now) and `rest` past its own end, and that the order keeps (outcome.c
// lineKept: a line that lives is taken whatever list it is outside), is the answer; else the line whose board is lost latest, through the
// same check. And THE
// FRAMES UNTIL THE BOARD IS LOST IF NOTHING IS DONE (diesIn: lostAlone's answer, NOT_ASKED when there is none).

#define OUT_SEQ 16
typedef struct { int32_t n, nseq, seq[OUT_SEQ], room, h, g, lost, acts, t; double margin; Moved last; } OItem;   // t: the line's end, frames from the root; acts: the cursor's actions for its swaps, from the root's cursor; last: the pairs its swaps moved (judge.c Moved)
typedef struct { int32_t set, nseq, seq[OUT_SEQ], lostAt, acts, endAt; double margin; } Outlived;
static LOCAL Ctx *outCtx;   // (each thread its own: the survival search runs on a worker beside the decision -- answer.c)
static int32_t heldOf(Ctx *x, int n) { Node *e = NODE(x, n); return e->t + imax(e->stopTime + e->preStopTime, e->shakeTime); }
// (THE RESERVE: with an input allowance said, the line kept is the latest lost of those that leave the next landing a break's walk -- the
// window plan, core/nodes.h windowKeepsBreak -- unless one that spends it is lost later and the walk is worth spending (core/nodes.h
// spendPays): what a line spends comes back only as the window ages, and the next break is pressed out of what is left)
// (THE LINES TAKEN: the latest lost of each kind -- within the reserve, and over it -- kept in order, OUT_POOL of each, and the first the
// one line check passes is the answer, asked on the search's own question: ranked first, checked after, so only a check that decides
// anything is paid for)
#define OUT_POOL 16
typedef struct { int32_t n; Outlived o[OUT_POOL]; } OPool;
// (THE MARGIN a survival line keeps: of lines lost within the same break's time (outBand), the one that keeps more of what runs out
// first -- the rows over its stack, the rows of panels under its garbage, the input window's actions, the columns under garbage whose
// panels hold it up (judge.c contactOn: a clear under resting garbage that does not break it leaves it over a hollow), each a share of its whole --
// then the later lost, then the fewer actions. A
// line that buys a few frames by clearing the panels the next break is made of spends the board's life, not saves it)
static int32_t rankSave;   // (rank.c: the frames one break takes)
static int32_t outBand(int32_t lost) { return lost == FOREVER ? 0x7fffffff : lost / imax(1, rankSave > 0 ? rankSave : 60); }
static double outMargin(const Board *b, int32_t endAt, int acts) {
  if (!b) return -1;
  double room = (12 - topOn(b)) / 12.0, mat = (double)materialOn(b) / W / 12.0, m = room < mat ? room : mat, win = windowShareAt(endAt, acts);
  int32_t contact, under; contactOn(b, &contact, &under);
  if (under > 0 && (double)contact / under < m) m = (double)contact / under;
  return win >= 0 && win < m ? win : m;
}
static int outBefore(const OItem *it, const Outlived *o) {
  int32_t bi = outBand(it->lost), bo = outBand(o->lostAt);
  if (bi != bo) return bi > bo;
  if (it->margin != o->margin) return it->margin > o->margin;
  if (it->lost != o->lostAt) return it->lost > o->lostAt;
  return it->acts < o->acts;
}
static void poolAdd(OPool *p, const OItem *it) {
  int at = p->n;
  while (at > 0 && outBefore(it, &p->o[at - 1])) at--;
  if (at >= OUT_POOL) return;
  int last = p->n < OUT_POOL ? p->n : OUT_POOL - 1;
  for (int i = last; i > at; i--) p->o[i] = p->o[i - 1];
  Outlived *o = &p->o[at]; o->set = 1; o->acts = it->acts; o->endAt = it->t; o->margin = it->margin; o->nseq = it->nseq; o->lostAt = it->lost;
  for (int s2 = 0; s2 < it->nseq; s2++) o->seq[s2] = it->seq[s2];
  if (p->n < OUT_POOL) p->n++;
}
static Outlived poolFirst(const OPool *p, const Question *q) {
  // (one that wastes no three first -- the order drops a three the save does not confirm, and with it the board's backup -- and only
  // else one that does: a three the board needs not to die comes from here, decide.c the save)
  for (int pass = 0; pass < 2; pass++)
    for (int i = 0; i < p->n; i++) if (lineCheckOn(q, p->o[i].seq, p->o[i].nseq, 0, pass ? 0 : CHECK_WASTE)) return p->o[i];
  Outlived none; memset(&none, 0, sizeof none); return none;
}
// (THE SURVIVAL SEARCH CARRIED ON, search/frontier.c FR_SURVIVE: the lines the decision's own search kept last time, re-rooted, played
// again first -- each swap within the rules, from the root -- and put in the pools as any line the beam finds; and the pools' lines,
// the next decision's to carry on. Only the decision's own search, on its question, carries: a board carried on (decide.c contLostOf)
// is another board)
static LOCAL OPool bestP, overP;
static Paths outSeeds, outKeep; static int32_t outSeedsHave, outSeedIn, outSeedPlayed;
static Outlived outliveIn(const Question *q, int32_t to, int32_t rest, double ms, int depth, int width);
static Outlived outlive(const Question *q, int32_t to, int32_t rest, double ms, int depth, int width) {
  Outlived r = outliveIn(q, to, rest, ms, depth, width);
  if (q == &decQ) {
    outKeep.n = 0;
    for (int pass = 0; pass < 2; pass++) { const OPool *p = pass ? &overP : &bestP;
      for (int i = 0; i < p->n && outKeep.n < KEEPN; i++) { int t = outKeep.n++; outKeep.len[t] = p->o[i].nseq; for (int k = 0; k < p->o[i].nseq; k++) outKeep.path[t][k] = p->o[i].seq[k]; } }
  }
  return r;
}
static Outlived outliveIn(const Question *q, int32_t to, int32_t rest, double ms, int depth, int width) {
  Outlived best, over; memset(&best, 0, sizeof best); memset(&over, 0, sizeof over);
  bestP.n = overP.n = 0;
  double t0 = nowMs(), perStep = 0;
  Ctx *x = outCtx = ctxOf(outCtx);
  int root = rootOf(x, q);
  if (root < 0) return best;
  if (q == &decQ) { outSeedIn = outSeedsHave ? outSeeds.n : 0; outSeedPlayed = 0; }
  for (int i = 0; q == &decQ && outSeedsHave && i < outSeeds.n && nowMs() - t0 < ms / 4; i++) {
    static OItem sd; memset(&sd, 0, sizeof sd);
    int n = root, ok = outSeeds.len[i] > 0 && outSeeds.len[i] <= OUT_SEQ;
    const Board *rb = ensureBoard(x, root); int r0 = rb ? rb->curRow : 0, c0 = rb ? rb->curCol : 0;
    for (int k = 0; k < outSeeds.len[i] && ok; k++) {
      int32_t mv = outSeeds.path[i][k];
      if (!legalAt(x, n, CR(mv), CC(mv))) { ok = 0; break; }
      sd.acts += actionsFor(r0, c0, CR(mv), CC(mv), pressAllowance >= 0 ? pressAllowance - sd.acts : HOLDTIGHT + 1); r0 = CR(mv); c0 = CC(mv);
      int out = step(x, n, MK_SWAP, CR(mv), CC(mv), 0);
      if (!liveNode(x, out) || !stepFitsAt(x, out)) { ok = 0; break; }
      n = out; sd.seq[sd.nseq++] = mv;
    }
    if (!ok) continue;
    outSeedPlayed++;
    sd.n = n; sd.t = NODE(x, n)->t - NODE(x, root)->t;
    sd.lost = lostAlone(x, n, imax(to, NODE(x, n)->t + rest));
    sd.margin = outMargin(ensureBoard(x, n), sd.t, sd.acts);
    if (sd.lost == FOREVER && windowKeepsBreak(sd.t, sd.acts) && lineCheckOn(q, sd.seq, sd.nseq, 0, CHECK_WASTE)) { poolAdd(&bestP, &sd); return bestP.o[0]; }
    poolAdd(windowKeepsBreak(sd.t, sd.acts) ? &bestP : &overP, &sd);
  }
  BS still; memset(&still, 0, sizeof still); still.x = x; still.root = root;
  static OItem level[PLAN_POOL], kids[PLAN_KIDS];
  static int32_t idx[PLAN_KIDS], tmpI[PLAN_KIDS], kh[PLAN_KIDS], kr[PLAN_KIDS], kg[PLAN_KIDS], kl[PLAN_KIDS], ka[PLAN_KIDS], ms1[MAXROWS * W];
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
      for (int j = 0; j < nm && nb < PLAN_KIDS; j++) if (!undoesMoved(x, level[i].n, ms1[j], &level[i].last)) { bPar[nb] = level[i].n; bMv[nb++] = ms1[j]; }
    }
    bAt[nlev] = nb;
    stepBatch(x, bPar, bMv, MK_SWAP, nb);
    for (int i = 0; i < nlev; i++) {
      for (int b = bAt[i], j = 0; b < bAt[i + 1] && nk < PLAN_KIDS; b++, j++) {
        ms1[j] = bMv[b];
        int out = stepTake(x, b, level[i].n, MK_SWAP, bMv[b]);
        if (!liveNode(x, out) || !stepFitsAt(x, out)) continue;
        if (d == 1 && !firstOk(CR(ms1[j]), CC(ms1[j]), madeBy(x, out, root))) continue;
        Node *on = NODE(x, out);
        int dup = 0;
        for (int q2 = 0; q2 < nk && !dup; q2++) { Node *kn = NODE(x, kids[q2].n); dup = kn->hash == on->hash && kn->keyn == on->keyn && !memcmp(kn->key, on->key, sizeof(int32_t) * on->keyn); }
        if (dup) continue;
        OItem *k = &kids[nk++]; memset(k, 0, sizeof *k);
        k->n = out; k->nseq = imin(level[i].nseq + 1, OUT_SEQ); k->last = movedOn(x, level[i].n, ms1[j], &level[i].last);
        for (int s2 = 0; s2 < level[i].nseq && s2 < OUT_SEQ; s2++) k->seq[s2] = level[i].seq[s2];
        if (level[i].nseq < OUT_SEQ) k->seq[level[i].nseq] = ms1[j];
        k->room = ensureBoard(x, out)->height - on->top; k->h = heldOf(x, out); k->g = on->garb;
        { const Board *pb = ensureBoard(x, level[i].n); k->acts = level[i].acts + (pb ? actionsFor(pb->curRow, pb->curCol, CR(ms1[j]), CC(ms1[j]), pressAllowance >= 0 ? pressAllowance - level[i].acts : HOLDTIGHT + 1) : 0); }
      }
    }
    batchDone();
    // the boards held longest, then with the most room, then the least garbage, then the fewest actions walked; each run on alone to the
    // frame it is lost
    for (int i = 0; i < nk; i++) { idx[i] = i; kh[i] = kids[i].h; kr[i] = kids[i].room; kg[i] = -kids[i].g; ka[i] = -kids[i].acts; }
    sortByKeyDesc(idx, nk, ka, tmpI); sortByKeyDesc(idx, nk, kg, tmpI); sortByKeyDesc(idx, nk, kr, tmpI); sortByKeyDesc(idx, nk, kh, tmpI);
    int nkeep = imin(nk, 2 * width);
    static OItem top[PLAN_POOL];
    for (int i = 0; i < nkeep; i++) top[i] = kids[idx[i]];
    for (int i = 0; i < nkeep; i++) {
      top[i].t = NODE(x, top[i].n)->t - NODE(x, root)->t;
      top[i].lost = lostAlone(x, top[i].n, imax(to, NODE(x, top[i].n)->t + rest));
      top[i].margin = outMargin(ensureBoard(x, top[i].n), top[i].t, top[i].acts);
      // (a line that lives within the reserve is the answer at once, through the one check)
      if (top[i].lost == FOREVER && windowKeepsBreak(top[i].t, top[i].acts)) {
        if (lineCheckOn(q, top[i].seq, top[i].nseq, 0, CHECK_WASTE)) { poolAdd(&bestP, &top[i]); return bestP.o[0].lostAt == FOREVER ? bestP.o[0] : poolFirst(&bestP, q); }
        // (one that lives by wasting a three is kept for the save, and the search goes on for one that does not)
        if (lineKeptOn(q, top[i].seq, top[i].nseq, 0)) { poolAdd(&bestP, &top[i]); continue; }
        top[i].lost = -1; continue;
      }
      poolAdd(windowKeepsBreak(top[i].t, top[i].acts) ? &bestP : &overP, &top[i]);
    }
    for (int i = 0; i < nkeep; i++) { idx[i] = i; kl[i] = top[i].lost; }
    sortByKeyDesc(idx, nkeep, kl, tmpI);
    nlev = imin(nkeep, width);
    for (int i = 0; i < nlev; i++) level[i] = top[idx[i]];
    perStep = nsteps ? (nowMs() - tl) / nsteps : 0;
  }
  best = poolFirst(&bestP, q); over = poolFirst(&overP, q);
  if (over.set && (!best.set || (over.lostAt == FOREVER ? best.lostAt != FOREVER : best.lostAt != FOREVER && over.lostAt > best.lostAt && spendPays(over.lostAt, over.endAt, over.acts, best.lostAt, best.endAt)))) return over;
  return best;
}
static int32_t diesIn(const Question *q, double horizon) {
  Ctx *x = outCtx = ctxOf(outCtx);
  int root = rootOf(x, q);
  if (root < 0) return NOT_ASKED;   // (no board to play: no answer, as lostAlone's when the clock stops it -- never a loss at 0)
  int32_t h = (int32_t)horizon; if (h < horizon) h++;
  return lostAlone(x, root, imax(1, h));
}
