// GAMBIT'S C CHECKS (./build.sh test), on Gambit's own games:
//   - the board as bits held to the cells it replaced, on boards of games and the boards one and two swaps from them (test/boards.txt);
//     every perched block the reader finds, its line played on the engine, counted by whether its block came down;
//   - the decision replayed (test/decisions.txt.gz: questions from runs on the fair board, a mode each): each answered twice, the same
//     answer both times, and against test/decisions.golden -- every question whose answer moved printed, with what decided it.
//   the rules every decision is replayed on: test/rules.words (words.js, the finish profile; its mode set a question at a time).
//   test DIR [golden]: "golden" writes test/decisions.golden from this build.
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
  gn_profile(profile[0], profile[1], profile[2], profile[3], profile[4], profile[5], profile[6], profile[7]);
  return 1;
}
int main(int argc, char **argv) {
  const char *dir = argc > 1 ? argv[1] : "test";
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
  int nq = 0, unsteady = 0, moved = 0, changed = 0;
  while (gzgets(z, line, sizeof line)) {
    int mode = atoi(line);
    const char *b = strstr(line, "GAMBITQ ");
    if (!b) b = strstr(line, "GAMBITB ");
    if (!b) continue;
    int narr, n = loadLine(b, &narr);
    if (n < 0 || gb_replay(n, narr, mode, REPLAY_WORK, rec, sizeof rec) < 0) { fprintf(stderr, "test: question %d does not load\n", nq); return 1; }
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
  gzclose(z); fclose(g);
  printf("%s: decisions replayed -- %d questions, %d answered differently on a second asking\n", unsteady ? "FAIL" : "ok", nq, unsteady);
  if (golden) printf("wrote %s/decisions.golden\n", dir);
  else printf("%s: against the golden -- %d moves changed, %d records changed\n", moved ? "CHANGED" : "ok", moved, changed);
  fail |= unsteady || !nq;
  return fail ? 1 : 0;
}
