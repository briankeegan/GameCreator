// THE BOARD AS BITS (bitsOf): one reading of a settled board, which every reader of one asks -- the nearest break (break.c breakNear,
// breakBuildable), the panel a match is one short of (fill.c), a perched block (break.c perchedDrops), the panel and garbage counts. A
// row is a mask of columns (bit c, 1..W): its panels, its garbage, the cells that hold a panel up, and a mask a colour the board shows.
// Read off the board the engine makes (gridCell), never a second engine.

#define ALLCOLS ((unsigned)((1u << (W + 1)) - 2u))   // bits 1..W
#define BITCOLOURS 30                                 // the colours a board shows (an unseen one, pa.c UNSEEN_COLOUR, is 30 and up)
typedef struct {
  int32_t top, rows;                                  // top: the rows a break is looked for in (1..height); rows: every row read
  uint8_t pan[MAXROWS + 2], gar[MAXROWS + 2], held[MAXROWS + 2];
  uint8_t col[BITCOLOURS][MAXROWS + 2];
  int32_t code[MAXROWS + 2][W + 2];                   // each cell as gridCell reads it (0 empty, < 0 garbage, a colour)
  int32_t gid[MAXROWS + 2][W + 2];                    // a garbage cell's block (GARBAGEID)
} Bits;
static void bitsOf(const Board *b, Bits *B) {
  B->top = b->height; B->rows = b->height + 1;
  memset(B->pan, 0, sizeof B->pan); memset(B->gar, 0, sizeof B->gar); memset(B->held, 0, sizeof B->held); memset(B->col, 0, sizeof B->col);
  for (int r = 0; r <= B->rows + 1 && r < MAXROWS + 2; r++) for (int c = 0; c <= W + 1; c++) { B->code[r][c] = 0; B->gid[r][c] = 0; }
  for (int r = 1; r <= B->rows; r++) for (int c = 1; c <= W; c++) {
    int32_t v = r < b->nrows ? gridCell(b, r, c) : 0;
    B->code[r][c] = v;
    if (v > 0) { B->pan[r] |= (uint8_t)(1u << c); if (v < BITCOLOURS) B->col[v][r] |= (uint8_t)(1u << c); }
    else if (v < 0) { B->gar[r] |= (uint8_t)(1u << c); B->gid[r][c] = b->p[r][c].f[GARBAGEID]; }
  }
  // (a cell holds a panel up: not garbage, and on the floor or on something)
  for (int r = 1; r <= B->top; r++) B->held[r] = (uint8_t)(~B->gar[r] & (r == 1 ? ALLCOLS : (B->pan[r - 1] | B->gar[r - 1])) & ALLCOLS);
}
static int bitCount(unsigned v) { int n = 0; for (; v; v &= v - 1) n++; return n; }
static int lowBit(unsigned v) { int i = 0; if (!v) return 0; while (!(v >> i & 1)) i++; return i; }
static int highBit(unsigned v) { int i = 31; if (!v) return 0; while (!(v >> i & 1)) i--; return i; }
// a row's panels of colour `want` (a colour not shown matches only itself)
static unsigned bitsColour(const Bits *B, int q, int32_t want) {
  if (q < 1 || q > B->top) return 0;
  if (want > 0 && want < BITCOLOURS) return B->col[want][q];
  unsigned m = 0;
  for (int c = 1; c <= W; c++) if (B->code[q][c] == want) m |= 1u << c;
  return m;
}
static int32_t bitsCellIn(const Bits *B, int q, int k) { return q >= 1 && q <= B->top && k >= 1 && k <= W ? B->code[q][k] : 0; }
// THE SWAPS THAT BRING A PANEL OF COLOUR want IN ROW q TO COLUMN k, from no column in `used`: the nearest one along the row over cells that
// hold it up (the first cell that does not hold one is the last reached); 0 when one is there already, -1 for none. *from: where it is.
static int bitsBring(const Bits *B, int q, int k, int32_t want, unsigned used, int *from) {
  unsigned w = bitsColour(B, q, want) & ~used & ALLCOLS;
  if (w >> k & 1) { *from = k; return 0; }
  unsigned held = q >= 1 && q <= B->top ? B->held[q] : ALLCOLS;
  if (!(held >> k & 1)) return -1;
  int best = -1;
  // (leftward first, so of two as near the left one is taken: the columns below k, down to the first that does not hold a panel)
  unsigned below = ALLCOLS & ((1u << k) - 1u), stopL = below & ~held, reachL = stopL ? below & ~((1u << highBit(stopL)) - 1u) : below;
  if (w & reachL) { int j = highBit(w & reachL); best = k - j; *from = j; }
  // (rightward: the columns above k, up to the first that does not hold one)
  unsigned above = ALLCOLS & ~((2u << k) - 1u), stopR = above & ~held, reachR = stopR ? above & ((2u << lowBit(stopR)) - 1u) : above;
  if (w & reachR) { int j = lowBit(w & reachR); if (best < 0 || j - k < best) { best = j - k; *from = j; } }
  return best;
}
// the panels on the board, garbage not counted -- the material every break is made from
static int32_t bitsPanels(const Bits *B) { int32_t n = 0; for (int r = 1; r <= B->rows; r++) n += bitCount(B->pan[r]); return n; }
// the lowest row with garbage (rows + 1 when none)
static int bitsLowestG(const Bits *B) { for (int r = 1; r <= B->rows; r++) if (B->gar[r]) return r; return B->rows + 1; }
// the panels a break can begin from: those beside garbage, above, below or to a side
static unsigned bitsStarts(const Bits *B, int r) {
  unsigned g = B->gar[r], up = r + 1 <= B->top ? B->gar[r + 1] : 0, dn = r - 1 >= 1 ? B->gar[r - 1] : 0;
  return B->pan[r] & (up | dn | ((g << 1) & ALLCOLS) | (g >> 1)) & ALLCOLS;
}
