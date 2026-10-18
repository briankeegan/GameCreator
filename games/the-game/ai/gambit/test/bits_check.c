// THE BITS HELD TO THE CELLS (test/bits_test.c asks it, built with GB_TEST): on the question's board and on every board one swap and two
// swaps from it, each reader on the bits and its cell-by-cell reference (test/cells_ref.c) asked alike; the boards checked and the
// disagreements, counted.
static int32_t bitsBoards, bitsWrong;
static int bitsAgreeOn(const Board *b) {
  static Bits B;
  bitsOf(b, &B);
  int wrong = 0, top = gridLen(b) - 2;
  if (bitsLowestG(&B) != refLowestG(b)) wrong++;
  if (unevenOf(&B) != refUneven(b)) wrong++;
  if (bitsPanels(&B) != refPanelsOn(b)) wrong++;
  if ((bitsLowestG(&B) <= B.rows) != refGarbageOn(b)) wrong++;
  int32_t s1[MAXPATH], s2[MAXPATH]; int n1 = 0, n2 = 0;
  int d1 = nearLineOf(&B, s1, &n1), d2 = refBreakNearLine(b, s2, &n2);
  if (d1 != d2 || n1 != n2) wrong++;
  else for (int i = 0; i < n1; i++) if (s1[i] != s2[i]) { wrong++; break; }
  for (int q = 1; q <= top; q++) for (int k = 1; k <= W; k++) for (int32_t want = 1; want <= 8; want++)
    for (unsigned used = 0; used < (1u << W); used += 7) {
      int ref[W + 2] = { 0 };
      for (int c = 1; c <= W; c++) ref[c] = used >> (c - 1) & 1;
      int f1 = -9, f2 = -9, a = bitsBring(&B, q, k, want, (used << 1) & ALLCOLS, &f1), z = refBring(b, top, q, k, want, ref, &f2);
      if (a != z || (a >= 0 && f1 != f2)) wrong++;
    }
  bitsBoards++; bitsWrong += wrong;
  return wrong;
}
static Ctx *bitsCtx;
EXPORT(gb_bits_agree) int gb_bits_agree(void) {
  if (!hostBoard) return -1;
  curQid = abortId + 1; clockAborted = 0;   // (a question being answered: the searches' steps are not cut)
  bitsAgreeOn(hostBoard);
  Ctx *x = bitsCtx = ctxOf(bitsCtx);
  int root = rootOf(x, &hostQ);
  if (root < 0) return bitsWrong;
  static int32_t ms[MAXROWS * W], ms2[MAXROWS * W];
  int nm = swapsOfNode(x, root, ms);
  for (int i = 0; i < nm; i++) {
    int o = step(x, root, MK_SETTLE, CR(ms[i]), CC(ms[i]), 0);
    if (!liveNode(x, o)) continue;
    const Board *b = ensureBoard(x, o);
    if (b) bitsAgreeOn(b);
    if (i % 8) continue;
    int nm2 = swapsOfNode(x, o, ms2);
    for (int j = 0; j < nm2; j += 3) {
      int o2 = step(x, o, MK_SETTLE, CR(ms2[j]), CC(ms2[j]), 0);
      if (liveNode(x, o2)) { const Board *b2 = ensureBoard(x, o2); if (b2) bitsAgreeOn(b2); }
    }
  }
  return bitsWrong;
}
EXPORT(gb_bits_boards) int gb_bits_boards(void) { return bitsBoards; }
