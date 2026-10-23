// GAMBIT'S C CHECKS (./build.sh test), on Gambit's own games:
//   - the board as bits held to the cells it replaced, on boards of games and the boards one and two swaps from them (test/boards.txt);
//     every perched block the reader finds, its line played on the engine, counted by whether its block came down;
//   - the decision replayed (test/decisions.txt.gz: questions from runs on the fair board, a mode each): each answered twice, the same
//     answer both times, and against test/decisions.golden -- every question whose answer moved printed, with what decided it;
//   - the answers: every mode answered, and when any candidate lives, what is played lives (or is the raise);
//   - the raise: each mode's boards cut to a low stack with nothing on it or on its way are raised, and the raise held down.
//   the rules every decision is replayed on: test/rules.words (words.js, the finish profile; its mode set a question at a time).
//   test DIR [golden|speed]: "golden" writes test/decisions.golden from this build; "speed" is the wall-clock check (speed()).
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <zlib.h>
int32_t *gb_io(void);
int gb_question_bytes(int nbytes, int narr);
int gb_bits_agree(void);
int gb_bits_boards(void);
int gb_perch_counts(int which);
double gb_bits_ms(int cells);
int gb_replay(int nbytes, int narr, int mode, int64_t work, char *out, int cap);
void gb_replay_last(int32_t *v);
void gb_replay_low(int keep);
void gb_replay_allow(int allow);
int gb_line_agree(int *n);
int gb_clock_work(void);
int gb_switch_check(int games, int frames, int min, int max, int32_t *counts, int *nrules);
void paThreadId(int id);
int gn_setup(int reaction, int swapGap, int cursor, int ahead, int gap, int jitter, int planHealth, const char *logPath);
int32_t *gn_io(void);
int gn_rules(int n);
void gn_rule_name(int i, const char *name);
void gn_profile(int mode, int ms, int extendMs, int width, int depth, int pool, int extendDepth, int extendOff);
#define REPLAY_WORK 20000   // a decision's work in the replay: engine frames, as step() charges them
static int b64v(int ch) { return ch >= 'A' && ch <= 'Z' ? ch - 'A' : ch >= 'a' && ch <= 'z' ? ch - 'a' + 26 : ch >= '0' && ch <= '9' ? ch - '0' + 52 : ch == '+' ? 62 : ch == '/' ? 63 : -1; }
// a GAMBITB line's board into the io, its arrivals after it: the bytes, *narr
static int loadLine(const char *line, int *narr) {
  const char *p = strchr(line, ':');
  if (!p) return -1;
  unsigned char *out = (unsigned char *)gb_io();
  int n = 0, v = 0, bits = 0;
  for (p++; *p && *p != ' ' && *p != '\n'; p++) { int d = b64v(*p); if (d < 0) continue; v = v << 6 | d; bits += 6; if (bits >= 8) { bits -= 8; out[n++] = (unsigned char)(v >> bits & 255); } }
  int32_t *a = gb_io() + (n + 3) / 4;
  *narr = 0;
  const char *q = strstr(p, "[[");
  if (q) for (q++; *q == '['; ) { int at, w, h; if (sscanf(q, "[%d,%d,%d]", &at, &w, &h) != 3) break; a[3 * *narr] = at; a[3 * *narr + 1] = w; a[3 * *narr + 2] = h; (*narr)++; q = strchr(q, ']'); if (!q) break; q++; if (*q == ',') q++; }
  return n;
}
static int loadWords(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) return 0;
  static char line[1 << 20];
  int setup[8] = { 0 }, profile[9] = { 0 }, nrules = -1, have = 0;
  while (fgets(line, sizeof line, f)) {
    char *rest = strchr(line, ' ');
    if (!rest) continue;
    *rest++ = 0;
    if (!strcmp(line, "setup")) { sscanf(rest, "%d %d %d %d %d %d %d", &setup[0], &setup[1], &setup[2], &setup[3], &setup[4], &setup[5], &setup[6]); have |= 1; }
    else if (!strcmp(line, "profile")) { sscanf(rest, "%d %d %d %d %d %d %d %d", &profile[0], &profile[1], &profile[2], &profile[3], &profile[4], &profile[5], &profile[6], &profile[7]); have |= 2; }
    else if (!strcmp(line, "name")) { int i; char nm[64]; if (sscanf(rest, "%d %63[^\n]", &i, nm) == 2) gn_rule_name(i, nm); }
    else if (!strcmp(line, "rules")) {
      char *s = rest; int len;
      nrules = (int)strtol(s, &s, 10); len = (int)strtol(s, &s, 10);
      int32_t *io = gn_io();
      for (int i = 0; i < len; i++) io[i] = (int32_t)strtol(s, &s, 10);
      have |= 4;
    }
  }
  fclose(f);
  if (have != 7) return 0;
  gn_setup(setup[0], setup[1], setup[2], setup[3], setup[4], setup[5], setup[6], "");
  if (gn_rules(nrules) != nrules) return 0;
  paThreadId(0);   // (the checks answer on this thread, as Gambit's own does: the engine's thread 0 -- gn_setup made it the game's)
  gn_profile(profile[0], profile[1], profile[2], profile[3], profile[4], profile[5], profile[6], profile[7]);
  return 1;
}
// THE SPEED (test DIR speed): the first SPEEDQ questions answered each in the wall clock's REPLAY_MS, as a game gives it -- the engine's
// work done a decision (frames stepped), on the threads the host started (GC_GAMBIT_WORKERS)
#define SPEEDQ 60
static int speed(const char *dir) {
  char path[4096]; static char line[1 << 17], rec[4096];
  snprintf(path, sizeof path, "%s/rules.words", dir);
  if (!loadWords(path)) return 1;
  snprintf(path, sizeof path, "%s/decisions.txt.gz", dir);
  gzFile z = gzopen(path, "r");
  if (!z) return 2;
  long long work = 0; int nq = 0;
  while (nq < SPEEDQ && gzgets(z, line, sizeof line)) {
    int mode = atoi(line);
    const char *b = strstr(line, "GAMBITQ ");
    if (!b) b = strstr(line, "GAMBITB ");
    if (!b) continue;
    int narr, n = loadLine(b, &narr);
    if (n < 0 || gb_replay(n, narr, mode, 0, rec, sizeof rec) < 0) continue;
    work += gb_clock_work(); nq++;
  }
  gzclose(z);
  printf("speed: %d decisions in the wall clock's time, %lld frames stepped a decision\n", nq, nq ? work / nq : 0);
  return 0;
}
int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : "test";
  if (argc > 2 && !strcmp(argv[2], "speed")) return speed(dir);
  int golden = argc > 2 && !strcmp(argv[2], "golden"), fail = 0;
  char path[4096];
  static char line[1 << 17];
  // ---- the bits
  snprintf(path, sizeof path, "%s/boards.txt", dir);
  FILE *f = fopen(path, "r");
  if (!f) { fprintf(stderr, "test: no %s\n", path); return 2; }
  int boards = 0, wrong = 0;
  while (fgets(line, sizeof line, f)) {
    if (strncmp(line, "GAMBITB ", 8)) continue;
    int narr, n = loadLine(line, &narr);
    if (n < 0 || gb_question_bytes(n, 0) != 0) { fprintf(stderr, "test: a board that does not load\n"); return 1; }
    wrong = gb_bits_agree(); boards++;
  }
  fclose(f);
  printf("the nearest break, 50 times a board: %.1f ms on the bits, %.1f ms on the cells\n", gb_bits_ms(0), gb_bits_ms(1));
  printf("%s: bits against cells -- %d boards of games, %d boards in all, %d disagreements\n", wrong ? "FAIL" : "ok", boards, gb_bits_boards(), wrong);
  int offered = gb_perch_counts(0), dropped = gb_perch_counts(1);
  printf("%s: perched blocks -- %d lines offered, %d let their block down\n", offered && !dropped ? "FAIL" : "ok", offered, dropped);
  fail |= wrong || !boards || (offered && !dropped);
  // ---- the decisions
  snprintf(path, sizeof path, "%s/rules.words", dir);
  if (!loadWords(path)) { fprintf(stderr, "test: %s is not a whole profile\n", path); return 1; }
  snprintf(path, sizeof path, "%s/decisions.txt.gz", dir);
  gzFile z = gzopen(path, "r");
  if (!z) { fprintf(stderr, "test: no %s\n", path); return 2; }
  snprintf(path, sizeof path, "%s/decisions.golden", dir);
  FILE *g = fopen(path, golden ? "w" : "r");
  if (!g) { fprintf(stderr, "test: no %s (test DIR golden writes it)\n", path); return 2; }
  static char rec[4096], rec2[4096], want[4096];
  int nq = 0, unsteady = 0, moved = 0, changed = 0, liveDied = 0, lows = 0, lowRaised = 0, raises = 0, raiseHeld = 0, modes[64] = { 0 };
  while (gzgets(z, line, sizeof line)) {
    int mode = atoi(line);
    const char *b = strstr(line, "GAMBITQ ");
    if (!b) b = strstr(line, "GAMBITB ");
    if (!b) continue;
    int narr, n = loadLine(b, &narr);
    if (n < 0 || gb_replay(n, narr, mode, REPLAY_WORK, rec, sizeof rec) < 0) { fprintf(stderr, "test: question %d does not load\n", nq); return 1; }
    // (the answer: when anything lives, what is played lives -- or is the raise; a low stack with nothing on it or on its way is raised;
    // a raise is held down through its row)
    { int32_t v[8]; gb_replay_last(v);
      if (v[2] > 0 && v[0] != 2 && v[1] != 1) { liveDied++; if (liveDied <= 3) printf("  lives but died %d (mode %d): %s\n", nq, mode, rec); }
        if (mode >= 0 && mode < 64) modes[mode]++; }
    n = loadLine(b, &narr);
    gb_replay(n, narr, mode, REPLAY_WORK, rec2, sizeof rec2);
    if (strcmp(rec, rec2)) { unsteady++; if (unsteady <= 3) printf("  unsteady %d: %s\n               %s\n", nq, rec, rec2); }
    if (golden) fprintf(g, "%s\n", rec);
    else if (fgets(want, sizeof want, g)) {
      want[strcspn(want, "\n")] = 0;
      if (strcmp(rec, want)) {
        changed++;
        int mv = strncmp(rec, want, (size_t)(strchr(rec, '|') - rec)) != 0;
        if (mv) { moved++; if (moved <= 12) printf("  moved %d (mode %d): was %s\n              now %s\n", nq, mode, want, rec); }
      }
    }
    nq++;
  }
  gzclose(z);
  fclose(g);
  // (the raise: each mode's question boards cut to a low stack with nothing on it or on its way -- each raised, and held down)
  snprintf(path, sizeof path, "%s/decisions.txt.gz", dir);
  if ((z = gzopen(path, "r"))) {
    gb_replay_low(3);
    int perMode[64] = { 0 };
    while (gzgets(z, line, sizeof line)) {
      int mode = atoi(line);
      if (mode < 0 || mode >= 64 || perMode[mode] >= 4) continue;
      const char *b = strstr(line, "GAMBITQ ");
      if (!b) b = strstr(line, "GAMBITB ");
      if (!b) continue;
      int narr, n = loadLine(b, &narr);
      if (n < 0 || gb_replay(n, narr, mode, REPLAY_WORK, rec, sizeof rec) < 0) continue;
      int32_t v[8]; gb_replay_last(v);
      perMode[mode]++; lows++; lowRaised += v[0] == 2; raises += v[0] == 2; raiseHeld += v[0] == 2 && v[7] > 0;
      if (v[0] != 2 && lows - lowRaised <= 3) printf("  low stack not raised (mode %d): %s\n", mode, rec);
    }
    gb_replay_low(0); gzclose(z);
  }
  // (THE LINE PRESSED AS JUDGED: each question answered again with the input budget tight -- walks held from two cells -- and the line
  // the answer hands on keyed as the frame loop keys it: every swap's keys begin on the frame the judge pressed it from, never later. A
  // swap pressed later is a board the judge never judged: front.c follow, core/nodes.h pressDelay)
  snprintf(path, sizeof path, "%s/decisions.txt.gz", dir);
  if ((z = gzopen(path, "r"))) {
    int compared = 0, late = 0, lines = 0;
    while (gzgets(z, line, sizeof line)) {
      int mode = atoi(line);
      const char *b = strstr(line, "GAMBITQ ");
      if (!b) b = strstr(line, "GAMBITB ");
      if (!b) continue;
      for (int t = 0; t < 2; t++) {
        int narr, n = loadLine(b, &narr), c;
        gb_replay_allow(t ? 12 : 30);
        if (n < 0 || gb_replay(n, narr, mode, REPLAY_WORK, rec, sizeof rec) < 0) continue;
        int l = gb_line_agree(&c);
        compared += c; late += l; lines += c > 0;
        if (l && late - l < 3) printf("  pressed later than judged (allowance %d, mode %d): %s\n", t ? 12 : 30, mode, rec);
      }
    }
    gb_replay_allow(-1); gzclose(z);
    printf("%s: the line pressed as judged -- %d swaps of %d lines keyed, %d begun later than the judge pressed them\n", late || !compared ? "FAIL" : "ok", compared, lines, late);
    fail |= late || !compared;
  }
  // ---- switching: every direction between the modes, over a run's games (gambit-switch.json's stretch)
  { int32_t counts[64 * 64]; int nr = 0, missing = gb_switch_check(24, 21600, 300, 1800, counts, &nr), lo = 1 << 30, hi = 0;
    for (int a = 0; a < nr; a++) for (int b = 0; b < nr; b++) if (a != b) { if (counts[a * nr + b] < lo) lo = counts[a * nr + b]; if (counts[a * nr + b] > hi) hi = counts[a * nr + b]; }
    printf("%s: switching -- %d modes, %d directions, each switched %d to %d times over 24 games, %d never\n", missing || nr < 2 ? "FAIL" : "ok", nr, nr * (nr - 1), lo, hi, missing);
    fail |= missing || nr < 2; }
  // (with workers, a break they find reaches the decision whenever it is found: an answer the same twice is asked only of one thread)
  int workers = getenv("GC_GAMBIT_WORKERS") && atoi(getenv("GC_GAMBIT_WORKERS")) > 0;
  printf("%s: decisions replayed -- %d questions, %d answered differently on a second asking%s\n", unsteady && !workers ? "FAIL" : "ok", nq, unsteady,
         workers ? " (workers: not held)" : "");
  { int nm = 0; for (int i = 0; i < 64; i++) nm += modes[i] > 0;
    printf("%s: the answers -- %d questions over %d modes, %d played a line that dies while one lived\n", liveDied || nm < 4 ? "FAIL" : "ok", nq, nm, liveDied);
    printf("%s: the raise -- %d of %d low stacks with no garbage raised, %d of %d raises held down\n", lowRaised < lows || raiseHeld < raises || !raises ? "FAIL" : "ok", lowRaised, lows, raiseHeld, raises);
    fail |= liveDied || nm < 4 || !lows || lowRaised < lows || raiseHeld < raises; }
  if (golden) printf("wrote %s/decisions.golden\n", dir);
  else printf("%s: against the golden -- %d moves changed, %d records changed\n", moved ? "CHANGED" : "ok", moved, changed);
  fail |= (unsteady && !workers) || !nq;
  return fail ? 1 : 0;
}
