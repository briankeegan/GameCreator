#include "libc.h"
typedef unsigned long long u64;

#define WMAX 8
#define NCOL 13
#define MAXSLAB 24
#define MAXD 24
enum { O_W = 0, O_H, O_N, O_NSLAB, O_BUSYF, O_BAD,
       OCC = 8, INERT = 16, GARB = 24, BUSY = 32, COL = 40,
       SLAB = COL + NCOL * WMAX, LOCK = SLAB + MAXSLAB * WMAX, AIR = LOCK + MAXSLAB, ST_INTS = AIR + MAXSLAB };
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
static void stcpy(int32_t *d, const int32_t *s) { for (int i = 0; i < ST_INTS; i++) d[i] = s[i]; }
#define U(st, i) ((uint32_t)(st)[i])
#define CL(st, a, c) U(st, COL + (a) * WMAX + (c))

typedef struct {
  int W, H, N, nslab;
  uint32_t occ[WMAX], inert[WMAX], garb[WMAX], chaining[WMAX], popping[WMAX], rest[WMAX];
  uint32_t colour[NCOL][WMAX];
  uint32_t slab[MAXSLAB][WMAX];
  int32_t locked[MAXSLAB], air[MAXSLAB], falling[MAXSLAB];
} R;
static R S;

static void restingOf(R *s) {
  for (int c = 1; c <= s->W; c++) {
    uint32_t o = s->occ[c], lowestZero = (~o) & (o + 1u), m = o & (lowestZero - 1u);
    uint32_t seeds = s->inert[c] & ~m;
    while (seeds) {
      uint32_t seed = lowb(seeds), run = seed, probe = seed;
      while ((probe <<= 1) && (o & probe)) run |= probe;
      m |= run;
      seeds &= ~run;
    }
    s->rest[c] = m;
  }
}
static void slabsThatFall(R *s) {
  int moved = 1, pass = 0;
  for (int i = 0; i < s->nslab; i++) s->falling[i] = 0;
  while (moved && pass++ <= s->nslab + 1) {
    moved = 0;
    for (int si = 0; si < s->nslab; si++) {
      if (s->falling[si] || s->locked[si]) continue;
      int held = 0;
      for (int c = 1; c <= s->W && !held; c++) {
        uint32_t v = s->slab[si][c];
        if (!v) continue;
        uint32_t lowBit = lowb(v);
        if (lowBit == 1) { held = 1; break; }
        uint32_t under = lowBit >> 1;
        if (!(s->occ[c] & under)) continue;
        int owner = -1;
        for (int sj = 0; sj < s->nslab; sj++) if (s->slab[sj][c] & under) owner = sj;
        if (owner >= 0 && s->falling[owner]) continue;
        held = 1;
      }
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
    for (int a = 0; a < NCOL; a++) s->colour[a][c] = CL(st, a, c);
  }
  for (int i = 0; i < s->nslab; i++) {
    for (int c = 0; c < WMAX; c++) s->slab[i][c] = U(st, SLAB + i * WMAX + c);
    s->locked[i] = st[LOCK + i]; s->air[i] = 0;
  }
}
static void save(R *s, int32_t *o) {
  for (int i = 0; i < ST_INTS; i++) o[i] = 0;
  o[O_W] = s->W; o[O_H] = s->H; o[O_N] = s->N;
  for (int c = 0; c < WMAX; c++) {
    o[OCC + c] = s->occ[c]; o[INERT + c] = s->inert[c]; o[GARB + c] = s->garb[c];
    for (int a = 1; a <= s->N; a++) o[COL + a * WMAX + c] = s->colour[a][c];
  }
  int n = 0;
  for (int i = 0; i < s->nslab; i++) {
    int any = 0;
    for (int c = 0; c < WMAX; c++) if (s->slab[i][c]) { any = 1; break; }
    if (!any) continue;
    for (int c = 0; c < WMAX; c++) o[SLAB + n * WMAX + c] = s->slab[i][c];
    o[LOCK + n] = s->locked[i] ? 1 : 0;
    n++;
  }
  o[O_NSLAB] = n;
}

typedef struct { uint32_t m[WMAX]; int until, swap; } Hold;
#define MAXHOLD 16
#define NEVER 0x3fffffff
static Hold HOLDS[MAXHOLD]; static int nHolds;
static uint32_t heldAt(int c) { uint32_t h = 0; for (int i = 0; i < nHolds; i++) h |= HOLDS[i].m[c]; return h; }
static int nextRelease(void) { int u = NEVER; for (int i = 0; i < nHolds; i++) if (HOLDS[i].until < u) u = HOLDS[i].until; return u; }
static int resolveT(const int32_t *st, int32_t *r, int wantSettled, const Timed *tm);
static void resolve(const int32_t *st, int32_t *r, int wantSettled) { resolveT(st, r, wantSettled, 0); }
static int tmFailed = 0;
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
static int resolveT(const int32_t *st, int32_t *r, int wantSettled, const Timed *tm) {
  for (int i = 0; i < R_INTS; i++) r[i] = 0;
  if (st[O_BAD]) { r[R_SCOPE] = SC_BAD; return 0; }
  R *s = &S;
  load(s, st);
  int W = s->W, H = s->H, N = s->N;
  int counter = 0, rounds = 0, total = 0, guard = 0, LIMIT = W * H * H, T = 0, moved = 0;
  uint32_t B[NCOL][WMAX], k[WMAX], freeM[WMAX];
  int32_t inGroup[MAXSLAB];
  int sweepAt = 0, hoverUntil = 0, made = 1, refused = 0;
  nHolds = 0;
  if (tm) {
    for (int c = 0; c <= W + 1; c++) { s->chaining[c] = tm->chaining[c] & s->occ[c]; s->popping[c] = tm->popping[c] & s->occ[c]; }
    for (int i = 0; i < s->nslab; i++) s->air[i] = st[AIR + i];
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
__attribute__((export_name("bit_resolve"))) void bit_resolve(int32_t wantSettled) { resolve(IN, OUT, wantSettled); }
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
static int legal(const int32_t *st, int32_t *out) {
  int n = 0;
  for (int r = 1; r <= st[O_H]; r++) {
    uint32_t b = 1u << (r - 1);
    for (int c = 1; c < st[O_W]; c++) {
      if ((U(st, INERT + c) & b) || (U(st, INERT + c + 1) & b)) continue;
      if (st[O_BUSYF] && ((U(st, BUSY + c) | U(st, BUSY + c + 1)) & b)) continue;
      if (!((U(st, OCC + c) | U(st, OCC + c + 1)) & b)) continue;
      if (colourLast(st, c, b) == colourLast(st, c + 1, b)) continue;
      out[2 * n] = r; out[2 * n + 1] = c; n++;
    }
  }
  return n;
}
__attribute__((export_name("bit_legal"))) int32_t bit_legal(void) { return legal(IN, LIST); }

static int32_t SW[2 * 128], RR[R_INTS + ST_INTS];
__attribute__((export_name("bit_scan"))) int32_t bit_scan(void) {
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
static int sccR, sccC, sccL, sccRt;
static int sccAt(const int32_t *st, int rr, int cc) {
  if (rr < 1 || rr > st[O_H] || cc < 1 || cc > st[O_W]) return -1;
  if (rr == sccR && cc == sccC) return sccRt;
  if (rr == sccR && cc == sccC + 1) return sccL;
  uint32_t bb = 1u << (rr - 1);
  if (U(st, INERT + cc) & bb) return 0;
  return colourFirst(st, cc, bb);
}
static int sccLine(const int32_t *st, int rr, int cc, int col) {
  int run = 1, k;
  for (k = cc - 1; k >= 1 && sccAt(st, rr, k) == col; k--) run++;
  for (k = cc + 1; k <= st[O_W] && sccAt(st, rr, k) == col; k++) run++;
  if (run >= 3) return 1;
  run = 1;
  for (k = rr - 1; k >= 1 && sccAt(st, k, cc) == col; k--) run++;
  for (k = rr + 1; k <= st[O_H] && sccAt(st, k, cc) == col; k++) run++;
  return run >= 3;
}
static int swapCanClear(const int32_t *st, int rest, int r, int c) {
  if (!rest) return 1;
  uint32_t b = 1u << (r - 1);
  int left = colourLast(st, c, b), right = colourLast(st, c + 1, b);
  if (!left || !right) return 1;
  sccR = r; sccC = c; sccL = left; sccRt = right;
  return sccLine(st, r, c, right) || sccLine(st, r, c + 1, left);
}
static int otAt(const int32_t *st, int rr, int cc) {
  if (rr < 1 || rr > st[O_H] || cc < 1 || cc > st[O_W]) return -1;
  if (rr == sccR && cc == sccC) return sccRt;
  if (rr == sccR && cc == sccC + 1) return sccL;
  return colourFirst(st, cc, 1u << (rr - 1));
}
static int otLine(const int32_t *st, int r, int c, int a) {
  int run = 1, k;
  for (k = c - 1; k >= 1 && otAt(st, r, k) == a; k--) run++;
  for (k = c + 1; k <= st[O_W] && otAt(st, r, k) == a; k++) run++;
  if (run >= 3) return 1;
  run = 1;
  for (k = r - 1; k >= 1 && otAt(st, k, c) == a; k--) run++;
  for (k = r + 1; k <= st[O_H] && otAt(st, k, c) == a; k++) run++;
  return run >= 3;
}
static ST SLOW;
static int32_t SWB[2 * 128], RB[R_INTS + ST_INTS];
static int anyOneSwapClear(const int32_t *st) {
  int n = legal(st, SWB), haveSlow = 0;
  for (int i = 0; i < n; i++) {
    int r = SWB[2 * i], c = SWB[2 * i + 1];
    uint32_t bitv = 1u << (r - 1);
    int left = colourFirst(st, c, bitv), right = colourFirst(st, c + 1, bitv);
    if (!left || !right) {
      if (!haveSlow) { stcpy(SLOW, st); haveSlow = 1; }
      if (!swapIn(SLOW, r, c)) continue;
      resolve(SLOW, RB, 0);
      swapIn(SLOW, r, c);
      if (RB[R_TOTAL] > 0 || RB[R_SCOPE] == SC_BROKE) return 1;
      continue;
    }
    sccR = r; sccC = c; sccL = left; sccRt = right;
    if (otLine(st, r, c + 1, left)) return 1;
    if (otLine(st, r, c, right)) return 1;
  }
  return 0;
}
static void reachMask(const int32_t *st, uint32_t *out) {
  int W = st[O_W];
  for (int c = 0; c < WMAX; c++) out[c] = 0;
  for (int a = 1; a <= st[O_N]; a++) {
    for (int c = 1; c <= W; c++) {
      uint32_t B = CL(st, a, c);
      if (!B) continue;
      uint32_t vp = B & (B >> 1);
      if (vp) out[c] |= vp | (vp >> 1) | (vp << 2);
      uint32_t hp = B & (c + 1 < WMAX ? CL(st, a, c + 1) : 0);
      if (hp) {
        out[c] |= hp; out[c + 1] |= hp;
        if (c > 1) out[c - 1] |= hp;
        if (c + 2 <= W) out[c + 2] |= hp;
      }
    }
  }
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
static void shapeOf(const int32_t *st, Shape *sh) {
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
  for (c = 1; c <= W; c++) {
    uint32_t gm = U(st, GARB + c);
    if (!gm) continue;
    uint32_t lowBit = lowb(gm);
    int fr = 0;
    while (fr < 32 && (lowBit >> fr)) fr++;
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
  uint32_t target = 1u << (t - 1), col[NCOL][WMAX];
  for (a = 1; a <= N; a++) for (c = 0; c < WMAX; c++) col[a][c] = CL(st, a, c);
  int rows[3] = { t, t - 1, t - 2 };
  for (int ri = 0; ri < 3; ri++) {
    int r = rows[ri];
    if (r < 1) continue;
    uint32_t bitv = 1u << (r - 1);
    for (c = 1; c < Wl; c++) {
      int left = 0, right = 0;
      for (a = 1; a <= N; a++) if (col[a][c] & bitv) { left = a; break; }
      for (a = 1; a <= N; a++) if (col[a][c + 1] & bitv) { right = a; break; }
      if (!left || !right || left == right) continue;
      col[left][c] &= ~bitv; col[left][c + 1] |= bitv;
      col[right][c + 1] &= ~bitv; col[right][c] |= bitv;
      int hit = 0;
      for (int aa = 1; aa <= N && !hit; aa++) {
        int runlen = 0;
        for (int cc = 1; cc <= Wl; cc++) {
          if (col[aa][cc] & target) { runlen++; if (runlen >= 3) { hit = 1; break; } }
          else runlen = 0;
        }
        if (!hit && t >= 3) {
          for (int c2 = 1; c2 <= Wl; c2++) {
            uint32_t m = col[aa][c2];
            if ((m & target) && (m & (target >> 1)) && (m & (target >> 2))) { hit = 1; break; }
          }
        }
      }
      col[left][c] |= bitv; col[left][c + 1] &= ~bitv;
      col[right][c + 1] |= bitv; col[right][c] &= ~bitv;
      if (hit) return 1;
    }
  }
  return 0;
}

// ---------------------------------------------------------------- caches by board
static u64 hashOf(const int32_t *st) {
  u64 h = 1469598103934665603ull;
  int W = st[O_W], N = st[O_N], c, a, i;
#define MIX(v) (h = (h ^ (uint32_t)(v)) * 1099511628211ull)
  MIX(N); MIX(st[O_BAD]); MIX(st[O_BUSYF]);
  for (c = 0; c <= W + 1; c++) { MIX(st[OCC + c]); MIX(st[INERT + c]); MIX(st[GARB + c]); if (st[O_BUSYF]) MIX(st[BUSY + c]); }
  for (a = 1; a <= N; a++) for (c = 0; c <= W + 1; c++) MIX(st[COL + a * WMAX + c]);
  MIX(st[O_NSLAB]);
  for (i = 0; i < st[O_NSLAB]; i++) { for (c = 0; c <= W + 1; c++) MIX(st[SLAB + i * WMAX + c]); MIX(st[LOCK + i]); }
#undef MIX
  return h | 1ull;
}
#define TCAP (1 << 17)
typedef struct { u64 key; double v; } Slot;
typedef struct { Slot s[TCAP]; int n; } Table;
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
static Table SAVES, ANYB, STOPS_T, FIRE, SETTLEIX;

// settled results: an arena for this search, and a store kept across searches
#define MAXPER 54000
#define SCAP 81920
typedef struct { int32_t r[R_INTS]; ST st; } Res;
static Res STORE[SCAP]; static int storeN = 0;
static int failed = 0;
static Res *settleOf(const int32_t *st) {
  u64 k = hashOf(st);
  double v;
  if (tget(&SETTLEIX, k, &v)) return &STORE[(int)v];
  Res *out;
  if (storeN >= SCAP) { failed = 1; return &STORE[0]; }
  out = &STORE[storeN]; tput(&SETTLEIX, k, storeN); storeN++;
  resolve(st, out->r, 1);
  return out;
}

static int canFireOf(const int32_t *st) {
  u64 k = hashOf(st); double v;
  if (tget(&FIRE, k, &v)) return (int)v;
  int f = anyOneSwapClear(st);
  tput(&FIRE, k, f);
  return f;
}
static ST SCR;
static int32_t SWS[2 * 128], RS[R_INTS + ST_INTS];
static int anyBreakOf(const int32_t *st0) {
  u64 k = hashOf(st0); double v;
  if (tget(&SAVES, k, &v)) return v > 0;
  if (tget(&ANYB, k, &v)) return (int)v;
  stcpy(SCR, st0);
  int n = legal(SCR, SWS), any = 0, rest = atRest(SCR);
  for (int i = 0; i < n && !any; i++) {
    if (!swapCanClear(SCR, rest, SWS[2 * i], SWS[2 * i + 1])) continue;
    if (!swapIn(SCR, SWS[2 * i], SWS[2 * i + 1])) continue;
    resolve(SCR, RS, 0);
    swapIn(SCR, SWS[2 * i], SWS[2 * i + 1]);
    if (RS[R_SCOPE] == SC_BROKE) any = 1;
  }
  tput(&ANYB, k, any);
  return any;
}
static int savesOfRaw(const int32_t *st0) {
  u64 k = hashOf(st0); double v;
  if (tget(&SAVES, k, &v)) return (int)v;
  stcpy(SCR, st0);
  int n = legal(SCR, SWS), cnt = 0, rest = atRest(SCR);
  for (int i = 0; i < n; i++) {
    if (!swapCanClear(SCR, rest, SWS[2 * i], SWS[2 * i + 1])) continue;
    if (!swapIn(SCR, SWS[2 * i], SWS[2 * i + 1])) continue;
    resolve(SCR, RS, 0);
    swapIn(SCR, SWS[2 * i], SWS[2 * i + 1]);
    if (RS[R_SCOPE] == SC_BROKE) cnt++;
  }
  tput(&SAVES, k, cnt);
  return cnt;
}
static double PCHAIN[64], PCOMBO[256];
static double priceOf(int chain, int total) {
  if (chain >= 2) return PCHAIN[chain < 63 ? chain : 63];
  return PCOMBO[total < 255 ? total : 255];
}
static ST SCS;
static int32_t SWL[2 * 128], RL[R_INTS + ST_INTS];
static double bestOneSwapStop(const int32_t *st0) {
  stcpy(SCS, st0);
  int n = legal(SCS, SWL), rest = atRest(SCS);
  double best = 0;
  for (int i = 0; i < n; i++) {
    if (!swapCanClear(SCS, rest, SWL[2 * i], SWL[2 * i + 1])) continue;
    if (!swapIn(SCS, SWL[2 * i], SWL[2 * i + 1])) continue;
    resolve(SCS, RL, 0);
    swapIn(SCS, SWL[2 * i], SWL[2 * i + 1]);
    if (!(RL[R_TOTAL] > 0)) continue;
    double pays = priceOf(RL[R_CHAIN], RL[R_TOTAL]);
    if (pays != pays) pays = 0;
    if (pays > best) best = pays;
  }
  return best;
}
static int stopKeyId = 0, hasStopPrice = 0;
static double landStopOf(const int32_t *st) {
  if (!stopKeyId) return bestOneSwapStop(st);
  u64 k = hashOf(st) ^ ((u64)stopKeyId * 0x9e3779b97f4a7c15ull); double v;
  if (tget(&STOPS_T, k, &v)) return v;
  double r = bestOneSwapStop(st);
  tput(&STOPS_T, k, r);
  return r;
}

// ---------------------------------------------------------------- the search
static double FPR, DEADLINE, LOCKP, OVERHEAD, SWAPP, HOLD, WORK, MAXSTOP, READYWORTH, PREPWORTH;
static int SPEND, LEAN, PREPARE, DIG, PRESS, Wd;
static int dropBudget, saveBudget, slabBudget, prepBudget;
static int nAvoid; static int32_t AVOID[2 * 40];
static ST BASEST;

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
static ST SCD;
static int32_t SWD[2 * 128];
static Res RDROP;
static int breakAfterDropOf(const int32_t *st0) {
  if (dropBudget <= 0) return 0;
  dropBudget--;
  stcpy(SCD, st0);
  int n = legal(SCD, SWD), rest = atRest(SCD);
  for (int i = 0; i < n; i++) {
    if (!swapCanClear(SCD, rest, SWD[2 * i], SWD[2 * i + 1])) continue;
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
#define MAXOPT MAXPER
static double ODATA[(MAXOPT + 4) * REC + 64], ODSCR[(MAXOPT + 4) * REC + 64];
static int32_t LANDS[ST_INTS], LANDSCR[ST_INTS];
static double *OD = ODATA;
static int32_t *LD = LANDS;
__attribute__((export_name("bit_odata"))) double *bit_odata(void) { return ODATA; }
__attribute__((export_name("bit_lands"))) int32_t *bit_lands(void) { return LANDS; }
static double PARAM[128];
__attribute__((export_name("bit_param"))) double *bit_param(void) { return PARAM; }
__attribute__((export_name("bit_pchain"))) double *bit_pchain(void) { return PCHAIN; }
__attribute__((export_name("bit_pcombo"))) double *bit_pcombo(void) { return PCOMBO; }

__attribute__((export_name("bit_layout"))) int32_t bit_layout(int32_t i) {
  int32_t v[] = { WMAX, NCOL, MAXSLAB, OCC, INERT, GARB, BUSY, COL, SLAB, LOCK, ST_INTS, R_INTS, REC, MAXD, AIR };
  return v[i];
}
static double *recAt(int i) { return OD + 64 + i * REC; }
static int nNow, nNext;
static int startOpt, nOpt;
static double *newOpt(void) {
  if (startOpt + nOpt >= MAXOPT) { failed = 1; return recAt(MAXOPT - 1); }
  double *o = recAt(4 + startOpt + nOpt);
  nOpt++;
  return o;
}
static Shape START;
static double BASELOW, BASEBUMPS, BASEVOID, BASEGAP;
static int BASEBREAK;
static int BASEDIG, BASESAVE;
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
    Shape sh; shapeOf(settled, &sh);
    o[F_HASSHAPE] = 1; o[F_TALL] = sh.tall; o[F_BUMPS] = sh.bumps; o[F_MAT] = sh.mat; o[F_LOW] = sh.low;
    o[F_SPREAD] = sh.spread; o[F_VOIDROWS] = sh.high - sh.mat; o[F_SLABGAP] = sh.slabRowGap;
    o[F_READY] = LEAN ? -1 : canFireOf(settled);
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
  o[F_BREAKREADY] = settled ? breakReadyOf(settled) : -2;
  o[F_CLOSESBREAK] = BASEBREAK && o[F_BREAKREADY] == 0;
  uint32_t rm[WMAX];
  o[F_DIGGAIN] = (DIG && settled) ? reachOf(settled, rm) - BASEDIG : 0;
  o[F_VOIDGAIN] = o[F_HASSHAPE] ? BASEVOID - o[F_VOIDROWS] : 0;
  o[F_SLABGAIN] = setupWorth(o[F_HASSHAPE] != 0, o[F_SLABGAP], DEADLINE - o[F_DURATION]) - setupWorth(1, BASEGAP, DEADLINE);
  o[F_SLABWORTH] = (PREPARE && prepBudget > 0 && settled && (prepBudget--, slabReadyFast(settled))) ? PREPWORTH : 0;
  o[F_MATNOW] = START.mat;
}

typedef struct { const int32_t *st; int nchain; int32_t chain[2 * MAXD]; int fr, fc, spent, hasReach, dig; uint32_t reach[WMAX]; double lock; } Node;
typedef struct { const int32_t *st; int parent, sr, sc, spent, hasReach, dig; uint32_t reach[WMAX]; double lock; } Born;
#define MAXFRONT 48
#define MAXBORN 4096
static Node FRONT[MAXFRONT], FRONT2[MAXFRONT];
static Born BORN[MAXBORN];
static int ORD[MAXBORN], ORD2[MAXBORN];
static int32_t SWE[2 * 128];
static ST WORK_ST[MAXFRONT];
// flat, save, ready, trigger: records 0..3
static int haveRec[4];
static void takeRec(int which, const int32_t *seq, int nseq, int frames, double value, double dur) {
  double *o = recAt(which);
  haveRec[which] = 1;
  o[F_FRAMES] = frames; o[F_VALUE] = value; o[F_DURATION] = dur; o[F_NSW] = nseq;
  for (int i = 0; i < 2 * nseq; i++) o[F_SW + i] = seq[i];
}
static void sortBorn(int n) {
  for (int i = 0; i < n; i++) ORD[i] = i;
  for (int i = 1; i < n; i++) {
    int x = ORD[i], j = i - 1;
    while (j >= 0 && BORN[ORD[j]].spent > BORN[x].spent) { ORD[j + 1] = ORD[j]; j--; }
    ORD[j + 1] = x;
  }
}

static void expandAll(int depth, int cr, int cc) {
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
    for (int fi = 0; fi < nf; fi++) {
      Node *node = &FRONT[fi];
      int32_t *state = WORK_ST[fi];
      stcpy(state, node->st);
      int nl = legal(state, SWE);
      uint32_t reach[WMAX]; int haveReach = node->hasReach;
      if (haveReach) for (int c = 0; c < WMAX; c++) reach[c] = node->reach[c];
      if (!haveReach && node->nchain) { reachOf(state, reach); haveReach = 1; }
      for (int k = 0; k < nl; k++) {
        int sr = SWE[2 * k], sc = SWE[2 * k + 1];
        if (haveReach && !SPEND) {
          uint32_t rb = 1u << (sr - 1);
          if (!((reach[sc] | reach[sc + 1]) & rb)) continue;
        }
        if (!swapIn(state, sr, sc)) continue;
        Res *res = settleOf(state);
        swapIn(state, sr, sc);
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
            fillOption(o, seq, nseq, cost, res->r, settled);
            extras(o, settled);
            o[F_BREAKS] = broke;
            nNext++;
          }
          continue;
        }
        if (!settled) continue;
        uint32_t rr[WMAX]; int rrDig = 0, haveRR = 0;
        if (DIG) { rrDig = reachOf(settled, rr); haveRR = 1; }
        int svNow = 0;
        if (!LEAN) {
          Shape sh2; shapeOf(settled, &sh2);
          double dur = cost + nseq * OVERHEAD;
          uint32_t wm[WMAX]; reachMask(settled, wm);
          int ways2 = 0; for (int c = 1; c <= Wd; c++) ways2 += popc(wm[c]);
          double base2 = (BASE.tall - sh2.tall) * FPR + (BASE.excess - sh2.excess) * FPR
                       - (WORK - sh2.mat > 0 ? WORK - sh2.mat : 0) * FPR - dur;
          double landStop = 0;
          if (hasStopPrice && (!haveRec[0] || base2 + MAXSTOP > fv)) landStop = landStopOf(settled);
          double val = base2 + landStop;
          if (DIG && haveRR) {
            int sv = 0;
            if (rrDig > 0) { if (saveBudget > 0) { saveBudget--; sv = savesOfRaw(settled); } }
            svNow = sv;
            val += (sv - BASESAVE) * (DEADLINE / Wd) * Wd + (rrDig - BASEDIG) * (DEADLINE / Wd);
          }
          double credit = 0, floor2 = haveRec[0] ? fv : -1.0 / 0.0;
          if (slabBudget > 0 && val + PREPWORTH > floor2) {
            slabBudget--;
            if (slabReadyFast(settled)) credit = PREPWORTH;
          }
          if (!credit && val + READYWORTH > floor2 && canFireOf(settled)) credit = READYWORTH;
          val += credit;
          int take = !haveRec[0] || val > fv;
          double *sv0 = recAt(1), *rd0 = recAt(2), *tg0 = recAt(3);
          if (svNow > 0 && (!haveRec[1] || val > sv0[F_VALUE] || (val == sv0[F_VALUE] && cost < sv0[F_FRAMES])))
            takeRec(1, seq, nseq, cost, val, cost + nseq * OVERHEAD);
          if ((!haveRec[2] || val > rd0[F_VALUE] || (val == rd0[F_VALUE] && cost < rd0[F_FRAMES])) && canFireOf(settled))
            takeRec(2, seq, nseq, cost, val, cost + nseq * OVERHEAD);
          if ((!haveRec[3] || val > tg0[F_VALUE] || (val == tg0[F_VALUE] && cost < tg0[F_FRAMES])) && slabReadyFast(settled))
            takeRec(3, seq, nseq, cost, val, cost + nseq * OVERHEAD);
          if (take) {
            takeRec(0, seq, nseq, cost, val, dur);
            double *fl = recAt(0);
            fl[F_TALL] = sh2.tall; fl[F_BUMPS] = sh2.bumps; fl[F_WAYS] = ways2;
            fv = val;
            stcpy(LD, settled);
          }
        }
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
      for (int i = 1; i < ns; i++) {
        int x = ORD2[i], j = i - 1;
        while (j >= 0) {
          Born *p = &BORN[ORD2[j]], *q = &BORN[x];
          int cmp = (q->dig - p->dig) ? (q->dig - p->dig) : (p->spent - q->spent);
          if (cmp > 0) { ORD2[j + 1] = ORD2[j]; j--; } else break;
        }
        ORD2[j + 1] = x;
      }
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

static int32_t SW1[2 * 128];
static ST ST1;
static Res R1;
// The whole search. Returns 0, or -1 when a fixed size was exceeded (a bug).
static int optionsRun(const int32_t *st0, const double *P, const int32_t *first, int nfirst) {
  failed = 0;
  if (storeN > SCAP - MAXPER) { storeN = 0; for (int i = 0; i < TCAP; i++) SETTLEIX.s[i].key = 0; SETTLEIX.n = 0; }
  FPR = P[0]; DEADLINE = P[1]; LOCKP = P[2]; SPEND = (int)P[3]; LEAN = (int)P[4];
  PREPARE = (int)P[5]; HOLD = P[6]; WORK = P[7]; OVERHEAD = P[8]; SWAPP = P[9];
  DIG = (int)P[10]; int depth = (int)P[11], cr = (int)P[12], cc = (int)P[13];
  PRESS = (int)P[14]; hasStopPrice = (int)P[15]; stopKeyId = (int)P[16]; MAXSTOP = P[17];
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
  for (int i = 0; i < ns; i++) {
    int sr = SW1[2 * i], sc = SW1[2 * i + 1];
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
  double *fl = recAt(0);
  if (haveRec[0] && !(fl[F_VALUE] > 0)) haveRec[0] = 0;
  OD[0] = failed ? -1 : 0; OD[1] = nNow; OD[2] = nNext; OD[3] = refused; OD[4] = unknown;
  OD[5] = ns; OD[6] = LEAN ? -1 : BASEBREAK;
  for (int i = 0; i < 4; i++) OD[7 + i] = haveRec[i];
  OD[11] = (hasStopPrice && haveRec[0]) ? landStopOf(LD) : 0;
  return failed ? -1 : 0;
}

__attribute__((export_name("bit_options"))) int32_t bit_options(void) {
  OD = ODATA; LD = LANDS;
  return optionsRun(IN, PARAM, LIST, PARAM[100] > 0 ? (int)PARAM[100] : 0);
}

#include "bot.c"
