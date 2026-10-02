
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  bot_new();
  void *dst[6] = { BIN, IN, RISEN, TMST, (void *)&TM, &BOTS[0] };
  for (int f = 1; f < argc; f++) {
    FILE *fp = fopen(argv[f], "rb");
    int n, len;
    if (!fp || fread(&n, 4, 1, fp) != 1) return 1;
    for (int i = 0; i < n; i++) {
      for (int j = 0; j < 6; j++) {
        if (fread(&len, 4, 1, fp) != 1 || fread(dst[j], 1, len, fp) != (size_t)len) return 1;
      }
      bot_decide(0);
    }
    fclose(fp);
  }
  return 0;
}
