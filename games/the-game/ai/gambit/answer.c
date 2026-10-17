// GAMBIT'S TURN (gambit_answer.js; plans/decision.md): a question from the frame loop answered by Gambit alone -- the break search, the
// decision, the move. What carries from one decision to the next lives here: the break search's lines, the boards this dig has stood
// on, the line toward a break begun, the line in progress, the pair the last swap swapped.

#define BREAK_SHARE 0.4    // of the decision's time, for the break search
#define UNDER_SHARE 0.75   // with garbage on the board: there the break is what saves the board
#define BREAK_MIN_MS 5
#define BREAK_MAX_MS 400
#define LINEUP_AFTER 30
#define HOLDTIGHT 40       // survivor_keys.js: the actions short of the input limit at which every walk is held
#define ROW_STEPS 16


// ---- the garbage the search digs toward: the id of the lowest block on the board
static int lowestGarbageRowOf(const Board *b) {
  for (int r = 1; r < b->nrows; r++) for (int c = 1; c <= W; c++) if (b->p[r][c].f[ISGARBAGE]) return r;
  return 0;
}
static int32_t digTargetOf(const Board *b) {
  int r = lowestGarbageRowOf(b);
  if (r) for (int k = 1; k <= W; k++) if (b->p[r][k].f[ISGARBAGE]) return b->p[r][k].f[GARBAGEID];
  return NUL;
}

// ---- THE DIG: the boards stood on since the garbage the break search digs toward was first the lowest (survivor_shared.js boardKey:
// each row's colours, garbage as G)
#define KEYLEN 160
#define DIGMAX 8192
static char digSeen[DIGMAX][KEYLEN]; static int32_t digN, digGid = NUL, digOn;
static int keyOf(const Board *b, char *out) {
  int k = 0;
  for (int r = 1; r < b->nrows && k < KEYLEN - 8; r++) {
    for (int c = 1; c <= W; c++) {
      const int32_t *f = b->p[r][c].f;
      if (f[ISGARBAGE]) out[k++] = 'G';
      else { int32_t v = f[COLOR] == NUL ? 0 : f[COLOR]; char d[12]; int nd = 0; if (!v) d[nd++] = '0'; while (v > 0) { d[nd++] = (char)('0' + v % 10); v /= 10; } while (nd) out[k++] = d[--nd]; }
    }
    out[k++] = '|';
  }
  out[k] = 0;
  return k;
}
static int sameDigKey(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }
static int digHas(const char *key) { for (int i = 0; i < digN; i++) if (sameDigKey(digSeen[i], key)) return 1; return 0; }
static void digAdd(const char *key) { if (digN < DIGMAX && !digHas(key)) { for (int i = 0; i < KEYLEN; i++) { digSeen[digN][i] = key[i]; if (!key[i]) break; } digN++; } }
// (the board a first swap leaves: pressed and six frames run, survivor_shared.js boardAfter)
static int seenDigHas(const Board *b, int32_t mv) {
  if (!digOn) return 0;
  static Board *t;
  if (!t) t = nb_new();
  cloneBoard(t, b);
  t->curRow = CR(mv); t->curCol = CC(mv);
  if (tryQueueSwap(t, CR(mv), CC(mv))) for (int f = 0; f < 6; f++) { t->input = 0; run(t); }
  char key[KEYLEN];
  keyOf(t, key);
  return digHas(key);
}

// ---- THE BREAK SEARCH CARRIED ON: this beam's lines, on this board, the garbage they dig toward, the move played and the line handed
// on after it, a bottom-row panel none of them touches, and the line toward a break played
typedef struct { int32_t set, gid, anchorRow, anchorCol, anchorId, id, playedHold, played, nhanded, handed[MAXLINE], ntoward, toward[MAXPATH]; Paths paths; } Kept;
static Kept theKept;
static int32_t towardPlayedN, towardPlayed[MAXPATH];
static int32_t riseSince(const Board *b, int row, int col, int32_t id) {
  for (int r = 1; r < b->nrows; r++) if (b->p[r][col].f[ID] == id) return r - row;
  return NOT_ASKED;
}
static int playedSince(const Kept *K, int32_t lineFrom, int32_t linePressed, int32_t *pre) {
  if (K->playedHold) return 0;
  int n = lineFrom == K->id && K->nhanded ? imin(linePressed, K->nhanded) : 0, k = 0;
  pre[k++] = K->played;
  for (int i = 0; i < n; i++) pre[k++] = K->handed[i];
  return k;
}
static int startsWith(const int32_t *p, int np, const int32_t *pre, int npre) { if (np <= npre) return 0; for (int i = 0; i < npre; i++) if (p[i] != pre[i]) return 0; return 1; }
static int carriedPaths(const Board *b, int32_t lineFrom, int32_t linePressed, Paths *out) {
  out->n = 0;
  Kept *K = &theKept;
  if (!K->set || !K->paths.n || digTargetOf(b) != K->gid) return 0;
  int32_t dr = riseSince(b, K->anchorRow, K->anchorCol, K->anchorId);
  if (dr == NOT_ASKED) return 0;
  int32_t pre[MAXLINE + 1];
  int npre = playedSince(K, lineFrom, linePressed, pre);
  // (THE LINE TOWARD A BREAK BEGUN: the rest of the one played last, the same moves taken off)
  if (K->ntoward && startsWith(K->toward, K->ntoward, pre, npre)) {
    towardRestLen = K->ntoward - npre;
    for (int i = 0; i < towardRestLen; i++) towardRest[i] = (CR(K->toward[npre + i]) + dr) * 8 + CC(K->toward[npre + i]);
  }
  for (int i = 0; i < K->paths.n; i++) {
    if (!startsWith(K->paths.path[i], K->paths.len[i], pre, npre)) continue;
    int t = out->n++;
    out->len[t] = K->paths.len[i] - npre;
    for (int k = 0; k < out->len[t]; k++) out->path[t][k] = (CR(K->paths.path[i][npre + k]) + dr) * 8 + CC(K->paths.path[i][npre + k]);
  }
  return 1;
}
static void keepFrontier(const Broke *br, int kind, int32_t move, const int32_t *handed, int nhanded, int32_t qid) {
  memset(&theKept, 0, sizeof theKept);
  if (!br || !br->keepOut.n || br->depth || !(kind == 0 || kind == 1)) return;
  const Board *b = decQ.b;
  for (int col = 1; col <= W; col++) {
    int32_t id = b->p[1][col].f[ID];
    if (id == NUL) continue;
    int touched = 0;
    if (kind == 1) {
      if (CR(move) == 1 && (CC(move) == col || CC(move) + 1 == col)) touched = 1;
      for (int i = 0; i < nhanded; i++) if (CR(handed[i]) == 1 && (CC(handed[i]) == col || CC(handed[i]) + 1 == col)) touched = 1;
    }
    if (touched) continue;
    Kept *K = &theKept;
    K->set = 1; K->paths = br->keepOut; K->gid = digTargetOf(b); K->anchorRow = 1; K->anchorCol = col; K->anchorId = id; K->id = qid;
    K->playedHold = kind == 0; K->played = move; K->nhanded = nhanded; for (int i = 0; i < nhanded; i++) K->handed[i] = handed[i];
    K->ntoward = towardPlayedN; for (int i = 0; i < towardPlayedN; i++) K->toward[i] = towardPlayed[i];
    return;
  }
}

// THE BREAK SEARCH, in its share of the decision's time
static Broke theBr;
static int32_t brCut, brResumed;
static int breakSearch(const Read *R, int32_t lineFrom, int32_t linePressed, double *ms) {
  double share = R->under ? UNDER_SHARE : BREAK_SHARE;
  *ms = 0; brCut = 0; brResumed = 0;
  // (no break search on a question due sooner than it could take: the answer would come late)
  if (C2.due && C2.due - nowMs() < C2.margin + BREAK_MIN_MS) return 0;
  double t = nowMs();
  int32_t pop = popLeft(decQ.b);
  static Paths resume;
  int have = carriedPaths(decQ.b, lineFrom, linePressed, &resume);
  double by = C2.due ? (t + (BREAK_MIN_MS > (C2.due - C2.t0) * share ? BREAK_MIN_MS : (C2.due - C2.t0) * share)) : t + BREAK_MAX_MS;
  if (C2.due && by > C2.due - C2.margin) by = C2.due - C2.margin;
  double old = clockShareBegin(by);
  breakMoves(&decQ, pop ? pop + LINEUP_AFTER : 0, have ? &resume : 0, &theBr);
  clockShareEnd(old);
  brCut = nowMs() >= by; brResumed = have ? resume.n : 0;
  *ms = nowMs() - t;
  return 1;
}

// ---- THE LOG LINE (gambit_answer.js logLine): one a decision, what Gambit chose, what was played and why
static char logBuf[8192]; static int logN;
static void L_s(const char *s) { while (*s && logN < (int)sizeof logBuf - 1) logBuf[logN++] = *s++; logBuf[logN] = 0; }
static void L_i(int64_t v) { char d[24]; int n = 0, neg = v < 0; if (neg) v = -v; if (!v) d[n++] = '0'; while (v > 0) { d[n++] = (char)('0' + v % 10); v /= 10; } if (neg) L_s("-"); while (n) { char c[2] = { d[--n], 0 }; L_s(c); } }
static void L_d(double v) {
  if (v == (double)(int64_t)v) { L_i((int64_t)v); return; }
  if (v < 0) { L_s("-"); v = -v; }
  L_i((int64_t)v); L_s(".");
  double f = v - (double)(int64_t)v;
  char d[8]; int n = 0;
  for (int i = 0; i < 6; i++) { f *= 10; int k = (int)f; d[n++] = (char)('0' + k); f -= k; }
  while (n > 1 && d[n - 1] == '0') n--;
  for (int i = 0; i < n; i++) { char c[2] = { d[i], 0 }; L_s(c); }
}
static void L_mv(int32_t mv) { L_i(CR(mv)); L_s(","); L_i(CC(mv)); }
static void L_play(int p) { const char *s = p == -2 ? "raise" : PLAY_NAME[p]; for (; *s; s++) { char c[2] = { *s == ' ' ? '_' : *s, 0 }; L_s(c); } }
static const char DROP_CHAR[NDROPS] = { 'b', 'o', 't', 'f', 'r', 'u' };

// THE MOVE: the one order's choice -- the raise the opening called for, a line's first swap, or the hold
typedef struct { int32_t kind, move; } Move;   // kind: 0 hold, 1 swap, 2 raise
// THE ANSWER, read by the host (gb_answer): the move, the raise held, the line handed on, and what the log and the audit read
typedef struct {
  Move d; int32_t raiseNow, raiseAfter, nhand, hand[MAXLINE];
  int32_t verdict;    // 0 none, 1 lives, 2 dies, 3 raise
  int32_t holdLives, brk, urgent, offered, lineup, touch, took, clears, dumpBoard;
  int32_t play, combo, chain, chainAll, broke, done, fire, nseq, seq[MAXLINE], rule, nlive, ncands;
  double idleMs, brMs;
} Answer;
static Answer theAnswer;
static int32_t lastA, lastB, pairRuns, blockA, blockB, blockUntil, emptyAt = NUL;

static void answerTurn(int32_t qid, int32_t at, int32_t allowanceKnown, int32_t allowance, int32_t lineFrom, int32_t linePressed) {
  Answer *A = &theAnswer;
  memset(A, 0, sizeof *A);
  logN = 0; logBuf[0] = 0;
  double tStart = nowMs();
  // (the input budget tight: the frame loop walks held from two cells, so every line is judged pressed as it walks)
  decQ.tight = allowanceKnown && allowance <= HOLDTIGHT;
  towardRestLen = 0;
  // (THE DIG: the boards stood on since the garbage the break search digs toward was first the lowest)
  int32_t gid = digTargetOf(decQ.b);
  if (gid == NUL) { digOn = 0; digN = 0; digGid = NUL; }
  else { if (!digOn || digGid != gid) { digOn = 1; digGid = gid; digN = 0; } char key[KEYLEN]; keyOf(decQ.b, key); digAdd(key); }
  // (the rules read first -- the list, the floor -- so the break search finds only breaks the judge will take)
  Read R;
  backBoard = decQ.b;
  theBack.at = at;
  if (!readBoard_(&R)) { A->d.kind = -1; return; }
  double brMs;
  int ran = breakSearch(&R, lineFrom, linePressed, &brMs);
  C2.br = ran ? &theBr : 0; C2.brMs = (int32_t)brMs;
  double ts = nowMs();
  static Found S;
  searchAll(&R, &S);
  S.searchMs = nowMs() - ts;
  int n = ranked(&R, &S);
  Played P = playOf(&R, n);
  if (R.F.known[FACT_US_CONTACT] || R.topped) gambitHit = 1;
  // THE MOVE
  Move d = R.up ? (Move){ 2, 0 } : P.line ? (Move){ 1, P.line->k.seq[0] } : (Move){ 0, 0 };
  A->d = d;
  const Judge *top = R.up ? 0 : P.top;
  A->verdict = R.up ? 3 : top ? (top->o.lives ? 1 : 2) : 0;
  A->holdLives = d.kind == 0 && top && top->o.lives;
  // (THE LINE PRESSED ON: a line the judge plays swap after swap is handed to the frame loop whole)
  if (d.kind == 1 && P.line && !P.line->settled && P.line->k.nseq > 1) { A->nhand = P.line->k.nseq - 1; for (int i = 1; i < P.line->k.nseq; i++) A->hand[i - 1] = P.line->k.seq[i]; }
  towardPlayedN = 0;
  if (d.kind == 1 && P.line && P.line->k.play == PLAY_TOWARD) { towardPlayedN = P.line->k.nseq; for (int i = 0; i < P.line->k.nseq; i++) towardPlayed[i] = P.line->k.seq[i]; }
  // (the break search's work carried on to the next decision, past the move and as much of the line handed on as gets pressed)
  keepFrontier(ran ? &theBr : 0, d.kind, d.move, A->hand, A->nhand, qid);
  if (A->nhand) theCarry.set = 0;
  else if (!(d.kind == 0 && P.top && P.top->wait)) carryOf(&R, P.line);
  // (no swap back: the pair the last swap swapped is kept out for a second when it is swapped three times running)
  int32_t pa = NUL, pb = NUL;
  if (d.kind == 1) { pa = decQ.b->p[CR(d.move)][CC(d.move)].f[ID]; pb = decQ.b->p[CR(d.move)][CC(d.move) + 1].f[ID]; }
  int pairKnown = d.kind == 1 ? (pa != NUL && pb != NUL) : !!lastA;
  int32_t na = d.kind == 1 ? pa : lastA, nb = d.kind == 1 ? pb : lastB;
  int same = pairKnown && lastA && samePair(na, nb, lastA, lastB);
  pairRuns = same ? pairRuns + 1 : 0;
  if (pairRuns >= 2) { blockA = na; blockB = nb; blockUntil = at + 60; }
  if (pairKnown) { lastA = na; lastB = nb; } else { lastA = lastB = 0; }
  gb_back(lastA, lastB, pairRuns, blockA, blockB, blockUntil, at);
  C2.idle = d.kind == 0 || (!R.up && !P.wait && !n);   // (held, or nothing was wanted)
  // what the answer and the audit read
  if (P.line) {
    const Judge *l = P.line;
    A->play = l->k.play; A->combo = l->apCombo; A->chain = l->apChain; A->chainAll = l->apChainAll; A->broke = l->apBroke;
    A->done = l->apDone; A->fire = l->apFire; A->nseq = l->k.nseq; for (int i = 0; i < l->k.nseq; i++) A->seq[i] = l->k.seq[i];
  } else A->play = P.name;
  A->clears = d.kind == 1 && (A->combo > 0 || A->broke > 0);
  A->brk = ran && theBr.depth; A->offered = ran ? theBr.depth : 0; A->lineup = ran && theBr.lineup; A->touch = ran && theBr.touch;
  if (ran && theBr.depth && d.kind == 1) for (int i = 0; i < theBr.nmoves; i++) if (theBr.moves[i] == d.move) A->took = 1;
  A->idleMs = S.idleMs; A->brMs = brMs;
  A->rule = theTables.r[R.rule].name; A->nlive = P.nlive; A->ncands = P.ncands;
  // (urgent: a cascade or a pop, an extension, or the line done within a pace gap of its deadline -- the frame loop's pace)
  A->urgent = (P.line && P.line->k.extend) || popLeft(decQ.b) > 0 || cascadeLive(decQ.b);
  // THE LOG LINE
  const Rule *rule = &theTables.r[R.rule];
  L_s("GAMBITD "); L_i(at); L_s(" @"); L_i(rule->name); L_s(" play="); L_play(P.name);
  L_s(" want="); if (R.up) L_s("raise"); else if (P.wait) L_s("hold"); else if (!n) L_s("-"); else if (order[0]->hold || order[0]->wait) L_s("hold"); else L_mv(order[0]->k.seq[0]);
  L_s(" got="); if (d.kind == 1) L_mv(d.move); else L_s(d.kind == 2 ? "raise" : "hold");
  L_s(" src=gambit v="); L_s(A->verdict == 1 ? "lives" : A->verdict == 2 ? "dies" : A->verdict == 3 ? "raise" : "none");
  L_s(" under="); L_i(R.under); L_s(" mat="); L_d(R.F.v[FACT_US_MATERIAL]); L_s(" chain="); L_i(A->chain); L_s(" combo="); L_i(A->combo); L_s(" broke="); L_i(A->broke);
  L_s(" tier="); L_i(P.line ? P.line->t.tier : d.kind == 0 ? HOLD_TIER : 0);
  L_s(" by="); if (R.by != NOT_ASKED && R.by) L_i(R.by); else L_s("-");
  L_s(" done="); if (P.line && A->done >= 0) L_i(A->done); else L_s("-");
  L_s(" fire="); if (P.line && A->fire >= 0) L_i(A->fire); else L_s("-");
  L_s(" ats="); if (P.line && P.line->apNats) { for (int i = 0; i < P.line->apNats; i++) { if (i) L_s("/"); L_i(P.line->apAts[i]); } } else L_s("-");
  L_s(" swaps="); L_i(P.line ? P.line->k.nseq : 0);
  L_s(" land="); if (R.F.known[FACT_US_NEXTLANDS]) L_d(R.F.v[FACT_US_NEXTLANDS]); else L_s("-");
  L_s(" dies="); L_d(R.F.v[FACT_US_DIES]); if (R.F.v[FACT_US_QUEUEKILLS]) L_s(" qk=1"); if (R.aloneOut) { L_s(" alone="); L_i(R.aloneChain); }
  L_s(" casc="); L_i(cascadeLive(decQ.b)); L_s(" pop="); L_i(popLeft(decQ.b)); L_s(" hp="); L_i(decQ.b->health); L_s(" stop="); L_d(R.F.v[FACT_US_STOP]);
  L_s(" waits="); L_i(R.breakWaits); L_s(" tight="); L_i(decQ.tight);
  L_s(" br=");
  if (ran) { L_i(theBr.depth); L_s("/"); if (theBr.pathLen) L_i(theBr.pathLen); else if (theBr.towardLen) { L_s("t"); L_i(theBr.towardLen); } else L_s("0");
             if (brCut) L_s("/cut"); if (brResumed) { L_s("/r"); L_i(brResumed); } if (theBr.wide) { L_s("/w"); L_i(theBr.wide); } if (theBr.carried) L_s("/carried"); }
  else L_s("none");
  L_s(" brMs="); L_i((int64_t)brMs);
  L_s(" ms="); L_i((int64_t)brMs); L_s("/"); L_i((int64_t)S.searchMs); L_s("/"); L_i(phaseMs[0]); L_s("/"); L_i(phaseMs[1]); L_s("/"); L_i(phaseMs[2]);
  L_s(" cands=");
  int any = 0;
  for (int p = 0; p < NPLAYS; p++) {
    if (!offered[p] && !(p == PLAY_SURVIVE && surviveAsked)) continue;
    if (any) L_s(","); any = 1;
    L_play(p); L_s(":"); L_i(offered[p]);
    int dn = 0; for (int w = 0; w < NDROPS; w++) dn += dropped[p][w];
    if (dn) { L_s("-"); for (int w = 0; w < NDROPS; w++) if (dropped[p][w]) { char c[2] = { DROP_CHAR[w], 0 }; L_s(c); L_i(dropped[p][w]); } }
  }
  if (!any) L_s("-");
  L_s(" live="); L_i(P.nlive); L_s("/"); L_i(P.ncands);
  L_s(" lost="); if (top) { if (top->o.lostAt == FOREVER) L_s("inf"); else L_i(top->o.lostAt); } else L_s("-");
  L_s(" ms_c="); L_i((int64_t)(nowMs() - tStart));
  L_s(" why="); if (top) L_play(top->k.play); else L_s(d.kind == 2 ? "raise" : "hold");
  // (THE BOARD THE BREAK SEARCH CAME UP EMPTY ON, under garbage, for gambit_reach.js: at most one every 30 frames)
  if (R.under && !(ran && theBr.depth) && (emptyAt == NUL || at - emptyAt >= 30 || at < emptyAt)) { emptyAt = at; A->dumpBoard = 1; }
  // THE RAISE HELD DOWN: the steps the row has left, and the rows on to the rule's `to`
  if (d.kind == 2) { A->raiseNow = imax(1, (decQ.b->displacement ? decQ.b->displacement : ROW_STEPS) - 1); A->raiseAfter = imax(0, R.to - fullTop(decQ.b) - 1) * ROW_STEPS; }
}

// ---- THE HOST'S SIDE (gambit.js): the rules, the profile, a question, the log
// The rules (gambit.js encodes the rules file): rule count, then per rule -- table, name, nwhen, when (fact, op, n, near each), naims,
// aims (ten words each), end, byFact, byFrames, keep (on, then height, material, evenness tests: op, n, near each), raiseTo -- then the
// file's keep (as a rule's), raiseTo and underIgnore.
static int readTest(const int32_t **w, Test *t) { t->op = (*w)[0]; t->n = (*w)[1]; t->near = (*w)[2]; *w += 3; return 1; }
EXPORT(gb_rules) int gb_rules(int n) {
  if (n < 0 || n > MAXRULES) return -1;
  const int32_t *w = ioBody;
  memset(&theTables, 0, sizeof theTables);
  for (int i = 0; i < n; i++) {
    Rule *r = &theTables.r[i];
    r->table = *w++; r->name = *w++; r->nwhen = *w++;
    if (r->nwhen > MAXWHEN) return -1;
    for (int k = 0; k < r->nwhen; k++) { r->when[k].fact = *w++; readTest(&w, &r->when[k].t); }
    r->list.n = *w++;
    if (r->list.n > MAXAIMS) return -1;
    for (int k = 0; k < r->list.n; k++) { Aim *a = &r->list.aim[k]; readTest(&w, &a->combo); readTest(&w, &a->chain); readTest(&w, &a->send); a->brk = *w++; }
    r->end = *w++; r->byFact = *w++; r->byFrames = *w++;
    r->keep.on = *w++; for (int k = 0; k < NKEEP; k++) readTest(&w, &r->keep.t[k]);
    r->raiseTo = *w++;
  }
  theTables.n = n;
  theTables.keep.on = *w++; for (int k = 0; k < NKEEP; k++) readTest(&w, &theTables.keep.t[k]);
  theTables.raiseTo = *w++; theTables.underIgnore = *w++;
  return n;
}
// The profile: the mode played the whole game (the rule's name, -1: chosen by the facts each decision), the gambit's numbers, the
// bot's hands.
EXPORT(gb_profile) void gb_profile(int mode, int ms, int extendMs, int width, int depth, int pool, int extendDepth, int extendOff, int reaction, int swapGap, int cursor) {
  modeRule = mode;
  Profile p = { mode, ms, extendMs, width, depth, pool, extendDepth, extendOff };
  C2.GP = p; C2.reaction = reaction;
  gb_config(reaction, swapGap, cursor);
}
// A new game: nothing of the last one is carried on.
EXPORT(gb_new_game) void gb_new_game(void) {
  memset(&theKept, 0, sizeof theKept); memset(&theCarry, 0, sizeof theCarry);
  digOn = 0; digN = 0; digGid = NUL; towardPlayedN = 0; towardRestLen = 0;
  lastA = lastB = pairRuns = blockA = blockB = blockUntil = 0; emptyAt = NUL; gambitHit = 0; C2.idle = 0;
  gb_back(0, 0, 0, 0, 0, 0, 0);
}
// A QUESTION: its board, hold and garbage on its way are node i of the host's search (the root it made); then its own facts. The answer
// into the io body (gb_answer's words below); the log line at gb_log.
EXPORT(gb_answer) int gb_answer(Ctx *hx, int i, int qid, int at, int topped, int oppHas, int oppOut, int oppTopKnown, int oppTop, int oppStopKnown, int oppStop,
                                int allowanceKnown, int allowance, int lineFrom, int linePressed, int canRaise, double due, double t0, double margin) {
  if (gb_question(hx, i, 0) < 0) return -1;
  decQ = hostQ; decQ.b = hostBoard;
  ncache = 0;
  hostTopped = topped;
  Opp o = { oppHas, oppOut, oppTopKnown, oppTop, oppStopKnown, oppStop }; theOpp = o;
  canRaiseNow = canRaise;
  C2.due = due; C2.t0 = t0; C2.margin = margin;
  clockStart(due ? due - margin : 0);
  decF.timeLeft = -1;   // (readiness is asked while the searches have time left, as each outcome finds it)
  answerTurn(qid, at, allowanceKnown, allowance, lineFrom, linePressed);
  Answer *A = &theAnswer;
  int32_t *w = ioBody, k = 0;
  w[k++] = A->d.kind; w[k++] = A->d.move ? CR(A->d.move) : 0; w[k++] = A->d.move ? CC(A->d.move) : 0;
  w[k++] = A->raiseNow; w[k++] = A->raiseAfter; w[k++] = A->verdict; w[k++] = A->holdLives; w[k++] = A->brk; w[k++] = A->urgent;
  w[k++] = A->offered; w[k++] = A->lineup; w[k++] = A->touch; w[k++] = A->took; w[k++] = A->clears; w[k++] = A->dumpBoard;
  w[k++] = A->play; w[k++] = A->combo; w[k++] = A->chain; w[k++] = A->chainAll; w[k++] = A->broke; w[k++] = A->done; w[k++] = A->fire;
  w[k++] = (int32_t)A->idleMs; w[k++] = (int32_t)A->brMs;
  w[k++] = A->nhand; for (int q = 0; q < A->nhand; q++) w[k++] = A->hand[q];
  w[k++] = A->nseq; for (int q = 0; q < A->nseq; q++) w[k++] = A->seq[q];
  w[k++] = A->d.kind < 0 ? -1 : A->rule; w[k++] = A->nlive; w[k++] = A->ncands;
  return k;
}
EXPORT(gb_log) const char *gb_log(void) { return logBuf; }
EXPORT(gb_log_len) int gb_log_len(void) { return logN; }
EXPORT(gb_play_name) const char *gb_play_name(int p) { return p == -2 ? "raise" : p >= 0 && p < NPLAYS ? PLAY_NAME[p] : ""; }
