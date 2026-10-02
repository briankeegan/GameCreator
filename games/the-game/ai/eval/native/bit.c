#include "libc.h"
typedef unsigned long long u64;
#ifdef THREADS
#define LOCAL _Thread_local
#else
#define LOCAL
#endif
extern unsigned char __heap_base;
static unsigned long heapTop;
static int32_t heapLock;
static void *grab(unsigned long n) {
  while (__atomic_exchange_n(&heapLock, 1, __ATOMIC_ACQUIRE)) {}
  if (!heapTop) heapTop = ((unsigned long)&__heap_base + 15) & ~15ul;
  n = (n + 15) & ~15ul;
  unsigned long at = heapTop, end = at + n, have = __builtin_wasm_memory_size(0) * 65536ul;
  void *r = (void *)at;
  if (end < at) r = 0;
  else if (end > have && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) == (unsigned long)-1) r = 0;
  else heapTop = end;
  __atomic_store_n(&heapLock, 0, __ATOMIC_RELEASE);
  return r;
}

#define WMAX 8
#define NCOL 13
#define MAXSLAB 24
#define MAXD 24
enum { O_W = 0, O_H, O_N, O_NSLAB, O_BUSYF, O_BAD,
       OCC = 8, INERT = 16, GARB = 24, BUSY = 32, COL = 40,
       SLAB = COL + NCOL * WMAX, SL = WMAX + 2, ST_INTS = SLAB + MAXSLAB * SL };
#define SM(i, c) (SLAB + (i) * SL + (c))
#define SLK(i) (SLAB + (i) * SL + WMAX)
#define SAIR(i) (SLAB + (i) * SL + WMAX + 1)
enum { R_SCOPE = 0, R_CHAIN, R_TOTAL, R_ROUNDS, R_FRAMES, R_GARBAGE, R_CONVERTS, R_VOID, R_INTS = 8 };
enum { SC_OK = 0, SC_BROKE = 1, SC_BAD = 2, SC_REFUSED = 3 };
typedef int32_t ST[ST_INTS];

static ST IN;
static int32_t OUT[R_INTS + ST_INTS], LIST[3 * 128];
__attribute__((export_name("bit_in"))) int32_t *bit_in(void) { return IN; }
__attribute__((export_name("bit_out"))) int32_t *bit_out(void) { return OUT; }
__attribute__((export_name("bit_list"))) int32_t *bit_list(void) { return LIST; }

static inline int popc(uint32_t x) { return __builtin_popcount(x); }
static inline uint32_t lowb(uint32_t x) { return x & (0u - x); }
static inline int topRow(uint32_t x) { return x ? 32 - __builtin_clz(x) : 0; }
static inline int stlen(const int32_t *s) { return SLAB + s[O_NSLAB] * SL; }
static void stcpy(int32_t *d, const int32_t *s) { __builtin_memcpy(d, s, (unsigned long)stlen(s) * 4); }
#define U(st, i) ((uint32_t)(st)[i])
#define CL(st, a, c) U(st, COL + (a) * WMAX + (c))

typedef struct {
  int W, H, N, nslab;
  uint32_t occ[WMAX], inert[WMAX], garb[WMAX], chaining[WMAX], popping[WMAX], rest[WMAX];
  uint32_t colour[NCOL][WMAX];
  uint32_t slab[MAXSLAB][WMAX];
  int32_t locked[MAXSLAB], air[MAXSLAB], falling[MAXSLAB];
} R;

static int nSettle, nLandR, nFireR, nSavesR, nAnyR;
static LOCAL R S;

static void restingOf(R *s) {
  for (int c = 1; c <= s->W; c++) {
    uint32_t o = s->occ[c], m = o & (((~o) & (o + 1u)) - 1u);
    uint32_t seeds = s->inert[c] & ~m;
    while (seeds) {
      uint32_t sd = lowb(seeds), x = o & ~(sd - 1u), run = x & ~(x + sd);
      m |= run;
      seeds &= ~run;
    }
    s->rest[c] = m;
  }
}
static void slabsThatFall(R *s) {
  int n = s->nslab;
  if (!n) return;
  int nu[MAXSLAB], uo[MAXSLAB][WMAX], ground[MAXSLAB];
  uint32_t any[WMAX];
  for (int c = 1; c <= s->W; c++) { any[c] = 0; for (int sj = 0; sj < n; sj++) any[c] |= s->slab[sj][c]; }
  for (int si = 0; si < n; si++) {
    s->falling[si] = 0; nu[si] = 0; ground[si] = 0;
    if (s->locked[si]) continue;
    for (int c = 1; c <= s->W; c++) {
      uint32_t v = s->slab[si][c];
      if (!v) continue;
      uint32_t lowBit = lowb(v);
      if (lowBit == 1) { ground[si] = 1; break; }
      uint32_t under = lowBit >> 1;
      if (!(s->occ[c] & under)) continue;
      if (!(any[c] & under)) { ground[si] = 1; break; }
      int owner = -1;
      for (int sj = n - 1; sj >= 0; sj--) if (s->slab[sj][c] & under) { owner = sj; break; }
      uo[si][nu[si]++] = owner;
    }
  }
  int moved = 1, pass = 0;
  while (moved && pass++ <= n + 1) {
    moved = 0;
    for (int si = 0; si < n; si++) {
      if (s->falling[si] || s->locked[si] || ground[si]) continue;
      int held = 0;
      for (int j = 0; j < nu[si]; j++) if (!s->falling[uo[si][j]]) { held = 1; break; }
      if (!held) { s->falling[si] = 1; moved = 1; }
    }
  }
}
static int lowestRow(R *s, uint32_t *m) {
  int lo = 32;
  for (int c = 1; c <= s->W; c++) if (m[c]) { int b = topRow(lowb(m[c])); if (b < lo) lo = b; }
  return lo;
}
static int nextTo(R *s, uint32_t *a, uint32_t *b) {
  for (int c = 1; c <= s->W; c++) {
    uint32_t l = c > 1 ? a[c - 1] : 0, r = c < s->W ? a[c + 1] : 0;
    if (b[c] & ((a[c] >> 1) | (a[c] << 1) | l | r)) return 1;
  }
  return 0;
}
static int eligible(R *s, int i, int run) {
  return !s->locked[i] && lowestRow(s, s->slab[i]) <= s->H && run >= s->air[i];
}
static int connectedGroup(R *s, uint32_t *k, int run, int32_t *inGroup) {
  int any = 0;
  for (int sl = 0; sl < s->nslab; sl++) {
    inGroup[sl] = eligible(s, sl, run) && nextTo(s, k, s->slab[sl]);
    if (inGroup[sl]) any = 1;
  }
  for (int grew = any; grew; ) {
    grew = 0;
    for (int sl = 0; sl < s->nslab; sl++) {
      if (inGroup[sl] || !eligible(s, sl, run)) continue;
      for (int sk = 0; sk < s->nslab; sk++) {
        if (inGroup[sk] && nextTo(s, s->slab[sk], s->slab[sl])) { inGroup[sl] = 1; grew = 1; break; }
      }
    }
  }
  return any;
}
typedef struct { int popAt, hover, hasSwap, sr, sc, at, HOVER, FLASH, FACE, POP;
                 uint32_t chaining[WMAX], popping[WMAX], hovering[WMAX]; } Timed;
static void load(R *s, const int32_t *st) {
  s->W = st[O_W]; s->H = st[O_H]; s->N = st[O_N]; s->nslab = st[O_NSLAB];
  for (int c = 0; c < WMAX; c++) {
    s->occ[c] = U(st, OCC + c); s->inert[c] = U(st, INERT + c); s->garb[c] = U(st, GARB + c);
    s->chaining[c] = 0; s->popping[c] = 0;
  }
  __builtin_memcpy(s->colour, st + COL, (unsigned long)(s->N + 1) * WMAX * 4);
  for (int i = 0; i < s->nslab; i++) {
    for (int c = 0; c < WMAX; c++) s->slab[i][c] = U(st, SM(i, c));
    s->locked[i] = st[SLK(i)]; s->air[i] = 0;
  }
}
static void save(R *s, int32_t *o) {
  __builtin_memset(o, 0, SLAB * 4);
  o[O_W] = s->W; o[O_H] = s->H; o[O_N] = s->N;
  for (int c = 0; c < WMAX; c++) { o[OCC + c] = s->occ[c]; o[INERT + c] = s->inert[c]; o[GARB + c] = s->garb[c]; }
  __builtin_memcpy(o + COL + WMAX, s->colour[1], (unsigned long)s->N * WMAX * 4);
  int n = 0;
  for (int i = 0; i < s->nslab; i++) {
    int any = 0;
    for (int c = 0; c < WMAX; c++) if (s->slab[i][c]) { any = 1; break; }
    if (!any) continue;
    for (int c = 0; c < WMAX; c++) o[SM(n, c)] = s->slab[i][c];
    o[SLK(n)] = s->locked[i] ? 1 : 0; o[SAIR(n)] = 0;
    n++;
  }
  o[O_NSLAB] = n;
}

typedef struct { uint32_t m[WMAX]; int until, swap; } Hold;
#define MAXHOLD 16
#define NEVER 0x3fffffff
static LOCAL Hold HOLDS[MAXHOLD]; static LOCAL int nHolds;
static uint32_t heldAt(int c) { uint32_t h = 0; for (int i = 0; i < nHolds; i++) h |= HOLDS[i].m[c]; return h; }
static int nextRelease(void) { int u = NEVER; for (int i = 0; i < nHolds; i++) if (HOLDS[i].until < u) u = HOLDS[i].until; return u; }
static int resolveT(const int32_t *st, int32_t *r, int wantSettled, const Timed *tm);
static void resolveM(const int32_t *st, int32_t *r, int wantSettled);
static void resolve(const int32_t *st, int32_t *r, int wantSettled) { resolveM(st, r, wantSettled); }
static LOCAL int tmFailed = 0;
static void pushHold(const uint32_t *m, int until, int swap) {
  if (nHolds >= MAXHOLD) { tmFailed = 1; return; }
  Hold *h = &HOLDS[nHolds++];
  for (int c = 0; c < WMAX; c++) h->m[c] = m[c];
  h->until = until; h->swap = swap;
}
static void hoveringOf(R *s, uint32_t *hv) {
  for (int c = 1; c <= s->W; c++) {
    uint32_t hole = (~s->occ[c]) & (s->occ[c] + 1u), above = ~((hole << 1) - 1u);
    uint32_t block = (s->inert[c] | s->popping[c]) & above, ceil = lowb(block);
    hv[c] = s->occ[c] & above & (ceil ? (ceil - 1u) : ~0u);
  }
  hv[0] = 0; hv[s->W + 1] = 0;
}
static LOCAL int nRes;
static int resolveT(const int32_t *st, int32_t *r, int wantSettled, const Timed *tm) {
  nRes++;
  for (int i = 0; i < R_INTS; i++) r[i] = 0;
  if (st[O_BAD]) { r[R_SCOPE] = SC_BAD; return 0; }
  R *s = &S;
  load(s, st);
  int W = s->W, H = s->H, N = s->N;
  int counter = 0, rounds = 0, total = 0, guard = 0, LIMIT = W * H * H, T = 0, moved = 0;
  uint32_t B[NCOL][WMAX], k[WMAX], freeM[WMAX], prevRest[WMAX], prevInert[WMAX];
  int quietRest = 0;
  int32_t inGroup[MAXSLAB];
  int sweepAt = 0, hoverUntil = 0, made = 1, refused = 0;
  nHolds = 0;
  if (tm) {
    for (int c = 0; c <= W + 1; c++) { s->chaining[c] = tm->chaining[c] & s->occ[c]; s->popping[c] = tm->popping[c] & s->occ[c]; }
    for (int i = 0; i < s->nslab; i++) s->air[i] = st[SAIR(i)];
    sweepAt = tm->popAt; made = !tm->hasSwap;
    if (tm->hover > 0) {
      uint32_t hm[WMAX] = {0};
      for (int c = 1; c <= W; c++) hm[c] = tm->hovering[c] & s->occ[c];
      pushHold(hm, tm->hover, 0);
    }
  }
#define HOVERMASK(out) do { uint32_t hv_[WMAX]; hoveringOf(s, hv_); \
    for (int c9 = 0; c9 <= W + 1; c9++) out[c9] = T < hoverUntil ? hv_[c9] : 0; \
    for (int i9 = 0; i9 < nHolds; i9++) if (!HOLDS[i9].swap) for (int c9 = 1; c9 <= W; c9++) out[c9] |= HOLDS[i9].m[c9]; } while (0)
#define MAKESWAP() do { uint32_t hv[WMAX]; HOVERMASK(hv); made = 1; \
    int r5 = tm->sr, c5 = tm->sc, d5 = c5 + 1; uint32_t b5 = 1u << (r5 - 1); \
    if ((s->popping[c5] | s->popping[d5] | s->inert[c5] | s->inert[d5]) & b5) refused = 1; \
    else if (!((s->occ[c5] | s->occ[d5]) & b5)) refused = 1; \
    else if ((hv[c5] | hv[d5]) & (b5 | (b5 << 1))) refused = 1; \
    else { \
      if (((s->occ[c5] & b5) != 0) != ((s->occ[d5] & b5) != 0)) { s->occ[c5] ^= b5; s->occ[d5] ^= b5; } \
      if (((s->chaining[c5] & b5) != 0) != ((s->chaining[d5] & b5) != 0)) { s->chaining[c5] ^= b5; s->chaining[d5] ^= b5; } \
      for (int a5 = 1; a5 <= N; a5++) if (((s->colour[a5][c5] & b5) != 0) != ((s->colour[a5][d5] & b5) != 0)) { s->colour[a5][c5] ^= b5; s->colour[a5][d5] ^= b5; } \
      uint32_t sm5[WMAX] = {0}; sm5[c5] = s->occ[c5] & b5; sm5[d5] = s->occ[d5] & b5; \
      pushHold(sm5, T + 4, 1); } } while (0)
  while (guard++ <= LIMIT) {
    if (refused) { r[R_SCOPE] = SC_REFUSED; r[R_FRAMES] = T; return 0; }
    int any = 0, link = 0, c, a;
    if (tm) {
      if (!made && T >= tm->at && tm->at < nextRelease() - 1) { MAKESWAP(); if (refused) continue; }
      int any7 = 0;
      for (int i7 = 0; i7 < nHolds; i7++) {
        Hold h8 = HOLDS[i7];
        if (T < h8.until - 1) continue;
        for (int j = i7; j + 1 < nHolds; j++) HOLDS[j] = HOLDS[j + 1];
        nHolds--; i7--; any7 = 1;
        if (!h8.swap) continue;
        uint32_t again[WMAX] = {0}; int anyAgain = 0;
        for (int c8 = 1; c8 <= W; c8++) {
          uint32_t air = h8.m[c8] & ~(s->occ[c8] << 1) & ~1u;
          if (air) { again[c8] = air; anyAgain = 1; }
        }
        if (anyAgain) pushHold(again, h8.until + tm->HOVER, 0);
      }
      if (any7) moved = 1;
      if (!made && T >= tm->at) { MAKESWAP(); if (refused) continue; }
    }
    restingOf(s);
    if (!tm && quietRest) {
      int same = 1;
      for (c = 1; c <= W && same; c++) if (s->rest[c] != prevRest[c] || s->inert[c] != prevInert[c]) same = 0;
      if (same) goto noMatch;
    }
    for (c = 1; c <= W; c++) freeM[c] = s->rest[c] & ~s->popping[c] & ~s->inert[c] & (tm ? ~heldAt(c) : ~0u);
    for (a = 1; a <= N; a++) for (c = 1; c <= W; c++) B[a][c] = s->colour[a][c] & freeM[c];
    for (c = 0; c < WMAX; c++) k[c] = 0;
    for (a = 1; a <= N; a++) {
      for (c = 1; c <= W; c++) {
        uint32_t bb = B[a][c], cv = bb & (bb >> 1) & (bb >> 2);
        k[c] |= cv | (cv << 1) | (cv << 2);
      }
      for (c = 1; c + 2 <= W; c++) {
        uint32_t hc = B[a][c] & B[a][c + 1] & B[a][c + 2];
        k[c] |= hc; k[c + 1] |= hc; k[c + 2] |= hc;
      }
    }
    for (c = 1; c <= W; c++) { if (k[c]) any = 1; if (k[c] & s->chaining[c]) link = 1; }
    if (tm) for (c = 1; c <= W; c++) s->chaining[c] &= ~(s->rest[c] & ~k[c] & ~s->popping[c] & ~s->inert[c] & ~heldAt(c));
    if (!any) { quietRest = 1; for (c = 1; c <= W; c++) { prevRest[c] = s->rest[c]; prevInert[c] = s->inert[c]; } }
    else quietRest = 0;
  noMatch:
    if (any) {
      rounds++;
      if (link) counter = counter == 0 ? 2 : counter + 1;
      if (tm) {
        int size = 0;
        for (c = 1; c <= W; c++) size += popc(k[c]);
        int mRun = T + (moved ? 2 : 1), sw2 = mRun + tm->FLASH + tm->FACE + tm->POP * size;
        if (sw2 > sweepAt) sweepAt = sw2;
      }
      int broke = 0;
      for (c = 1; c <= W; c++) {
        total += popc(k[c]);
        s->popping[c] |= k[c];
        uint32_t gl = c > 1 ? s->garb[c - 1] : 0, gr = c < W ? s->garb[c + 1] : 0;
        if (k[c] & ((s->garb[c] >> 1) | (s->garb[c] << 1) | gl | gr)) broke = 1;
      }
      int haveGroup = broke && s->nslab;
      if (haveGroup && !connectedGroup(s, k, T + (moved ? 2 : 1), inGroup)) broke = 0;
      if (broke) {
        int touched = 0, converts = 0, convCol[WMAX] = {0};
        for (int sl = 0; sl < s->nslab; sl++) {
          if (!(haveGroup && inGroup[sl])) continue;
          uint32_t *sm = s->slab[sl];
          for (c = 1; c <= W; c++) touched += popc(sm[c]);
          int low = 32;
          for (c = 1; c <= W; c++) if (sm[c]) { int lb = topRow(lowb(sm[c])); if (lb < low) low = lb; }
          if (low < 32) {
            uint32_t lowBit = 1u << (low - 1);
            for (c = 1; c <= W; c++) if (sm[c] & lowBit) { converts++; convCol[c] = 1; }
          }
        }
        int hMax = 0, hs[WMAX], vAfter = 0;
        for (c = 1; c <= W; c++) {
          uint32_t gc = s->garb[c], fl = gc ? lowb(gc) : 0;
          uint32_t under = s->occ[c] & ~gc & ~s->popping[c] & (fl ? fl - 1u : 0xffffffffu);
          hs[c] = popc(under) + convCol[c];
          if (convCol[c] && hs[c] > hMax) hMax = hs[c];
        }
        for (c = 1; c <= W; c++) if (convCol[c]) vAfter += hMax - hs[c];
        r[R_SCOPE] = SC_BROKE; r[R_CHAIN] = counter > 1 ? counter : 1; r[R_TOTAL] = total;
        r[R_ROUNDS] = rounds; r[R_FRAMES] = T; r[R_GARBAGE] = touched; r[R_CONVERTS] = converts; r[R_VOID] = vAfter;
        return 0;
      }
      continue;
    }
    int fell = 0;
    for (c = 1; c <= W; c++) {
      uint32_t o2 = s->occ[c], fixed = (s->inert[c] | s->popping[c] | (tm ? heldAt(c) : 0)) & o2;
      uint32_t holds2 = o2 & (((~o2) & (o2 + 1u)) - 1u), seeds2 = fixed & ~holds2;
      while (seeds2) {
        uint32_t sd = lowb(seeds2), x2 = o2 & ~(sd - 1u), run2 = x2 & ~(x2 + sd);
        holds2 |= run2;
        seeds2 &= ~run2;
      }
      uint32_t movable = o2 & ~holds2;
      if (!movable) continue;
      fell = 1;
      uint32_t keepPut = s->occ[c] & ~movable;
      for (a = 1; a <= N; a++) s->colour[a][c] = (s->colour[a][c] & keepPut) | ((s->colour[a][c] & movable) >> 1);
      s->chaining[c] = (s->chaining[c] & keepPut) | ((s->chaining[c] & movable) >> 1);
      s->occ[c] = keepPut | (movable >> 1);
    }
    slabsThatFall(s);
    for (int sk = 0; sk < s->nslab; sk++) {
      if (!s->falling[sk]) continue;
      fell = 1;
      for (c = 1; c <= W; c++) {
        uint32_t sb = s->slab[sk][c];
        if (!sb) continue;
        s->occ[c] &= ~sb; s->inert[c] &= ~sb; s->garb[c] &= ~sb;
        s->slab[sk][c] = sb >> 1;
        s->occ[c] |= s->slab[sk][c]; s->inert[c] |= s->slab[sk][c]; s->garb[c] |= s->slab[sk][c];
      }
    }
    if (fell) {
      if (tm && T < hoverUntil - 1) T = hoverUntil - 1;
      T++;
      for (int sk = 0; sk < s->nslab; sk++) if (s->falling[sk]) s->air[sk] = T + 2;
      moved = 1; continue;
    }
    moved = 0;
    if (tm) {
      int anyPopping = 0;
      for (c = 1; c <= W; c++) if (s->popping[c]) { anyPopping = 1; break; }
      if (anyPopping) {
        int nr = nextRelease() - 1;
        if (!made && tm->at < sweepAt && tm->at <= nr) { if (tm->at > T) T = tm->at; MAKESWAP(); continue; }
        if (nr < sweepAt) { if (nr > T) T = nr; continue; }
        if (sweepAt > T) T = sweepAt;
      }
    }
    int swept = 0;
    for (c = 1; c <= W; c++) {
      if (!s->popping[c]) continue;
      swept = 1;
      uint32_t lowest = lowb(s->popping[c]), keep = s->occ[c] & ~s->popping[c];
      s->chaining[c] = (s->chaining[c] | (keep & ~(lowest - 1u))) & keep;
      for (a = 1; a <= N; a++) s->colour[a][c] &= keep;
      s->inert[c] &= keep;
      s->occ[c] = keep;
      s->popping[c] = 0;
    }
    if (swept) {
      quietRest = 0;
      if (tm) {
        hoverUntil = T + tm->HOVER;
        if (!made && tm->at <= hoverUntil && tm->at < nextRelease() - 1) { if (tm->at > T) T = tm->at; MAKESWAP(); }
      }
      continue;
    }
    if (tm && nHolds) { int nr = nextRelease() - 1; if (nr > T) T = nr; continue; }
    if (tm && !made) { int t2 = tm->at > hoverUntil ? tm->at : hoverUntil; if (t2 > T) T = t2; MAKESWAP(); if (!refused) continue; }
    if (refused) { r[R_SCOPE] = SC_REFUSED; r[R_FRAMES] = T; return 0; }
    break;
  }
#undef MAKESWAP
#undef HOVERMASK
  r[R_SCOPE] = SC_OK; r[R_CHAIN] = rounds ? (counter > 1 ? counter : 1) : 0; r[R_TOTAL] = total;
  r[R_ROUNDS] = rounds; r[R_FRAMES] = T;
  if (wantSettled) save(s, r + R_INTS);
  return 0;
}
static void memoRoom(void);
__attribute__((export_name("bit_resolve"))) void bit_resolve(int32_t wantSettled) { memoRoom(); resolve(IN, OUT, wantSettled); }
static Timed TM;
__attribute__((export_name("bit_timed"))) int32_t *bit_timed(void) { return (int32_t *)&TM; }
__attribute__((export_name("bit_resolve_timed"))) int32_t bit_resolve_timed(int32_t wantSettled) {
  tmFailed = 0;
  resolveT(IN, OUT, wantSettled, &TM);
  return tmFailed ? -1 : 0;
}

static int colourFirst(const int32_t *st, int c, uint32_t b) {
  for (int a = 1; a <= st[O_N]; a++) if (CL(st, a, c) & b) return a;
  return 0;
}
static int colourLast(const int32_t *st, int c, uint32_t b) {
  int at = 0;
  for (int a = 1; a <= st[O_N]; a++) if (CL(st, a, c) & b) at = a;
  return at;
}
static int swapIn(int32_t *st, int r, int c) {
  uint32_t b = 1u << (r - 1);
  int o = c + 1;
  if ((U(st, INERT + c) & b) || (U(st, INERT + o) & b)) return 0;
  if (st[O_BUSYF] && ((U(st, BUSY + c) | U(st, BUSY + o)) & b)) return 0;
  int left = colourLast(st, c, b), right = colourLast(st, o, b);
  if (left) { st[COL + left * WMAX + c] &= ~b; st[COL + left * WMAX + o] |= b; }
  if (right) { st[COL + right * WMAX + o] &= ~b; st[COL + right * WMAX + c] |= b; }
  if (left) st[OCC + o] |= b; else st[OCC + o] &= ~b;
  if (right) st[OCC + c] |= b; else st[OCC + c] &= ~b;
  return 1;
}
typedef struct { uint8_t g[18][WMAX]; uint32_t m[NCOL][WMAX], pv[NCOL][WMAX]; } Grid;
static void gridOf(const int32_t *st, Grid *G) {
  __builtin_memset(G, 0, sizeof(Grid));
  int W = st[O_W], H = st[O_H];
  uint32_t lim = (H < 17 ? (1u << H) - 1u : 0x1ffffu);
  for (int a = 1; a <= st[O_N]; a++)
    for (int c = 1; c <= W; c++) {
      uint32_t bits = CL(st, a, c) & 0x1ffffu, m = bits & lim;
      G->m[a][c] = m;
      G->pv[a][c] = ((m >> 1) & (m >> 2)) | ((m << 1) & (m >> 1)) | ((m << 1) & (m << 2));
      while (bits) { G->g[__builtin_ctz(bits) + 1][c] = (uint8_t)a; bits &= bits - 1u; }
    }
}
static int legalG(const int32_t *st, int32_t *out, Grid *G) {
  gridOf(st, G);
  int n = 0, W = st[O_W], busy = st[O_BUSYF];
  for (int r = 1; r <= st[O_H]; r++) {
    uint32_t b = 1u << (r - 1);
    for (int c = 1; c < W; c++) {
      if ((U(st, INERT + c) | U(st, INERT + c + 1)) & b) continue;
      if (busy && ((U(st, BUSY + c) | U(st, BUSY + c + 1)) & b)) continue;
      if (!((U(st, OCC + c) | U(st, OCC + c + 1)) & b)) continue;
      if (G->g[r][c] == G->g[r][c + 1]) continue;
      out[2 * n] = r; out[2 * n + 1] = c; n++;
    }
  }
  return n;
}
static int legal(const int32_t *st, int32_t *out) { Grid G; return legalG(st, out, &G); }
__attribute__((export_name("bit_legal"))) int32_t bit_legal(void) { return legal(IN, LIST); }

static int32_t SW[2 * 128], RR[R_INTS + ST_INTS];
__attribute__((export_name("bit_scan"))) int32_t bit_scan(void) {
  memoRoom();
  int n = legal(IN, SW);
  for (int i = 0; i < n; i++) {
    int r = SW[2 * i], c = SW[2 * i + 1];
    if (!swapIn(IN, r, c)) { LIST[3 * i] = 0; LIST[3 * i + 1] = 0; LIST[3 * i + 2] = -1; continue; }
    resolve(IN, RR, 0);
    swapIn(IN, r, c);
    LIST[3 * i] = RR[R_CHAIN]; LIST[3 * i + 1] = RR[R_TOTAL]; LIST[3 * i + 2] = RR[R_SCOPE];
  }
  return n;
}

// ---------------------------------------------------------------- board facts
static int atRest(const int32_t *st) {
  int W = st[O_W], c, a;
  if (st[O_BUSYF]) for (c = 1; c <= W; c++) if (st[BUSY + c]) return 0;
  for (c = 1; c <= W; c++) {
    uint32_t o = U(st, OCC + c), m = o & (((~o) & (o + 1u)) - 1u), seeds = U(st, INERT + c) & ~m;
    while (seeds) {
      uint32_t seed = lowb(seeds), run = seed, probe = seed;
      while ((probe <<= 1) && (o & probe)) run |= probe;
      m |= run; seeds &= ~run;
    }
    if (m != o) return 0;
  }
  for (a = 1; a <= st[O_N]; a++) {
    for (c = 1; c <= W; c++) {
      uint32_t b = CL(st, a, c) & ~U(st, INERT + c);
      if (b & (b >> 1) & (b >> 2)) return 0;
      if (c + 2 <= W && (b & CL(st, a, c + 1) & CL(st, a, c + 2) & ~U(st, INERT + c + 1) & ~U(st, INERT + c + 2))) return 0;
    }
  }
  return 1;
}
static inline int gAt(const int32_t *st, const Grid *G, int rr, int cc, int r, int c, int l, int rt) {
  if (rr < 1 || rr > st[O_H] || cc < 1 || cc > st[O_W]) return -1;
  if (rr == r && cc == c) return rt;
  if (rr == r && cc == c + 1) return l;
  return G->g[rr][cc];
}
static int gLine(const int32_t *st, const Grid *G, int rr, int cc, int col, int r, int c, int l, int rt) {
  int run = 1, k;
  for (k = cc - 1; k >= 1 && gAt(st, G, rr, k, r, c, l, rt) == col; k--) run++;
  for (k = cc + 1; k <= st[O_W] && gAt(st, G, rr, k, r, c, l, rt) == col; k++) run++;
  if (run >= 3) return 1;
  run = 1;
  for (k = rr - 1; k >= 1 && gAt(st, G, k, cc, r, c, l, rt) == col; k--) run++;
  for (k = rr + 1; k <= st[O_H] && gAt(st, G, k, cc, r, c, l, rt) == col; k++) run++;
  return run >= 3;
}
static int swapCanClearG(const int32_t *st, const Grid *G, int rest, int r, int c) {
  if (!rest) return 1;
  int left = G->g[r][c], right = G->g[r][c + 1];
  if (!left || !right) return 1;
  if (left == right) return gLine(st, G, r, c, right, r, c, left, right) || gLine(st, G, r, c + 1, left, r, c, left, right);
  uint32_t x = G->pv[right][c] | G->pv[left][c + 1];
  if (c >= 3) x |= G->m[right][c - 1] & G->m[right][c - 2];
  if (c + 3 <= st[O_W]) x |= G->m[left][c + 2] & G->m[left][c + 3];
  return (x >> (r - 1)) & 1u;
}
static int settledRest(const int32_t *st) { return !st[O_BUSYF] && !st[O_BAD] && atRest(st); }
static int quietSwapG(const int32_t *st, const Grid *G, int rest, int r, int c) {
  if (!rest) return 0;
  if (!G->g[r][c] || !G->g[r][c + 1]) return 0;
  return !swapCanClearG(st, G, 1, r, c);
}
static LOCAL ST SLOW;
static LOCAL int32_t SWB[2 * 128], RB[R_INTS + ST_INTS];
static int anyOneSwapClear(const int32_t *st) {
  Grid G;
  int n = legalG(st, SWB, &G), haveSlow = 0;
  for (int i = 0; i < n; i++) {
    int r = SWB[2 * i], c = SWB[2 * i + 1];
    int left = G.g[r][c], right = G.g[r][c + 1];
    if (!left || !right) {
      if (!haveSlow) { stcpy(SLOW, st); haveSlow = 1; }
      if (!swapIn(SLOW, r, c)) continue;
      nFireR++, resolve(SLOW, RB, 0);
      swapIn(SLOW, r, c);
      if (RB[R_TOTAL] > 0 || RB[R_SCOPE] == SC_BROKE) return 1;
      continue;
    }
    if (gLine(st, &G, r, c + 1, left, r, c, left, right)) return 1;
    if (gLine(st, &G, r, c, right, r, c, left, right)) return 1;
  }
  return 0;
}
typedef uint32_t v8u __attribute__((vector_size(32)));
static void reachMask(const int32_t *st, uint32_t *out) {
  int W = st[O_W];
  v8u acc = { 0 }, cols = { 0, 1, 2, 3, 4, 5, 6, 7 }, z = { 0 };
  v8u inW = (v8u)(cols >= 1) & (v8u)(cols <= (uint32_t)W), ge1 = (v8u)(cols >= 1), leW = (v8u)(cols <= (uint32_t)W);
  for (int a = 1; a <= st[O_N]; a++) {
    v8u B;
    __builtin_memcpy(&B, st + COL + a * WMAX, sizeof(B));
    v8u Bm = B & inW;
    v8u vp = Bm & (Bm >> 1);
    acc |= vp | (vp >> 1) | (vp << 2);
    v8u hp = Bm & __builtin_shufflevector(B, z, 1, 2, 3, 4, 5, 6, 7, 8);
    acc |= hp | __builtin_shufflevector(z, hp, 7, 8, 9, 10, 11, 12, 13, 14)
             | (__builtin_shufflevector(hp, z, 1, 2, 3, 4, 5, 6, 7, 8) & ge1)
             | (__builtin_shufflevector(z, hp, 6, 7, 8, 9, 10, 11, 12, 13) & leW);
  }
  __builtin_memcpy(out, &acc, sizeof(acc));
}
static int reachOf(const int32_t *st, uint32_t *reach) {
  int W = st[O_W], dig = 0;
  reachMask(st, reach);
  for (int c = 1; c <= W; c++) {
    uint32_t g = U(st, GARB + c), gl = U(st, GARB + c - 1), gr = U(st, GARB + c + 1);
    uint32_t adj = ((g >> 1) | (g << 1) | gl | gr) & ~g;
    dig += popc(reach[c] & adj);
    reach[c] |= adj;
  }
  return dig;
}
typedef struct { double tall, bumps, excess, mat, low, high, spread, slabRowGap; } Shape;
static void shapeOfG(const int32_t *st, Shape *sh, int withGap);
static void shapeOf(const int32_t *st, Shape *sh) { shapeOfG(st, sh, 1); }
static void shapeOfG(const int32_t *st, Shape *sh, int withGap) {
  int W = st[O_W], c, h[WMAX], tall = 0, bumps = 0, mx = 0, low;
  double sum = 0;
  for (c = 1; c <= W; c++) {
    int top = topRow(U(st, OCC + c));
    if (top > tall) tall = top;
    uint32_t g = U(st, GARB + c), floor = g ? lowb(g) : 0, below = floor ? floor - 1u : 0xffffffffu;
    h[c] = popc(U(st, OCC + c) & ~g & below);
    sum += h[c];
    if (h[c] > mx) mx = h[c];
  }
  for (c = 1; c < W; c++) bumps += h[c] > h[c + 1] ? h[c] - h[c + 1] : h[c + 1] - h[c];
  double mean = sum / W, dev = 0;
  for (c = 1; c <= W; c++) { double d = h[c] - mean; dev += d < 0 ? -d : d; }
  low = h[1];
  for (c = 2; c <= W; c++) if (h[c] < low) low = h[c];
  double gap = 0;
  int floorRow = 0;
  for (c = 1; withGap && c <= W; c++) {
    uint32_t gm = U(st, GARB + c);
    if (!gm) continue;
    uint32_t lowBit = lowb(gm);
    int fr = __builtin_ctz(lowBit) + 1;
    if (!floorRow || fr < floorRow) floorRow = fr;
  }
  if (floorRow > 1) {
    int need = floorRow - 1;
    double best = 1e300;
    for (c = 1; c + 2 <= W; c++) {
      int win = (need - h[c] > 0 ? need - h[c] : 0) + (need - h[c + 1] > 0 ? need - h[c + 1] : 0) +
                (need - h[c + 2] > 0 ? need - h[c + 2] : 0);
      if (win < best) best = win;
    }
    int col = 0;
    for (c = 1; c <= W; c++) {
      int climb = need - h[c] > 0 ? need - h[c] : 0, run = 0;
      if (h[c] > 0) {
        uint32_t topBit = 1u << (h[c] - 1);
        col = 0;
        for (int a = 1; a <= 12; a++) if (a < NCOL && (CL(st, a, c) & topBit)) { col = a; break; }
        if (col) {
          uint32_t mask = CL(st, col, c);
          for (int r2 = h[c]; r2 >= 1 && (mask & (1u << (r2 - 1))); r2--) run++;
        }
      }
      int have = 0;
      if (col) {
        int lo = c - 1 > 1 ? c - 1 : 1, hi = c + 1 < W ? c + 1 : W;
        for (int cc2 = lo; cc2 <= hi; cc2++) {
          uint32_t gm2 = U(st, GARB + cc2), fl2 = gm2 ? lowb(gm2) : 0, bl2 = fl2 ? fl2 - 1u : 0xffffffffu;
          have += popc(CL(st, col, cc2) & bl2);
        }
      }
      double vert = (col && have >= 3) ? climb + (3 - run > 0 ? 3 - run : 0) : 1e300;
      if (vert < best) best = vert;
    }
    gap = best >= 1e300 ? 0 : best;
  }
  sh->tall = tall; sh->bumps = bumps; sh->excess = dev / W; sh->mat = mean; sh->low = low;
  sh->high = mx; sh->spread = mx - low; sh->slabRowGap = gap;
}
static int slabReadyFast(const int32_t *st) {
  int Wl = st[O_W], Hl = st[O_H], N = st[O_N], t = 0, c, a;
  for (c = 1; c <= Wl; c++) { int top = topRow(U(st, OCC + c)); if (top > t) t = top; }
  if (t >= Hl || t < 1) return 0;
  uint32_t target = 1u << (t - 1), v3 = t >= 3 ? target | (target >> 1) | (target >> 2) : 0;
  uint32_t rowT[NCOL], vcol[NCOL];
  int base[NCOL], nBase = 0, rows[3] = { t, t - 1, t - 2 };
  uint32_t rm = target | (target >> 1) | (target >> 2);
  uint8_t first[3][WMAX];
  __builtin_memset(first, 0, sizeof(first));
  for (a = N; a >= 1; a--) {
    rowT[a] = 0; vcol[a] = 0;
    for (c = 1; c <= Wl; c++) {
      uint32_t m = CL(st, a, c);
      if (m & target) rowT[a] |= 1u << c;
      if (v3 && (m & v3) == v3) vcol[a] |= 1u << c;
      for (uint32_t q = m & rm; q; q &= q - 1u) first[t - 1 - __builtin_ctz(q)][c] = (uint8_t)a;
    }
    base[a] = (rowT[a] & (rowT[a] >> 1) & (rowT[a] >> 2)) || vcol[a];
    nBase += base[a];
  }
  for (int ri = 0; ri < 3; ri++) {
    int r = rows[ri];
    if (r < 1) continue;
    uint32_t bitv = 1u << (r - 1);
    for (c = 1; c < Wl; c++) {
      int left = first[ri][c], right = first[ri][c + 1];
      if (!left || !right || left == right) continue;
      if (nBase - base[left] - base[right] > 0) return 1;
      for (int side = 0; side < 2; side++) {
        int x = side ? right : left, from = side ? c + 1 : c, to = side ? c : c + 1;
        uint32_t row = rowT[x];
        if (r == t) row = (row & ~(1u << from)) | (1u << to);
        if (row & (row >> 1) & (row >> 2)) return 1;
        if (v3) {
          uint32_t vc = vcol[x] & ~((1u << from) | (1u << to));
          uint32_t mf = CL(st, x, from) & ~bitv, mt = CL(st, x, to) | bitv;
          if ((mf & v3) == v3) vc |= 1u << from;
          if ((mt & v3) == v3) vc |= 1u << to;
          if (vc) return 1;
        }
      }
    }
  }
  return 0;
}

// ---------------------------------------------------------------- caches by board
static u64 hashOf(const int32_t *st) {
  u64 h0 = 1469598103934665603ull, h1 = 0x9E3779B97F4A7C15ull, h2 = 0xC2B2AE3D27D4EB4Full, h3 = 0x165667B19E3779F9ull;
  int W = st[O_W], N = st[O_N], c, a, i;
#define MX(h, v) (h = (h ^ (uint32_t)(v)) * 1099511628211ull)
  MX(h0, W); MX(h1, st[O_H]); MX(h2, N); MX(h3, st[O_BAD]); MX(h0, st[O_BUSYF]);
  for (c = 0; c <= W + 1; c++) { MX(h1, st[OCC + c]); MX(h2, st[INERT + c]); MX(h3, st[GARB + c]); if (st[O_BUSYF]) MX(h0, st[BUSY + c]); }
  for (a = 1; a <= N; a++) for (c = 0; c <= W + 1; c += 2) { MX(h0, st[COL + a * WMAX + c]); MX(h1, st[COL + a * WMAX + c + 1]); }
  MX(h2, st[O_NSLAB]);
  for (i = 0; i < st[O_NSLAB]; i++) { for (c = 0; c <= W + 1; c++) MX(h3, st[SM(i, c)]); MX(h2, st[SLK(i)]); }
#undef MX
  u64 h = h0 ^ (h1 * 0x9E3779B97F4A7C15ull) ^ (h2 * 0xC2B2AE3D27D4EB4Full) ^ (h3 * 0x165667B19E3779F9ull);
  h ^= h >> 29;
  return h | 1ull;
}
#define TCAP (1 << 17)
typedef struct { u64 key; double v; } Slot;
typedef struct { Slot *s; int n; } Table;
static Slot TABLE_MAIN[4][TCAP];
static int tget(Table *t, u64 k, double *v) {
  uint32_t i = (uint32_t)(k ^ (k >> 32)) & (TCAP - 1);
  while (t->s[i].key) { if (t->s[i].key == k) { *v = t->s[i].v; return 1; } i = (i + 1) & (TCAP - 1); }
  return 0;
}
static void tput(Table *t, u64 k, double v) {
  if (t->n >= TCAP * 3 / 4) { for (int i = 0; i < TCAP; i++) t->s[i].key = 0; t->n = 0; }
  uint32_t i = (uint32_t)(k ^ (k >> 32)) & (TCAP - 1);
  while (t->s[i].key) { if (t->s[i].key == k) { t->s[i].v = v; return; } i = (i + 1) & (TCAP - 1); }
  t->s[i].key = k; t->s[i].v = v; t->n++;
}
static LOCAL Table SAVES, ANYB, STOPS_T, FIRE;
static void threadInit(void);

#define ARENA_INTS (40 << 20)
static int32_t ARENA_MAIN[ARENA_INTS];
static LOCAL int32_t *ARENA;
static LOCAL int arenaN = 0, arenaCap = ARENA_INTS;
static LOCAL int failed = 0;
static void threadInit(void);
static void memoRoom(void) { threadInit(); }
static int resolveU(const int32_t *st, int32_t *r, int wantSettled) {
  nRes++;
  for (int i = 0; i < R_INTS; i++) r[i] = 0;
  if (st[O_BAD]) { r[R_SCOPE] = SC_BAD; return 0; }
  R *s = &S;
  load(s, st);
  int W = s->W, H = s->H, N = s->N, c, a;
  int counter = 0, rounds = 0, total = 0, guard = 0, LIMIT = W * H * H, T = 0, moved = 0;
  int scan = 1, anyPop = 0, restValid = 0, slabQuiet = 0;
  uint32_t supp[WMAX], suppOcc[WMAX];
  uint32_t k[WMAX];
  int32_t inGroup[MAXSLAB];
  while (guard++ <= LIMIT) {
    if (!restValid) restingOf(s);
    restValid = 1;
    if (scan) {
      int any = 0, link = 0;
      v8u fv, rv, pv, iv, kv = { 0 }, z = { 0 }, lanes = { 0, 1, 2, 3, 4, 5, 6, 7 };
      __builtin_memcpy(&rv, s->rest, sizeof(rv)); __builtin_memcpy(&pv, s->popping, sizeof(pv)); __builtin_memcpy(&iv, s->inert, sizeof(iv));
      fv = rv & ~pv & ~iv & (v8u)(lanes >= 1) & (v8u)(lanes <= (uint32_t)W);
      for (a = 1; a <= N; a++) {
        v8u b;
        __builtin_memcpy(&b, s->colour[a], sizeof(b));
        b &= fv;
        v8u cv = b & (b >> 1) & (b >> 2);
        v8u hc = b & __builtin_shufflevector(z, b, 7, 8, 9, 10, 11, 12, 13, 14) & __builtin_shufflevector(z, b, 6, 7, 8, 9, 10, 11, 12, 13);
        kv |= cv | (cv << 1) | (cv << 2) | hc | __builtin_shufflevector(hc, z, 1, 2, 3, 4, 5, 6, 7, 8) | __builtin_shufflevector(hc, z, 2, 3, 4, 5, 6, 7, 8, 9);
      }
      __builtin_memcpy(k, &kv, sizeof(kv));
      for (c = 1; c <= W; c++) { if (k[c]) any = 1; if (k[c] & s->chaining[c]) link = 1; }
      scan = 0;
      if (any) {
        rounds++;
        if (link) counter = counter == 0 ? 2 : counter + 1;
        int broke = 0;
        for (c = 1; c <= W; c++) {
          total += popc(k[c]);
          s->popping[c] |= k[c];
          uint32_t gl = c > 1 ? s->garb[c - 1] : 0, gr = c < W ? s->garb[c + 1] : 0;
          if (k[c] & ((s->garb[c] >> 1) | (s->garb[c] << 1) | gl | gr)) broke = 1;
        }
        anyPop = 1;
        int haveGroup = broke && s->nslab;
        if (haveGroup && !connectedGroup(s, k, T + (moved ? 2 : 1), inGroup)) broke = 0;
        if (broke) {
          int touched = 0, converts = 0, convCol[WMAX] = {0};
          for (int sl = 0; sl < s->nslab; sl++) {
            if (!(haveGroup && inGroup[sl])) continue;
            uint32_t *sm = s->slab[sl];
            for (c = 1; c <= W; c++) touched += popc(sm[c]);
            int low = 32;
            for (c = 1; c <= W; c++) if (sm[c]) { int lb = topRow(lowb(sm[c])); if (lb < low) low = lb; }
            if (low < 32) {
              uint32_t lowBit = 1u << (low - 1);
              for (c = 1; c <= W; c++) if (sm[c] & lowBit) { converts++; convCol[c] = 1; }
            }
          }
          int hMax = 0, hs[WMAX], vAfter = 0;
          for (c = 1; c <= W; c++) {
            uint32_t gc = s->garb[c], fl = gc ? lowb(gc) : 0;
            uint32_t under = s->occ[c] & ~gc & ~s->popping[c] & (fl ? fl - 1u : 0xffffffffu);
            hs[c] = popc(under) + convCol[c];
            if (convCol[c] && hs[c] > hMax) hMax = hs[c];
          }
          for (c = 1; c <= W; c++) if (convCol[c]) vAfter += hMax - hs[c];
          r[R_SCOPE] = SC_BROKE; r[R_CHAIN] = counter > 1 ? counter : 1; r[R_TOTAL] = total;
          r[R_ROUNDS] = rounds; r[R_FRAMES] = T; r[R_GARBAGE] = touched; r[R_CONVERTS] = converts; r[R_VOID] = vAfter;
          return 0;
        }
        continue;
      }
    }
    int fell = 0;
    for (c = 1; c <= W; c++) {
      uint32_t o2 = s->occ[c], holds2;
      if (!anyPop) holds2 = s->rest[c];
      else {
        uint32_t fixed = (s->inert[c] | s->popping[c]) & o2, seeds2;
        holds2 = o2 & (((~o2) & (o2 + 1u)) - 1u); seeds2 = fixed & ~holds2;
        while (seeds2) {
          uint32_t sd = lowb(seeds2), x2 = o2 & ~(sd - 1u), run2 = x2 & ~(x2 + sd);
          holds2 |= run2;
          seeds2 &= ~run2;
        }
      }
      uint32_t movable = o2 & ~holds2;
      if (!movable) continue;
      fell = 1;
      uint32_t keepPut = o2 & ~movable;
      for (a = 1; a <= N; a++) s->colour[a][c] = (s->colour[a][c] & keepPut) | ((s->colour[a][c] & movable) >> 1);
      s->chaining[c] = (s->chaining[c] & keepPut) | ((s->chaining[c] & movable) >> 1);
      s->occ[c] = keepPut | (movable >> 1);
    }
    int slabsFell = 0;
    if (s->nslab) {
      int skip = slabQuiet;
      for (c = 1; c <= W && skip; c++) if ((s->occ[c] & supp[c]) != suppOcc[c]) skip = 0;
      if (skip) { for (int sk = 0; sk < s->nslab; sk++) s->falling[sk] = 0; }
      else {
        slabsThatFall(s);
        for (int sk = 0; sk < s->nslab; sk++) if (s->falling[sk]) { slabsFell = 1; break; }
        if (!slabsFell) {
          for (c = 0; c < WMAX; c++) supp[c] = 0;
          for (int sk = 0; sk < s->nslab; sk++) for (c = 1; c <= W; c++) { uint32_t v = s->slab[sk][c]; if (v) supp[c] |= lowb(v) >> 1; }
          for (c = 1; c <= W; c++) suppOcc[c] = s->occ[c] & supp[c];
          slabQuiet = 1;
        } else slabQuiet = 0;
      }
    }
    for (int sk = 0; sk < s->nslab; sk++) {
      if (!s->falling[sk]) continue;
      fell = 1;
      for (c = 1; c <= W; c++) {
        uint32_t sb = s->slab[sk][c];
        if (!sb) continue;
        s->occ[c] &= ~sb; s->inert[c] &= ~sb; s->garb[c] &= ~sb;
        s->slab[sk][c] = sb >> 1;
        s->occ[c] |= s->slab[sk][c]; s->inert[c] |= s->slab[sk][c]; s->garb[c] |= s->slab[sk][c];
      }
    }
    if (fell) {
      T++;
      for (int sk = 0; sk < s->nslab; sk++) if (s->falling[sk]) s->air[sk] = T + 2;
      moved = 1;
      uint32_t old[WMAX], oldI[WMAX];
      for (c = 1; c <= W; c++) { old[c] = s->rest[c]; oldI[c] = s->inert[c]; }
      restingOf(s);
      for (c = 1; c <= W; c++) if (s->rest[c] != old[c] || s->inert[c] != oldI[c]) { scan = 1; break; }
      continue;
    }
    moved = 0;
    int swept = 0;
    for (c = 1; c <= W; c++) {
      if (!s->popping[c]) continue;
      swept = 1;
      uint32_t lowest = lowb(s->popping[c]), keep = s->occ[c] & ~s->popping[c];
      s->chaining[c] = (s->chaining[c] | (keep & ~(lowest - 1u))) & keep;
      for (a = 1; a <= N; a++) s->colour[a][c] &= keep;
      s->inert[c] &= keep;
      s->occ[c] = keep;
      s->popping[c] = 0;
    }
    if (swept) { anyPop = 0; scan = 1; restValid = 0; continue; }
    break;
  }
  r[R_SCOPE] = SC_OK; r[R_CHAIN] = rounds ? (counter > 1 ? counter : 1) : 0; r[R_TOTAL] = total;
  r[R_ROUNDS] = rounds; r[R_FRAMES] = T;
  if (wantSettled) save(s, r + R_INTS);
  return 0;
}
static void resolveRaw(const int32_t *st, int32_t *r, int wantSettled) { resolveU(st, r, wantSettled); }
static void resolveM(const int32_t *st, int32_t *r, int wantSettled) { resolveRaw(st, r, wantSettled); }
typedef struct { int32_t r[R_INTS]; ST st; } Res;
static LOCAL Res SETTLE_SPILL;
#define SMCAP (1 << 17)
typedef struct { u64 h; int32_t gen, at; } SMemo;
static SMemo SMEMO_MAIN[SMCAP];
static LOCAL SMemo *SMEMO;
static LOCAL int32_t smGen, smN;
static u64 stHash(const int32_t *st, int n) {
  u64 a = 0x9E3779B97F4A7C15ull ^ (u64)n, b = 0xC2B2AE3D27D4EB4Full;
  int W = st[O_W], N = st[O_N];
  for (int c = 1; c <= W; c++) {
    a = (a ^ (uint32_t)st[OCC + c]) * 0x100000001B3ull;
    b = (b ^ (uint32_t)st[GARB + c]) * 0x100000001B3ull;
  }
  for (int x = 1; x <= N; x++)
    for (int c = 1; c <= W; c += 2) {
      a = (a ^ (uint32_t)st[COL + x * WMAX + c]) * 0x100000001B3ull;
      b = (b ^ (uint32_t)st[COL + x * WMAX + c + 1]) * 0x100000001B3ull;
    }
  a ^= b * 0x9E3779B97F4A7C15ull;
  return a ^ (a >> 31);
}
static Res *settleOf(const int32_t *st) {
  int n = stlen(st);
  u64 h = stHash(st, n);
  unsigned i = (unsigned)(h >> 32) & (SMCAP - 1);
  for (; SMEMO[i].gen == smGen; i = (i + 1) & (SMCAP - 1)) {
    if (SMEMO[i].h != h) continue;
    const int32_t *p = ARENA + SMEMO[i].at;
    int j = 0;
    if (p[0] == n) while (j < n && p[1 + j] == st[j]) j++;
    if (j == n && p[0] == n) return (Res *)(p + 1 + n);
  }
  if (arenaN + 1 + n + R_INTS + ST_INTS > arenaCap) { failed = 1; return &SETTLE_SPILL; }
  int32_t *p = ARENA + arenaN;
  p[0] = n;
  for (int j = 0; j < n; j++) p[1 + j] = st[j];
  Res *out = (Res *)(p + 1 + n);
  nSettle++;
  resolveRaw(st, out->r, 1);
  if (smN < SMCAP / 2) { SMEMO[i].gen = smGen; SMEMO[i].h = h; SMEMO[i].at = arenaN; smN++; }
  arenaN += 1 + n + R_INTS + (out->r[R_SCOPE] == SC_OK ? stlen(out->st) : 0);
  return out;
}

static int canFireOf(const int32_t *st) {
  u64 k = hashOf(st); double v;
  if (tget(&FIRE, k, &v)) return (int)v;
  int f = anyOneSwapClear(st);
  tput(&FIRE, k, f);
  return f;
}
static LOCAL ST SCR;
static LOCAL int32_t SWS[2 * 128], RS[R_INTS + ST_INTS];
static void markLines(const int32_t *st, const Grid *G, int rr, int cc, int col, int r, int c, int l, int rt, uint32_t *k) {
  int lo = cc, hi = cc;
  while (gAt(st, G, rr, lo - 1, r, c, l, rt) == col) lo--;
  while (gAt(st, G, rr, hi + 1, r, c, l, rt) == col) hi++;
  if (hi - lo >= 2) for (int x = lo; x <= hi; x++) k[x] |= 1u << (rr - 1);
  int bot = rr, top = rr;
  while (gAt(st, G, bot - 1, cc, r, c, l, rt) == col) bot--;
  while (gAt(st, G, top + 1, cc, r, c, l, rt) == col) top++;
  if (top - bot >= 2) for (int y = bot; y <= top; y++) k[cc] |= 1u << (y - 1);
}
static int firstRoundK(const int32_t *st, const Grid *G, int r, int c, int *total, int *cascade, uint32_t *k);
static int firstRound(const int32_t *st, const Grid *G, int r, int c, int *total, int *cascade) { uint32_t k[WMAX]; return firstRoundK(st, G, r, c, total, cascade, k); }
static int firstRoundK(const int32_t *st, const Grid *G, int r, int c, int *total, int *cascade, uint32_t *k) {
  int W = st[O_W], H = st[O_H], L = G->g[r][c], Rt = G->g[r][c + 1];
  for (int i = 0; i < WMAX; i++) k[i] = 0;
  markLines(st, G, r, c, Rt, r, c, L, Rt, k);
  markLines(st, G, r, c + 1, L, r, c, L, Rt, k);
  int adj = 0, t = 0, cas = 0;
  for (int cc = 1; cc <= W; cc++) {
    if (!k[cc]) continue;
    t += popc(k[cc]);
    uint32_t top = 1u << (topRow(k[cc]) - 1);
    if (U(st, OCC + cc) & ~((top << 1) - 1u)) cas = 1;
    uint32_t g = U(st, GARB + cc), gl = cc > 1 ? U(st, GARB + cc - 1) : 0, gr = cc < W ? U(st, GARB + cc + 1) : 0;
    if (k[cc] & ((g >> 1) | (g << 1) | gl | gr)) adj = 1;
  }
  *total = t; *cascade = cas;
  if (!adj) return 0;
  int n = st[O_NSLAB];
  if (!n) return 1;
  for (int i = 0; i < n; i++) {
    if (st[SLK(i)]) continue;
    int low = 32;
    for (int cc = 1; cc <= W; cc++) { uint32_t m = U(st, SM(i, cc)); if (m) { int b = topRow(lowb(m)); if (b < low) low = b; } }
    if (low > H) continue;
    for (int cc = 1; cc <= W; cc++) {
      uint32_t l = cc > 1 ? k[cc - 1] : 0, rr = cc < W ? k[cc + 1] : 0;
      if (U(st, SM(i, cc)) & ((k[cc] >> 1) | (k[cc] << 1) | l | rr)) return 1;
    }
  }
  return 0;
}
static int quietClear(const int32_t *st, const Grid *G, int r, int c, int32_t *out) {
  int t, cas; uint32_t k[WMAX];
  if (firstRoundK(st, G, r, c, &t, &cas, k) || cas) return 0;
  int32_t *res = out, *ss = out + R_INTS;
  for (int i = 0; i < R_INTS; i++) res[i] = 0;
  res[R_SCOPE] = SC_OK; res[R_CHAIN] = 1; res[R_TOTAL] = t; res[R_ROUNDS] = 1;
  stcpy(ss, st);
  swapIn(ss, r, c);
  ss[O_BUSYF] = 0; ss[O_BAD] = 0; ss[6] = 0; ss[7] = 0;
  for (int cc = 0; cc < WMAX; cc++) { ss[BUSY + cc] = 0; ss[COL + cc] = 0; }
  for (int a = st[O_N] + 1; a < NCOL; a++) for (int cc = 0; cc < WMAX; cc++) ss[COL + a * WMAX + cc] = 0;
  for (int i = 0; i < st[O_NSLAB]; i++) { ss[SLK(i)] = ss[SLK(i)] ? 1 : 0; ss[SAIR(i)] = 0; }
  for (int cc = 1; cc <= st[O_W]; cc++) {
    if (!k[cc]) continue;
    ss[OCC + cc] &= ~k[cc];
    for (int a = 1; a <= st[O_N]; a++) ss[COL + a * WMAX + cc] &= ~k[cc];
  }
  return 1;
}
static const uint32_t ZK[WMAX];
static int runAt(const uint8_t g[18][WMAX], int W, int y, int x) {
  int a = g[y][x], lo = x, hi = x, bo = y, tp = y;
  while (lo > 1 && g[y][lo - 1] == a) lo--;
  while (hi < W && g[y][hi + 1] == a) hi++;
  if (hi - lo >= 2) return 1;
  while (bo > 1 && g[bo - 1][x] == a) bo--;
  while (tp < 17 && g[tp + 1][x] == a) tp++;
  return tp - bo >= 2;
}
typedef struct { int ok, nc; uint8_t g[18][WMAX]; uint32_t occ[WMAX], gar[WMAX], sl[MAXSLAB][WMAX]; uint8_t cand[MAXSLAB]; } Drop;
static void dropOf(const int32_t *st, const Grid *G, Drop *D) {
  int W = st[O_W], ns = st[O_NSLAB];
  D->ok = 1; D->nc = 0;
  __builtin_memcpy(D->g, G->g, sizeof(D->g));
  for (int cc = 1; cc <= W; cc++) {
    uint32_t gb = U(st, GARB + cc);
    if ((U(st, INERT + cc) & ~gb) || U(st, OCC + cc) >> 15) { D->ok = 0; return; }
    D->occ[cc] = U(st, OCC + cc); D->gar[cc] = gb;
    for (uint32_t q = gb; q; q &= q - 1u) D->g[__builtin_ctz(q) + 1][cc] = 0;
  }
  for (int i = 0; i < ns; i++) {
    if (st[SAIR(i)]) { D->ok = 0; return; }
    int any = 0, ground = 0;
    for (int cc = 1; cc <= W; cc++) {
      uint32_t v = U(st, SM(i, cc));
      D->sl[i][cc] = v;
      if (v) { any = 1; if (v & 1u) ground = 1; }
    }
    if (any && !ground && !st[SLK(i)]) D->cand[D->nc++] = (uint8_t)i;
  }
}
static int runOver(const Drop *D, int W, int y, int x, int r, int c, int L, int Rt) {
#define GV(yy, xx) ((yy) == r && (xx) == c ? Rt : (yy) == r && (xx) == c + 1 ? L : D->g[yy][xx])
  int a = GV(y, x), lo = x, hi = x, bo = y, tp = y;
  while (lo > 1 && GV(y, lo - 1) == a) lo--;
  while (hi < W && GV(y, hi + 1) == a) hi++;
  if (hi - lo >= 2) return 1;
  while (bo > 1 && GV(bo - 1, x) == a) bo--;
  while (tp < 17 && GV(tp + 1, x) == a) tp++;
#undef GV
  return tp - bo >= 2;
}
static int dropQuiet(const int32_t *st, const Drop *D, int r, int c, const uint32_t *k, int32_t *out) {
  if (!D->ok) return 0;
  int W = st[O_W], ns = st[O_NSLAB];
  uint32_t b0 = 1u << (r - 1);
  if (((D->occ[c] & b0) && !D->g[r][c]) || ((D->occ[c + 1] & b0) && !D->g[r][c + 1])) return 0;
  if (D->g[r][c] && D->g[r][c] == D->g[r][c + 1]) return 0;
  if (k == ZK) {
    int L0 = D->g[r][c], R0 = D->g[r][c + 1];
    if (!L0 != !R0) {
      int src = L0 ? c : c + 1, dst = L0 ? c + 1 : c;
      uint32_t bb = 1u << (r - 1);
      uint32_t above = D->occ[src] & ~((bb << 1) - 1u);
      int land = topRow(D->occ[dst] & (bb - 1u));
      if ((above || land != r - 1) && !(above & D->gar[src])) {
        int col = L0 ? L0 : R0;
#define GS(yy, xx) ((xx) == dst ? ((yy) == land + 1 ? col : (yy) == r ? 0 : D->g[yy][xx]) : (xx) == src ? ((yy) >= r ? ((yy) < 17 ? D->g[(yy) + 1][xx] : 0) : D->g[yy][xx]) : D->g[yy][xx])
        int hit = 0;
        for (int pass = 0; pass < 2 && !hit; pass++) {
          uint32_t cells = pass ? above >> 1 : 1u << land;
          int x = pass ? src : dst;
          for (; cells && !hit; cells &= cells - 1u) {
            int y = __builtin_ctz(cells) + 1, a = GS(y, x), lo = x, hi = x, bo = y, tp = y;
            while (lo > 1 && GS(y, lo - 1) == a) lo--;
            while (hi < W && GS(y, hi + 1) == a) hi++;
            if (hi - lo >= 2) { hit = 1; break; }
            while (bo > 1 && GS(bo - 1, x) == a) bo--;
            while (tp < 17 && GS(tp + 1, x) == a) tp++;
            if (tp - bo >= 2) hit = 1;
          }
        }
#undef GS
        if (hit) return 0;
        if (!out) return 1;
        int32_t *ss = out + R_INTS;
        for (int i = 0; i < R_INTS; i++) out[i] = 0;
        out[R_SCOPE] = SC_OK;
        stcpy(ss, st);
        ss[O_BUSYF] = 0; ss[O_BAD] = 0; ss[6] = 0; ss[7] = 0;
        for (int cc = 0; cc < WMAX; cc++) { ss[BUSY + cc] = 0; ss[COL + cc] = 0; }
        for (int a = st[O_N] + 1; a < NCOL; a++) for (int cc = 0; cc < WMAX; cc++) ss[COL + a * WMAX + cc] = 0;
        for (int i = 0; i < ns; i++) { ss[SLK(i)] = ss[SLK(i)] ? 1 : 0; ss[SAIR(i)] = 0; }
        uint32_t keepLo = bb - 1u, lb = 1u << land;
        ss[OCC + dst] |= lb;
        ss[OCC + src] = (ss[OCC + src] & keepLo) | ((ss[OCC + src] >> 1) & ~keepLo);
        for (int a = 1; a <= st[O_N]; a++) {
          uint32_t ms = (uint32_t)ss[COL + a * WMAX + src];
          ms = (ms & keepLo) | ((ms >> 1) & ~keepLo);
          ss[COL + a * WMAX + src] = ms & ss[OCC + src] & ~ss[GARB + src];
          uint32_t md = (uint32_t)ss[COL + a * WMAX + dst];
          if (a == col) md |= lb;
          ss[COL + a * WMAX + dst] = md & ss[OCC + dst] & ~ss[GARB + dst];
        }
        return 1;
      }
      if (!(D->occ[src] >> r) && (r == 1 || (D->occ[dst] & (bb >> 1)))) {
        if (runOver(D, W, r, dst, r, c, L0, R0)) return 0;
        if (!out) return 1;
        int32_t *ss = out + R_INTS;
        for (int i = 0; i < R_INTS; i++) out[i] = 0;
        out[R_SCOPE] = SC_OK;
        stcpy(ss, st);
        ss[O_BUSYF] = 0; ss[O_BAD] = 0; ss[6] = 0; ss[7] = 0;
        for (int cc = 0; cc < WMAX; cc++) { ss[BUSY + cc] = 0; ss[COL + cc] = 0; }
        for (int a = st[O_N] + 1; a < NCOL; a++) for (int cc = 0; cc < WMAX; cc++) ss[COL + a * WMAX + cc] = 0;
        for (int i = 0; i < ns; i++) { ss[SLK(i)] = ss[SLK(i)] ? 1 : 0; ss[SAIR(i)] = 0; }
        swapIn(ss, r, c);
        for (int cc = c; cc <= c + 1; cc++)
          for (int a = 1; a <= st[O_N]; a++) ss[COL + a * WMAX + cc] &= ss[OCC + cc] & ~ss[GARB + cc];
        return 1;
      }
    }
  }
  uint8_t g[18][WMAX];
  uint32_t occ[WMAX], gar[WMAX], mv[WMAX], b = 1u << (r - 1);
  int dd[MAXSLAB];
  uint32_t dirty = (1u << c) | (2u << c);
  __builtin_memcpy(g, D->g, sizeof(g));
  int L = g[r][c], Rt = g[r][c + 1];
  g[r][c] = (uint8_t)Rt; g[r][c + 1] = (uint8_t)L;
  for (int x = 0; x < D->nc; x++) dd[D->cand[x]] = 0;
  for (int cc = 1; cc <= W; cc++) {
    uint32_t o = D->occ[cc], kk = k[cc];
    if (cc == c) o = (o & ~b) | (Rt ? b : 0);
    else if (cc == c + 1) o = (o & ~b) | (L ? b : 0);
    o &= ~kk;
    for (uint32_t q = kk; q; q &= q - 1u) g[__builtin_ctz(q) + 1][cc] = 0;
    occ[cc] = o; gar[cc] = D->gar[cc];
    mv[cc] = (cc == c || cc == c + 1) ? (o & ~gar[cc] & b) : 0;
    if (kk) dirty |= 1u << cc;
  }
  int anyMoved = 0;
  for (int pass = 0; pass < 64; pass++) {
    int slabMoved = 0;
    for (int cc = 1; cc <= W; cc++) {
      uint32_t o = occ[cc], need = o & ~gar[cc] & ~((o << 1) | 1u);
      if (!need) continue;
      dirty |= 1u << cc;
      int y0 = __builtin_ctz(need), w = topRow(o & ((1u << y0) - 1u));
      for (int y = y0; y < 17; y++) {
        uint32_t bit = 1u << y;
        if (!(o & bit)) continue;
        if (gar[cc] & bit) { w = y + 1; continue; }
        if (w != y) {
          g[w + 1][cc] = g[y + 1][cc]; g[y + 1][cc] = 0;
          o = (o & ~bit) | (1u << w);
          mv[cc] = (mv[cc] & ~bit) | (1u << w);
        }
        w++;
      }
      occ[cc] = o;
    }
    for (int x = 0; x < D->nc; x++) {
      int i = D->cand[x], free = 1;
      for (int cc = 1; cc <= W && free; cc++) {
        uint32_t v = D->sl[i][cc] >> dd[i];
        if (v && ((v & 1u) || ((lowb(v) >> 1) & occ[cc]))) free = 0;
      }
      if (!free) continue;
      int d = 0;
      for (;;) {
        int ok = 1;
        for (int cc = 1; cc <= W && ok; cc++) {
          uint32_t v = D->sl[i][cc] >> dd[i];
          if (!v) continue;
          if (v & ((2u << d) - 1u)) ok = 0;
          else if ((v >> (d + 1)) & occ[cc] & ~v) ok = 0;
        }
        if (!ok) break;
        d++;
      }
      for (int cc = 1; cc <= W; cc++) {
        uint32_t v = D->sl[i][cc] >> dd[i];
        if (!v) continue;
        occ[cc] = (occ[cc] & ~v) | (v >> d); gar[cc] = (gar[cc] & ~v) | (v >> d);
      }
      dd[i] += d;
      anyMoved = 1; slabMoved = 1;
    }
    if (!slabMoved) break;
  }
  for (int cc = 1; cc <= W; cc++)
    for (uint32_t q = mv[cc]; q; q &= q - 1u) if (runAt(g, W, __builtin_ctz(q) + 1, cc)) return 0;
  if (!out) return 1;
  int32_t *res = out, *ss = out + R_INTS, t = 0, N = st[O_N];
  for (int cc = 1; cc <= W; cc++) t += popc(k[cc]);
  for (int i = 0; i < R_INTS; i++) res[i] = 0;
  res[R_SCOPE] = SC_OK;
  if (t) { res[R_CHAIN] = 1; res[R_TOTAL] = t; res[R_ROUNDS] = 1; }
  stcpy(ss, st);
  ss[O_BUSYF] = 0; ss[O_BAD] = 0; ss[6] = 0; ss[7] = 0;
  for (int cc = 0; cc < WMAX; cc++) { ss[BUSY + cc] = 0; ss[COL + cc] = 0; }
  for (int a = N + 1; a < NCOL; a++) for (int cc = 0; cc < WMAX; cc++) ss[COL + a * WMAX + cc] = 0;
  for (int i = 0; i < ns; i++) { ss[SLK(i)] = ss[SLK(i)] ? 1 : 0; ss[SAIR(i)] = 0; }
  if (anyMoved) {
    for (int x = 0; x < D->nc; x++) {
      int i = D->cand[x];
      if (!dd[i]) continue;
      for (int cc = 1; cc <= W; cc++) { ss[INERT + cc] &= ~D->sl[i][cc]; ss[SM(i, cc)] = D->sl[i][cc] >> dd[i]; }
    }
    for (int x = 0; x < D->nc; x++) {
      int i = D->cand[x];
      if (dd[i]) for (int cc = 1; cc <= W; cc++) ss[INERT + cc] |= D->sl[i][cc] >> dd[i];
    }
  }
  for (int cc = 1; cc <= W; cc++) {
    ss[OCC + cc] = occ[cc]; ss[GARB + cc] = gar[cc];
    if (!(dirty & (1u << cc))) continue;
    for (int a = 1; a <= N; a++) ss[COL + a * WMAX + cc] = 0;
    for (uint32_t q = occ[cc] & ~gar[cc]; q; q &= q - 1u) {
      int y = __builtin_ctz(q);
      ss[COL + g[y + 1][cc] * WMAX + cc] |= 1u << y;
    }
  }
  return 1;
}
#define DROPQ(st, r, c, k) ((haveD || (dropOf(st, &G, &D), haveD = 1)) && dropQuiet(st, &D, r, c, k, 0))
static int quietDrop(const int32_t *st, const Grid *G, const Drop *D, int r, int c, int32_t *out) {
  uint32_t b = 1u << (r - 1), k[WMAX];
  if ((U(st, INERT + c) | U(st, INERT + c + 1)) & b) return 0;
  if (G->g[r][c] && G->g[r][c + 1]) {
    int t, cas;
    if (firstRoundK(st, G, r, c, &t, &cas, k)) return 0;
    return dropQuiet(st, D, r, c, k, out);
  }
  return dropQuiet(st, D, r, c, ZK, out);
}
static int breaksFirst(const int32_t *st, const Grid *G, int r, int c) { int t, cs; return firstRound(st, G, r, c, &t, &cs); }
static int anyBreakOf(const int32_t *st0) {
  Grid G;
  u64 k = hashOf(st0); double v;
  if (tget(&SAVES, k, &v)) return v > 0;
  if (tget(&ANYB, k, &v)) return (int)v;
  stcpy(SCR, st0);
  int n = legalG(SCR, SWS, &G), any = 0, rest = atRest(SCR), nLater = 0, LATER[128];
  Drop D; int haveD = 0;
  for (int i = 0; i < n && !any; i++) {
    if (!swapCanClearG(SCR, &G, rest, SWS[2 * i], SWS[2 * i + 1])) continue;
    if (rest && G.g[SWS[2 * i]][SWS[2 * i + 1]] && G.g[SWS[2 * i]][SWS[2 * i + 1] + 1]) {
      int t, cas; uint32_t kq[WMAX];
      if (firstRoundK(SCR, &G, SWS[2 * i], SWS[2 * i + 1], &t, &cas, kq)) { any = 1; break; }
      if (!cas || DROPQ(SCR, SWS[2 * i], SWS[2 * i + 1], kq)) continue;
    }
    if (rest && !(G.g[SWS[2 * i]][SWS[2 * i + 1]] && G.g[SWS[2 * i]][SWS[2 * i + 1] + 1]) && DROPQ(SCR, SWS[2 * i], SWS[2 * i + 1], ZK)) continue;
    LATER[nLater++] = i;
  }
  for (int j = 0; j < nLater && !any; j++) {
    int i = LATER[j];
    if (!swapIn(SCR, SWS[2 * i], SWS[2 * i + 1])) continue;
    nAnyR++, resolve(SCR, RS, 0);
    swapIn(SCR, SWS[2 * i], SWS[2 * i + 1]);
    if (RS[R_SCOPE] == SC_BROKE) any = 1;
  }
  tput(&ANYB, k, any);
  return any;
}
static int savesOfRaw(const int32_t *st0) {
  Grid G;
  u64 k = hashOf(st0); double v;
  if (tget(&SAVES, k, &v)) return (int)v;
  stcpy(SCR, st0);
  int n = legalG(SCR, SWS, &G), cnt = 0, rest = atRest(SCR);
  Drop D; int haveD = 0;
  for (int i = 0; i < n; i++) {
    if (!swapCanClearG(SCR, &G, rest, SWS[2 * i], SWS[2 * i + 1])) continue;
    if (rest && G.g[SWS[2 * i]][SWS[2 * i + 1]] && G.g[SWS[2 * i]][SWS[2 * i + 1] + 1]) {
      int t, cas; uint32_t kq[WMAX];
      if (firstRoundK(SCR, &G, SWS[2 * i], SWS[2 * i + 1], &t, &cas, kq)) { cnt++; continue; }
      if (!cas || DROPQ(SCR, SWS[2 * i], SWS[2 * i + 1], kq)) continue;
    }
    if (rest && !(G.g[SWS[2 * i]][SWS[2 * i + 1]] && G.g[SWS[2 * i]][SWS[2 * i + 1] + 1]) && DROPQ(SCR, SWS[2 * i], SWS[2 * i + 1], ZK)) continue;
    if (!swapIn(SCR, SWS[2 * i], SWS[2 * i + 1])) continue;
    nSavesR++, resolve(SCR, RS, 0);
    swapIn(SCR, SWS[2 * i], SWS[2 * i + 1]);
    if (RS[R_SCOPE] == SC_BROKE) cnt++;
  }
  tput(&SAVES, k, cnt);
  return cnt;
}
static LOCAL double PCHAIN[64], PCOMBO[256];
static double priceOf(int chain, int total) {
  if (chain >= 2) return PCHAIN[chain < 63 ? chain : 63];
  return PCOMBO[total < 255 ? total : 255];
}
static LOCAL ST SCS;
static LOCAL int32_t SWL[2 * 128], RL[R_INTS + ST_INTS];
static double bestOneSwapStop(const int32_t *st0) {
  Grid G;
  stcpy(SCS, st0);
  int n = legalG(SCS, SWL, &G), rest = atRest(SCS);
  Drop D; int haveD = 0;
  double best = 0;
  for (int i = 0; i < n; i++) {
    if (!swapCanClearG(SCS, &G, rest, SWL[2 * i], SWL[2 * i + 1])) continue;
    if (rest && G.g[SWL[2 * i]][SWL[2 * i + 1]] && G.g[SWL[2 * i]][SWL[2 * i + 1] + 1]) {
      int t, cas; uint32_t kq[WMAX];
      int br = firstRoundK(SCS, &G, SWL[2 * i], SWL[2 * i + 1], &t, &cas, kq);
      if (br || !cas || DROPQ(SCS, SWL[2 * i], SWL[2 * i + 1], kq)) {
        if (!(t > 0)) continue;
        double pays = priceOf(1, t);
        if (pays != pays) pays = 0;
        if (pays > best) best = pays;
        continue;
      }
    }
    if (rest && !(G.g[SWL[2 * i]][SWL[2 * i + 1]] && G.g[SWL[2 * i]][SWL[2 * i + 1] + 1]) && DROPQ(SCS, SWL[2 * i], SWL[2 * i + 1], ZK)) continue;
    if (!swapIn(SCS, SWL[2 * i], SWL[2 * i + 1])) continue;
    nLandR++, resolve(SCS, RL, 0);
    swapIn(SCS, SWL[2 * i], SWL[2 * i + 1]);
    if (!(RL[R_TOTAL] > 0)) continue;
    double pays = priceOf(RL[R_CHAIN], RL[R_TOTAL]);
    if (pays != pays) pays = 0;
    if (pays > best) best = pays;
  }
  return best;
}
static LOCAL int stopKeyId = 0, hasStopPrice = 0;
static double landStopOf(const int32_t *st) {
  if (!stopKeyId) return bestOneSwapStop(st);
  u64 k = hashOf(st) ^ ((u64)stopKeyId * 0x9e3779b97f4a7c15ull); double v;
  if (tget(&STOPS_T, k, &v)) return v;
  double r = bestOneSwapStop(st);
  tput(&STOPS_T, k, r);
  return r;
}

// ---------------------------------------------------------------- the search
static LOCAL double LMAX;
static LOCAL int lazyBreak, expanding;
static LOCAL double FPR, DEADLINE, LOCKP, OVERHEAD, SWAPP, HOLD, WORK, MAXSTOP, READYWORTH, PREPWORTH;
static LOCAL int SPEND, LEAN, PREPARE, DIG, PRESS, Wd;
static LOCAL int dropBudget, saveBudget, slabBudget, prepBudget;
static LOCAL int nAvoid; static LOCAL int32_t AVOID[2 * 40];
static LOCAL ST BASEST;

static int travelCost(int r0, int c0, int r1, int c1) {
  int steps = (r1 > r0 ? r1 - r0 : r0 - r1) + (c1 > c0 ? c1 - c0 : c0 - c1);
  return (steps <= 0 ? 0 : 4 * (steps - 1) + 1) + PRESS;
}
static int hasGarb(const int32_t *st) { for (int c = 1; c <= st[O_W]; c++) if (st[GARB + c]) return 1; return 0; }
static int breakAfterDropOf(const int32_t *st0);
static int breakReadyOf(const int32_t *st) {
  if (!hasGarb(st)) return -1;
  if (anyBreakOf(st)) return 1;
  return breakAfterDropOf(st);
}
static LOCAL ST SCD;
static LOCAL int32_t SWD[2 * 128];
static LOCAL Res RDROP;
static int breakAfterDropOf(const int32_t *st0) {
  Grid G;
  if (dropBudget <= 0) return 0;
  dropBudget--;
  stcpy(SCD, st0);
  int n = legalG(SCD, SWD, &G), rest = atRest(SCD);
  for (int i = 0; i < n; i++) {
    if (!swapCanClearG(SCD, &G, rest, SWD[2 * i], SWD[2 * i + 1])) continue;
    if (!swapIn(SCD, SWD[2 * i], SWD[2 * i + 1])) continue;
    resolve(SCD, RDROP.r, 1);
    swapIn(SCD, SWD[2 * i], SWD[2 * i + 1]);
    if (RDROP.r[R_SCOPE] == SC_BROKE) return 1;
    if (RDROP.r[R_SCOPE] != SC_OK || RDROP.r[R_TOTAL] == 0) continue;
    if (anyBreakOf(RDROP.st)) return 1;
  }
  return 0;
}
static double setupWorth(int haveG, double g, double left) {
  if (!haveG || !(left > 0)) return 0;
  double cost = g * (SWAPP > 1 ? SWAPP : 1);
  if (cost >= left) return 0;
  return (FPR + HOLD) * (1 - cost / left);
}
static int undoesLast(int row, int col, const int32_t *r) {
  if (!nAvoid) return 0;
  if (r[R_TOTAL] > 0 || r[R_SCOPE] == SC_BROKE) return 0;
  uint32_t b = 1u << (row - 1);
  if (!(U(BASEST, OCC + col) & b) || !(U(BASEST, OCC + col + 1) & b)) return 0;
  for (int q = 0; q < nAvoid; q++) if (AVOID[2 * q] == row && AVOID[2 * q + 1] == col) return 1;
  return 0;
}

// An option record (doubles):
enum { F_KIND, F_SIZE, F_FRAMES, F_CHAIN, F_TOTAL, F_GARBAGE, F_CONVERTS, F_VOID, F_DURATION, F_HASSHAPE,
       F_TALL, F_BUMPS, F_MAT, F_LOW, F_SPREAD, F_VOIDROWS, F_SLABGAP, F_READY, F_BREAKS, F_LEVELS, F_OPENSHOLE,
       F_EXTRAS, F_BREAKREADY, F_CLOSESBREAK, F_DIGGAIN, F_VOIDGAIN, F_SLABGAIN, F_SLABWORTH, F_MATNOW,
       F_VALUE, F_WAYS, F_LANDSTOP, F_NSW, F_SW, REC = F_SW + 2 * MAXD };
#define MAXOPT 54000
static double ODATA[(MAXOPT + 4) * REC + 64], ODSCR[(MAXOPT + 4) * REC + 64];
static int32_t LANDS[ST_INTS], LANDSCR[ST_INTS];
static LOCAL double *OD = ODATA, *ODS = ODSCR;
static LOCAL int32_t *LD = LANDS, *LDS = LANDSCR;
static LOCAL int odCap = MAXOPT;
__attribute__((export_name("bit_odata"))) double *bit_odata(void) { return ODATA; }
__attribute__((export_name("bit_lands"))) int32_t *bit_lands(void) { return LANDS; }
static double PARAM[128];
__attribute__((export_name("bit_param"))) double *bit_param(void) { return PARAM; }
__attribute__((export_name("bit_pchain"))) double *bit_pchain(void) { return PCHAIN; }
__attribute__((export_name("bit_pcombo"))) double *bit_pcombo(void) { return PCOMBO; }

__attribute__((export_name("bit_layout"))) int32_t bit_layout(int32_t i) {
  int32_t v[] = { WMAX, NCOL, MAXSLAB, OCC, INERT, GARB, BUSY, COL, SLAB, SL, ST_INTS, R_INTS, REC, MAXD, 0 };
  return v[i];
}
static double *recAt(int i) { return OD + 64 + i * REC; }
static LOCAL int nNow, nNext;
static LOCAL int startOpt, nOpt;
static double *newOpt(void) {
  if (startOpt + nOpt >= odCap) { failed = 1; return recAt(odCap - 1); }
  double *o = recAt(4 + startOpt + nOpt);
  nOpt++;
  return o;
}
static LOCAL Shape START;
static LOCAL double BASELOW, BASEBUMPS, BASEVOID, BASEGAP;
static LOCAL int BASEBREAK;
static LOCAL int BASEDIG, BASESAVE;
typedef struct CK CK;
static LOCAL CK *CUR_E;
static void shapeC(const int32_t *st, Shape *sh);
static int fireC(const int32_t *st);
static int reachC(const int32_t *st, uint32_t *rr);
static int slabC(const int32_t *st);
static int breakReadyC(const int32_t *st);
static void fillOption(double *o, const int32_t *seq, int nseq, int frames, const int32_t *r, const int32_t *settled) {
  int chain = r[R_CHAIN], total = r[R_TOTAL];
  o[F_KIND] = chain >= 2 ? 1 : 0;
  o[F_SIZE] = chain >= 2 ? chain : total;
  o[F_FRAMES] = frames; o[F_CHAIN] = chain; o[F_TOTAL] = total;
  o[F_GARBAGE] = r[R_SCOPE] == SC_BROKE ? r[R_GARBAGE] : 0;
  o[F_CONVERTS] = r[R_SCOPE] == SC_BROKE ? r[R_CONVERTS] : 0;
  o[F_VOID] = r[R_SCOPE] == SC_BROKE ? r[R_VOID] : 0;
  o[F_DURATION] = frames + nseq * OVERHEAD;
  if (settled) {
    Shape sh; shapeC(settled, &sh);
    o[F_HASSHAPE] = 1; o[F_TALL] = sh.tall; o[F_BUMPS] = sh.bumps; o[F_MAT] = sh.mat; o[F_LOW] = sh.low;
    o[F_SPREAD] = sh.spread; o[F_VOIDROWS] = sh.high - sh.mat; o[F_SLABGAP] = sh.slabRowGap;
    o[F_READY] = LEAN ? -1 : fireC(settled);
  } else {
    double nan = 0.0 / 0.0;
    o[F_HASSHAPE] = 0; o[F_READY] = -1;
    o[F_TALL] = nan; o[F_BUMPS] = nan; o[F_MAT] = nan; o[F_LOW] = nan; o[F_SPREAD] = nan; o[F_VOIDROWS] = nan; o[F_SLABGAP] = nan;
  }
  o[F_NSW] = nseq;
  for (int i = 0; i < 2 * nseq; i++) o[F_SW + i] = seq[i];
}
static void extras(double *o, const int32_t *settled) {
  o[F_BREAKS] = 0;
  o[F_LEVELS] = o[F_HASSHAPE] && o[F_BUMPS] <= BASEBUMPS;
  o[F_OPENSHOLE] = o[F_HASSHAPE] && o[F_LOW] == 0 && BASELOW > 0;
  o[F_EXTRAS] = !LEAN;
  if (LEAN) {
    o[F_BREAKREADY] = -1; o[F_CLOSESBREAK] = 0; o[F_DIGGAIN] = 0; o[F_VOIDGAIN] = 0; o[F_SLABGAIN] = 0; o[F_SLABWORTH] = 0;
    o[F_MATNOW] = 0.0 / 0.0;
    return;
  }
  if (lazyBreak && expanding && !BASEBREAK && !(o[F_HASSHAPE] && o[F_TALL] >= 8)) o[F_BREAKREADY] = -3;
  else o[F_BREAKREADY] = settled ? breakReadyC(settled) : -2;
  o[F_CLOSESBREAK] = BASEBREAK && o[F_BREAKREADY] == 0;
  uint32_t rm[WMAX];
  o[F_DIGGAIN] = (DIG && settled) ? reachC(settled, rm) - BASEDIG : 0;
  o[F_VOIDGAIN] = o[F_HASSHAPE] ? BASEVOID - o[F_VOIDROWS] : 0;
  o[F_SLABGAIN] = setupWorth(o[F_HASSHAPE] != 0, o[F_SLABGAP], DEADLINE - o[F_DURATION]) - setupWorth(1, BASEGAP, DEADLINE);
  o[F_SLABWORTH] = (PREPARE && prepBudget > 0 && settled && (prepBudget--, slabC(settled))) ? PREPWORTH : 0;
  o[F_MATNOW] = START.mat;
}

typedef struct { const int32_t *st; int nchain; int32_t chain[2 * MAXD]; int fr, fc, spent, hasReach, dig; uint32_t reach[WMAX]; double lock; } Node;
typedef struct { const int32_t *st; int parent, sr, sc, spent, hasReach, dig; uint32_t reach[WMAX]; double lock; } Born;
#define MAXFRONT 48
#define MAXBORN 4096
static LOCAL Node FRONT[MAXFRONT], FRONT2[MAXFRONT];
static Res QUIET_MAIN[2 * MAXBORN];
static LOCAL Res *QUIET;
static LOCAL int qcap = MAXBORN;
static LOCAL int nQuiet[2], qside;
static LOCAL Born BORN[MAXBORN];
static LOCAL int ORD[MAXBORN], ORD2[MAXBORN];
static LOCAL int32_t SWE[2 * 128];
static LOCAL ST WORK_ST[MAXFRONT];
// flat, save, ready, trigger: records 0..3
static LOCAL int haveRec[4];
static void takeRec(int which, const int32_t *seq, int nseq, int frames, double value, double dur) {
  double *o = recAt(which);
  haveRec[which] = 1;
  o[F_FRAMES] = frames; o[F_VALUE] = value; o[F_DURATION] = dur; o[F_NSW] = nseq;
  for (int i = 0; i < 2 * nseq; i++) o[F_SW + i] = seq[i];
}
static LOCAL int TMPI[MAXBORN];
static void msortI(int *a, int n, int (*cmp)(int, int)) {
  for (int w = 1; w < n; w *= 2) {
    for (int lo = 0; lo < n; lo += 2 * w) {
      int mid = lo + w < n ? lo + w : n, hi = lo + 2 * w < n ? lo + 2 * w : n, i = lo, j = mid, k = lo;
      while (i < mid && j < hi) TMPI[k++] = cmp(a[i], a[j]) <= 0 ? a[i++] : a[j++];
      while (i < mid) TMPI[k++] = a[i++];
      while (j < hi) TMPI[k++] = a[j++];
    }
    for (int i = 0; i < n; i++) a[i] = TMPI[i];
  }
}
static int bySpent(int x, int y) { return BORN[x].spent - BORN[y].spent; }
static int byDig(int x, int y) {
  int d = BORN[y].dig - BORN[x].dig;
  return d ? d : BORN[x].spent - BORN[y].spent;
}
static LOCAL int CNT[4097];
static void sortBorn(int n) {
  int lo = 1 << 30, hi = -(1 << 30);
  for (int i = 0; i < n; i++) { int v = BORN[i].spent; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (n && hi - lo < 4096) {
    int range = hi - lo + 1;
    for (int i = 0; i <= range; i++) CNT[i] = 0;
    for (int i = 0; i < n; i++) CNT[BORN[i].spent - lo + 1]++;
    for (int i = 1; i <= range; i++) CNT[i] += CNT[i - 1];
    for (int i = 0; i < n; i++) ORD[CNT[BORN[i].spent - lo]++] = i;
    return;
  }
  for (int i = 0; i < n; i++) ORD[i] = i;
  msortI(ORD, n, bySpent);
}

static LOCAL int threadReady;
struct CK { Res *res; int resPly, persist, hasRR, rrDig, hasSh, hasShG, sv, fire, slab, hasLand, anyB, bad; double land; Shape sh, shg; uint32_t rr[WMAX]; };
#define NTCAP (1 << 12)
typedef struct { u64 h; int32_t gen, at, n, nl, rest; CK *ck; int32_t *sw; } NT;
static NT NT_MAIN[NTCAP];
static LOCAL NT *NTB;
static LOCAL int32_t ntGen = 1, ntN;
static NT *nodeFind(const int32_t *st, unsigned *slot) {
  int n = stlen(st);
  u64 h = stHash(st, n);
  unsigned i = (unsigned)(h >> 32) & (NTCAP - 1);
  for (; NTB[i].gen == ntGen; i = (i + 1) & (NTCAP - 1)) {
    if (NTB[i].h != h || NTB[i].n != n) continue;
    const int32_t *p = ARENA + NTB[i].at;
    int j = 0;
    while (j < n && p[j] == st[j]) j++;
    if (j == n) return &NTB[i];
  }
  NTB[i].h = h; NTB[i].n = n;
  *slot = i;
  return 0;
}
static CK *nodeAdd(unsigned i, const int32_t *st, int nl, const int32_t *sw, int rest) {
  int n = NTB[i].n;
  if (ntN >= NTCAP / 2) return 0;
  int at = (arenaN + 1) & ~1, need = (int)((nl * sizeof(CK) + 3) / 4);
  if (at + need + n + 2 * nl + R_INTS + ST_INTS > arenaCap) return 0;
  CK *ck = (CK *)(ARENA + at);
  for (int k = 0; k < nl; k++) { ck[k].res = 0; ck[k].hasRR = 0; ck[k].hasSh = 0; ck[k].hasShG = 0; ck[k].sv = -1; ck[k].fire = -1; ck[k].slab = -1; ck[k].hasLand = 0; ck[k].anyB = -1; ck[k].bad = -1; }
  int32_t *cp = ARENA + at + need, *sp = cp + n;
  for (int j = 0; j < n; j++) cp[j] = st[j];
  for (int j = 0; j < 2 * nl; j++) sp[j] = sw[j];
  arenaN = at + need + n + 2 * nl;
  NTB[i].gen = ntGen; NTB[i].at = (int32_t)(cp - ARENA); NTB[i].nl = nl; NTB[i].rest = rest; NTB[i].ck = ck; NTB[i].sw = sp;
  ntN++;
  return ck;
}
static LOCAL ST SWAPSCR;
static int settleSwap(const int32_t *st, int r, int c, Res *out) {
  unsigned slot;
  NT *nt = NTB ? nodeFind(st, &slot) : 0;
  if (nt && nt->ck) {
    for (int k = 0; k < nt->nl; k++) {
      if (nt->sw[2 * k] != r || nt->sw[2 * k + 1] != c) continue;
      Res *res = nt->ck[k].res;
      if (res && nt->ck[k].persist) {
        int n = R_INTS + (res->r[R_SCOPE] == SC_OK ? stlen(res->st) : 0);
        for (int i = 0; i < n; i++) ((int32_t *)out)[i] = ((const int32_t *)res)[i];
        return 1;
      }
      break;
    }
  }
  if (settledRest(st)) {
    Grid G; Drop D;
    gridOf(st, &G); dropOf(st, &G, &D);
    if (quietDrop(st, &G, &D, r, c, (int32_t *)out)) return 1;
  }
  stcpy(SWAPSCR, st);
  if (!swapIn(SWAPSCR, r, c)) return 0;
  resolve(SWAPSCR, out->r, 1);
  return 1;
}
static void shapeC(const int32_t *st, Shape *sh) {
  CK *e = CUR_E;
  if (!e) { shapeOf(st, sh); return; }
  if (!e->hasShG) { shapeOf(st, &e->shg); e->hasShG = 1; }
  *sh = e->shg;
}
static int fireC(const int32_t *st) { CK *e = CUR_E; if (!e) return canFireOf(st); if (e->fire < 0) e->fire = canFireOf(st); return e->fire; }
static int slabC(const int32_t *st) { CK *e = CUR_E; if (!e) return slabReadyFast(st); if (e->slab < 0) e->slab = slabReadyFast(st); return e->slab; }
static int reachC(const int32_t *st, uint32_t *rr) {
  CK *e = CUR_E;
  if (!e) return reachOf(st, rr);
  if (!e->hasRR) { e->rrDig = reachOf(st, e->rr); e->hasRR = 1; }
  for (int c = 0; c < WMAX; c++) rr[c] = e->rr[c];
  return e->rrDig;
}
static int breakReadyC(const int32_t *st) {
  CK *e = CUR_E;
  if (!e) return breakReadyOf(st);
  if (!hasGarb(st)) return -1;
  if (e->anyB < 0) e->anyB = anyBreakOf(st);
  if (e->anyB) return 1;
  if (dropBudget <= 0) return 0;
  if (e->bad >= 0) { dropBudget--; return e->bad; }
  return e->bad = breakAfterDropOf(st);
}
static void threadInit(void) {
  if (threadReady) return;
  threadReady = 1;
  ARENA = ARENA_MAIN; QUIET = QUIET_MAIN; SMEMO = SMEMO_MAIN; smGen = 1; NTB = NT_MAIN;
  __builtin_memset(ARENA_MAIN, 0, 16ul << 20);
  __builtin_memset(QUIET_MAIN, 0, sizeof(QUIET_MAIN));
  __builtin_memset(ODATA, 0, 8ul << 20);
  __builtin_memset(ODSCR, 0, 4ul << 20);
  SAVES.s = TABLE_MAIN[0]; ANYB.s = TABLE_MAIN[1]; STOPS_T.s = TABLE_MAIN[2]; FIRE.s = TABLE_MAIN[3];
}
#define MAXSET 4096
#define SOUT (R_INTS + ST_INTS)
#define TIXW 130
static int32_t PSET[MAXSET * 4], PSOUT[2 * MAXSET * SOUT], TASKIX[MAXFRONT * TIXW], PEXTRA[MAXSET * 6];
static LOCAL ST PSWAP;
typedef struct Cand Cand;
typedef struct { int32_t gen, next, n, kind, ack, nworkers, lean, dig; Cand **cands; double *out; const int32_t *front; int32_t *sout; } Pool;
static Pool pool;

static LOCAL int inPar;
static void scoreTask(int i);
static void savesTask(int i);
static void runTask(int i) {
  if (pool.kind == 1) { scoreTask(i); return; }
  if (pool.kind == 3) { savesTask(i); return; }
  int32_t *x = PEXTRA + 6 * i;
  x[0] = 0; x[2] = 0;
  stcpy(PSWAP, pool.front + PSET[4 * i] * ST_INTS);
  swapIn(PSWAP, PSET[4 * i + 1], PSET[4 * i + 2]);
  const int32_t *settled;
  int32_t *r = pool.sout + i * SOUT;
  if (PSET[4 * i + 3]) settled = PSWAP;
  else {
    resolveRaw(PSWAP, r, 1);
    if (r[R_SCOPE] != SC_OK) return;
    settled = r + R_INTS;
    if (r[R_TOTAL] > 0) {
      if (!pool.lean && hasGarb(settled)) { x[0] = 1; x[1] = anyBreakOf(settled); }
      u64 h = hashOf(settled); x[4] = (int32_t)h; x[5] = (int32_t)(h >> 32);
      return;
    }
  }
  if (pool.dig && !pool.lean) {
    uint32_t rm[WMAX];
    x[2] = reachOf(settled, rm) > 0;
  }
  u64 h = hashOf(settled); x[4] = (int32_t)h; x[5] = (int32_t)(h >> 32);
}
static int32_t SAVEIX[MAXSET];
static void savesTask(int i) {
  int t = SAVEIX[i];
  int32_t *x = PEXTRA + 6 * t;
  const int32_t *settled;
  if (PSET[4 * t + 3]) {
    stcpy(PSWAP, pool.front + PSET[4 * t] * ST_INTS);
    swapIn(PSWAP, PSET[4 * t + 1], PSET[4 * t + 2]);
    settled = PSWAP;
  } else settled = pool.sout + t * SOUT + R_INTS;
  x[3] = savesOfRaw(settled);
}
static void runTasks(void) {
  int i, n = pool.n, chunk = pool.kind == 1 ? 1 : 4;
  inPar = 1;
  while ((i = __atomic_fetch_add(&pool.next, chunk, __ATOMIC_SEQ_CST)) < n)
    for (int j = i; j < i + chunk && j < n; j++) runTask(j);
  inPar = 0;
}
static void parRun0(int kind, int n);
static void parRun(int kind, int n) { parRun0(kind, n); }
static void parRun0(int kind, int n) {
  pool.kind = kind; pool.n = n; pool.next = 0;
  if (!pool.nworkers || n < 2) { inPar = 1; for (int i = 0; i < n; i++) runTask(i); inPar = 0; return; }
  __atomic_store_n(&pool.ack, 0, __ATOMIC_SEQ_CST);
  __atomic_add_fetch(&pool.gen, 1, __ATOMIC_SEQ_CST);
#ifdef THREADS
  __builtin_wasm_memory_atomic_notify(&pool.gen, (unsigned)-1);
#endif
  runTasks();
  int32_t a;
  while ((a = __atomic_load_n(&pool.ack, __ATOMIC_SEQ_CST)) < pool.nworkers) {}
}
#ifdef THREADS
extern void __wasm_init_tls(void *);
__attribute__((export_name("bit_thread_init"))) void bit_thread_init(int32_t id) {
  unsigned long a = __builtin_wasm_tls_align();
  void *tls = grab(__builtin_wasm_tls_size() + a);
  __wasm_init_tls((void *)(((unsigned long)tls + a - 1) & ~(a - 1)));
  if (!id) return;
  threadReady = 1;
  arenaCap = 8 << 20; qcap = 2048; odCap = 2048;
  SAVES.s = (Slot *)grab(TCAP * sizeof(Slot)); ANYB.s = (Slot *)grab(TCAP * sizeof(Slot));
  STOPS_T.s = (Slot *)grab(TCAP * sizeof(Slot)); FIRE.s = (Slot *)grab(TCAP * sizeof(Slot));
  ARENA = (int32_t *)grab((unsigned long)arenaCap * 4);
  SMEMO = (SMemo *)grab(SMCAP * sizeof(SMemo)); smGen = 1;
  NTB = (NT *)grab(NTCAP * sizeof(NT));
  QUIET = (Res *)grab(2ul * qcap * sizeof(Res));
  ODS = (double *)grab(((unsigned long)odCap + 4) * REC * 8 + 64 * 8);
  LDS = (int32_t *)grab(ST_INTS * 4);
  OD = ODS; LD = LDS;
}
__attribute__((export_name("bit_grab"))) void *bit_grab(int32_t n) { return grab((unsigned long)n); }
__attribute__((export_name("bit_worker_loop"))) void bit_worker_loop(void) {
  int32_t last = __atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST);
  __atomic_add_fetch(&pool.nworkers, 1, __ATOMIC_SEQ_CST);
  __builtin_wasm_memory_atomic_notify(&pool.nworkers, 1);
  for (;;) {
    for (int spin = 0; spin < 20000000 && __atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST) == last; spin++) {}
    while (__atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST) == last) __builtin_wasm_memory_atomic_wait32(&pool.gen, last, -1);
    last = __atomic_load_n(&pool.gen, __ATOMIC_SEQ_CST);
    memoRoom();
    runTasks();
    __atomic_add_fetch(&pool.ack, 1, __ATOMIC_SEQ_CST);
    __builtin_wasm_memory_atomic_notify(&pool.ack, 1);
  }
}
#endif
__attribute__((export_name("bit_workers"))) int32_t bit_workers(void) { return __atomic_load_n(&pool.nworkers, __ATOMIC_SEQ_CST); }
static int prefetchPly(int nf, int ply) {
  int nt = 0;
  for (int fi = 0; fi < nf; fi++) {
    Node *node = &FRONT[fi];
    int32_t *state = WORK_ST[fi];
    stcpy(state, node->st);
    Grid G;
    int nl = legalG(state, SWE, &G);
    int nodeRest = settledRest(state);
    uint32_t reach[WMAX]; int haveReach = node->hasReach;
    if (haveReach) for (int c = 0; c < WMAX; c++) reach[c] = node->reach[c];
    if (!haveReach && node->nchain) { reachOf(state, reach); haveReach = 1; }
    for (int k = 0; k < nl; k++) {
      int sr = SWE[2 * k], sc = SWE[2 * k + 1];
      TASKIX[fi * TIXW + k] = -1;
      if (haveReach && !SPEND) {
        uint32_t rb = 1u << (sr - 1);
        if (!((reach[sc] | reach[sc + 1]) & rb)) continue;
      }
      int quiet = quietSwapG(state, &G, nodeRest, sr, sc);
      if (quiet && !DIG) continue;
      int cost = node->spent + travelCost(node->fr, node->fc, sr, sc);
      if ((double)(cost + ply - 1) > node->lock + SPEND) continue;
      if (nt >= MAXSET) continue;
      if (!quiet) TASKIX[fi * TIXW + k] = nt;
      PSET[4 * nt] = fi; PSET[4 * nt + 1] = sr; PSET[4 * nt + 2] = sc; PSET[4 * nt + 3] = quiet; nt++;
    }
  }
  pool.front = (const int32_t *)WORK_ST;
  pool.sout = PSOUT + qside * MAXSET * SOUT;
  pool.lean = LEAN; pool.dig = DIG;
  parRun(2, nt);
  int ns = 0, budget = saveBudget;
  for (int i = 0; i < nt; i++) {
    int32_t *x = PEXTRA + 6 * i;
    u64 h = (u64)(uint32_t)x[4] | ((u64)(uint32_t)x[5] << 32);
    if (x[0]) tput(&ANYB, h, x[1]);
    if (x[2] && budget > 0) {
      int32_t *r = pool.sout + i * SOUT;
      if (!PSET[4 * i + 3] && (r[R_SCOPE] != SC_OK || r[R_TOTAL] > 0)) continue;
      budget--;
      double v;
      if (!tget(&SAVES, h, &v)) SAVEIX[ns++] = i;
    }
  }
  if (ns) {
    parRun(3, ns);
    for (int j = 0; j < ns; j++) {
      int32_t *x = PEXTRA + 6 * SAVEIX[j];
      tput(&SAVES, (u64)(uint32_t)x[4] | ((u64)(uint32_t)x[5] << 32), x[3]);
    }
  }
  return 1;
}
static void expandAll(int depth, int cr, int cc) {
  expanding = 1;
  Shape BASE; shapeOf(BASEST, &BASE);
  uint32_t rm[WMAX];
  BASEDIG = DIG ? reachOf(BASEST, rm) : 0;
  saveBudget = 192; slabBudget = 24; prepBudget = 24;
  BASESAVE = (DIG && BASEDIG > 0 && !LEAN) ? savesOfRaw(BASEST) : 0;
  int nf = 1;
  FRONT[0].st = BASEST; FRONT[0].nchain = 0; FRONT[0].fr = cr; FRONT[0].fc = cc; FRONT[0].spent = 0;
  FRONT[0].hasReach = 0; FRONT[0].dig = 0; FRONT[0].lock = LOCKP;
  int32_t seq[2 * MAXD];
  double fv = 0;
  for (int ply = 1; ply <= depth && nf; ply++) {
    int nb = 0;
    qside ^= 1; nQuiet[qside] = 0;
    int pf = pool.nworkers && !LEAN && !inPar && prefetchPly(nf, ply);
    for (int fi = 0; fi < nf; fi++) {
      Node *node = &FRONT[fi];
      int32_t *state = WORK_ST[fi];
      stcpy(state, node->st);
      Grid G;
      int nl, nodeRest, haveG = 0;
      unsigned slot = 0;
      NT *nt = nodeFind(state, &slot);
      CK *ck;
      if (nt) {
        nl = nt->nl; nodeRest = nt->rest; ck = nt->ck;
        for (int j = 0; j < 2 * nl; j++) SWE[j] = nt->sw[j];
      } else {
        nl = legalG(state, SWE, &G); haveG = 1;
        nodeRest = settledRest(state);
        ck = nodeAdd(slot, state, nl, SWE, nodeRest);
      }
      Drop D; int haveD = 0;
      uint32_t reach[WMAX]; int haveReach = node->hasReach;
      if (haveReach) for (int c = 0; c < WMAX; c++) reach[c] = node->reach[c];
      if (!haveReach && node->nchain) { reachOf(state, reach); haveReach = 1; }
      for (int k = 0; k < nl; k++) {
        int sr = SWE[2 * k], sc = SWE[2 * k + 1];
        if (haveReach && !SPEND) {
          uint32_t rb = 1u << (sr - 1);
          if (!((reach[sc] | reach[sc + 1]) & rb)) continue;
        }
        Res *res;
        CK *e = ck ? &ck[k] : 0;
        if (e && e->res && (e->resPly == ply || e->persist)) res = e->res;
        else if ((haveG || (gridOf(state, &G), haveG = 1)) && quietSwapG(state, &G, nodeRest, sr, sc)) {
          if (nQuiet[qside] >= qcap) { failed = 1; continue; }
          res = &QUIET[qside * qcap + nQuiet[qside]++];
          for (int i = 0; i < R_INTS; i++) res->r[i] = 0;
          swapIn(state, sr, sc);
          stcpy(res->st, state);
          swapIn(state, sr, sc);
        } else if (nodeRest && G.g[sr][sc] && G.g[sr][sc + 1] && arenaN + R_INTS + ST_INTS <= arenaCap &&
                   quietClear(state, &G, sr, sc, ARENA + arenaN)) {
          res = (Res *)(ARENA + arenaN);
          arenaN += R_INTS + stlen(res->st);
        } else if (nodeRest && arenaN + R_INTS + ST_INTS <= arenaCap && (haveD || (dropOf(state, &G, &D), haveD = 1)) && quietDrop(state, &G, &D, sr, sc, ARENA + arenaN)) {
          res = (Res *)(ARENA + arenaN);
          arenaN += R_INTS + stlen(res->st);
        } else if (pf && TASKIX[fi * TIXW + k] >= 0) {
          res = (Res *)(PSOUT + (qside * MAXSET + TASKIX[fi * TIXW + k]) * SOUT);
        } else {
          if (!swapIn(state, sr, sc)) continue;
          res = settleOf(state);
          swapIn(state, sr, sc);
        }
        if (e) {
          e->res = res; e->resPly = ply;
          e->persist = (res < QUIET || res >= QUIET + 2 * qcap) && ((int32_t *)res < PSOUT || (int32_t *)res >= PSOUT + 2 * MAXSET * SOUT);
        }
        int cost = node->spent + travelCost(node->fr, node->fc, sr, sc);
        int tPlan = cost + ply - 1;
        if ((double)tPlan > node->lock + SPEND) continue;
        int broke = res->r[R_SCOPE] == SC_BROKE;
        if (res->r[R_SCOPE] != SC_OK && !broke) continue;
        if (ply == 1 && undoesLast(sr, sc, res->r)) continue;
        for (int i = 0; i < 2 * node->nchain; i++) seq[i] = node->chain[i];
        seq[2 * node->nchain] = sr; seq[2 * node->nchain + 1] = sc;
        int nseq = node->nchain + 1;
        const int32_t *settled = (res->r[R_SCOPE] == SC_OK) ? res->st : 0;
        if (res->r[R_TOTAL] > 0 || broke) {
          if (node->nchain) {
            double *o = newOpt();
            CUR_E = settled ? e : 0;
            fillOption(o, seq, nseq, cost, res->r, settled);
            extras(o, settled);
            CUR_E = 0;
            o[F_BREAKS] = broke;
            nNext++;
          }
          continue;
        }
        if (!settled) continue;
        uint32_t rr[WMAX]; int rrDig = 0, haveRR = 0;
        if (DIG) {
          if (!e) rrDig = reachOf(settled, rr);
          else {
            if (!e->hasRR) { e->rrDig = reachOf(settled, e->rr); e->hasRR = 1; }
            rrDig = e->rrDig;
            for (int c = 0; c < WMAX; c++) rr[c] = e->rr[c];
          }
          haveRR = 1;
        }
        int svNow = 0;
        if (!LEAN) {
          Shape sh2;
          if (!e) shapeOfG(settled, &sh2, 0);
          else { if (!e->hasSh) { shapeOfG(settled, &e->sh, 0); e->hasSh = 1; } sh2 = e->sh; }
          double dur = cost + nseq * OVERHEAD;
          double base2 = (BASE.tall - sh2.tall) * FPR + (BASE.excess - sh2.excess) * FPR
                       - (WORK - sh2.mat > 0 ? WORK - sh2.mat : 0) * FPR - dur;
          int needLand = hasStopPrice && (!haveRec[0] || base2 + MAXSTOP > fv);
          int haveTerm = 0; double term = 0;
          if (DIG && haveRR) {
            int sv = 0;
            if (rrDig > 0) { if (saveBudget > 0) { saveBudget--; sv = !e ? savesOfRaw(settled) : e->sv >= 0 ? e->sv : (e->sv = savesOfRaw(settled)); } }
            svNow = sv;
            haveTerm = 1;
            term = (sv - BASESAVE) * (DEADLINE / Wd) * Wd + (rrDig - BASEDIG) * (DEADLINE / Wd);
          }
          double credit = 0, floor2 = haveRec[0] ? fv : -1.0 / 0.0;
          if (needLand) {
            double vLo = base2 + 0.0, vHi = base2 + LMAX;
            if (haveTerm) { vLo += term; vHi += term; }
            int exact = 0, slabYes = 0;
            if (slabBudget > 0) {
              if (vLo + PREPWORTH > floor2) slabYes = 1;
              else if (!(vHi + PREPWORTH <= floor2)) exact = 1;
            }
            double hi = vHi + (PREPWORTH > READYWORTH ? PREPWORTH : READYWORTH);
            double *v1 = recAt(1), *v2 = recAt(2), *v3 = recAt(3);
            if (!exact && (!haveRec[0] || hi > fv)) exact = 1;
            if (!exact && svNow > 0 && (!haveRec[1] || hi > v1[F_VALUE] || (hi == v1[F_VALUE] && cost < v1[F_FRAMES]))) exact = 1;
            if (!exact && (!haveRec[2] || hi > v2[F_VALUE] || (hi == v2[F_VALUE] && cost < v2[F_FRAMES])) && (!e ? canFireOf(settled) : e->fire >= 0 ? e->fire : (e->fire = canFireOf(settled)))) exact = 1;
            if (!exact && (!haveRec[3] || hi > v3[F_VALUE] || (hi == v3[F_VALUE] && cost < v3[F_FRAMES])) && (!e ? slabReadyFast(settled) : e->slab >= 0 ? e->slab : (e->slab = slabReadyFast(settled)))) exact = 1;
            if (!exact) {
              if (slabYes) slabBudget--;
              goto born;
            }
          }
          double landStop = needLand ? (!e ? landStopOf(settled) : e->hasLand ? e->land : (e->hasLand = 1, e->land = landStopOf(settled))) : 0;
          double val = base2 + landStop;
          if (haveTerm) val += term;
          if (slabBudget > 0 && val + PREPWORTH > floor2) {
            slabBudget--;
            if ((!e ? slabReadyFast(settled) : e->slab >= 0 ? e->slab : (e->slab = slabReadyFast(settled)))) credit = PREPWORTH;
          }
          if (!credit && val + READYWORTH > floor2 && (!e ? canFireOf(settled) : e->fire >= 0 ? e->fire : (e->fire = canFireOf(settled)))) credit = READYWORTH;
          val += credit;
          int take = !haveRec[0] || val > fv;
          double *sv0 = recAt(1), *rd0 = recAt(2), *tg0 = recAt(3);
          if (svNow > 0 && (!haveRec[1] || val > sv0[F_VALUE] || (val == sv0[F_VALUE] && cost < sv0[F_FRAMES])))
            takeRec(1, seq, nseq, cost, val, cost + nseq * OVERHEAD);
          if ((!haveRec[2] || val > rd0[F_VALUE] || (val == rd0[F_VALUE] && cost < rd0[F_FRAMES])) && (!e ? canFireOf(settled) : e->fire >= 0 ? e->fire : (e->fire = canFireOf(settled))))
            takeRec(2, seq, nseq, cost, val, cost + nseq * OVERHEAD);
          if ((!haveRec[3] || val > tg0[F_VALUE] || (val == tg0[F_VALUE] && cost < tg0[F_FRAMES])) && (!e ? slabReadyFast(settled) : e->slab >= 0 ? e->slab : (e->slab = slabReadyFast(settled))))
            takeRec(3, seq, nseq, cost, val, cost + nseq * OVERHEAD);
          if (take) {
            takeRec(0, seq, nseq, cost, val, dur);
            double *fl = recAt(0);
            uint32_t wm[WMAX]; reachMask(settled, wm);
            int ways2 = 0; for (int c = 1; c <= Wd; c++) ways2 += popc(wm[c]);
            fl[F_TALL] = sh2.tall; fl[F_BUMPS] = sh2.bumps; fl[F_WAYS] = ways2;
            fv = val;
            stcpy(LD, settled);
          }
        }
      born:
        if (nb >= MAXBORN) { failed = 1; continue; }
        Born *b = &BORN[nb++];
        b->st = settled; b->parent = fi; b->sr = sr; b->sc = sc; b->spent = cost;
        b->hasReach = haveRR; b->dig = haveRR ? rrDig : 0;
        if (haveRR) for (int c = 0; c < WMAX; c++) b->reach[c] = rr[c];
        double l2 = tPlan + 4;
        b->lock = node->lock > l2 ? node->lock : l2;
      }
    }
    sortBorn(nb);
    int beam = 12, digBeam = SPEND ? 24 : 6, nf2 = nb > beam ? beam : nb;
    int pick[MAXFRONT], np = 0;
    for (int i = 0; i < nf2; i++) pick[np++] = ORD[i];
    if (DIG && nb > nf2) {
      int ns = 0;
      for (int i = nf2; i < nb; i++) ORD2[ns++] = ORD[i];
      msortI(ORD2, ns, byDig);
      for (int k = 0; k < ns && k < digBeam; k++) if (BORN[ORD2[k]].dig) pick[np++] = ORD2[k];
    }
    for (int i = 0; i < np; i++) {
      Born *b = &BORN[pick[i]];
      Node *pn = &FRONT[b->parent], *nn = &FRONT2[i];
      nn->st = b->st; nn->nchain = pn->nchain + 1;
      for (int j = 0; j < 2 * pn->nchain; j++) nn->chain[j] = pn->chain[j];
      nn->chain[2 * pn->nchain] = b->sr; nn->chain[2 * pn->nchain + 1] = b->sc;
      nn->fr = b->sr; nn->fc = b->sc; nn->spent = b->spent; nn->hasReach = b->hasReach; nn->dig = b->dig;
      for (int c = 0; c < WMAX; c++) nn->reach[c] = b->reach[c];
      nn->lock = b->lock;
    }
    for (int i = 0; i < np; i++) FRONT[i] = FRONT2[i];
    nf = np;
  }
}

static LOCAL int32_t SW1[2 * 128];
static LOCAL ST ST1;
static LOCAL Res R1;
// The whole search. Returns 0, or -1 when a fixed size was exceeded (a bug).
static LOCAL int nOptRuns, nOptDepth;
static int optionsRun(const int32_t *st0, const double *P, const int32_t *first, int nfirst) {
  threadInit(); arenaN = 0; smGen++; smN = 0; ntGen++; ntN = 0; expanding = 0;
  nOptRuns++; nOptDepth += (int)P[11];
  failed = 0;
  FPR = P[0]; DEADLINE = P[1]; LOCKP = P[2]; SPEND = (int)P[3]; LEAN = (int)P[4];
  PREPARE = (int)P[5]; HOLD = P[6]; WORK = P[7]; OVERHEAD = P[8]; SWAPP = P[9];
  DIG = (int)P[10]; int depth = (int)P[11], cr = (int)P[12], cc = (int)P[13];
  PRESS = (int)P[14]; hasStopPrice = (int)P[15]; stopKeyId = (int)P[16]; MAXSTOP = P[17];
  lazyBreak = (int)P[101];
  LMAX = 0;
  for (int i = 0; i < 64; i++) if (PCHAIN[i] > LMAX) LMAX = PCHAIN[i];
  for (int i = 0; i < 256; i++) if (PCOMBO[i] > LMAX) LMAX = PCOMBO[i];
  nAvoid = (int)P[18];
  if (nAvoid > 40) { nAvoid = 40; failed = 1; }
  for (int i = 0; i < 2 * nAvoid; i++) AVOID[i] = (int32_t)P[19 + i];
  stcpy(BASEST, st0);
  Wd = BASEST[O_W];
  READYWORTH = HOLD / Wd; PREPWORTH = (FPR + HOLD) / Wd;
  prepBudget = 24; dropBudget = 8;
  shapeOf(BASEST, &START);
  BASELOW = START.low; BASEBUMPS = START.bumps; BASEVOID = START.high - START.mat; BASEGAP = START.slabRowGap;
  BASEBREAK = LEAN ? 0 : breakReadyOf(BASEST) == 1;
  uint32_t rm[WMAX];
  BASEDIG = DIG ? reachOf(BASEST, rm) : 0;
  nNow = 0; nNext = 0; startOpt = 0; nOpt = 0;
  for (int i = 0; i < 4; i++) haveRec[i] = 0;
  int refused = 0, unknown = 0;
  stcpy(ST1, BASEST);
  int ns;
  if (nfirst > 0) { ns = nfirst; for (int i = 0; i < 2 * ns; i++) SW1[i] = first[i]; }
  else ns = legal(ST1, SW1);
  int rest1 = settledRest(ST1);
  Grid G1; gridOf(ST1, &G1);
  for (int i = 0; i < ns; i++) {
    int sr = SW1[2 * i], sc = SW1[2 * i + 1];
    if (quietSwapG(ST1, &G1, rest1, sr, sc)) {
      for (int j = 0; j < R_INTS; j++) R1.r[j] = 0;
      if (undoesLast(sr, sc, R1.r)) refused++;
      continue;
    }
    if (!swapIn(ST1, sr, sc)) { refused++; continue; }
    resolve(ST1, R1.r, 1);
    swapIn(ST1, sr, sc);
    int broke = R1.r[R_SCOPE] == SC_BROKE;
    if (R1.r[R_SCOPE] != SC_OK && !broke) { unknown++; continue; }
    if (undoesLast(sr, sc, R1.r)) { refused++; continue; }
    if (R1.r[R_TOTAL] == 0 && !broke) continue;
    double *o = newOpt();
    int32_t seq[2] = { sr, sc };
    const int32_t *settled = R1.r[R_SCOPE] == SC_OK ? R1.st : 0;
    fillOption(o, seq, 1, travelCost(cr, cc, sr, sc), R1.r, settled);
    extras(o, settled);
    o[F_BREAKS] = broke;
    nNow++;
  }
  BASEDIG = 0; BASESAVE = 0; saveBudget = 0; slabBudget = 0; dropBudget = 0;
  if ((depth ? depth : 1) >= 2) expandAll(depth ? depth : 1, cr, cc);
  expanding = 0;
  double *fl = recAt(0);
  if (haveRec[0] && !(fl[F_VALUE] > 0)) haveRec[0] = 0;
  OD[0] = failed ? -1 : 0; OD[1] = nNow; OD[2] = nNext; OD[3] = refused; OD[4] = unknown;
  OD[5] = ns; OD[6] = LEAN ? -1 : BASEBREAK;
  for (int i = 0; i < 4; i++) OD[7 + i] = haveRec[i];
  OD[11] = (hasStopPrice && haveRec[0]) ? landStopOf(LD) : 0;
  return failed ? -1 : 0;
}

__attribute__((export_name("bit_options"))) int32_t bit_options(void) {
  memoRoom();
  OD = ODATA; LD = LANDS;
  return optionsRun(IN, PARAM, LIST, PARAM[100] > 0 ? (int)PARAM[100] : 0);
}

#include "bot.c"
__attribute__((export_name("bit_checkbf"))) int32_t bit_checkbf(void) {
  Grid G; static int32_t sw[256], rr[R_INTS + ST_INTS];
  int n = legalG(IN, sw, &G), rest = atRest(IN), bad = 0, hits = 0;
  for (int i = 0; i < n; i++) {
    int r = sw[2 * i], c = sw[2 * i + 1];
    if (!rest || !G.g[r][c] || !G.g[r][c + 1] || !swapCanClearG(IN, &G, rest, r, c)) continue;
    int t, cas, bf = firstRound(IN, &G, r, c, &t, &cas);
    swapIn(IN, r, c); resolveRaw(IN, rr, 0); swapIn(IN, r, c);
    if (bf) { hits++; if (rr[R_SCOPE] != SC_BROKE || rr[R_ROUNDS] != 1 || rr[R_CHAIN] != 1 || rr[R_TOTAL] != t) bad++; }
    else if (!cas) {
      hits++;
      if (rr[R_SCOPE] != SC_OK || rr[R_ROUNDS] != 1 || rr[R_CHAIN] != 1 || rr[R_TOTAL] != t) bad++;
      static int32_t q[R_INTS + ST_INTS], full[R_INTS + ST_INTS];
      if (!quietClear(IN, &G, r, c, q)) bad++;
      else {
        swapIn(IN, r, c); resolveRaw(IN, full, 1); swapIn(IN, r, c);
        for (int j = 0; j < R_INTS; j++) if (q[j] != full[j]) { bad++; break; }
        int len = stlen(full + R_INTS);
        if (stlen(q + R_INTS) != len) bad++;
        else for (int j = 0; j < len; j++) if (q[R_INTS + j] != full[R_INTS + j]) { bad++; break; }
      }
    }
    else if (rr[R_SCOPE] == SC_BROKE && rr[R_ROUNDS] == 1) bad += 1000;
  }
  return bad * 10000 + hits;
}
