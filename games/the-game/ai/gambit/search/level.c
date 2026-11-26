// LEVEL: of the swaps that clear nothing and are settled by `by` (the next block lands), the one that leaves the least
// hollow under the garbage, then the flattest stack -- only one better than the board left alone, through the shared line check.
// The swap, or 0 for none.
static Ctx *levelCtx;
static int32_t level(const Question *q, int32_t by) {
  Ctx *x = levelCtx = ctxOf(levelCtx);
  int root = rootOf(x, q);
  if (root < 0) return 0;
  int r0 = settleOf(x, root);
  if (!liveNode(x, r0)) return 0;
  Shape before = shapeOf(ensureBoard(x, r0)), bestS;
  int32_t best = 0, ms[MAXROWS * W];
  int nm = swapsOfNode(x, root, ms);
  static int outs[MAXROWS * W];
  for (int i = 0; i < nm; i++) outs[i] = step(x, root, MK_SETTLE, CR(ms[i]), CC(ms[i]), 0);
  for (int i = 0; i < nm; i++) {
    int out = outs[i];
    if (!liveNode(x, out)) continue;
    Stats st; statsOf(x, out, &st);
    if (st.cleared > 0 || (by != NOT_ASKED && by && NODE(x, out)->t > by) || !firstOk(CR(ms[i]), CC(ms[i]), 0)) continue;
    Shape sh = shapeOf(ensureBoard(x, out));
    if (sh.hollow > before.hollow || (sh.hollow == before.hollow && sh.even >= before.even)) continue;
    if ((!best || sh.hollow < bestS.hollow || (sh.hollow == bestS.hollow && sh.even < bestS.even)) && lineFits(&ms[i], 1, 1)) { best = ms[i]; bestS = sh; }
  }
  return best;
}
// LEVEL BY A WALK (the opener's flattening, decide.c opTarget): with no single swap leaving the stack flatter (level), a panel walked two
// cells along its row -- the second swap pressed where the first left it once it rests, as the opener presses its line -- that clears nothing, is settled by `by`, and leaves the
// least hollow, then the flattest stack, better than the board left alone: a staircase of towers, which no one swap brings down, comes
// down a panel at a time. Both swaps into sw; 2, or 0 for none.
static int levelWalk(const Question *q, int32_t by, int32_t *sw) {
  Ctx *x = levelCtx = ctxOf(levelCtx);
  int root = rootOf(x, q);
  if (root < 0) return 0;
  int r0 = settleOf(x, root);
  if (!liveNode(x, r0)) return 0;
  Shape before = shapeOf(ensureBoard(x, r0)), bestS;
  int found = 0;
  int32_t ms[MAXROWS * W];
  int nm = swapsOfNode(x, root, ms);
  for (int i = 0; i < nm && !clockOut(); i++) {
    int r = CR(ms[i]), c = CC(ms[i]);
    int a = step(x, root, MK_SETTLE, r, c, 0);
    if (!liveNode(x, a)) continue;
    // (the left panel carried on right, from c + 1; the right one carried on left, from c - 1)
    for (int d = -1; d <= 1; d += 2) {
      int c2 = c + d;
      if (c2 < 1 || c2 >= W) continue;
      int out = step(x, a, MK_SETTLE, r, c2, 0);
      if (!liveNode(x, out)) continue;
      Stats st; statsOf(x, out, &st);
      if (st.cleared > 0 || (by != NOT_ASKED && by && NODE(x, out)->t > by) || !firstOk(r, c, 0)) continue;
      Shape sh = shapeOf(ensureBoard(x, out));
      if (sh.hollow > before.hollow || (sh.hollow == before.hollow && sh.even >= before.even)) continue;
      int32_t seq[2] = { r * 8 + c, r * 8 + c2 };
      if ((!found || sh.hollow < bestS.hollow || (sh.hollow == bestS.hollow && sh.even < bestS.even)) && lineFits(seq, 2, 1)) { sw[0] = seq[0]; sw[1] = seq[1]; bestS = sh; found = 1; }
    }
  }
  return found ? 2 : 0;
}
