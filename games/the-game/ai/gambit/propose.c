// THE PROPOSERS (plans/decision.md step 2): each kind of move the bot can make, one function each. A proposer reads
// what the searches found and offers lines; it decides nothing. The searches run once a decision (searchAll).

// THE DECISION'S CONTEXT the proposers and the rank read (answer.c fills it): the question, the profile's numbers, the clock
typedef struct {
  int32_t mode, ms, extendMs, width, depth, pool, extendDepth, extendOff;   // the profile's gambit (GP)
} Profile;
typedef struct {
  Profile GP;
  double due, t0, margin;          // ms; due 0: no deadline
  int32_t idle;                    // the decision before held or had nothing to play (bot._gambitIdle)
  int32_t reaction;
  Broke *br;                       // the break search's answer (0: none)
  int32_t brMs;
} Ctx2;
static Ctx2 C2;
// what the searches may take: the decision's time less the answer's margin and a quarter of it kept for judging what they found --
// searchesEnd, the share every search runs in (answer.c answerTurn), so no search runs into the judging's quarter
static double searchesEnd(void) { return C2.due ? C2.due - C2.margin - (C2.due - C2.t0) / 4 : 0; }
static double leftMs(void) { return C2.due ? searchesEnd() - nowMs() : 1e9; }
static double leftMsOf(void) { return leftMs(); }

// ---- the board's state the proposers read
static int cascadeLive(Board *b) {
  if (b->chainCounter > 0) return 1;
  int stop = b->stopTime + b->preStopTime > 0;
  if (hasChainingPanels(b)) return 1;
  return stop && hasActivePanels(b);
}
static int32_t popLeft(const Board *b) {
  int32_t t = 0;
  for (int r = 0; r < b->nrows; r++) for (int c = 1; c <= W; c++) { const int32_t *f = b->p[r][c].f; if (f[ISGARBAGE] && f[STATE] == MATCHED && f[TIMER] > t) t = f[TIMER]; }
  return t;
}

#define MAXSTARTS 8
// THE SEARCHES, run once a decision: the planner, the extension of a chain falling or a slab popping, readiness, levelling
typedef struct {
  int32_t haveAp; Plan ap;
  int32_t haveEx; Ext ex; List xAims;
  int32_t haveRd; Readied rd;
  int32_t lvU, lvG;                       // a level swap (0: none)
  int32_t haveRl, rlN, rl[2], rlAt;
  int32_t nstart; XLine start[MAXSTARTS];  // chains begun: a swap that starts a clear, and the links its fall is continued by
  int32_t tried; double idleMs, searchMs;
} Found;
#define READY_LINE_MS 120
// whether a list asks for a chain at all
static int wantsChain(const List *L) { for (int i = 0; i < L->n; i++) if (L->aim[i].chain.op && listWantsLonger(L, 1)) return 1; return 0; }
static Ctx *startCtx;
static void startChains(const Read *R, Found *S, double ms) {
  if (ms < 5) return;
  Profile *GP = &C2.GP;
  double t0 = nowMs(), shareOld = clockShareBegin(t0 + ms);
  Ctx *x = startCtx = ctxOf(startCtx);
  int root = rootOf(x, &decQ);
  if (root < 0) { clockShareEnd(shareOld); return; }
  static int32_t ms_[MAXROWS * W], starts[MAXROWS * W];
  int nm = swapsOfNode(x, root, ms_), ns = 0;
  // (the swaps that start a clear: played to the settle, they clear panels)
  for (int j = 0; j < nm && !clockOut(); j++) {
    int out = step(x, root, MK_SETTLE, CR(ms_[j]), CC(ms_[j]), 0);
    Stats st;
    if (liveNode(x, out) && statsOf(x, out, &st) && st.cleared > 0) starts[ns++] = ms_[j];
  }
  for (int j = 0; j < ns && S->nstart < MAXSTARTS && !clockOut(); j++) {
    int sw = step(x, root, MK_SWAP, CR(starts[j]), CC(starts[j]), 0);
    if (!liveNode(x, sw)) continue;
    Question q = decQ; q.b = ensureBoard(x, sw); q.holdLeft = 0; q.holdStarted = 0;
    if (!q.b) continue;
    double left = t0 + ms - nowMs();
    if (left < 2) break;
    ExtOpts eo = { GP->width ? GP->width : 40, GP->extendDepth ? GP->extendDepth : 6, &R->guides, R->by ? R->by : NOT_ASKED, R->keepOn ? &R->keep : 0,
                   left / (ns - j) };
    Ext E;
    extend(&q, &eo, &E);
    if (!E.best.set || E.best.aimIndex < 0 || E.best.nseq + 1 > PLAN_SEQ) continue;
    XLine *l = &S->start[S->nstart++];
    *l = E.best;
    l->nseq = E.best.nseq + 1; l->seq[0] = starts[j];
    for (int k = 0; k < E.best.nseq; k++) l->seq[k + 1] = E.best.seq[k];
  }
  clockShareEnd(shareOld);
}
static void searchAll(const Read *R, Found *S) {
  memset(S, 0, sizeof *S);
  if (!R->guides.n) return;
  Profile *GP = &C2.GP;
  Board *board = decQ.b;
  // (EVERY SEARCH TAKES A SHARE OF THE TIME THE DECISION HAS: half of what is left when it begins -- leftMs already keeps back the
  // judging's quarter -- so a decision with a second to its move searches a second's worth, and one with a frame, a frame's)
  double xMs = leftMs() / 2;
  // (a slab popping is lined up as the list is written -- the pop is the break; with garbage left, the entries that break again first)
  S->xAims = !R->pop ? R->guides : R->list;
  if (R->pop && R->under) {
    S->xAims = R->guides;
    for (int i = 0; i < R->list.n && S->xAims.n < MAXAIMS; i++) S->xAims.aim[S->xAims.n++] = R->list.aim[i];
    if (S->xAims.n < MAXAIMS) { Aim brk; memset(&brk, 0, sizeof brk); brk.brk = 1; S->xAims.aim[S->xAims.n++] = brk; }
  }
  double xm = xMs < leftMs() ? xMs : leftMs();
  if ((cascadeLive(board) || R->pop) && !GP->extendOff && xm >= 20) {
    S->tried++;
    ExtOpts eo = { GP->width ? GP->width : 40, GP->extendDepth ? GP->extendDepth : 6, &S->xAims, R->by ? R->by : NOT_ASKED, R->keepOn ? &R->keep : 0, xm };
    extend(&decQ, &eo, &S->ex); S->haveEx = 1;
  }
  // (A CHAIN IS BEGUN AND CONTINUED: on a board at rest, each swap that starts a clear, then the links its fall is continued by -- the
  // extension's own search, from the board the swap leaves falling; a beginning whose chain ends in the list is a line)
  if (!cascadeLive(board) && !R->pop && !GP->extendOff && wantsChain(&R->guides)) startChains(R, S, leftMs() / 2);
  // (idle time is planning time -- while the board left alone lives; a board the hold loses keeps the time for the survival search)
  double usual = leftMs() / 2;
  int idle = C2.idle && leftAlone().lives;
  double ms = idle ? (usual > leftMs() ? usual : leftMs()) : usual, extra = ms - (usual > 0 ? usual : 0);
  if (ms >= 20) {
    S->tried++;
    PlanOpts po = { GP->width ? GP->width : 40, GP->depth ? GP->depth : 7, GP->pool ? GP->pool : 250, &R->guides, R->by ? R->by : NOT_ASKED,
                    R->keepOn ? &R->keep : 0, R->readyAt, R->under, R->F.v[FACT_US_DIES] > 0 ? R->F.v[FACT_US_DIES] : 0, R->under, ms };
    plan(&decQ, &po, &S->ap); S->haveAp = 1;
    if (extra > 0) { double v = S->ap.ms - (usual > 0 ? usual : 0); S->idleMs = v < extra ? v : extra; if (S->idleMs < 0) S->idleMs = 0; }
  }
  int32_t nl = R->F.known[FACT_US_NEXTLANDS] ? (int32_t)R->F.v[FACT_US_NEXTLANDS] : 0;
  S->lvU = R->under ? level(&decQ, nl > 0 ? nl : (R->by ? R->by : NOT_ASKED)) : 0;
  if (!R->under && R->readyAt != NOT_ASKED && decQ.narr) { double m2 = leftMs() < 60 ? leftMs() : 60; S->rd = readyFor(&decQ, m2 > 1 ? m2 : 1); S->haveRd = 1; }
  // (the board left alone with no plan once everything shown has landed: a line of one or two swaps that leaves one)
  int32_t lastLand = NOT_ASKED;
  for (int i = 0; i < decQ.narr; i++) if (lastLand == NOT_ASKED || decQ.arr[i].at > lastLand) lastLand = decQ.arr[i].at;
  if (lastLand != NOT_ASKED && !leftAlone().lives) {
    double m3 = leftMs() / 2 < READY_LINE_MS ? leftMs() / 2 : READY_LINE_MS;
    S->haveRl = readyLines(&decQ, lastLand, m3 > 1 ? m3 : 1, S->rl, &S->rlN, &S->rlAt);
  }
  S->lvG = !R->under && R->readyAt != NOT_ASKED && !(S->haveRd && !S->rd.ready && S->rd.setup) ? level(&decQ, R->readyAt ? R->readyAt : NOT_ASKED) : 0;
}

// THE LEVEL BUILT: topped or under garbage, the line that walks the tallest column's top panel onto a lower
// column beside it, panel after panel, until the stack is level (no column more than one above another) -- each step settled, the
// whole line judged on the engine. Its length into seq; 0 for none
static int levelLine(const Board *b, int32_t *seq, int cap) {
  int h[W + 2], top = gridLen(b) - 2, n = 0;
  for (int c = 1; c <= W; c++) { h[c] = 0; for (int r = 1; r <= top; r++) if (cellAt(b, r, c) > 0) h[c] = r; }
  while (n < cap) {
    int best = 0, to = 0;
    for (int c = 1; c <= W; c++)
      for (int d = -1; d <= 1; d += 2) {
        int nb = c + d;
        if (nb < 1 || nb > W || h[nb] >= h[c] - 1) continue;
        if (!best || h[c] > h[best] || (h[c] == h[best] && h[nb] < h[to])) { best = c; to = nb; }
      }
    if (!best) break;
    seq[n++] = h[best] * 8 + (to > best ? best : to);
    h[best]--; h[to]++;
  }
  return n;
}

// ---- the candidates
static int candOf(Cand *k, int play, const int32_t *seq, int n, int aim, int extend) {
  memset(k, 0, sizeof *k);
  if (!seq || n <= 0 || !seq[0]) return 0;
  k->set = 1; k->play = play; k->nseq = imin(n, MAXLINE); k->aim = aim; k->extend = extend; k->settled = -1;
  for (int i = 0; i < k->nseq; i++) k->seq[i] = seq[i];
  k->x.floor = -1; k->xFire = -1; k->xDone = -1;
  return 1;
}
static void xFromPlan(Cand *k, const PLine *l) {
  k->x.combo = l->combo; k->x.chain = l->chain; k->x.broke = l->broke; k->x.cells = l->cells; k->x.earned = l->earned; k->x.near = l->near;
  k->x.floor = l->floor; k->xFire = l->fire; k->xDone = l->done; k->xNats = imin(l->nseq, MAXLINE);
  for (int i = 0; i < k->xNats; i++) k->xAts[i] = l->ats[i];
}
static void xFromExt(Cand *k, const XLine *l) {
  k->x.combo = l->combo; k->x.chain = l->chain; k->x.broke = l->broke; k->x.cells = l->cells; k->x.near = l->near; k->x.floor = l->floor;
  k->xFire = l->fire; k->xDone = l->done;
}
static int seenDigHas(const Board *b, int32_t mv);   // (answer.c: the boards this dig has stood on)
static int32_t towardRest[MAXPATH], towardRestLen;   // (answer.c: the rest of the line toward a break played last)
// Every candidate, in the order they are offered: entries, the extension, the nearest, the break line, the break
// search's breaks, toward a break, ready, level, setup, clear
// A THREE GROWN (search/fill.c): each line proposed whose last swap makes a match of three, again with one more panel of its colour walked
// beside the match before that swap -- a combo of four or more buys the stop a three does not (pa.c calculateStopTime). Offered as the
// play that found the three, so its place in the order is that play's; the engine judges whether the match is made.
static Ctx *fillCtx;
static const Board *boardBefore(Ctx *x, const int32_t *seq, int n) {
  if (n <= 0) return decQ.b;
  int node = rootOf(x, &decQ);
  for (int i = 0; i < n && liveNode(x, node); i++) node = step(x, node, MK_SWAP, CR(seq[i]), CC(seq[i]), 0);
  return liveNode(x, node) ? ensureBoard(x, node) : 0;
}
static int growLines(Cand *out, int n, int cap) {
  Ctx *x = fillCtx = ctxOf(fillCtx);
  static Land L; static Fills F;
  for (int i = 0, n0 = n; i < n0 && n < cap && !clockOut(); i++) {
    const Cand *k = &out[i];
    if (k->nseq < 1 || k->grown) continue;
    const Board *B = boardBefore(x, k->seq, k->nseq - 1);
    if (!B) continue;
    int32_t last = k->seq[k->nseq - 1];
    swapLand(B, CR(last), CC(last), &L);
    fillWalks(B, &L, 3, &F);
    for (int w = 0; w < F.n && w < 2 && n < cap; w++) {
      if (k->nseq + F.len[w] > MAXLINE) continue;
      Cand *g = &out[n];
      *g = *k; g->grown = 1; g->nseq = 0;
      for (int j = 0; j < k->nseq - 1; j++) g->seq[g->nseq++] = k->seq[j];
      for (int j = 0; j < F.len[w]; j++) g->seq[g->nseq++] = F.seq[w][j];
      g->seq[g->nseq++] = last;
      g->x.combo = 4; g->xFire = -1; g->xDone = -1; g->xNats = 0;
      n++;
    }
  }
  return n;
}
// THE CONVERTED ROW'S CHAIN (search/fill.c): the panels a break converts fall chaining once its pop is over, so a panel of their colour
// waiting beside where they land makes a link of a chain. While a pop runs, the land is the board left alone and the colours are the ones
// the screen has drawn; before a break is pressed, the land is the break line's own end and the colours the board already shows -- the
// break line and the walk after it, one line. Each a candidate like any other (PLAY_CONVERT), judged on the engine and in time.
static int convertLines(const Read *R, Cand *out, int n, int cap) {
  Ctx *x = fillCtx = ctxOf(fillCtx);
  static Land L; static Fills F;
  #define ADDC(seq_, n_, aim_) do { if (n < cap && candOf(&out[n], PLAY_CONVERT, seq_, n_, aim_, 1)) { out[n].settled = 0; n++; } } while (0)
  if (R->pop) {
    const Board *E = lineEnd(0, 0, 0);
    if (E && settledLand(decQ.b, E, &L)) { fillWalks(decQ.b, &L, 2, &F); for (int w = 0; w < F.n; w++) ADDC(F.seq[w], F.len[w], -1); }
  }
  if (R->under && !R->pop) {
    for (int i = 0, n0 = n; i < n0 && n < cap && !clockOut(); i++) {
      const Cand *k = &out[i];
      if (!(k->x.broke > 0) || k->grown || k->play == PLAY_CONVERT) continue;
      int st = k->settled >= 0 ? k->settled : settledPlay(k->play);
      const Board *E0 = lineEnd(k->seq, k->nseq, st);
      if (!E0) continue;
      static Board *E; if (!E) E = nb_new(); if (!E) break;
      cloneBoard(E, E0);
      const Board *B = boardBefore(x, k->seq, k->nseq);
      if (!B || !settledLand(B, E, &L)) continue;
      fillWalks(B, &L, 2, &F);
      for (int w = 0; w < F.n && w < 2; w++) {
        if (k->nseq + F.len[w] > MAXLINE) continue;
        int32_t seq[MAXLINE], m = 0;
        for (int j = 0; j < k->nseq; j++) seq[m++] = k->seq[j];
        for (int j = 0; j < F.len[w]; j++) seq[m++] = F.seq[w][j];
        ADDC(seq, m, k->aim);
      }
    }
  }
  #undef ADDC
  return n;
}
static int proposeAll(const Read *R, const Found *S, Cand *out, int cap) {
  int n = 0;
  #define ADD(...) do { if (n < cap && candOf(&out[n], __VA_ARGS__)) n++; } while (0)
  // AN ENTRY: the planner's line for each entry of the list it found one for
  if (S->haveAp) for (int i = 0; i < R->guides.n; i++) if (S->ap.perAim[i].set) { int m0 = n; ADD(PLAY_ENTRY, S->ap.perAim[i].seq, S->ap.perAim[i].nseq, i, 0); if (n > m0) xFromPlan(&out[m0], &S->ap.perAim[i]); }
  // THE EXTENSION: links that keep a chain already falling going (or a popping slab lined up), and the nearest of them to the list
  if (S->haveEx) {
    const XLine *ex = &S->ex.best;
    if (ex->nseq && ex->aimIndex >= 0) {
      int na = R->guides.n, xi = ex->aimIndex, xa = !(R->pop && R->under) ? xi : xi < na ? xi : xi < 2 * na ? xi - na : -1;
      int m0 = n; ADD(R->pop ? PLAY_LINEUP : PLAY_EXTEND, ex->seq, ex->nseq, xa, 1); if (n > m0) xFromExt(&out[m0], ex);
    }
    if (S->ex.nearest.set) { int m0 = n; ADD(R->pop ? PLAY_LINEUP : PLAY_EXTEND, S->ex.nearest.seq, S->ex.nearest.nseq, -1, 1); if (n > m0) xFromExt(&out[m0], &S->ex.nearest); }
  }
  // A CHAIN BEGUN: a swap that starts a clear and the links that continue its fall into an entry of the list
  for (int i = 0; i < S->nstart; i++) { int m0 = n; ADD(PLAY_EXTEND, S->start[i].seq, S->start[i].nseq, S->start[i].aimIndex, 1); if (n > m0) xFromExt(&out[m0], &S->start[i]); }
  // THE NEAREST: the planner's line nearest the list; THE BREAK LINE: its line in time that breaks the most garbage
  if (S->haveAp && S->ap.nearest.set && S->ap.nearest.nseq) { int m0 = n; ADD(PLAY_NEAREST, S->ap.nearest.seq, S->ap.nearest.nseq, -1, 0); if (n > m0) xFromPlan(&out[m0], &S->ap.nearest); }
  if (S->haveAp && S->ap.quick.set) { int m0 = n; ADD(PLAY_BREAKLINE, S->ap.quick.seq, S->ap.quick.nseq, -1, 0); if (n > m0) xFromPlan(&out[m0], &S->ap.quick); }
  // THE BREAK SEARCH'S BREAKS: its line to a break, and every first swap it found breaks (a row each: it counts rows, the planner cells)
  Broke *br = C2.br;
  if (br && br->depth) {
    int play = br->lineup ? PLAY_LINEUPBREAK : PLAY_BREAKSEARCH;
    #define BX(k) do { (k)->x.broke = 6; (k)->xDone = br->at ? br->at : -1; (k)->xFire = br->at ? br->at : -1; } while (0)
    if (br->pathLen) { int m0 = n; ADD(play, br->path, br->pathLen, -1, 0); if (n > m0) BX(&out[m0]); }
    else for (int i = 0; i < br->nmoves; i++) {
      int hasPair = br->pairs[i][0] != 0, m0 = n;
      int32_t one = br->moves[i];
      if (hasPair) ADD(play, br->pairs[i], 2, -1, 0); else ADD(play, &one, 1, -1, 0);
      if (n > m0) { BX(&out[m0]); if (br->lineup == 4 && hasPair) out[m0].settled = 1; }
    }
    #undef BX
  }
  // TOWARD A BREAK: under garbage with none in reach, the line begun last gone on with first, then the break search's lines: the first
  // whose first swap does not bring back a board this dig has already stood on
  if (R->under && br) {
    static int32_t lines[KEEPN + 2][MAXPATH], lens[KEEPN + 2];
    int nl = 0;
    const Paths *tw = &br->towards;
    if (tw->n) for (int i = 0; i < tw->n && nl < KEEPN; i++) { lens[nl] = tw->len[i]; for (int k = 0; k < tw->len[i]; k++) lines[nl][k] = tw->path[i][k]; nl++; }
    else if (br->towardLen) { lens[nl] = br->towardLen; for (int k = 0; k < br->towardLen; k++) lines[nl][k] = br->toward[k]; nl++; }
    static int32_t ord[KEEPN + 2][MAXPATH], olen[KEEPN + 2];
    int no = 0;
    if (towardRestLen) {
      // (the lines that carry the one begun further, then its rest, then the others)
      for (int pass = 0; pass < 3; pass++) {
        if (pass == 1) { olen[no] = towardRestLen; for (int k = 0; k < towardRestLen; k++) ord[no][k] = towardRest[k]; no++; continue; }
        for (int i = 0; i < nl; i++) {
          int starts = lens[i] >= towardRestLen;
          for (int k = 0; k < towardRestLen && starts; k++) starts = lines[i][k] == towardRest[k];
          if ((pass == 0) != !!starts) continue;
          olen[no] = lens[i]; for (int k = 0; k < lens[i]; k++) ord[no][k] = lines[i][k]; no++;
        }
      }
    } else for (int i = 0; i < nl; i++) { olen[no] = lens[i]; for (int k = 0; k < lens[i]; k++) ord[no][k] = lines[i][k]; no++; }
    for (int i = 0; i < no; i++) {
      if (!olen[i]) continue;
      if (seenDigHas(decQ.b, ord[i][0])) continue;
      ADD(PLAY_TOWARD, ord[i], olen[i], -1, 0);
      break;
    }
  }
  // READY: the swap that leaves the next block breakable when it lands, and the line that leaves a plan once everything has landed
  if (S->haveRd && !S->rd.ready && S->rd.setup) { int32_t one = S->rd.setup; ADD(PLAY_READY, &one, 1, -1, 0); }
  if (S->haveRl) { int m0 = n; ADD(PLAY_READY, S->rl, S->rlN, -1, 0); if (n > m0) out[m0].xDone = S->rlAt; }
  // (LOWERING THE STACK: the tallest column's top walked onto a lower one, each step settled -- on any board with a column two above
  // its neighbour, the move when there is nothing better to do (rank.c markIdle); topped or under garbage, a perched block let down too
  // -- its supports walked out from under it (search/break.c perchedDrops). Each judged as any line: a lower stack is a later loss)
  // (on a board at rest only, unless topped or under garbage: panels walked while a chain falls or a slab pops spoil what the board
  // makes alone)
  if (R->topped || R->under || (!hasActivePanels(decQ.b) && decQ.b->chainCounter == 0 && !R->pop)) {
    static int32_t lv[MAXLINE]; int nl = levelLine(decQ.b, lv, MAXLINE);
    if (nl > 0) { int m0 = n; ADD(PLAY_LEVEL, lv, nl, -1, 0); if (n > m0) out[m0].settled = 1; } }
  if (R->topped || R->under) {
    static Perches pd; perchedDrops(decQ.b, &pd);
    for (int i = 0; i < pd.n; i++) { int m0 = n; ADD(PLAY_LEVEL, pd.seq[i], pd.len[i], -1, 0); if (n > m0) out[m0].drop = 1; }
  }
  // LEVEL: the swap that flattens the stack, under garbage or before a block lands
  // (a swap that clears nothing and brings back a board this dig has stood on goes nowhere: not offered)
  if (S->lvU && !seenDigHas(decQ.b, S->lvU)) { int32_t one = S->lvU; ADD(PLAY_LEVEL, &one, 1, -1, 0); }
  if (S->lvG && !seenDigHas(decQ.b, S->lvG)) { int32_t one = S->lvG; ADD(PLAY_LEVEL, &one, 1, -1, 0); }
  // SET UP: the planner's swap toward the ask, with no block on its way; CLEAR: the line that leaves the lowest stack
  if (S->haveAp && S->ap.setup && R->readyAt == NOT_ASKED && !seenDigHas(decQ.b, S->ap.setup)) { int32_t one = S->ap.setup; ADD(PLAY_SETUP, &one, 1, -1, 0); }
  if (S->haveAp && S->ap.lowest.set) { int m0 = n; ADD(PLAY_CLEAR, S->ap.lowest.seq, S->ap.lowest.nseq, -1, 0); if (n > m0) xFromPlan(&out[m0], &S->ap.lowest); }
  #undef ADD
  // (and from the lines above: the converted row's chain, then every three grown -- the converted lines' own among them)
  n = convertLines(R, out, n, cap);
  n = growLines(out, n, cap);
  return n;
}
