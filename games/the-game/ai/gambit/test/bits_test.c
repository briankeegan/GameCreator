// THE BITS HELD TO THE CELLS, on boards Gambit met in its own games (test/boards.txt: GAMBITB lines from runs on the fair board) and the
// boards one and two swaps from each: every reader on the bits answers as the cell-by-cell reader it replaced.
//   ./build.sh test
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
int32_t *gb_io(void);
int gb_question_bytes(int nbytes, int narr);
int gb_bits_agree(void);
int gb_bits_boards(void);
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
  printf("%s: bits against cells -- %d boards of games, %d boards in all, %d disagreements\n", wrong ? "FAIL" : "ok", boards, gb_bits_boards(), wrong);
  return wrong || !boards ? 1 : 0;
}
