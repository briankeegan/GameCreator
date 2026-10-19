// THE DECISION REPLAYED (test/main.c asks it, built with GB_TEST): a question Gambit met in a game, its board and the garbage on its way
// (gb_question_bytes), answered as a new game with the mode's rules. Its time is a game's (REPLAY_MS, shared out among the searches and
// the judging as a game's is), read off the work done -- `work` engine frames to the whole decision, never the wall clock, so the same
// board gives the same answer every time. Its record: the move, the play, and the first three of the one order with the keys they were
// ranked by.
#define REPLAY_MS 150   // a decision's time, as the frame loop gives one
static int64_t replayWork;
static double replayNow(void) { return (double)clockWork * REPLAY_MS / (double)replayWork; }
EXPORT(gb_replay) int gb_replay(int nbytes, int narr, int mode, int64_t work, char *out, int cap) {
  if (gb_question_bytes(nbytes, narr) != 0) return -1;
  gb_new_game();
  modeRule = mode;
  curQid = abortId + 1;
  replayWork = work; clockNowOf = replayNow; clockFrameOut = 0; clockWork = 0;
  int topped = fullTop(hostBoard) >= hostBoard->height;
  answerQuestion(1, 0, topped, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, REPLAY_MS, 0, 0);
  clockNowOf = 0;
  const Answer *A = &theAnswer;
  int k = snprintf(out, (unsigned long)cap, "move %d %d,%d play %d live %d/%d |", A->d.kind, A->d.move ? CR(A->d.move) : 0, A->d.move ? CC(A->d.move) : 0,
                   A->play, A->nlive, A->ncands);
  // (the chain the board makes left alone and the one it makes with the line played, where the board is making one)
  if (aloneChain > 1) k += snprintf(out + k, (unsigned long)(cap - k), " own %d/%d", aloneChain, A->whole >= 0 ? A->whole : aloneChain);
  for (int i = 0; i < 3 && i < A->ncands && k < cap - 160; i++) {
    const Judge *J = order[i];
    k += snprintf(out + k, (unsigned long)(cap - k), " %d:%d,%d,%d,%d,%d,%d,%d,t%d", J->hold ? PLAY_HOLD : J->k.play, J->o.lives, J->o.lostAt, J->outside,
                  J->met, J->material, J->saving, J->o.lifeLeft, tierView(J).tier);
  }
  return k;
}
// SWITCHING'S DIRECTIONS (answer.c gb_switch_game): over `games` games of `frames` frames each, how often each ordered pair of the
// attack rules is switched between -- into counts (n x n, by the rules' order), the pairs never switched between returned
EXPORT(gb_switch_check) int gb_switch_check(int games, int frames, int min, int max, int32_t *counts, int *nrules) {
  int32_t idx[MAXRULES], nr = 0;
  for (int i = 0; i < theTables.n && nr < MAXRULES; i++) if (theTables.r[i].table == 1) idx[nr++] = theTables.r[i].name;
  *nrules = nr;
  for (int i = 0; i < nr * nr; i++) counts[i] = 0;
  gb_switch(min, max);
  for (int g = 0; g < games; g++) {
    gb_switch_game((uint32_t)(g * 7919 + 1));
    for (int k = 1; k < nswitch && switchAt[k] < frames; k++) {
      int a = -1, b = -1;
      for (int i = 0; i < nr; i++) { if (idx[i] == switchMode[k - 1]) a = i; if (idx[i] == switchMode[k]) b = i; }
      if (a >= 0 && b >= 0) counts[a * nr + b]++;
    }
  }
  gb_switch(0, 0); nswitch = 0;
  int missing = 0;
  for (int a = 0; a < nr; a++) for (int b = 0; b < nr; b++) if (a != b && !counts[a * nr + b]) missing++;
  return missing;
}
