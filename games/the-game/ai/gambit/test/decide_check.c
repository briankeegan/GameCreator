// THE DECISION REPLAYED (test/main.c asks it, built with GB_TEST): a question Gambit met in a game, its board and the garbage on its way
// (gb_question_bytes), answered as a new game with the mode's rules -- each decision cut by work, never the wall clock, so the same
// board gives the same answer every time. Its record: the move, the play, and the first three of the one order with the keys they
// were ranked by.
static int64_t replayWork;
static int replayOut(void) { return clockWork >= replayWork; }
EXPORT(gb_replay) int gb_replay(int nbytes, int narr, int mode, int64_t work, char *out, int cap) {
  if (gb_question_bytes(nbytes, narr) != 0) return -1;
  gb_new_game();
  modeRule = mode;
  curQid = abortId + 1;
  replayWork = work; clockFrameOut = replayOut;
  int topped = fullTop(hostBoard) >= hostBoard->height;
  answerQuestion(1, 0, topped, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0);
  clockFrameOut = 0;
  const Answer *A = &theAnswer;
  int k = snprintf(out, (unsigned long)cap, "move %d %d,%d play %d live %d/%d |", A->d.kind, A->d.move ? CR(A->d.move) : 0, A->d.move ? CC(A->d.move) : 0,
                   A->play, A->nlive, A->ncands);
  for (int i = 0; i < 3 && i < A->ncands && k < cap - 160; i++) {
    const Judge *J = order[i];
    k += snprintf(out + k, (unsigned long)(cap - k), " %d:%d,%d,%d,%d,%d,%d,%d,t%d", J->hold ? PLAY_HOLD : J->k.play, J->o.lives, J->o.lostAt, J->outside,
                  J->met, J->material, J->saving, J->o.lifeLeft, J->t.tier);
  }
  return k;
}
