// THE BITS HELD TO THE CELLS, on boards Gambit met in its own games (test/boards.txt: GAMBITB lines from runs on the fair board) and the
// boards one and two swaps from each: every reader on the bits answers as the cell-by-cell reader it replaced; and every perched block
// the reader finds, its line played on the engine, counted by whether its block came down.
//   ./build.sh test
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
int32_t *gb_io(void);
int gb_question_bytes(int nbytes, int narr);
int gb_bits_agree(void);
int gb_bits_boards(void);
int gb_perch_counts(int which);
double gb_bits_ms(int cells);
static int b64v(int ch) { return ch >= 'A' && ch <= 'Z' ? ch - 'A' : ch >= 'a' && ch <= 'z' ? ch - 'a' + 26 : ch >= '0' && ch <= '9' ? ch - '0' + 52 : ch == '+' ? 62 : ch == '/' ? 63 : -1; }
int main(int argc, char **argv) {
  const char *path = argc > 1 ? argv[1] : "test/boards.txt";
  FILE *f = fopen(path, "r");
  if (!f) { fprintf(stderr, "bits_test: no %s\n", path); return 2; }
  static char line[1 << 17];
  int boards = 0, wrong = 0;
  while (fgets(line, sizeof line, f)) {
    char *p = strchr(line, ':');
    if (strncmp(line, "GAMBITB ", 8) || !p) continue;
    unsigned char *out = (unsigned char *)gb_io();
    int n = 0, v = 0, bits = 0;
    for (p++; *p && *p != ' ' && *p != '\n'; p++) {
      int d = b64v(*p);
      if (d < 0) continue;
      v = v << 6 | d; bits += 6;
      if (bits >= 8) { bits -= 8; out[n++] = (unsigned char)(v >> bits & 255); }
    }
    if (gb_question_bytes(n, 0) != 0) { fprintf(stderr, "bits_test: a board that does not load\n"); return 1; }
    wrong = gb_bits_agree(); boards++;
  }
  fclose(f);
  printf("the nearest break, 50 times a board: %.1f ms on the bits, %.1f ms on the cells\n", gb_bits_ms(0), gb_bits_ms(1));
  int offered = gb_perch_counts(0), dropped = gb_perch_counts(1);
  printf("%s: bits against cells -- %d boards of games, %d boards in all, %d disagreements\n", wrong ? "FAIL" : "ok", boards, gb_bits_boards(), wrong);
  // (a perched block let down: of the lines offered, played on the engine, some let their block down -- none would be a reader that
  // finds no perch the engine agrees with)
  printf("%s: perched blocks -- %d lines offered, %d let their block down\n", offered && !dropped ? "FAIL" : "ok", offered, dropped);
  return wrong || !boards || (offered && !dropped) ? 1 : 0;
}
