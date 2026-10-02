// ================================================================== THE SEARCH
// puyocpu.js's survival search, on these boards: a node is a board at one of
// the bot's decision frames, a step is one decision played frame by frame
// (_engineAdvanceOn / _runFrom / _engineStep, with panel-cpu.js's walk), and
// the level loop is _survivalSearch's. Same order, same budget, same keys, so
// the same moves are proven. native.js puts nodes in front of puyocpu.js;
// native.test.js and GC_ENGINE_CHECK compare every step with the JS one.
// What an engine gives the search, besides Board, run, canSwap, tryQueueSwap,
// cloneBoard, nb_load and nb_save:
//   KEY_COLOR(f)       a panel's colour in the key (garbage: its kind)
//   SWAP_PRESSED       1 where tryQueueSwap only presses swap for the next
//                      frame and that frame decides (the server's engine);
//                      st->swapDenied then says it was not taken
//   pushArrival(b, a)  garbage arriving
//   NODE_BREAKS(b)     garbage rows broken on the board so far (0 where not counted)
#ifndef NODE_BREAKS
#define NODE_BREAKS(b) 0   // an engine that counts breaks says how
#endif
// isMetal: bit 1 metal, bit 2 capped -- an attack engine's garbage, which the
// game holds back while CAPPED_AT are queued, the earliest due of it a frame.
typedef struct { int32_t at, width, height, isChain, isMetal; } Arr;
#define CAPPED_AT 72
#define MAXARR 64   // pa.c / engine.c NBODY leave room for this many after the board
#define KEYMAX (16 * W)
enum { MK_LONG, MK_HOLD, MK_RAISE, MK_SWAP, MK_SETTLE };
// MK_SETTLE (engines with STEP_STATS): a swap at (mr, mc) -- or, with mr 0, a
// hold -- and then the frames until nothing moves, at most `frames` (or
// SETTLE_CAP when that is 0), as the
// bot's candidate resolve settles them; what the step did is read with
// ns_step_stats.
typedef struct Node {
  Board *st;                   // 0 once freed: replayed from prev when asked for
  int32_t t, holdLeft, holdStarted, fresh, dead, fromPrev;   // fromPrev: a dead end, on its parent's board
  int32_t narr; Arr arr[MAXARR];
  int32_t tag, prev, mk, mr, mc, frames, seed, pins, err, live, kept;
  int32_t held, garb, top, pos0, pos1, brk;   // brk: garbage rows broken so far (NODE_BREAKS)
  int32_t stopTime, preStopTime, shakeTime, displacement, speed;
  double riseTimer;
  uint32_t hash;
  int32_t keyn; int32_t key[KEYMAX];
} Node;
typedef struct { int32_t *a; int32_t n, cap; } Vec;
typedef struct Ctx {
  Node *nodes; int32_t n, cap;
  int32_t reaction, cursorMoveFrames, surviveFrames, surviveRest;
  int32_t swapGap;   // frames the bot waits after a swap before it acts again (ns_ctx_gap; reaction unless set)
  int32_t steps;
  // the level loop's own storage, kept from search to search
  Vec level, next, keep, tmp, moves;
  int32_t *seen; int32_t seenCap;
  int32_t ntags;
  int32_t *verdict, *proofs, *weak, *reach, *reachSet, *far, *per, *brkAt; int32_t tagCap;
  int32_t rootBrk;   // the root's rows broken: a line breaks garbage when a node's brk is past it
  int32_t par;   // threads are making nodes: newNode takes a reserved slot
} Ctx;
#define NODE(x, i) (&(x)->nodes[i])

static Node *newNode(Ctx *x) {
  if (x->par) {
    int32_t i = __atomic_fetch_add(&x->n, 1, __ATOMIC_SEQ_CST);
    if (i >= x->cap) return 0;   // reserved before the threads start: never here
    Node *n = &x->nodes[i];
    memset(n, 0, sizeof(Node) - sizeof(n->key));
    n->prev = -1; n->tag = -1;
    return n;
  }
  if (x->n == x->cap) {
    int32_t cap = x->cap ? x->cap * 2 : 1024;
    Node *nn = (Node *)grab((unsigned long)cap * sizeof(Node));
    if (!nn) return 0;
    if (x->n) memcpy(nn, x->nodes, (unsigned long)x->n * sizeof(Node));
    x->nodes = nn; x->cap = cap;   // the old block is left behind: nodes grow rarely
  }
  Node *n = &x->nodes[x->n++];
  memset(n, 0, sizeof(Node) - sizeof(n->key));
  n->prev = -1; n->tag = -1;
  return n;
}
EXPORT(ns_ctx_new) Ctx *ns_ctx_new(void) { Ctx *x = (Ctx *)grab(sizeof(Ctx)); memset(x, 0, sizeof(Ctx)); return x; }
EXPORT(ns_ctx_set) void ns_ctx_set(Ctx *x, int reaction, int cursorMoveFrames, int surviveFrames, int surviveRest) {
  x->reaction = reaction; x->cursorMoveFrames = cursorMoveFrames; x->surviveFrames = surviveFrames; x->surviveRest = surviveRest;
  x->swapGap = reaction;
}
EXPORT(ns_ctx_cap) int ns_ctx_cap(Ctx *x) { return x->cap; }
// After a swap the bot acts again `gap` frames on; a hold or a wait is still reaction + 1.
EXPORT(ns_ctx_gap) void ns_ctx_gap(Ctx *x, int gap) { x->swapGap = gap; }
// Every node gone and every board back in the pool.
EXPORT(ns_reset) void ns_reset(Ctx *x) {
  for (int i = 0; i < x->n; i++) if (x->nodes[i].st && !x->nodes[i].fromPrev) nb_free(x->nodes[i].st);
  x->n = 0;
}

// ---- what the search reads off a board (puyocpu.js _engineNode, FastStack.grid)
static const char STATE_KEY[10] = { 0, 1, 2, 3, 4, 4, 5, 6, 7, 8 };   // 'popping' and 'popped' share their 'p'
static void readBoard(Node *n, Board *b) {
  int H = b->height, r, c, k = 0, g = 0, top = 0;
  uint32_t h = 2166136261u;
  for (r = 1; r <= H + 1 && r < b->nrows; r++)
    for (c = 1; c <= W; c++) {
      const int32_t *f = b->p[r][c].f;
      if (f[COLOR] != 0) { top = r; if (f[ISGARBAGE]) g++; }
      // The key holds 19 bits of timer: one outside them is clamped, which
      // only lets two boards that differ there share a key.
      int32_t tm = f[TIMER];
      if (tm < 0) tm = 0; else if (tm >= (1 << 19)) tm = (1 << 19) - 1;
      int32_t v = KEY_COLOR(f) | (STATE_KEY[f[STATE]] << 8) | (tm << 12);
      if (k < KEYMAX) n->key[k++] = v;
      h = (h ^ (uint32_t)v) * 16777619u;
    }
  n->keyn = k; n->hash = h; n->garb = g; n->top = top;
  n->pos0 = b->curRow; n->pos1 = b->curCol;
  n->stopTime = b->stopTime; n->preStopTime = b->preStopTime; n->shakeTime = b->shakeTime;
  n->displacement = b->displacement; n->riseTimer = b->riseTimer; n->speed = b->speed;
  n->held = b->stopTime + b->preStopTime + b->shakeTime;
  n->brk = NODE_BREAKS(b);
}
static int legalSwaps(Board *b, int32_t *out) {
  int n = 0;
  for (int r = 1; r <= b->height; r++)
    for (int c = 1; c < W; c++) {
      Panel *a = P(b, r, c), *d = P(b, r, c + 1);
      if (a->f[ISGARBAGE] || d->f[ISGARBAGE]) continue;
      if (a->f[COLOR] == 0 && d->f[COLOR] == 0) continue;
      if (a->f[COLOR] == d->f[COLOR]) continue;
      if (!canSwap(b, r, c)) continue;
      out[n++] = r * 8 + c;
    }
  return n;
}

// ---- the bot's hands (panel-cpu.js beginWalk / driveWalk / nearestSwappable, puyocpu.js raiseStep)
typedef struct { int32_t active, row, col, timer, cooldown, retries, disp; } Walk;
typedef struct { Walk w; int32_t cooldown, lastSwap, raiseFrames, raiseStarted; } Bot;
static void beginWalk(Bot *bot, int row, int col, int cooldown) {
  Walk w = { 1, row, col, 0, cooldown, 0, UND };
  bot->w = w;
}
static int nearestSwappable(Board *b, int fromRow, int fromCol, int *out) {
  int found = 0, bestD = 0x7fffffff;
  for (int r = 1; r <= b->topCurRow; r++)
    for (int c = 1; c < W; c++) {
      if (r == fromRow && c == fromCol) continue;
      int d = (r > fromRow ? r - fromRow : fromRow - r) + (c > fromCol ? c - fromCol : fromCol - c);
      if (d >= bestD) continue;
      if (!canSwap(b, r, c)) continue;
      out[0] = r; out[1] = c; bestD = d; found = 1;
    }
  return found;
}
static void driveWalk(Ctx *x, Bot *bot, Board *b, int32_t *input) {
  Walk *w = &bot->w;
  if (w->disp != UND && b->displacement > w->disp) w->row++;
  w->disp = b->displacement;
  int row = imax(1, imin(w->row, b->topCurRow)), col = imax(1, imin(w->col, W - 1));
  if (b->curRow != row || b->curCol != col) {
    if (w->timer > 0) { w->timer--; return; }
    if (b->curCol < col) *input |= IN_RIGHT;
    else if (b->curCol > col) *input |= IN_LEFT;
    else if (b->curRow < row) *input |= IN_UP;
    else *input |= IN_DOWN;
    w->timer = x->cursorMoveFrames - 1;
    return;
  }
  int ok = tryQueueSwap(b, b->curRow, b->curCol);
  Walk old = *w;
  w->active = 0;
  if (ok) { bot->lastSwap = 1; bot->cooldown = old.cooldown; return; }
  int alt[2];
  if (old.retries < 2 && nearestSwappable(b, b->curRow, b->curCol, alt)) {
    beginWalk(bot, alt[0], alt[1], old.cooldown);
    bot->w.retries = old.retries + 1;
    return;
  }
  bot->cooldown = old.cooldown;
}
static void raiseStep(Bot *h, Board *st, int32_t *input) {
  if (h->raiseFrames > 0) {
    if (st->manualRaise) h->raiseStarted = 1;
    if (st->preventManualRaise || (h->raiseStarted && !st->manualRaise)) h->raiseFrames = 0;
    else { h->raiseFrames--; *input |= IN_RAISE; }
  }
}

// ---- one step
#define STEP_NULL (-1)
#define STEP_DEAD (-2)
#define STEP_ERR (-3)
static LOCAL int32_t deadAt;   // the frame a STEP_DEAD died on
#ifndef PUSH_ARRIVAL
static void pushArrival(Board *b, const Arr *a) { nb_push_incoming(b, a->width, a->height, a->isChain, a->isMetal & 1); }
#endif
// THE KEY TAPE: with tape set, advance writes every frame it plays -- the
// keys sent (SENT_KEYS: with the swap an engine presses for itself) and the
// raise held after it -- so a caller can press what the search played.
#ifndef SENT_KEYS
#define SENT_KEYS(st, input) (input)
#endif
static LOCAL int32_t *tape, tapeN, tapeCap;
static int runFrame(Board *st, Arr *arr, int32_t *narr, int32_t input, int32_t *f) {
  st->input = input;
  run(st);
  (*f)++;
  int k = 0, first = 0x7fffffff;
  for (int i = 0; i < *narr; i++) if ((arr[i].isMetal & 2) && arr[i].at <= *f && arr[i].at < first) first = arr[i].at;
  int open = first != 0x7fffffff && st->ninc < CAPPED_AT;
  for (int i = 0; i < *narr; i++) {
    if (arr[i].at <= *f && (!(arr[i].isMetal & 2) || (open && arr[i].at == first))) pushArrival(st, &arr[i]);
    else arr[k++] = arr[i];
  }
  *narr = k;
  return st->gameOver;
}
static Board *ensureBoard(Ctx *x, int i);
// _engineAdvanceOn + _runFrom. Returns the child's index, STEP_NULL (refused)
// or STEP_DEAD (deadAt set).
// Frames played and steps made, per step kind, on every thread (ns_frame_stats).
static int32_t framesOf[8], stepsOf[8];
static int advance(Ctx *x, int pi, int kind, int mr, int mc, int32_t frames) {
  Board *pb = ensureBoard(x, pi);
  if (!pb) return STEP_ERR;
  Node *par = NODE(x, pi);
  Board *st = nb_new();
  if (!st) return STEP_ERR;
  cloneBoard(st, pb);
  Bot bot; memset(&bot, 0, sizeof bot);
  bot.raiseFrames = par->holdLeft; bot.raiseStarted = par->holdStarted;
  Arr arr[MAXARR]; int32_t narr = par->narr;
  for (int i = 0; i < narr; i++) arr[i] = par->arr[i];
  int32_t input = par->fresh ? st->input : 0, f = 0, t0 = par->t;
  if (!par->fresh) raiseStep(&bot, st, &input);
  int swapping = kind == MK_SWAP || (kind == MK_SETTLE && mr > 0);
#define GIVE0(code) do { nb_free(st); return (code); } while (0)
#ifdef STEP_STATS
  st->sNCombo = 0; st->sCleared = 0; st->sBroke = 0; st->sEarned = 0;
#else
  if (kind == MK_SETTLE) GIVE0(STEP_ERR);
#endif
  if (swapping) { beginWalk(&bot, mr, mc, x->swapGap); driveWalk(x, &bot, st, &input); }
  else if (kind == MK_RAISE) { bot.raiseFrames = 20; bot.raiseStarted = 0; bot.cooldown = x->reaction; }
  else if (kind == MK_HOLD || kind == MK_SETTLE) bot.cooldown = x->reaction;
#define REFUSED (swapping && !bot.w.active && !bot.lastSwap)
#define GIVE(code) do { nb_free(st); return (code); } while (0)
#define FRAME() do { if (tape) { if (tapeN >= tapeCap) GIVE(STEP_ERR); \
                        tape[3 * tapeN] = SENT_KEYS(st, input); tape[3 * tapeN + 1] = bot.raiseFrames; \
                        tape[3 * tapeN + 2] = bot.raiseStarted; tapeN++; } \
                      int over_ = runFrame(st, arr, &narr, input, &f); if (st->err) GIVE(STEP_ERR); \
                      if (SWAP_PRESSED && swapping && st->swapDenied) GIVE(STEP_NULL); \
                      if (over_) { deadAt = t0 + f; __atomic_add_fetch(&framesOf[kind & 7], f, __ATOMIC_RELAXED); __atomic_add_fetch(&stepsOf[kind & 7], 1, __ATOMIC_RELAXED); GIVE(STEP_DEAD); } } while (0)
  if (REFUSED || (bot.w.active && bot.w.retries)) GIVE(STEP_NULL);
  FRAME();
  for (int guard = 0; guard < 4000; guard++) {
    if (kind == MK_LONG && f >= frames) break;
    input = 0;
    raiseStep(&bot, st, &input);
#ifdef COUNTDOWN
    // Frames on which only timers run are played at once (countdown), up to
    // the frame before the step ends or garbage on its way lands.
    if (!tape && !input && !bot.w.active) {
      int32_t room = kind == MK_LONG ? frames - f - 1
                   : bot.cooldown > 0 ? bot.cooldown - 1
                   : kind == MK_SETTLE && f >= 3 ? (frames > 0 ? frames : SETTLE_CAP) - f - 1 : 0;
      for (int i = 0; i < narr; i++) room = imin(room, arr[i].at - f - 1);
      int32_t k = countdown(st, room);
      if (k > 0) { f += k; if (bot.cooldown > 0) bot.cooldown -= k; }
    }
#endif
    if (bot.w.active) {
      driveWalk(x, &bot, st, &input);
      if (REFUSED || (bot.w.active && bot.w.retries)) GIVE(STEP_NULL);
      FRAME();
      continue;
    }
    if (kind != MK_LONG) {
      if (bot.cooldown > 0) { bot.cooldown--; FRAME(); continue; }
#ifdef STEP_STATS
      if (kind == MK_SETTLE && (f < 3 || !st->quiet) && f < (frames > 0 ? frames : SETTLE_CAP)) { FRAME(); continue; }
#endif
      break;
    }
    FRAME();
  }
#undef FRAME
  if (st->err) GIVE(STEP_ERR);
  __atomic_add_fetch(&framesOf[kind & 7], f, __ATOMIC_RELAXED); __atomic_add_fetch(&stepsOf[kind & 7], 1, __ATOMIC_RELAXED);
  Node *n = newNode(x);
  if (!n) GIVE(STEP_ERR);
  par = NODE(x, pi);   // nodes may have moved
  n->st = st; n->t = t0 + f; n->holdLeft = bot.raiseFrames; n->holdStarted = bot.raiseStarted; n->fresh = 0;
  n->narr = narr;
  for (int i = 0; i < narr; i++) { n->arr[i] = arr[i]; n->arr[i].at -= f; }
  n->prev = pi; n->mk = kind; n->mr = mr; n->mc = mc; n->frames = frames;
  readBoard(n, st);
  if (n->err) return STEP_ERR;
  return (int)(n - x->nodes);
#undef REFUSED
#undef GIVE
#undef GIVE0
}
// _engineStep: a wait to `until` in whole beats (reaction + 1), a raise, a
// hold or a swap. A wait that dies after the horizon is a dead end on the
// parent's board.
// A wait to `until` from node pi, in whole beats (reaction + 1).
static int32_t longFrames(Ctx *x, int pi, int32_t until) {
  int32_t beat = x->reaction + 1, fr = imax(1, until - NODE(x, pi)->t);
  return ((fr + beat - 1) / beat) * beat;
}
static int lineStep(Ctx *x, int pi, int kind, int mr, int mc, int32_t until) {
  int32_t frames = kind == MK_LONG ? longFrames(x, pi, until) : 0;
  int r = advance(x, pi, kind, mr, mc, frames);
  if (r != STEP_DEAD) return r;
  if (kind == MK_LONG && deadAt >= x->surviveFrames) {
    Node *n = newNode(x);
    if (!n) return STEP_ERR;
    Node *par = NODE(x, pi);
    int32_t keep[KEYMAX]; int32_t keyn = par->keyn;
    for (int i = 0; i < keyn; i++) keep[i] = par->key[i];
    *n = *par;
    for (int i = 0; i < keyn; i++) n->key[i] = keep[i];
    n->fresh = 0;
    n->st = 0; n->fromPrev = 1; n->t = deadAt; n->dead = 1; n->prev = pi; n->mk = kind; n->mr = mr; n->mc = mc;
    n->frames = frames; n->pins = 0; n->tag = -1; n->seed = 0;
    return (int)(n - x->nodes);
  }
  return STEP_NULL;
}
// A node whose board was let go is played again from its parent. The replay
// must land on the same frame, or the port is not deterministic.
static Board *ensureBoard(Ctx *x, int i) {
  Node *n = NODE(x, i);
  if (n->fromPrev) return ensureBoard(x, n->prev);   // never kept: the parent's may be let go
  if (n->st) return n->st;
  if (n->prev < 0) return 0;
  int32_t t = n->t, mk = n->mk, mr = n->mr, mc = n->mc, frames = n->frames, prev = n->prev;
  int r = advance(x, prev, mk, mr, mc, frames);
  if (r < 0) return 0;
  Node *m = NODE(x, r), *o = NODE(x, i);
  Board *b = m->st;
  m->st = 0; x->n--;   // the replay was the last node made
  if (m->t != t) { nb_free(b); return 0; }
  o->st = b;
  return b;
}
// ensureBoard for the threads: the replay's node is left where it was made
// (other threads are making theirs), its board moved to node i.
static int replayBoard(Ctx *x, int i) {
  Node *n = NODE(x, i);
  if (n->fromPrev || n->st) return 1;
  if (n->prev < 0) return 0;
  int32_t t = n->t;
  int r = advance(x, n->prev, n->mk, n->mr, n->mc, n->frames);
  if (r < 0) return 0;
  Node *m = NODE(x, r);
  Board *b = m->st;
  m->st = 0;
  if (m->t != t) { nb_free(b); return 0; }
  NODE(x, i)->st = b;
  return 1;
}
static void dropBoard(Ctx *x, int i) {
  Node *n = NODE(x, i);
  if (n->prev < 0 || n->pins) return;          // the root and pinned nodes keep theirs
  if (n->fromPrev) return;
  if (n->st) { nb_free(n->st); n->st = 0; }
}

// ---- nodes from JS
// The root: the board in the io buffers (nb_load's wire), a raise in hand,
// garbage on its way (io body after the board: at, width, height, isChain).
// rootWhy: why the last root was refused -- 1000 + the board's err flags
// (nb_load), 2 no node, 3 too many arrivals, 4 a panel the key cannot hold.
static int32_t rootWhy;
EXPORT(ns_root_why) int ns_root_why(void) { return rootWhy; }
EXPORT(ns_root) int ns_root(Ctx *x, int holdLeft, int holdStarted, int narr, int fresh) {
  Board *b = nb_new();
  int le = b ? nb_load(b) : -1;
  if (!b || le) { if (b) nb_free(b); rootWhy = 1000 + le; return STEP_ERR; }
  Node *n = newNode(x);
  if (!n) { rootWhy = 2; return STEP_ERR; }
  int32_t used = nb_save(b);   // the body's length, to find the arrivals after it
  if (narr > MAXARR) { rootWhy = 3; return STEP_ERR; }
  n->st = b; n->t = 0; n->holdLeft = holdLeft; n->holdStarted = holdStarted; n->fresh = fresh; n->narr = narr;
  for (int i = 0; i < narr; i++) {
    const int32_t *a = ioBody + used + 5 * i;
    n->arr[i].at = a[0]; n->arr[i].width = a[1]; n->arr[i].height = a[2]; n->arr[i].isChain = a[3]; n->arr[i].isMetal = a[4];
  }
  readBoard(n, b);
  // A new search: no line of it has broken garbage yet.
  x->rootBrk = n->brk;
  for (int i = 0; i < x->tagCap; i++) x->brkAt[i] = -1;
  if (n->err) rootWhy = 4;
  return n->err ? STEP_ERR : (int)(n - x->nodes);
}
EXPORT(ns_step) int ns_step(Ctx *x, int pi, int kind, int mr, int mc, int until) { x->steps++; return lineStep(x, pi, kind, mr, mc, until); }
EXPORT(ns_advance) int ns_advance(Ctx *x, int pi, int kind, int mr, int mc, int frames) { return advance(x, pi, kind, mr, mc, frames); }
EXPORT(ns_dead_at) int ns_dead_at(void) { return deadAt; }
EXPORT(ns_frame_stats) int ns_frame_stats(int kind, int steps) {
#ifdef COUNTDOWN
  if (kind >= 5) { int32_t *c = kind == 5 ? &fullFrames : kind == 6 ? &quietFrames : kind == 7 ? &jumpedFrames : &lightFrames, v = *c; *c = 0; return v; }
#endif
  int32_t v = steps ? stepsOf[kind & 7] : framesOf[kind & 7]; if (steps) stepsOf[kind & 7] = 0; else framesOf[kind & 7] = 0; return v;
}
// One decision from node pi as keys: the io body gets [keys, raise held,
// raise started] per frame. Returns the frames written, or advance's refusal
// (STEP_NULL, STEP_ERR); a line that dies still gives the keys up to it.
EXPORT(ns_keys) int ns_keys(Ctx *x, int pi, int kind, int mr, int mc, int frames) {
  // a wait given as frames < 0 waits to -frames, as the search's line step does
  if (kind == MK_LONG && frames < 0) frames = longFrames(x, pi, -frames);
  tape = ioBody; tapeN = 0; tapeCap = (int32_t)(sizeof ioBody / sizeof ioBody[0]) / 3;
  int r = advance(x, pi, kind, mr, mc, frames);
  tape = 0;
  if (r == STEP_NULL || r == STEP_ERR) return r;
  return tapeN;
}
EXPORT(ns_node) Node *ns_node(Ctx *x, int i) { return NODE(x, i); }
EXPORT(ns_board) Board *ns_board(Ctx *x, int i) { return ensureBoard(x, i); }
EXPORT(ns_legal) int ns_legal(Ctx *x, int i) { Board *b = ensureBoard(x, i); return b ? legalSwaps(b, ioBody) : -1; }
EXPORT(ns_steps) int ns_steps(Ctx *x) { int s = x->steps; x->steps = 0; return s; }
EXPORT(ns_pin) void ns_pin(Ctx *x, int i, int d) { NODE(x, i)->pins += d; }
// Where each field of a Node is, for native.js to read them in place.
#define NODE_FIELDS(X) X(t) X(holdLeft) X(holdStarted) X(fresh) X(dead) X(fromPrev) X(narr) X(tag) X(prev) X(mk) X(mr) X(mc) \
  X(seed) X(pins) X(held) X(garb) X(top) X(pos0) X(pos1) X(stopTime) X(preStopTime) X(shakeTime) X(displacement) X(speed) X(keyn)
#define NOFF1(f) (int)(unsigned long)&((Node *)0)->f,
#define NNAME1(f) #f,
static const int nodeOffs[] = { NODE_FIELDS(NOFF1) (int)(unsigned long)&((Node *)0)->riseTimer, (int)(unsigned long)&((Node *)0)->arr, (int)(unsigned long)&((Node *)0)->key, (int)sizeof(Node) };
static const char *nodeNames[] = { NODE_FIELDS(NNAME1) "riseTimer", "arr", "key", "size", 0 };
EXPORT(ns_field_off) int ns_field_off(int i) { return nodeOffs[i]; }
EXPORT(ns_field_name) const char *ns_field_name(int i) { return nodeNames[i]; }
// The node's grid (puyocpu.js engineGrid): rows 0..height+1, columns 0..6,
// 0 empty, -2 garbage, else the colour; into the io body.
EXPORT(ns_grid) int ns_grid(Ctx *x, int i) {
  Board *b = ensureBoard(x, i);
  if (!b) return -1;
  int k = 0;
  for (int r = 0; r <= b->height + 1; r++)
    for (int c = 0; c <= W; c++) {
      int32_t v = 0;
      if (c && r < b->nrows) { const int32_t *f = b->p[r][c].f; v = f[COLOR] == 0 ? 0 : f[ISGARBAGE] ? -2 : f[COLOR]; }
      ioBody[k++] = v;
    }
  return b->height;
}

// ---- the level loop (puyocpu.js _survivalSearch, breadth first)
extern int abort_poll(void) __attribute__((import_module("env"), import_name("abort_poll")));
static int vreserve(Vec *v, int32_t n) {
  if (n <= v->cap) return 1;
  int32_t cap = v->cap ? v->cap : 256;
  while (cap < n) cap *= 2;
  int32_t *a = (int32_t *)grab((unsigned long)cap * 4);
  if (!a) return 0;
  if (v->n) memcpy(a, v->a, (unsigned long)v->n * 4);
  v->a = a; v->cap = cap;
  return 1;
}
static int vpush(Vec *v, int32_t x) { if (!vreserve(v, v->n + 1)) return 0; v->a[v->n++] = x; return 1; }
EXPORT(ns_tags) int32_t *ns_tags(Ctx *x, int ntags) {
  if (ntags > x->tagCap) {
    int32_t cap = ntags < 64 ? 64 : ntags * 2;
    int32_t *m = (int32_t *)grab((unsigned long)cap * 4 * 8);
    if (!m) return 0;
    x->verdict = m; x->proofs = m + cap; x->weak = m + 2 * cap; x->reach = m + 3 * cap; x->reachSet = m + 4 * cap;
    x->far = m + 5 * cap; x->per = m + 6 * cap; x->brkAt = m + 7 * cap; x->tagCap = cap;
    for (int i = 0; i < cap; i++) x->brkAt[i] = -1;
  }
  x->ntags = ntags;
  return x->verdict;
}
EXPORT(ns_tag_stride) int ns_tag_stride(Ctx *x) { return x->tagCap; }
// The first frame a live line of the move tagged `tag` breaks garbage, -1 for none.
EXPORT(ns_break_at) int ns_break_at(Ctx *x, int tag) { return tag >= 0 && tag < x->tagCap ? x->brkAt[tag] : -1; }
EXPORT(ns_level) int32_t *ns_level(Ctx *x, int n) { if (!vreserve(&x->level, n)) return 0; x->level.n = n; return x->level.a; }
EXPORT(ns_level_n) int ns_level_n(Ctx *x) { return x->level.n; }
EXPORT(ns_set_tag) void ns_set_tag(Ctx *x, int i, int tag, int seed) { NODE(x, i)->tag = tag; NODE(x, i)->seed = seed; }
// A node's board is let go when nothing holds it: not in the level being
// expanded or the one being built, not the proof, the fallback or the
// furthest line of its move.
static void release(Ctx *x, int i) { Node *n = NODE(x, i); if (!n->pins && !n->live) dropBoard(x, i); }
static void pin(Ctx *x, int32_t *slot, int i) {
  int old = *slot;
  *slot = i;
  if (i >= 0) NODE(x, i)->pins++;
  if (old >= 0) { NODE(x, old)->pins--; release(x, old); }
}
static int better(Ctx *x, int32_t a, int32_t b) {
  Node *p = NODE(x, a), *q = NODE(x, b);
  int32_t d = (q->t + q->held) - (p->t + p->held);
  if (d) return d;
  if (p->garb != q->garb) return p->garb - q->garb;
  return p->top - q->top;
}
// Stable, as Array.prototype.sort is.
static int sortBetter(Ctx *x, int32_t *a, int32_t n) {
  if (n < 2) return 1;
  if (!vreserve(&x->tmp, n)) return 0;
  int32_t *t = x->tmp.a;
  for (int32_t w = 1; w < n; w *= 2) {
    for (int32_t lo = 0; lo < n; lo += 2 * w) {
      int32_t mid = lo + w < n ? lo + w : n, hi = lo + 2 * w < n ? lo + 2 * w : n, i = lo, j = mid, k = lo;
      while (i < mid && j < hi) t[k++] = better(x, a[j], a[i]) < 0 ? a[j++] : a[i++];
      while (i < mid) t[k++] = a[i++];
      while (j < hi) t[k++] = a[j++];
    }
    for (int32_t i = 0; i < n; i++) a[i] = t[i];
  }
  return 1;
}
static int sameKey(Node *a, Node *b) {
  if (a->hash != b->hash || a->tag != b->tag || a->held != b->held || a->pos0 != b->pos0 || a->pos1 != b->pos1 || a->keyn != b->keyn) return 0;
  for (int i = 0; i < a->keyn; i++) if (a->key[i] != b->key[i]) return 0;
  return 1;
}
static uint32_t seenHash(Node *n) {
  uint32_t h = n->hash;
  h = (h ^ (uint32_t)n->tag) * 16777619u; h = (h ^ (uint32_t)n->held) * 16777619u;
  h = (h ^ (uint32_t)n->pos0) * 16777619u; h = (h ^ (uint32_t)n->pos1) * 16777619u;
  return h ^ (h >> 15);
}
// Returns 1 if an equal node was seen this level, else records i.
static int seenBefore(Ctx *x, int i, int32_t *count) {
  if (2 * (*count + 1) > x->seenCap) {
    int32_t cap = x->seenCap ? x->seenCap * 2 : 4096;
    int32_t *t = (int32_t *)grab((unsigned long)cap * 4);
    if (!t) return -1;
    for (int32_t k = 0; k < cap; k++) t[k] = -1;
    for (int32_t k = 0; k < x->seenCap; k++) {
      int32_t v = x->seen[k];
      if (v < 0) continue;
      uint32_t s = seenHash(NODE(x, v)) & (uint32_t)(cap - 1);
      while (t[s] >= 0) s = (s + 1) & (uint32_t)(cap - 1);
      t[s] = v;
    }
    x->seen = t; x->seenCap = cap;
  }
  Node *n = NODE(x, i);
  uint32_t s = seenHash(n) & (uint32_t)(x->seenCap - 1);
  while (x->seen[s] >= 0) {
    if (sameKey(NODE(x, x->seen[s]), n)) return 1;
    s = (s + 1) & (uint32_t)(x->seenCap - 1);
  }
  x->seen[s] = i; (*count)++;
  return 0;
}
static void clearSeen(Ctx *x) { for (int32_t k = 0; k < x->seenCap; k++) x->seen[k] = -1; }
#define LOOP_ABORTED (-10)
#define LOOP_ERR (-11)
#define NOTRUN (-99)
// ---- the other threads. A phase is a list of steps (parent, move), each
// written to its own slot; the threads take them in any order, and the level
// loop reads them in its own. What a step makes does not depend on which
// thread made it or when.
static struct {
  int32_t gen, next, ntasks, ack, nworkers;
  Ctx *ctx; int32_t *tasks, *res, *deadAt;   // deadAt: per step, the frame a death was (settles only)
} pool;
#define REPLAY_TASK (-3)   // a task's move: play node t[0]'s board again from its parent (replayBoard)
#define ADVANCE_TASK (-1000)   // a task's move at or below: ns_advance_many's, ((row << 3 | col) << 3 | kind) = ADVANCE_TASK - mv
static void runTasks(void) {
  Ctx *x = pool.ctx;
  int32_t n = pool.ntasks;
  for (;;) {
    int32_t i = __atomic_fetch_add(&pool.next, 1, __ATOMIC_SEQ_CST);
    if (i >= n) break;
    const int32_t *t = pool.tasks + 4 * i;
    int32_t mv = t[1];
    if (mv == REPLAY_TASK) { pool.res[t[3]] = replayBoard(x, t[0]) ? 0 : -1; continue; }
    if (mv <= ADVANCE_TASK) {
      // ns_advance_many: the step's board is read straight after, so kept.
      int32_t m = ADVANCE_TASK - mv, r = advance(x, t[0], m & 7, CR(m >> 3), CC(m >> 3), t[2]);
      pool.res[t[3]] = r;
      if (pool.deadAt) pool.deadAt[t[3]] = r == STEP_DEAD ? deadAt : 0;
      continue;
    }
    int32_t r = mv == -1 ? lineStep(x, t[0], MK_LONG, 0, 0, t[2])
              : mv == -2 ? lineStep(x, t[0], MK_HOLD, 0, 0, 0)
              : lineStep(x, t[0], MK_SWAP, CR(mv), CC(mv), 0);
    // A step's board is not read till its node is expanded: replayed then.
    if (r >= 0) dropBoard(x, r);
    pool.res[t[3]] = r;
  }
}
#ifdef THREADS
extern void __wasm_init_tls(void *);
// Every instance, the searching one included, before anything else.
EXPORT(ns_thread_init) void ns_thread_init(int id) {
  void *tls = grab(__builtin_wasm_tls_size() + __builtin_wasm_tls_align());
  unsigned long a = __builtin_wasm_tls_align();
  __wasm_init_tls((void *)(((unsigned long)tls + a - 1) & ~(a - 1)));
  thId = id;
}
EXPORT(ns_grab) void *ns_grab(int n) { return grab((unsigned long)n); }
// A worker's life: wait for a phase, take steps until there are none, say so.
EXPORT(ns_worker_loop) void ns_worker_loop(void) {
  int32_t last = __atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST);
  __atomic_add_fetch(&pool.nworkers, 1, __ATOMIC_SEQ_CST);
  __builtin_wasm_memory_atomic_notify(&pool.nworkers, 1);
  for (;;) {
    while (__atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST) == last) __builtin_wasm_memory_atomic_wait32(&pool.gen, last, -1);
    last = __atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST);
    runTasks();
    __atomic_add_fetch(&pool.ack, 1, __ATOMIC_SEQ_CST);
    __builtin_wasm_memory_atomic_notify(&pool.ack, 1);
  }
}
EXPORT(ns_workers) int ns_workers(void) { return __atomic_load_n(&pool.nworkers, __ATOMIC_SEQ_CST); }
#endif
static int reserveNodes(Ctx *x, int32_t more) {
  if (x->n + more <= x->cap) return 1;
  int32_t cap = x->cap ? x->cap : 1024;
  while (cap < x->n + more) cap *= 2;
  Node *nn = (Node *)grab((unsigned long)cap * sizeof(Node));
  if (!nn) return 0;
  if (x->n) memcpy(nn, x->nodes, (unsigned long)x->n * sizeof(Node));
  x->nodes = nn; x->cap = cap;
  return 1;
}
// Runs the phase's steps on every thread; back when all are done.
static int runPhase(Ctx *x, Vec *tasks, int32_t *res) {
  int32_t n = tasks->n / 4, w = pool.nworkers;
  if (!n) return 1;
  if (!reserveNodes(x, n)) return 0;
  // Boards for the workers, from this thread's spares, so memory goes round.
  int32_t each = n / (w + 1) + 4;
  for (int k = 1; k <= w && k < MAXTHREADS; k++)
    while (freeCount[k] < each && freeOf[0]) {
      Board *b = freeOf[0]; freeOf[0] = *(Board **)b; freeCount[0]--;
      *(Board **)b = freeOf[k]; freeOf[k] = b; freeCount[k]++;
    }
  pool.ctx = x; pool.tasks = tasks->a; pool.res = res; pool.ntasks = n; pool.ack = 0;
  x->par = 1;
  __atomic_store_n(&pool.next, 0, __ATOMIC_SEQ_CST);
  __atomic_add_fetch(&pool.gen, 1, __ATOMIC_SEQ_CST);
  __builtin_wasm_memory_atomic_notify(&pool.gen, (unsigned)-1);
  runTasks();
  int32_t a;
  while ((a = __atomic_load_n(&pool.ack, __ATOMIC_SEQ_CST)) < w) __builtin_wasm_memory_atomic_wait32(&pool.ack, a, -1);
  x->par = 0;
  if (x->n > x->cap) x->n = x->cap;
  return 1;
}
// Steps on every thread: the io body holds n records (parent, kind, row,
// col, frames), each the step ns_advance would make from them. Out, in the io
// body, per step: the node, or -1 refused, or -2; the frame it died on; the
// node's frame; its garbage rows broken. Returns n, or -3 for no room.
EXPORT(ns_advance_many) int ns_advance_many(Ctx *x, int n) {
  static Vec tasks, res, dead;
  if (n < 0 || 5 * n > NBODY || !vreserve(&tasks, 4 * n) || !vreserve(&res, n) || !vreserve(&dead, n)) return -3;
  tasks.n = 0;
  for (int i = 0; i < n; i++) {
    const int32_t *a = ioBody + 5 * i;
    // Parents first, here: two threads must not replay one board.
    if (a[0] < 0 || a[0] >= x->n || a[1] < 0 || a[1] > MK_SETTLE || a[2] < 0 || a[2] > 255 || a[3] < 0 || a[3] > 7 || !ensureBoard(x, a[0])) return -3;
    tasks.a[tasks.n++] = a[0]; tasks.a[tasks.n++] = ADVANCE_TASK - ((((a[2] << 3) | a[3]) << 3) | a[1]);
    tasks.a[tasks.n++] = a[4]; tasks.a[tasks.n++] = i;
  }
  pool.deadAt = dead.a;
  int ok = runPhase(x, &tasks, res.a);
  pool.deadAt = 0;
  if (!ok) return -3;
  for (int i = 0; i < n; i++) {
    int32_t r = res.a[i];
    ioBody[4 * i] = r; ioBody[4 * i + 1] = dead.a[i];
    ioBody[4 * i + 2] = r >= 0 ? NODE(x, r)->t : 0; ioBody[4 * i + 3] = r >= 0 ? NODE(x, r)->brk : 0;
  }
  return n;
}
#define CHUNK 96
// The level loop. In: the level (ns_level), each level node's tag and seed
// (ns_set_tag), and per move (ns_tags): verdict (1 proven), proofs, weak,
// reach/reachSet and far, nodes as indices, -1 for none. Out: the same, and
// the level still open. Returns the budget left.
//
// It reads the level a chunk of parents at a time. With threads, a chunk's
// waits are played first, then the other moves of every parent whose wait
// did not prove its move; then the chunk is read in order, exactly as the
// single-threaded loop reads it, a step not played yet being played then.
// Steps played but not read are dropped.
EXPORT(ns_loop) int ns_loop(Ctx *x, int budget, int until, int full, int beam, int quota, int seedsMax) {
  int32_t *verdict = x->verdict, *proofs = x->proofs, *weak = x->weak, *reach = x->reach, *reachSet = x->reachSet, *far = x->far;
  int polled = 0, i, j;
  static Vec poff, res, tasks, proven, parents;
  for (i = 0; i < x->ntags; i++) {
    if (proofs[i] >= 0) NODE(x, proofs[i])->pins++;
    if (weak[i] >= 0) NODE(x, weak[i])->pins++;
    if (far[i] >= 0) NODE(x, far[i])->pins++;
  }
  for (i = 0; i < x->level.n; i++) NODE(x, x->level.a[i])->live = 1;
  if (!vreserve(&proven, x->ntags)) return LOOP_ERR;
  while (x->level.n && budget > 0) {
    int32_t seenN = 0;
    x->next.n = 0; parents.n = 0;
    clearSeen(x);
    int32_t at = 0;
    while (at < x->level.n && budget > 0) {
      // the chunk: parents at..e, their moves at poff[k]..poff[k+1]
      int32_t e = at, est = 0;
      x->moves.n = 0; poff.n = 0;
      while (e < x->level.n && e - at < CHUNK && (e == at || est < budget)) {
        int ni = x->level.a[e];
        if (!vpush(&poff, x->moves.n)) return LOOP_ERR;
        if (!verdict[NODE(x, ni)->tag]) {
          Board *nb = ensureBoard(x, ni);
          if (!nb || !vreserve(&x->moves, x->moves.n + 2 + 6 * MAXROWS)) return LOOP_ERR;
          int32_t *m = x->moves.a + x->moves.n;
          int nm = 2 + legalSwaps(nb, m + 2);
          m[0] = -1; m[1] = -2;
          x->moves.n += nm; est += nm;
        }
        e++;
      }
      if (!vpush(&poff, x->moves.n) || !vreserve(&res, x->moves.n)) return LOOP_ERR;
      for (j = 0; j < x->moves.n; j++) res.a[j] = NOTRUN;
      if (pool.nworkers) {
        tasks.n = 0;
        for (int k = 0; k < e - at; k++) {
          if (poff.a[k + 1] == poff.a[k]) continue;
          int32_t t[4] = { x->level.a[at + k], -1, until, poff.a[k] };
          for (j = 0; j < 4; j++) if (!vpush(&tasks, t[j])) return LOOP_ERR;
        }
        if (!runPhase(x, &tasks, res.a)) return LOOP_ERR;
        tasks.n = 0;
        for (i = 0; i < x->ntags; i++) proven.a[i] = verdict[i];
        int32_t cum = 0;
        for (int k = 0; k < e - at && cum < budget; k++) {
          int32_t o = poff.a[k], nm = poff.a[k + 1] - o, tag = NODE(x, x->level.a[at + k])->tag;
          if (!nm || proven.a[tag]) continue;
          cum++;
          int32_t r = res.a[o];
          if (r >= 0 && NODE(x, r)->t >= full && !NODE(x, r)->dead) { proven.a[tag] = 1; continue; }
          for (j = 1; j < nm; j++) {
            int32_t t[4] = { x->level.a[at + k], x->moves.a[o + j], 0, o + j };
            for (int q = 0; q < 4; q++) if (!vpush(&tasks, t[q])) return LOOP_ERR;
          }
          cum += nm - 1;
        }
        if (!runPhase(x, &tasks, res.a)) return LOOP_ERR;
      }
      for (int k = 0; k < e - at && budget > 0; k++) {
        int ni = x->level.a[at + k];
        int32_t tag = NODE(x, ni)->tag, o = poff.a[k], nm = poff.a[k + 1] - o;
        if (verdict[tag]) { NODE(x, ni)->live = 0; release(x, ni); continue; }
        for (j = 0; j < nm && budget > 0; j++) {
          budget--;
          if (++polled >= 64) { polled = 0; if (abort_poll()) return LOOP_ABORTED; }
          int32_t mv = x->moves.a[o + j];
          int c = res.a[o + j];
          if (c == NOTRUN)
            c = mv == -1 ? lineStep(x, ni, MK_LONG, 0, 0, until)
              : mv == -2 ? lineStep(x, ni, MK_HOLD, 0, 0, 0)
              : lineStep(x, ni, MK_SWAP, CR(mv), CC(mv), 0);
          res.a[o + j] = NOTRUN;   // read: nothing to drop
          if (c == STEP_NULL) continue;
          if (c < 0) return LOOP_ERR;
          Node *cn = NODE(x, c), *pn = NODE(x, ni);
          cn->tag = tag; cn->seed = pn->seed;
          if (!reachSet[tag] || cn->t > reach[tag]) { reach[tag] = cn->t; reachSet[tag] = 1; pin(x, &far[tag], c); }
          if (cn->t >= full && !cn->dead) { verdict[tag] = 1; pin(x, &proofs[tag], c); break; }
          if (cn->t >= x->surviveFrames && weak[tag] < 0) pin(x, &weak[tag], c);
          // THE EARLIEST BREAK: of the move's live lines, the first frame one breaks garbage.
          if (!cn->dead && cn->brk > x->rootBrk && (x->brkAt[tag] < 0 || cn->t < x->brkAt[tag])) x->brkAt[tag] = cn->t;
          // A child's board is not read till the level is cut to the beam: a
          // child kept is replayed from its parent then.
          dropBoard(x, c);
          if (cn->dead) continue;
          int sb = seenBefore(x, c, &seenN);
          if (sb < 0) return LOOP_ERR;
          if (sb) { release(x, c); continue; }
          if (!vpush(&x->next, c)) return LOOP_ERR;
          cn = NODE(x, c); cn->live = 1;
        }
        NODE(x, ni)->live = 0;
        if (!vpush(&parents, ni)) return LOOP_ERR;
      }
      for (j = 0; j < x->moves.n; j++) if (res.a[j] >= 0) dropBoard(x, res.a[j]);
      at = e;
    }
    // Parents the budget did not reach are let go too.
    for (; at < x->level.n; at++) { NODE(x, x->level.a[at])->live = 0; release(x, x->level.a[at]); }
    // the level left unexpanded when the budget ran out stays open
    int32_t k = 0;
    for (j = 0; j < x->next.n; j++) {
      int c = x->next.a[j];
      if (verdict[NODE(x, c)->tag]) { NODE(x, c)->live = 0; release(x, c); }
      else x->next.a[k++] = c;
    }
    x->next.n = k;
    if (!sortBetter(x, x->next.a, x->next.n)) return LOOP_ERR;
    if (!vreserve(&x->keep, x->next.n)) return LOOP_ERR;
    int32_t *keep = x->keep.a, nk = 0, seeds = 0;
    for (i = 0; i < x->ntags; i++) x->per[i] = 0;
    for (j = 0; j < x->next.n; j++) NODE(x, x->next.a[j])->kept = 0;
    for (j = 0; j < x->next.n && seeds < seedsMax; j++) {
      Node *cn = NODE(x, x->next.a[j]);
      if (cn->seed) { keep[nk++] = x->next.a[j]; cn->kept = 1; seeds++; }
    }
    for (j = 0; j < x->next.n; j++) {
      Node *cn = NODE(x, x->next.a[j]);
      if (cn->kept) continue;
      if (x->per[cn->tag] < quota) { x->per[cn->tag]++; keep[nk++] = x->next.a[j]; cn->kept = 1; }
    }
    for (j = 0; j < x->next.n && nk < beam; j++) {
      Node *cn = NODE(x, x->next.a[j]);
      if (!cn->kept && weak[cn->tag] < 0) { keep[nk++] = x->next.a[j]; cn->kept = 1; }
    }
    for (j = 0; j < x->next.n; j++) {
      Node *cn = NODE(x, x->next.a[j]);
      if (!cn->kept) { cn->live = 0; release(x, x->next.a[j]); }
    }
    if (!sortBetter(x, keep + seeds, nk - seeds)) return LOOP_ERR;
    // The kept nodes' boards, played again from their parents on every thread.
    if (pool.nworkers && nk > 1) {
      tasks.n = 0;
      for (j = 0; j < nk; j++) {
        Node *kn = NODE(x, keep[j]);
        if (kn->st || kn->fromPrev) continue;
        int32_t t[4] = { keep[j], REPLAY_TASK, 0, j };
        for (int q = 0; q < 4; q++) if (!vpush(&tasks, t[q])) return LOOP_ERR;
      }
      if (!vreserve(&res, nk) || !runPhase(x, &tasks, res.a)) return LOOP_ERR;
      keep = x->keep.a;
    }
    for (j = 0; j < nk; j++) if (!ensureBoard(x, keep[j])) return LOOP_ERR;
    for (j = 0; j < parents.n; j++) release(x, parents.a[j]);
    if (!vreserve(&x->level, nk)) return LOOP_ERR;
    for (j = 0; j < nk; j++) x->level.a[j] = keep[j];
    x->level.n = nk;
  }
  for (i = 0; i < x->level.n; i++) NODE(x, x->level.a[i])->live = 0;
  for (i = 0; i < x->ntags; i++) {
    if (proofs[i] >= 0) NODE(x, proofs[i])->pins--;
    if (weak[i] >= 0) NODE(x, weak[i])->pins--;
    if (far[i] >= 0) NODE(x, far[i])->pins--;
  }
  return budget;
}

