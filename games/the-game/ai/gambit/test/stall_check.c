// THE STALL (gb_stall_check): garbage lands and the stack rises only on a frame the board is idle -- a swap in progress holds both
// (pa.c shouldDropGarbage, updateRiseLock). Measured on the engine: the question's board with fifty 4x1 queued, a harmless pair (two
// coloured panels of different colours, no three made either way) swapped every `gap` frames for `frames` frames. Into out: blocks
// landed, rows risen, clears made, the frame lost (0 alive), the highest top row reached. Returns 0, or -1 with no harmless pair.
static int stallThreeAt(Board *b, int r, int c) {
  // (a three the pair at (r, c) makes once swapped: in the row through either cell, or the column of either)
  int32_t col[W + 2];
  for (int k = 1; k <= W; k++) col[k] = P(b, r, k)->f[ISGARBAGE] ? 0 : P(b, r, k)->f[COLOR];
  int32_t t = col[c]; col[c] = col[c + 1]; col[c + 1] = t;
  for (int k = 1; k + 2 <= W; k++) if (col[k] && col[k] == col[k + 1] && col[k] == col[k + 2]) return 1;
  for (int k = c; k <= c + 1; k++) {
    int32_t v = col[k], n = 1;
    for (int rr = r - 1; rr >= 1 && !P(b, rr, k)->f[ISGARBAGE] && P(b, rr, k)->f[COLOR] == v; rr--) n++;
    for (int rr = r + 1; rr <= b->height && !P(b, rr, k)->f[ISGARBAGE] && P(b, rr, k)->f[COLOR] == v; rr++) n++;
    if (v && n >= 3) return 1;
  }
  return 0;
}
EXPORT(gb_stall_check) int gb_stall_check(int gap, int frames, int32_t *out) {
  Board *b = nb_new();
  if (!b || !hostQ.b) return -2;
  cloneBoard(b, hostQ.b);
  b->ninc = 0;
  for (int i = 0; i < 50; i++) nb_push_incoming(b, 4, 1, 0, 0);
  int pr = 0, pc = 0;
  for (int r = 1; r <= b->height && !pr; r++)
    for (int c = 1; c < W && !pr; c++) {
      Panel *a = P(b, r, c), *d = P(b, r, c + 1);
      if (a->f[ISGARBAGE] || d->f[ISGARBAGE] || !a->f[COLOR] || !d->f[COLOR] || a->f[COLOR] == d->f[COLOR]) continue;
      if (a->f[STATE] != NORMAL || d->f[STATE] != NORMAL) continue;
      if (stallThreeAt(b, r, c)) continue;
      pr = r; pc = c;
    }
  if (!pr) { nb_free(b); return -1; }
  b->curRow = pr; b->curCol = pc;
  int32_t panels0 = panelsOn(b), inc0 = b->ninc, clears = 0, top = 0, lost = 0;
  for (int f = 0; f < frames; f++) {
    b->input = 0; b->pressSwap = gap > 0 && f % gap == 0;
    run(b);
    if (b->err) { nb_free(b); return -3; }
    for (int r = 1; r <= b->height; r++) for (int c = 1; c <= W; c++) if (P(b, r, c)->f[STATE] == MATCHED && P(b, r, c)->f[STATECHANGED]) clears++;
    if (TOP(b) > top) top = TOP(b);
    if (b->gameOverClock > 0) { lost = f + 1; break; }
  }
  out[0] = inc0 - b->ninc; out[1] = (panelsOn(b) - panels0 - 4 * out[0]) / W; out[2] = clears; out[3] = lost; out[4] = top;
  nb_free(b);
  return 0;
}
