// bitmatch.js's resolveFromMasks (untimed) and the one-swap scans built on it,
// in C. Same arithmetic, same order. bitnative.js marshals a state in and out;
// bitnative.test.js holds every answer to the JS one.
//
// A state is ST_INTS int32s:
//   0 W  1 H  2 N  3 nslab  4 hasBusy  5 bad
//   OCC..  occ[8]   INERT.. inert[8]   GARB.. garb[8]   BUSY.. busy[8]
//   COL..  colour[13][8]
//   SLAB.. slab[MAXSLAB][8]   LOCK.. locked[MAXSLAB]   AIR.. air[MAXSLAB]
#include "libc.h"

#define WMAX 8
#define NCOL 13
#define MAXSLAB 64
enum { O_W = 0, O_H, O_N, O_NSLAB, O_BUSYF, O_BAD,
       OCC = 8, INERT = 16, GARB = 24, BUSY = 32, COL = 40,
       SLAB = COL + NCOL * WMAX, LOCK = SLAB + MAXSLAB * WMAX, AIR = LOCK + MAXSLAB,
       ST_INTS = AIR + MAXSLAB };
// A result: R_INTS int32s, then (when settled is asked for) a state.
enum { R_SCOPE = 0, R_CHAIN, R_TOTAL, R_ROUNDS, R_FRAMES, R_GARBAGE, R_CONVERTS, R_VOID, R_INTS = 8 };
enum { SC_OK = 0, SC_BROKE = 1, SC_BAD = 2 };

static int32_t IN[ST_INTS], OUT[R_INTS + ST_INTS], LIST[3 * 128];
__attribute__((export_name("bit_in"))) int32_t *bit_in(void) { return IN; }
__attribute__((export_name("bit_out"))) int32_t *bit_out(void) { return OUT; }
__attribute__((export_name("bit_list"))) int32_t *bit_list(void) { return LIST; }

static inline int popc(uint32_t x) { return __builtin_popcount(x); }

// ------------------------------------------------------------ the resolver
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
      uint32_t seed = seeds & (0u - seeds), run = seed, probe = seed;
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
        uint32_t lowBit = v & (0u - v);
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
  for (int c = 1; c <= s->W; c++) {
    uint32_t v = m[c];
    if (v) { int b = 32 - __builtin_clz(v & (0u - v)); if (b < lo) lo = b; }
  }
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
// The whole connected group, block to block; any: some slab is in it.
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

static void load(R *s, int32_t *st) {
  s->W = st[O_W]; s->H = st[O_H]; s->N = st[O_N]; s->nslab = st[O_NSLAB];
  for (int c = 0; c < WMAX; c++) {
    s->occ[c] = st[OCC + c]; s->inert[c] = st[INERT + c]; s->garb[c] = st[GARB + c];
    s->chaining[c] = 0; s->popping[c] = 0;
    for (int a = 0; a < NCOL; a++) s->colour[a][c] = st[COL + a * WMAX + c];
  }
  for (int i = 0; i < s->nslab; i++) {
    for (int c = 0; c < WMAX; c++) s->slab[i][c] = st[SLAB + i * WMAX + c];
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

// resolveFromMasks(st, wantSettled) with no clock. r: R_INTS ints; settled after them.
static void resolve(int32_t *st, int32_t *r, int wantSettled) {
  for (int i = 0; i < R_INTS; i++) r[i] = 0;
  if (st[O_BAD]) { r[R_SCOPE] = SC_BAD; return; }
  R *s = &S;
  load(s, st);
  int W = s->W, H = s->H, N = s->N;
  int counter = 0, rounds = 0, total = 0, guard = 0, LIMIT = W * H * H, T = 0, moved = 0;
  uint32_t B[NCOL][WMAX], k[WMAX];
  int32_t inGroup[MAXSLAB];
  while (guard++ <= LIMIT) {
    restingOf(s);
    int any = 0, link = 0, c, a;
    uint32_t freeM[WMAX];
    for (c = 1; c <= W; c++) freeM[c] = s->rest[c] & ~s->popping[c] & ~s->inert[c];
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
      int haveGroup = broke && s->nslab;
      if (haveGroup) {
        int gany = connectedGroup(s, k, T + (moved ? 2 : 1), inGroup);
        if (!gany) broke = 0;
      }
      if (broke) {
        int touched = 0, converts = 0, convCol[WMAX] = {0};
        for (int sl = 0; sl < s->nslab; sl++) {
          if (!(haveGroup && inGroup[sl])) continue;
          uint32_t *sm = s->slab[sl];
          for (c = 1; c <= W; c++) touched += popc(sm[c]);
          int low = 32;
          for (c = 1; c <= W; c++) {
            uint32_t lm = sm[c];
            if (!lm) continue;
            int lb = 32 - __builtin_clz(lm & (0u - lm));
            if (lb < low) low = lb;
          }
          if (low < 32) {
            uint32_t lowBit = 1u << (low - 1);
            for (c = 1; c <= W; c++) if (sm[c] & lowBit) { converts++; convCol[c] = 1; }
          }
        }
        int hMax = 0, hs[WMAX], vAfter = 0;
        for (c = 1; c <= W; c++) {
          uint32_t gc = s->garb[c], fl = gc ? (gc & (0u - gc)) : 0;
          uint32_t under = s->occ[c] & ~gc & ~s->popping[c] & (fl ? fl - 1u : 0xffffffffu);
          hs[c] = popc(under) + convCol[c];
          if (convCol[c] && hs[c] > hMax) hMax = hs[c];
        }
        for (c = 1; c <= W; c++) if (convCol[c]) vAfter += hMax - hs[c];
        r[R_SCOPE] = SC_BROKE; r[R_CHAIN] = counter > 1 ? counter : 1; r[R_TOTAL] = total;
        r[R_ROUNDS] = rounds; r[R_FRAMES] = T; r[R_GARBAGE] = touched; r[R_CONVERTS] = converts; r[R_VOID] = vAfter;
        return;
      }
      continue;
    }
    // fall one row
    int fell = 0;
    for (c = 1; c <= W; c++) {
      uint32_t o2 = s->occ[c], fixed = (s->inert[c] | s->popping[c]) & o2;
      uint32_t holds2 = o2 & (((~o2) & (o2 + 1u)) - 1u), seeds2 = fixed & ~holds2;
      while (seeds2) {
        uint32_t sd = seeds2 & (0u - seeds2), x2 = o2 & ~(sd - 1u), run2 = x2 & ~(x2 + sd);
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
      T++;
      for (int sk = 0; sk < s->nslab; sk++) if (s->falling[sk]) s->air[sk] = T + 2;
      moved = 1; continue;
    }
    moved = 0;
    int swept = 0;
    for (c = 1; c <= W; c++) {
      if (!s->popping[c]) continue;
      swept = 1;
      uint32_t lowest = s->popping[c] & (0u - s->popping[c]);
      uint32_t keep = s->occ[c] & ~s->popping[c];
      s->chaining[c] = (s->chaining[c] | (keep & ~(lowest - 1u))) & keep;
      for (a = 1; a <= N; a++) s->colour[a][c] &= keep;
      s->inert[c] &= keep;
      s->occ[c] = keep;
      s->popping[c] = 0;
    }
    if (swept) continue;
    break;
  }
  r[R_SCOPE] = SC_OK; r[R_CHAIN] = rounds ? (counter > 1 ? counter : 1) : 0; r[R_TOTAL] = total;
  r[R_ROUNDS] = rounds; r[R_FRAMES] = T;
  if (wantSettled) save(s, r + R_INTS);
}

__attribute__((export_name("bit_resolve"))) void bit_resolve(int32_t wantSettled) { resolve(IN, OUT, wantSettled); }

// ------------------------------------------------------------ swaps and scans
static int colourAt(int32_t *st, int c, uint32_t b) {
  int at = 0;
  for (int a = 1; a <= st[O_N]; a++) if ((uint32_t)st[COL + a * WMAX + c] & b) at = a;
  return at;
}
static int swapIn(int32_t *st, int r, int c) {
  uint32_t b = 1u << (r - 1);
  int o = c + 1;
  if (((uint32_t)st[INERT + c] & b) || ((uint32_t)st[INERT + o] & b)) return 0;
  if (st[O_BUSYF] && (((uint32_t)st[BUSY + c] | (uint32_t)st[BUSY + o]) & b)) return 0;
  int left = 0, right = 0;
  for (int a = 1; a <= st[O_N]; a++) {
    if ((uint32_t)st[COL + a * WMAX + c] & b) left = a;
    if ((uint32_t)st[COL + a * WMAX + o] & b) right = a;
  }
  if (left) { st[COL + left * WMAX + c] &= ~b; st[COL + left * WMAX + o] |= b; }
  if (right) { st[COL + right * WMAX + o] &= ~b; st[COL + right * WMAX + c] |= b; }
  if (left) st[OCC + o] |= b; else st[OCC + o] &= ~b;
  if (right) st[OCC + c] |= b; else st[OCC + c] &= ~b;
  return 1;
}
// legalSwapsOf: into LIST as (r, c) pairs; returns the count.
static int legal(int32_t *st, int32_t *out) {
  int n = 0;
  for (int r = 1; r <= st[O_H]; r++) {
    uint32_t b = 1u << (r - 1);
    for (int c = 1; c < st[O_W]; c++) {
      if (((uint32_t)st[INERT + c] & b) || ((uint32_t)st[INERT + c + 1] & b)) continue;
      if (st[O_BUSYF] && (((uint32_t)st[BUSY + c] | (uint32_t)st[BUSY + c + 1]) & b)) continue;
      if (!(((uint32_t)st[OCC + c] | (uint32_t)st[OCC + c + 1]) & b)) continue;
      if (colourAt(st, c, b) == colourAt(st, c + 1, b)) continue;
      out[2 * n] = r; out[2 * n + 1] = c; n++;
    }
  }
  return n;
}
__attribute__((export_name("bit_legal"))) int32_t bit_legal(void) { return legal(IN, LIST); }

static int32_t SW[2 * 128], RR[R_INTS + ST_INTS];
// Every legal swap, resolved without settling: LIST gets (chain, total, scope) per
// swap in order, -1 scope where swapMasks refused. Returns the count.
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
