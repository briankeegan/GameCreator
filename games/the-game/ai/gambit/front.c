// GAMBIT'S FRAME LOOP: one match, a frame at a time, in the game's own process (native.c). Each frame the host hands it the board as the
// player sees it and the garbage the senders' telegraphs show, and it returns the keys pressed. Decisions are asked ahead, of the board
// predicted for the frame they are due, and answered on Gambit's thread (native.c); the frame never waits on one.
//
// THE BOARD PLAYED IS THE BOARD DECIDED ON. The board after each frame is predicted from the board and the keys pressed; the next
// frame's board is compared with it, and anything the prediction could not know (a row's or a break's colours) aside, a difference
// drops every plan and question made before it. So does garbage shown that the plan was not made knowing, and a broken slab's
// colours shown.

#define MIN_LEG 3          // the shortest walk a held key is no later on
#define STAGING (45 + 45 + 1)   // a sender stages garbage this long, then it lands LAND frames later
#define LAND 60
#define PLANN 4096         // frames of plan kept, by clock
#define MAXKEYS 2048
#define MAXARRIVALS 1024
#define FTHINK 8           // the answers' times kept, for how soon the next comes

typedef struct { int32_t at, capped; Incoming g; } Arrival;   // at: the stopWatch it is received on; capped: held back (search.h CAPPED_AT)
typedef struct { int32_t bits, holdLeft, holdStarted, swap; } Planned;
typedef struct { int32_t n, ins[MAXKEYS], hl[MAXKEYS], hs[MAXKEYS], held; } Keys;

// what the worker is asked, and what it answers (native.c carries them across)
typedef struct {
  int32_t id, epoch, at, lead, allowance, topped, lineFrom, linePressed, holdLeft, holdStarted, narr;
  int32_t oppHas, oppOut, oppTop;
  double ms, posted;
  Arrival arr[MAXARRIVALS];
  Board *b;
} FQuestion;
typedef struct {
  int32_t id, epoch, at, kind, move, raiseNow, raiseAfter, nhand, hand[MAXLINE], holdLives, brk, urgent, error;
  int32_t empty;               // a hold the clock left no time to judge anything for
  int32_t nalt, alt[MAXLINE];  // the move in hand: the best line that lives and is no hold, its swaps (0: none)
  double ms, idleMs, closeMs;
} FAnswer;
static void postQuestion(FQuestion *q);   // native.c
static int takeAnswer(FAnswer *a);        // native.c: 1 when one was waiting
static int answerWaiting(int32_t id);     // native.c
static void abortTo(int32_t id);          // native.c: every question up to id is no longer wanted
static void flog(const char *s);          // native.c: a line into the run's log

typedef struct {
  int32_t frames, decisions, played, late, diverged, refused, guarded, unasked, idle, followed, noLine, unforeseen, reasked, revealed,
          raiseCut, actions, maxWindow, overInput, heldWalks, paced, swaps, starved, inHand;
  int32_t combo[64], chain[32];
  // each chain link past the list's two, by its cause: panels out of garbage (colours not shown when it was decided), a swap pressed
  // since the link before it, or neither (the stack alone)
  int32_t linkBy[3][32];
} FStats;
enum { LINK_GARBAGE, LINK_SWAP, LINK_ALONE };

static struct {
  int32_t now, epoch, nextAt, lastSwapEnd, haveSwapEnd, jitterFor, jitterGap, raiseCutUntil;
  int32_t holdLeft, holdStarted, overLogged, loggedAskNow, loggedRefused, nalt, alt[MAXLINE];
  Planned plan[PLANN]; int32_t planAt[PLANN];
  Board *truth, *expect, *pr, *scratch;
  int32_t haveExpect;
  Arrival arr[MAXARRIVALS]; int32_t narr;            // garbage on its way, this frame
  Arrival knew[MAXARRIVALS]; int32_t nknew;          // the garbage on its way the plan was decided knowing
  Arrival nextPend[MAXARRIVALS]; int32_t nnextPend;  // still to land after the predicted next frame
  Arrival prPend[MAXARRIVALS]; int32_t nprPend;
  // the question out: its id and frame, the board it was asked of, its raise and garbage, the garbage known when it was asked
  int32_t pending, pId, pEpoch, pAt, pPaced, pHoldLeft, pHoldStarted, pNarr, pNknew;
  Board *pBoard; Arrival pArr[MAXARRIVALS], pKnew[MAXARRIVALS];
  int32_t nextId;
  // the line after the move, pressed as it was decided: its swaps
  int32_t lineN, line[MAXLINE], lineOfId, lineOfPressed, haveLineOf;
  int32_t lastHold, lastBrk, lastUrgent, havePace;
  double thinking[FTHINK]; int32_t nthinking;
  double msPerFrame, wall;
  // the input budget: its limit and window, the frames the keys still inside it were pressed, the keys held last frame
  int32_t limit, window, pressFrames[512], npress, prevBits;
  int32_t oppHas, oppOut, oppTop;
  int32_t toppedNow;
  // the attacks made, read off the board as it is shown
  int32_t chainMax, pendCombo[16], npendCombo, matchedIds[MAXROWS * W], nmatched, swapSince;
  int32_t reaction, ahead, gap, jitter;
  uint32_t rnd;
  FStats st;
  int32_t loggedDiffer;
} F;

static double fNow(void) { return clock_ms(); }

// ---------------------------------------------------------------- the garbage on its way
// What the senders' telegraphs show, as the garbage this board will receive and the stopWatch it arrives on (garbage due at T is
// received once the frame before T has run): a source's transit by the stopWatch it lands on, its staged shipped from the end of the
// list, none before the one ahead of it; a chain still going ships once it ends, at the soonest. The host's words (gn_tele):
// nsrc, then per source its stopWatch, whether it is held back (an attack engine's queue: GarbageDelivery delivers it only while fewer
// than CAPPED_AT are queued, a transit a frame, the late ones too), ntransit, each transit's at and npieces and pieces -- every transit
// not yet delivered, the finished ones held back as well -- nstaged and pieces; a piece is width, height, isChain, isMetal,
// frameEarned, finalized (NUL, 0, 1).
static int32_t tele[1 << 15];
static void arrivalsOf(const Board *b) {
  const int32_t *w = tele;
  int32_t mine = b->stopWatch, nsrc = *w++;
  F.narr = 0;
  for (int s = 0; s < nsrc; s++) {
    int32_t sw = *w++, capped = *w++, offset = mine - sw, floor = mine + 1, nt = *w++, free = floor;
    for (int t = 0; t < nt; t++) {
      int32_t at = *w++ + offset, np = *w++;
      // (a held-back source delivers a transit a frame, in order: its transits are given frames one apart, none before the next free)
      if (capped) { if (at < free) at = free; free = at + 1; }
      else if (at < floor) at = floor;
      for (int k = 0; k < np; k++, w += 6)
        if (F.narr < MAXARRIVALS) { Arrival *a = &F.arr[F.narr++]; a->at = at; a->capped = capped; a->g = (Incoming){ w[0], w[1], w[2], w[3], w[4], w[5] }; }
    }
    int32_t ns = *w++, ship = sw, lastRaw = NUL, lastAt = NUL;
    const int32_t *g0 = w;
    w += 6 * ns;
    for (int i = ns - 1; i >= 0; i--) {
      const int32_t *g = g0 + 6 * i;
      int32_t chainGoing = g[2] && g[5] != 1 ? sw + 1 : 0;
      ship = imax(ship, imax((g[4] == NUL ? sw : g[4]) + STAGING, chainGoing));
      // (pieces shipped together are one transit, landing together)
      int32_t raw = ship + LAND + offset, at = imax(raw, capped ? free : floor);
      if (capped) { if (raw == lastRaw) at = lastAt; else free = at + 1; lastRaw = raw; lastAt = at; }
      if (F.narr < MAXARRIVALS) { Arrival *a = &F.arr[F.narr++]; a->at = at; a->capped = capped; a->g = (Incoming){ g[0], g[1], g[2], g[3], g[4], g[5] }; }
    }
  }
  // (sorted by when they arrive, the order they came in kept between equals)
  for (int i = 1; i < F.narr; i++) { Arrival x = F.arr[i]; int j = i - 1; while (j >= 0 && F.arr[j].at > x.at) { F.arr[j + 1] = F.arr[j]; j--; } F.arr[j + 1] = x; }
}
// The garbage of `now` a decision made knowing `knew` did not count on: each piece of `knew` accounts for one no bigger, due no sooner;
// whether any of it is due by `by` (a stopWatch).
static int unforeseenBy(const Arrival *knew, int nk, const Arrival *now, int nn, int32_t by) {
  static uint8_t used[MAXARRIVALS];
  memset(used, 0, (unsigned long)nk);
  for (int i = 0; i < nn; i++) {
    const Arrival *a = &now[i];
    int found = 0;
    for (int k = 0; k < nk && !found; k++) {
      const Arrival *b = &knew[k];
      if (!used[k] && b->at <= a->at && b->g.width == a->g.width && b->g.height >= a->g.height && !!b->g.isChain == !!a->g.isChain &&
          !!b->g.isMetal == !!a->g.isMetal) { used[k] = 1; found = 1; }
    }
    if (!found && a->at <= by) return 1;
  }
  return 0;
}
// Garbage due by the frame just reached, received as the server receives it; what lands is taken out of `pend`.
// (garbage held back lands as the search lands it, search.h runFrame: only while fewer than CAPPED_AT are queued, the earliest due a frame)
// THE QUEUE A BOARD HOLDS: fuller than MAXINC, the board keeps the pieces that drop soonest, as the host loads it -- the piece to drop
// last is let go; a board asked of the search keeps MAXINC - MAXARR of them, room for the MAXARR the search lands (keepQueue).
static void receiveKept(Board *b, const Arrival *a) {
  Incoming g = { a->g.width, a->g.height, a->g.isChain ? 1 : 0, a->g.isMetal ? 1 : 0, a->g.frameEarned == NUL ? b->stopWatch : a->g.frameEarned, a->g.finalized };
  if (b->ninc >= MAXINC) {
    if (orderBefore(&g, &b->inc[0])) return;
    for (int i = 1; i < b->ninc; i++) b->inc[i - 1] = b->inc[i];
    b->ninc--;
  }
  nb_receive(b, g.width, g.height, g.isChain, g.isMetal, g.frameEarned, g.finalized);
}
static void keepQueue(Board *b, int keep) {
  if (b->ninc <= keep) return;
  int drop = b->ninc - keep;
  for (int i = drop; i < b->ninc; i++) b->inc[i - drop] = b->inc[i];
  b->ninc = keep;
}
static void landOn(Board *b, Arrival *pend, int32_t *n) {
  int k = 0, first = 0x7fffffff;
  for (int i = 0; i < *n; i++) if (pend[i].capped && pend[i].at <= b->stopWatch && pend[i].at < first) first = pend[i].at;
  int open = first != 0x7fffffff && b->ninc < CAPPED_AT;
  for (int i = 0; i < *n; i++) {
    Arrival *a = &pend[i];
    if (a->at > b->stopWatch || (a->capped && !(open && a->at == first))) { pend[k++] = *a; continue; }
    receiveKept(b, a);
  }
  *n = k;
}
// The same, as the search takes it: frames from this board, the 64 soonest.
static int arrivalsFrom(const Board *b, const Arrival *arr, int n, Arr *out) {
  int k = 0;
  for (int i = 0; i < n && k < MAXARR; i++) {
    const Arrival *a = &arr[i];
    if (a->at <= b->stopWatch) continue;
    out[k++] = (Arr){ imax(1, a->at - b->stopWatch), a->g.width, a->g.height, a->g.isChain ? 1 : 0, (a->g.isMetal ? 1 : 0) | (a->capped ? 2 : 0) };
  }
  return k;
}

// ---------------------------------------------------------------- the board, as predicted
static int unseenColour(int32_t c) { return (c >= 30 && c <= 119) || (c >= 130 && c <= 219); }
static int sameInc(const Incoming *a, const Incoming *b) {
  return a->width == b->width && a->height == b->height && a->isChain == b->isChain && a->isMetal == b->isMetal && a->frameEarned == b->frameEarned &&
         a->finalized == b->finalized;
}
// The queue the game has is the one predicted less pieces it has not let in yet: a plan made with them is made with more garbage than there is.
static int heldBack(const Board *want, const Board *got) {
  if (got->ninc >= want->ninc) return 0;
  static uint8_t used[MAXINC];
  memset(used, 0, (unsigned long)want->ninc);
  for (int i = 0; i < got->ninc; i++) {
    int found = 0;
    for (int k = 0; k < want->ninc && !found; k++) if (!used[k] && sameInc(&got->inc[i], &want->inc[k])) { used[k] = 1; found = 1; }
    if (!found) return 0;
  }
  return 1;
}
static const int PANEL_FIELDS[] = { COLOR, STATE, TIMER, ISGARBAGE, CHAINING, METAL, GARBAGEID, XOFF, YOFF, GWIDTH, GHEIGHT, COMBOINDEX, COMBOSIZE,
                                    MATCHANYWAY, PROPCHAIN, STATECHANGED, DONTSWAP, QUEUEDHOVER, SHAKETIME, FELL, POPTIME, POPINDEX, INITIALTIME };
// Where two boards first disagree (0: they agree), into `why`.
static int differ(const Board *w, const Board *g, char *why, int cap) {
#define DIFF1(f) if (w->f != g->f) { snprintf(why, (unsigned long)cap, "stack." #f " %d vs %d", (int)w->f, (int)g->f); return 1; }
  DIFF1(clock) DIFF1(speed) DIFF1(displacement) DIFF1(riseLock) DIFF1(hasRisen) DIFF1(manualRaise) DIFF1(manualRaiseYet)
  DIFF1(preventManualRaise) DIFF1(stopTime) DIFF1(preStopTime) DIFF1(shakeTime) DIFF1(peakShakeTime) DIFF1(health) DIFF1(chainCounter)
  DIFF1(nActive) DIFF1(nPrevActive) DIFF1(curRow) DIFF1(curCol) DIFF1(topCurRow) DIFF1(queuedSwapRow) DIFF1(queuedSwapCol) DIFF1(curTimer)
  DIFF1(cursorDirection) DIFF1(metalPanelsQueued) DIFF1(garbageCreatedCount) DIFF1(highestGarbageIdMatched) DIFF1(gameOverClock)
  DIFF1(panelsCleared) DIFF1(swapCount)
#undef DIFF1
  if (w->riseTimer != g->riseTimer) { snprintf(why, (unsigned long)cap, "stack.riseTimer"); return 1; }
  int sameQ = w->ninc == g->ninc;
  for (int i = 0; sameQ && i < w->ninc; i++) sameQ = sameInc(&w->inc[i], &g->inc[i]);
  if (!sameQ && !heldBack(w, g)) { snprintf(why, (unsigned long)cap, "incoming %d vs %d", w->ninc, g->ninc); return 1; }
  int sameS = w->nstall == g->nstall;
  for (int i = 0; sameS && i < w->nstall; i++)
    sameS = w->stall[i].leftId == g->stall[i].leftId && w->stall[i].rightId == g->stall[i].rightId && w->stall[i].row == g->stall[i].row &&
            w->stall[i].col == g->stall[i].col && w->stall[i].clock == g->stall[i].clock;
  if (!sameS) { snprintf(why, (unsigned long)cap, "swap-stall log"); return 1; }
  if (w->nrows != g->nrows) { snprintf(why, (unsigned long)cap, "rows %d vs %d", w->nrows, g->nrows); return 1; }
  for (int r = 0; r < w->nrows; r++) for (int c = 1; c <= W; c++)
    for (unsigned k = 0; k < sizeof PANEL_FIELDS / sizeof PANEL_FIELDS[0]; k++) {
      int f = PANEL_FIELDS[k];
      if (f == COLOR && unseenColour(w->p[r][c].f[COLOR])) continue;
      if (w->p[r][c].f[f] != g->p[r][c].f[f]) { snprintf(why, (unsigned long)cap, "panel %d,%d field %d %d vs %d", r, c, f, w->p[r][c].f[f], g->p[r][c].f[f]); return 1; }
    }
  return 0;
}
// A broken slab's colours shown: a panel predicted with a garbage row's unseen colour that the game now shows.
static int revealed(const Board *w, const Board *g) {
  for (int r = 0; r < w->nrows && r < g->nrows; r++) for (int c = 1; c <= W; c++) {
    int32_t p = w->p[r][c].f[COLOR], q = g->p[r][c].f[COLOR];
    if (p >= 130 && p <= 219 && q >= 1 && q <= 10) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------- the plan
static Planned *planOf(int32_t t) { int i = t & (PLANN - 1); return F.planAt[i] == t ? &F.plan[i] : 0; }
static void planSet(int32_t t, Planned p) { int i = t & (PLANN - 1); F.plan[i] = p; F.planAt[i] = t; }
static void planDrop(int32_t t) { int i = t & (PLANN - 1); if (F.planAt[i] == t) F.planAt[i] = NUL; }
static void planClearFrom(int32_t t) { for (int i = 0; i < PLANN; i++) if (F.planAt[i] != NUL && F.planAt[i] >= t) F.planAt[i] = NUL; }
// Everything planned and asked is dropped: the board is not the one it was made for.
static void dropAll(void) {
  if (F.pending) abortTo(F.pId);
  F.epoch++; planClearFrom(NUL + 1); F.nextAt = 0; F.lineN = 0; F.pending = 0;
}

// The board at `at`, from `b` now, pressing what is planned till then, and the garbage still to land after it (from).
static int32_t predictErr;   // (the engine's error flags the last prediction failed on, for the log)
static int predict(const Board *b, int32_t at, int32_t holdLeft, int32_t holdStarted, const Arrival *from, int32_t nfrom, Board *out,
                   int32_t *hL, int32_t *hS) {
  copyBoard(out, b);
  memcpy(F.prPend, from, sizeof(Arrival) * (unsigned long)nfrom); F.nprPend = nfrom;
  int32_t hl = holdLeft, hs = holdStarted;
  while (out->clock < at && out->gameOverClock <= 0) {
    Planned *p = planOf(out->clock);
    int32_t bits = 0;
    if (p) { bits = p->bits; hl = p->holdLeft; hs = p->holdStarted; }
    else if (hl > 0) {
      int started = hs || out->manualRaise;
      if (out->preventManualRaise || (started && !out->manualRaise)) { hl = 0; hs = started; }
      else { hl--; hs = started; bits = IN_RAISE; }
    }
    out->input = bits & ~IN_SWAP;
    if (bits & IN_SWAP) out->pressSwap = 1;
    run(out);
    if (out->err) { predictErr = out->err; return 0; }
    landOn(out, F.prPend, &F.nprPend);
  }
  *hL = hl; *hS = hs;
  return 1;
}

// ---------------------------------------------------------------- the keys
// One decision from a board as keys: the search's own walk, swap and wait (search.h advance), every frame it plays.
static Ctx *keyCtx;
static int keysOf(const Board *b, int32_t holdLeft, int32_t holdStarted, const Arrival *arr, int32_t narr, int kind, int mr, int mc, Keys *k) {
  keyCtx = ctxOf(keyCtx);
  Question q; memset(&q, 0, sizeof q);
  q.b = (Board *)b; q.holdLeft = holdLeft; q.holdStarted = holdStarted; q.narr = arrivalsFrom(b, arr, narr, q.arr);
  int root = rootOf(keyCtx, &q);
  if (root < 0) return 0;
  static LOCAL int32_t buf[3 * MAXKEYS];
  tape = buf; tapeN = 0; tapeCap = MAXKEYS;
  // (a swap whose pair still moves is pressed once it is still, as the judge presses it: the frames between are waited, nothing pressed)
  int node = root, r;
  for (;;) {
    int32_t mark = tapeN;
    r = advance(keyCtx, node, kind, mr, mc, 0);
    if (r != STEP_NULL || kind != MK_SWAP) break;
    tapeN = mark;
    Board *bb = ensureBoard(keyCtx, node);
    if (!bb || !(hasActivePanels(bb) || bb->swappingCount > 0)) break;
    int w = advance(keyCtx, node, MK_LONG, 0, 0, 1);
    if (w < 0 || NODE(keyCtx, w)->dead) break;
    node = w;
  }
  tape = 0;
  ns_reset(keyCtx);
  if (r == STEP_NULL || r == STEP_ERR) return 0;
  k->n = tapeN; k->held = 0;
  for (int i = 0; i < tapeN; i++) { k->ins[i] = buf[3 * i]; k->hl[i] = buf[3 * i + 1]; k->hs[i] = buf[3 * i + 2]; }
  return 1;
}
// A walk of n cells in one direction is played as n taps four frames apart; from four cells up (three where another walk follows) a held
// key gets the cursor to the same cell on the same frame or sooner, so it is held for as long as the cursor needs and released.
static void fHoldWalks(Keys *k) {
  Keys o = *k;
  int held = 0, i = 0, n0 = k->n;
  while (i < n0) {
    Leg L;
    if (!walkLeg(k->ins, n0, i, &L)) { i++; continue; }
    if (L.cells >= MIN_LEG && L.last <= L.end) { for (int f = i; f <= L.end; f++) o.ins[f] = f <= L.last ? L.v : L.base; held++; }
    i = L.p + 1;
  }
  o.held = held;
  *k = o;
}
// The same walks held from two cells, when the allowance is tight; the frames the cursor is late by are put in before the next key,
// each carrying the raise held of the frame it follows.
static void fSlowWalks(Keys *k) {
  static Keys o;
  int held = 0, i = 0, n0 = k->n;
  o.n = 0;
#define PUSH(v, f) do { if (o.n < MAXKEYS) { o.ins[o.n] = (v); o.hl[o.n] = k->hl[f]; o.hs[o.n] = k->hs[f]; o.n++; } } while (0)
  while (i < n0) {
    Leg L;
    if (!walkLeg(k->ins, n0, i, &L)) { PUSH(k->ins[i], i); i++; continue; }
    if (L.cells < 2) { for (int f = i; f <= L.end; f++) PUSH(k->ins[f], f); i = L.end + 1; continue; }
    for (int g = i; g <= imax(L.last, L.end); g++) PUSH(g <= L.last ? L.v : L.base, imin(g, L.end));
    held++;
    i = L.end + 1;
  }
#undef PUSH
  o.held = held;
  *k = o;
}

// ---------------------------------------------------------------- the input budget
#define COUNTED (IN_SWAP | IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT)
// How many actions the game still allows a move starting on frame `at`: the allowance less the presses made and planned in the window.
static int allowanceAt(int32_t at) {
  int32_t lo = at - F.window, used = 0, prev = F.prevBits;
  for (int i = 0; i < F.npress; i++) if (F.pressFrames[i] > lo) used++;
  for (int32_t t = F.now; t < at; t++) {
    Planned *p = planOf(t);
    int32_t bits = p ? p->bits : 0, down = bits & COUNTED & ~prev;
    prev = bits;
    for (int b = 1; b <= 16; b <<= 1) if ((down & b) && t > lo) used++;
  }
  return imax(0, F.limit - used);
}
// Whether the keys from frame `at` stay inside the allowance in every window.
static int keysFit(int32_t at, const Keys *k) {
  static int32_t spent[1024];
  int ns = 0, head = 0;
  for (int i = 0; i < F.npress && ns < 1024; i++) spent[ns++] = F.pressFrames[i];
  int32_t prev = F.prevBits;
  for (int32_t t = F.now; t < at + k->n; t++) {
    Planned *p = planOf(t);
    int32_t bits = t >= at ? k->ins[t - at] : (p ? p->bits : 0), down = bits & COUNTED & ~prev;
    prev = bits;
    for (int b = 1; b <= 16; b <<= 1) if (down & b) {
      while (head < ns && t - spent[head] >= F.window) head++;
      if (ns - head >= F.limit) return 0;
      if (ns < 1024) spent[ns++] = t;
    }
  }
  return 1;
}
static void countActions(int32_t bits, int32_t now) {
  int32_t down = bits & COUNTED & ~F.prevBits;
  F.prevBits = bits;
  for (int b = 1; b <= 16; b <<= 1) if ((down & b) && F.npress < 512) { F.pressFrames[F.npress++] = now; F.st.actions++; }
  int k = 0;
  for (int i = 0; i < F.npress; i++) if (now - F.pressFrames[i] < F.window) F.pressFrames[k++] = F.pressFrames[i];
  F.npress = k;
  if (k > F.st.maxWindow) F.st.maxWindow = k;
  if (k > F.limit) F.st.overInput++;
}
// The cost in actions of a swap at (r, c) from the cursor at (row, col): its walk, across then up or down, each held when it would be.
static int actionsFor(int row, int col, int r, int c, int left) {
  int tight = left <= HOLDTIGHT, legs[2], nl = 0, cost = 1;
  if (abs(c - col)) legs[nl++] = abs(c - col);
  if (abs(r - row)) legs[nl++] = abs(r - row);
  for (int k = 0; k < nl; k++) {
    int n = legs[k], inner = k < nl - 1;
    cost += tight ? (n >= 2 ? 1 : n) : (n >= MIN_LEG + 1 || (n == MIN_LEG && inner)) ? 1 : n;
  }
  return cost;
}
static void walkKeys(Keys *k, int32_t at) { if (allowanceAt(at) <= HOLDTIGHT) fSlowWalks(k); else fHoldWalks(k); }

// ---------------------------------------------------------------- pacing
// How soon an answer can be had, in frames: half again the slowest of the last few.
static int soon(void) {
  double worst = 300;
  if (F.nthinking) { worst = 0; for (int i = 0; i < F.nthinking; i++) if (F.thinking[i] > worst) worst = F.thinking[i]; }
  return imax(6, imin(600, (int)__builtin_ceil(worst / F.msPerFrame * 1.5)));
}
static int aheadOf(void) { return imax(F.ahead, soon()); }
static uint32_t frand(void) { F.rnd = F.rnd * 1664525u + 1013904223u; return F.rnd >> 8; }
// THE SLACK: after a swap whose decision found the hold lives and nothing urgent, the next swap waits the profile's gap and a jitter.
static int calmGap(const Board *next) {
  if (F.gap < 0 || !F.haveSwapEnd || !F.havePace || !F.lastHold || F.lastUrgent) return -1;
  int32_t stop = next->stopTime + next->preStopTime;
  if (F.toppedNow && !(stop > F.gap)) return -1;
  if (F.jitter) {
    if (F.jitterFor != F.lastSwapEnd) { F.jitterFor = F.lastSwapEnd; F.jitterGap = F.gap + (int)(frand() % (uint32_t)(F.jitter + 1)); }
    return F.jitterGap;
  }
  return F.gap;
}

// ---------------------------------------------------------------- questions and answers
static void ask(int32_t at, const Board *b, int32_t hl, int32_t hs, const Arrival *pend, int32_t npend) {
  static FQuestion q;
  F.pending = 1; F.pId = F.nextId++; F.pEpoch = F.epoch; F.pAt = at; F.pPaced = 0; F.pHoldLeft = hl; F.pHoldStarted = hs;
  if (!F.pBoard) F.pBoard = nb_new();
  copyBoard(F.pBoard, b);
  keepQueue(F.pBoard, MAXINC - MAXARR);
  F.pNarr = 0;
  for (int i = 0; i < npend; i++) if (pend[i].at > b->stopWatch) F.pArr[F.pNarr++] = pend[i];
  memcpy(F.pKnew, F.arr, sizeof(Arrival) * (unsigned long)F.narr); F.pNknew = F.narr;
  q.id = F.pId; q.epoch = F.epoch; q.at = at; q.lead = at - F.now; q.ms = (at - F.now) * F.msPerFrame; q.posted = fNow();
  q.allowance = allowanceAt(at); q.topped = F.toppedNow; q.lineFrom = F.haveLineOf ? F.lineOfId : -1; q.linePressed = F.haveLineOf ? F.lineOfPressed : 0;
  q.holdLeft = hl; q.holdStarted = hs; q.narr = F.pNarr; memcpy(q.arr, F.pArr, sizeof(Arrival) * (unsigned long)F.pNarr);
  q.oppHas = F.oppHas; q.oppOut = F.oppOut; q.oppTop = F.oppTop;
  q.b = F.pBoard;
  postQuestion(&q);
  F.st.decisions++;
}
// The answers: an answer's keys go in the plan, and the next decision is due on the frame they end on. One that came after its frame is
// not played (a swap is pressed only on the board it was judged on); the next question is asked of the board as it is.
static int follow(void);
static void take(void) {
  static FAnswer a;
  static Keys k;
  while (takeAnswer(&a)) {
    if (F.nthinking == FTHINK) { memmove(F.thinking, F.thinking + 1, sizeof(double) * (FTHINK - 1)); F.nthinking--; }
    // (how soon an answer can be had: what it took, up to a reaction's frames -- a decision given longer, because its move was further
    // off, used time it was given, not time the next one needs)
    double took = a.ms - a.idleMs > 0 ? a.ms - a.idleMs : 0, most = (F.reaction + 1) * F.msPerFrame;
    F.thinking[F.nthinking++] = took < most ? took : most;
    if (!F.pending || a.id != F.pId) { F.st.unasked++; continue; }
    F.pending = 0;
    if (a.error || a.kind < 0) continue;
    if (a.epoch != F.epoch || a.at < F.now) {
      F.st.late++;
      if (a.epoch == F.epoch && F.st.late <= 40) { char l[160]; snprintf(l, sizeof l, "LATE answer for %d taken at %d: %.0f ms, closing %.0f ms, %.1f ms a frame", a.at, F.now, a.ms, a.closeMs, F.msPerFrame); flog(l); }
      continue;
    }
    int32_t at = a.at;
    // (THE MOVE IN HAND: a hold the clock left no time to judge for is no answer -- the line already in hand, or else the last answer's
    // line that lives and is no hold, is played on, from the frame it was asked for, each swap checked by the keys it makes)
    if (a.kind == 0 && a.empty) {
      F.st.starved++;
      if (!F.lineN && F.nalt) { F.lineN = F.nalt; for (int i = 0; i < F.nalt; i++) F.line[i] = F.alt[i]; F.nalt = 0; F.haveLineOf = 0; }
      if (F.lineN) { if (F.nextAt < at) F.nextAt = at; if (follow()) { F.st.inHand++; continue; } }
    }
    if (!a.empty) { F.nalt = a.nalt; for (int i = 0; i < a.nalt; i++) F.alt[i] = a.alt[i]; }
    int kind = a.kind == 1 ? MK_SWAP : a.kind == 2 ? MK_RAISE : MK_HOLD;
    if (!keysOf(F.pBoard, F.pHoldLeft, F.pHoldStarted, F.pArr, F.pNarr, kind, a.kind == 1 ? CR(a.move) : 0, a.kind == 1 ? CC(a.move) : 0, &k)) {
      F.st.refused++;
      if (F.loggedRefused < 40) { char l[160]; snprintf(l, sizeof l, "REFUSED answer for %d taken at %d: no keys press %d,%d there", a.at, F.now, CR(a.move), CC(a.move)); flog(l); F.loggedRefused++; }
      continue;
    }
    // (a raise held down: the button stays down for the frames it takes to bring the rows in, and raiseAfter after them)
    if (a.kind == 2 && a.raiseNow > k.n) {
      k.n = imin(a.raiseNow, MAXKEYS);
      for (int q = 0; q < k.n; q++) { k.ins[q] = IN_RAISE; k.hl[q] = q == k.n - 1 ? a.raiseAfter : 0; k.hs[q] = q == k.n - 1 && a.raiseAfter > 0; }
    }
    F.st.played++;
    walkKeys(&k, at);
    if (!keysFit(at, &k)) {
      F.st.guarded++;
      if (F.loggedRefused < 40) { char l[160]; snprintf(l, sizeof l, "GUARDED answer for %d taken at %d: its %d keys do not fit the input allowance", a.at, F.now, k.n); flog(l); F.loggedRefused++; }
      continue;
    }
    F.st.heldWalks += k.held;
    if (a.kind == 1) F.st.swaps++;
    planClearFrom(at);
    for (int i = 0; i < k.n; i++) planSet(at + i, (Planned){ k.ins[i], k.hl[i], k.hs[i], a.kind == 1 });
    F.nextAt = at + k.n;
    if (a.kind == 1) { F.lastSwapEnd = F.nextAt; F.haveSwapEnd = 1; }
    F.lastHold = a.holdLives; F.lastBrk = a.brk; F.lastUrgent = a.urgent; F.havePace = 1;
    memcpy(F.knew, F.pKnew, sizeof(Arrival) * (unsigned long)F.pNknew); F.nknew = F.pNknew;
    F.lineN = a.nhand; for (int i = 0; i < a.nhand; i++) F.line[i] = a.hand[i];
    F.haveLineOf = 1; F.lineOfId = a.id; F.lineOfPressed = 0;
  }
}
// The line behind the move, its next swap played from where the plan ends, on the board predicted for then.
static int follow(void) {
  static Keys k;
  if (!F.lineN) return 0;
  int32_t mv = F.line[0], hl, hs;
  if (!predict(F.expect, F.nextAt, F.holdLeft, F.holdStarted, F.nextPend, F.nnextPend, F.pr, &hl, &hs)) { F.lineN = 0; return 0; }
  if (!keysOf(F.pr, hl, hs, F.prPend, F.nprPend, MK_SWAP, CR(mv), CC(mv), &k)) { F.lineN = 0; return 0; }
  if (F.pending) abortTo(F.pId);
  F.pending = 0;
  walkKeys(&k, F.nextAt);
  if (!keysFit(F.nextAt, &k)) { F.lineN = 0; F.st.guarded++; return 0; }
  int left = allowanceAt(F.nextAt);
  if (actionsFor(F.pr->curRow, F.pr->curCol, CR(mv), CC(mv), left) > left) { F.lineN = 0; return 0; }
  F.st.heldWalks += k.held;
  for (int i = 0; i < k.n; i++) planSet(F.nextAt + i, (Planned){ k.ins[i], k.hl[i], k.hs[i], 1 });
  F.nextAt += k.n;
  F.lastSwapEnd = F.nextAt; F.haveSwapEnd = 1;
  memmove(F.line, F.line + 1, sizeof(int32_t) * (unsigned long)(F.lineN - 1)); F.lineN--;
  F.lineOfPressed++;
  F.st.followed++;
  return 1;
}

// ---------------------------------------------------------------- the attacks made, counted off the board shown
// A match of 4 or more is a combo when it is a clear of its own; a chain is counted at its longest when it ends.
// (a panel out of garbage keeps the garbage's id: every id seen as garbage is kept)
#define WASG (1 << 20)
static uint8_t wasGarbage[WASG];
static void countAttacks(const Board *b) {
  static int32_t now[MAXROWS * W];
  int nn = 0, fresh = 0, fromGarbage = 0;
  for (int r = 1; r < b->nrows; r++) for (int c = 1; c <= W; c++) {
    const int32_t *f = b->p[r][c].f;
    if (f[ISGARBAGE] && f[ID] != NUL) wasGarbage[f[ID] & (WASG - 1)] = 1;
    if (f[STATE] == MATCHED && !f[ISGARBAGE] && f[COLOR] > 0) {
      now[nn++] = f[ID];
      int seen = 0;
      for (int i = 0; i < F.nmatched && !seen; i++) seen = F.matchedIds[i] == f[ID];
      if (!seen) { fresh++; if ((f[ID] != NUL && wasGarbage[f[ID] & (WASG - 1)]) || (f[FELL] != NUL && f[FELL] > 0)) fromGarbage++; }
    }
  }
  memcpy(F.matchedIds, now, sizeof(int32_t) * (unsigned long)nn); F.nmatched = nn;
  int32_t cc = b->chainCounter;
  if (cc >= 2 && F.npendCombo) F.npendCombo = 0;
  if (cc == 0 && F.npendCombo) { for (int i = 0; i < F.npendCombo; i++) F.st.combo[imin(F.pendCombo[i], 63)]++; F.npendCombo = 0; }
  if (fresh >= 4 && cc < 2 && F.npendCombo < 16) F.pendCombo[F.npendCombo++] = fresh;
  if (cc > F.chainMax) {
    if (cc >= 3) F.st.linkBy[fromGarbage ? LINK_GARBAGE : F.swapSince ? LINK_SWAP : LINK_ALONE][imin(cc, 31)]++;
    F.chainMax = cc; F.swapSince = 0;
  }
  if (cc == 0 && F.chainMax >= 2) F.st.chain[imin(F.chainMax, 31)]++;
  if (cc == 0) F.chainMax = 0;
}

// ---------------------------------------------------------------- one frame
static int frontFrame(void) {
  Board *t = F.truth;
  int32_t now = t->clock;
  char why[160];
  F.now = now;
  countAttacks(t);
  F.toppedNow = isToppedOut(t);
  F.st.frames++;
  double wall = fNow();
  if (F.wall) F.msPerFrame += ((wall - F.wall < 100 ? wall - F.wall : 100) - F.msPerFrame) / 60;
  F.wall = wall;
  int diverged = 0;
  if (F.haveExpect && differ(F.expect, t, why, sizeof why)) {
    dropAll(); F.st.diverged++; diverged = 1;
    if (F.loggedDiffer < 40) {
      // (and the garbage on its way as the telegraph shows it now, and as the plan knew it: how many, and how many due by now)
      int dueNow = 0, dueKnew = 0;
      for (int i = 0; i < F.narr; i++) dueNow += F.arr[i].at <= t->stopWatch;
      for (int i = 0; i < F.nknew; i++) dueKnew += F.knew[i].at <= t->stopWatch;
      char l[320]; snprintf(l, sizeof l, "DIVERGED clock %d: %s (on its way %d, due %d; known %d, due %d)", now, why, F.narr, dueNow, F.nknew, dueKnew);
      flog(l); F.loggedDiffer++;
    }
  }
  // (colours dealt into the row not yet risen: no planned swap touches it, so the plan stands -- a board it does change is caught as one
  // that differs -- and only the question out, asked without them, is asked again)
  if (!diverged && F.haveExpect && revealed(F.expect, t)) { if (F.pending) { abortTo(F.pId); F.pending = 0; } F.st.revealed++; }
  int32_t off = t->clock - t->stopWatch;
  if (F.nextAt > now && unforeseenBy(F.knew, F.nknew, F.arr, F.narr, F.nextAt - off)) { dropAll(); F.st.unforeseen++; }
  if (F.pending && unforeseenBy(F.pKnew, F.pNknew, F.arr, F.narr, F.pAt - off)) { abortTo(F.pId); F.pending = 0; F.st.reasked++; }
  take();
  int32_t bits;
  Planned *p = planOf(now);
  if (p) { bits = p->bits; F.holdLeft = p->holdLeft; F.holdStarted = p->holdStarted; planDrop(now); }
  else {
    bits = 0;
    if (F.holdLeft > 0) {
      int started = F.holdStarted || t->manualRaise;
      if (t->preventManualRaise || (started && !t->manualRaise)) { F.holdLeft = 0; F.holdStarted = started; }
      else { bits = IN_RAISE; F.holdLeft--; F.holdStarted = started; }
    }
    F.st.idle++;
  }
  // (never raised while topped out: the raise is let go, and what was planned with it dropped)
  if ((bits & IN_RAISE) && (F.toppedNow || t->wasToppedOut)) {
    bits &= ~IN_RAISE; F.holdLeft = 0; F.holdStarted = 0;
    if (!(now < F.raiseCutUntil)) { dropAll(); F.st.raiseCut++; }
    F.raiseCutUntil = now + 30;
  }
  countActions(bits, now);
  if (bits & IN_SWAP) F.swapSince = 1;
  return bits;
}
// After the frame: the board it makes, then the line followed on or the next question asked.
static void afterFrame(int32_t bits) {
  int32_t now = F.now;
  copyBoard(F.expect, F.truth);
  F.expect->input = bits & ~IN_SWAP;
  if (bits & IN_SWAP) F.expect->pressSwap = 1;
  run(F.expect);
  memcpy(F.nextPend, F.arr, sizeof(Arrival) * (unsigned long)F.narr); F.nnextPend = F.narr;
  landOn(F.expect, F.nextPend, &F.nnextPend);
  F.haveExpect = 1;
  Board *next = F.expect;
  if (next->gameOverClock > 0) return;
  if (F.pending && !F.pPaced && F.nextAt - now == 1 && !answerWaiting(F.pId)) { if (F.lineN) follow(); else F.st.noLine++; }
  if (F.pending) return;
  int gap = calmGap(next);
  while (gap < 0 && F.lineN && F.nextAt > now && F.nextAt - now < soon() && follow()) {}
  int lead = F.nextAt > now ? soon() : imax(soon(), imin(aheadOf(), popLeft(next) / 4));
  int32_t at = imax(F.nextAt > now ? F.nextAt : 0, now + lead);
  int paced = 0;
  if (gap >= 0 && F.lastSwapEnd + gap > at) { at = F.lastSwapEnd + gap; paced = 1; }
  if (at - now > aheadOf()) return;
  int32_t hl, hs;
  int ok = predict(next, at, F.holdLeft, F.holdStarted, F.nextPend, F.nnextPend, F.pr, &hl, &hs);
  // (the board predicted lost by then: asked for the last frame it is still alive, which leaves the question all the time there is)
  if (ok && F.pr->gameOverClock > 0) {
    int32_t alive = F.pr->gameOverClock - 1;
    ok = alive > now + 1 && predict(next, alive, F.holdLeft, F.holdStarted, F.nextPend, F.nnextPend, F.pr, &hl, &hs) && F.pr->gameOverClock <= 0;
    if (ok) at = alive;
  }
  if (!ok || F.pr->gameOverClock > 0) {
    if (F.loggedAskNow < 40) {
      char l[200]; snprintf(l, sizeof l, "ASKNOW clock %d: the board for frame %d %s (engine error %d, queued %d)", now, at, !ok ? "could not be predicted" : "is lost by then", predictErr, next->ninc);
      flog(l); F.loggedAskNow++;
    }
    at = now + 1; copyBoard(F.pr, next); hl = F.holdLeft; hs = F.holdStarted;
    memcpy(F.prPend, F.nextPend, sizeof(Arrival) * (unsigned long)F.nnextPend); F.nprPend = F.nnextPend;
  }
  ask(at, F.pr, hl, hs, F.prPend, F.nprPend);
  if (paced && at > now + 1) { F.pPaced = 1; F.st.paced++; }
}

// THE MATCH'S STATS as one JSON line, as the reports read it ("match over: {...}")
static void statsLine(char *out, int cap) {
  int k = snprintf(out, (unsigned long)cap, "match over: {\"frames\":%d,\"decisions\":%d,\"played\":%d,\"late\":%d,\"diverged\":%d,\"refused\":%d,"
                   "\"guarded\":%d,\"unasked\":%d,\"idle\":%d,\"followed\":%d,\"noLine\":%d,\"unforeseen\":%d,\"reasked\":%d,\"revealed\":%d,"
                   "\"raiseCut\":%d,\"actions\":%d,\"maxWindow\":%d,\"overInput\":%d,\"heldWalks\":%d,\"paced\":%d,\"swaps\":%d,\"starved\":%d,\"inHand\":%d,\"attacks\":{\"combo\":{",
                   F.st.frames, F.st.decisions, F.st.played, F.st.late, F.st.diverged, F.st.refused, F.st.guarded, F.st.unasked, F.st.idle,
                   F.st.followed, F.st.noLine, F.st.unforeseen, F.st.reasked, F.st.revealed, F.st.raiseCut, F.st.actions, F.st.maxWindow,
                   F.st.overInput, F.st.heldWalks, F.st.paced, F.st.swaps, F.st.starved, F.st.inHand);
  int first = 1;
  for (int z = 0; z < 64 && k < cap; z++) if (F.st.combo[z]) { k += snprintf(out + k, (unsigned long)(cap - k), "%s\"%d\":%d", first ? "" : ",", z, F.st.combo[z]); first = 0; }
  if (k < cap) k += snprintf(out + k, (unsigned long)(cap - k), "},\"chain\":{");
  first = 1;
  for (int z = 0; z < 32 && k < cap; z++) if (F.st.chain[z]) { k += snprintf(out + k, (unsigned long)(cap - k), "%s\"%d\":%d", first ? "" : ",", z, F.st.chain[z]); first = 0; }
  if (k < cap) k += snprintf(out + k, (unsigned long)(cap - k), "}},\"linkBy\":{");
  static const char *CAUSE[3] = { "garbage", "swap", "alone" };
  for (int w = 0; w < 3 && k < cap; w++) {
    k += snprintf(out + k, (unsigned long)(cap - k), "%s\"%s\":{", w ? "," : "", CAUSE[w]);
    first = 1;
    for (int z = 0; z < 32 && k < cap; z++) if (F.st.linkBy[w][z]) { k += snprintf(out + k, (unsigned long)(cap - k), "%s\"%d\":%d", first ? "" : ",", z, F.st.linkBy[w][z]); first = 0; }
    if (k < cap) k += snprintf(out + k, (unsigned long)(cap - k), "}");
  }
  if (k < cap) snprintf(out + k, (unsigned long)(cap - k), "}}");
}

static void frontNew(int reaction, int ahead, int gap, int jitter) {
  if (F.pending) abortTo(F.pId);
  Board *keep[4] = { F.truth, F.expect, F.pr, F.pBoard };
  int32_t nextId = F.nextId;
  memset(&F, 0, sizeof F);
  F.truth = keep[0] ? keep[0] : nb_new(); F.expect = keep[1] ? keep[1] : nb_new(); F.pr = keep[2] ? keep[2] : nb_new(); F.pBoard = keep[3];
  for (int i = 0; i < PLANN; i++) F.planAt[i] = NUL;
  F.nextId = nextId ? nextId : 1;
  F.reaction = reaction; F.ahead = ahead; F.gap = gap; F.jitter = jitter;
  F.msPerFrame = 1000.0 / 60; F.limit = 76; F.window = 600;
  F.rnd = (uint32_t)fNow();
  memset(wasGarbage, 0, sizeof wasGarbage);
}
