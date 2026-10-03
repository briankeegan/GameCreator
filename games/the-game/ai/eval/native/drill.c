// THE DRILL ON THE C ENGINE: the bot (bit.c, its front end front.c) plays one
// stack of the server's engine (pa.c) under a drill's garbage, as the Lua
// deals it -- the starting board and the rows and garbage colours to come,
// off lua/deal.lua. Level 10 only. Built natively by build.sh.
//
//   drill DEAL FRAMES [WIDTH HEIGHT LEAD CYCLE LEN]
//
// Garbage: one WIDTH x HEIGHT slab on every frame of the first LEN of each
// CYCLE stopwatch frames past LEAD (comboStorm's 4 x 1, 150, 950, 50 by
// default). Prints "f<frame> panels P garb G top T" every 250 frames and the
// decisions taken since, then "died F" or "alive F".
// GC_TRACE=F prints every decision from frame F on; GC_TAPE_OUT=file records
// each frame's keys and swap press (two int32s); GC_TAPE_IN=file with
// GC_TAKEOVER=F plays a tape's keys and hands the board to the bot at frame F,
// so a change is tried on the board an earlier bot reached. GC_PROBE=F (and
// GC_PROBE_EVERY=N) prints the shortest line of up to 4 swaps that breaks
// garbage, time aside, from frame F on; GC_PROBE_CELLS adds every panel's
// colour, state and timer. GC_BOTLOG=F prints the pool at frame F as the
// engine plays it.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "pa.h"

double *nb_io_head(void);
int32_t *nb_io_body(void);
int nb_nhead(void);
const char *nb_head_name(int i);
int nb_load(Board *b);
int front_new(Board *b, int reaction, int allowRaise);
int front_frame(int fid, Board *b);
int front_last(int fid);
int front_move(int fid);
extern int botTraceOn;
int bot_keepbreak(void);
int bot_breakfirst(void);
int front_probe(int fid, Board *b, int depth, int32_t *out);

static const char *VIAS[] = { "-", "raise:opening", "raise:material", "raising", "readyFirst", "awaitLanding", "break",
  "lineupHold", "lineup", "breakReach", "breakSpend", "digPlan", "digWait", "attackWait", "attackPlan", "bestAttack",
  "planWait", "survivalPlan", "flattenWait", "flatten", "noBest", "setup", "WEIGHTS", "ruled", "planSave", "keepSave",
  "awaitDrain", "keepHealth" };
#define NVIAS ((int)(sizeof VIAS / sizeof VIAS[0]))
static const char *KINDS[] = { "hold", "raise", "swap" };

#define MAXSTREAM 200000
static int32_t rows[MAXSTREAM][6], brks[MAXSTREAM][6];
static int nRows, nBrks, atRow, atBrk;

static void die(const char *m, const char *x) { fprintf(stderr, "drill: %s%s\n", m, x ? x : ""); exit(2); }

static Board *deal(const char *file) {
  FILE *in = fopen(file, "r");
  if (!in) die("cannot read ", file);
  static int32_t panel[MAXROWS][W + 1][NF], inc[MAXINC][6], stall[MAXSTALL][5], landed[MAXLANDED], drop[6];
  int nhead = nb_nhead(), have[256] = { 0 }, nrows = 0, ninc = 0, nstall = 0, nland = 0, hasDrop = 0, i, r, c, f;
  double *H = nb_io_head();
  char line[4096];
  for (i = 0; i < nhead; i++) H[i] = NAN;
  while (fgets(line, sizeof line, in)) {
    char *p = line + 2;
    switch (line[0]) {
    case 'H': {
      char name[128]; double v;
      char val[64];
      if (sscanf(p, "%127s %63s", name, val) != 2) die("bad line: ", line);
      v = strcmp(val, "nan") == 0 ? NAN : strtod(val, 0);
      for (i = 0; i < nhead && strcmp(nb_head_name(i), name); i++) {}
      if (i == nhead) die("the engine has no field ", name);
      H[i] = v; have[i] = 1;
      break;
    }
    case 'P': {
      r = (int)strtol(p, &p, 10); c = (int)strtol(p, &p, 10);
      if (r < 0 || r >= MAXROWS || c < 1 || c > W) die("bad panel: ", line);
      for (f = 0; f < NF; f++) panel[r][c][f] = (int32_t)strtol(p, &p, 10);
      if (r + 1 > nrows) nrows = r + 1;
      break;
    }
    case 'I': for (f = 0; f < 6; f++) inc[ninc][f] = (int32_t)strtol(p, &p, 10); ninc++; break;
    case 'S': for (f = 0; f < 5; f++) stall[nstall][f] = (int32_t)strtol(p, &p, 10); nstall++; break;
    case 'L': landed[nland++] = (int32_t)strtol(p, &p, 10); break;
    case 'D': for (f = 0; f < 6; f++) drop[f] = (int32_t)strtol(p, &p, 10); hasDrop = 1; break;
    case 'R': if (nRows < MAXSTREAM) { for (f = 0; f < 6; f++) rows[nRows][f] = (int32_t)strtol(p, &p, 10); nRows++; } break;
    case 'B': if (nBrks < MAXSTREAM) { for (f = 0; f < 6; f++) brks[nBrks][f] = (int32_t)strtol(p, &p, 10); nBrks++; } break;
    }
  }
  fclose(in);
  if (!nrows || !hasDrop) die("no board in ", file);
  // what the board's own lists say, and the frame's input, none yet
  static const char *made[] = { "nrows", "ninc", "nstall", "nlanded", "err", "unseenRows", "unseenBreaks", "nextInput",
                                "pressSwap", "swapDeniedThisFrame" };
  int madeV[] = { nrows, ninc, nstall, nland, 0, 0, 0, 0, 0, 0 };
  for (int k = 0; k < (int)(sizeof made / sizeof made[0]); k++) {
    for (i = 0; i < nhead && strcmp(nb_head_name(i), made[k]); i++) {}
    if (i == nhead) die("the engine has no field ", made[k]);
    H[i] = madeV[k]; have[i] = 1;
  }
  for (i = 0; i < nhead; i++) if (!have[i]) fprintf(stderr, "drill: %s is nil\n", nb_head_name(i));
  int32_t *x = nb_io_body();
  for (r = 0; r < nrows; r++) for (c = 1; c <= W; c++) for (f = 0; f < NF; f++) *x++ = panel[r][c][f];
  for (i = 0; i < ninc; i++) for (f = 0; f < 6; f++) *x++ = inc[i][f];
  for (i = 0; i < nstall; i++) for (f = 0; f < 5; f++) *x++ = stall[i][f];
  for (i = 0; i < nland; i++) *x++ = landed[i];
  for (f = 0; f < 6; f++) *x++ = drop[f];
  Board *b = nb_new();
  int err = nb_load(b);
  if (err) { fprintf(stderr, "drill: the engine refused the board (err %d)\n", err); exit(2); }
  return b;
}

// Rows and garbage colours go in as the engine takes them, a few ahead.
static void feed(Board *b) {
  while (atRow < nRows && nb_feed_row(b, rows[atRow][0], rows[atRow][1], rows[atRow][2], rows[atRow][3], rows[atRow][4], rows[atRow][5])) atRow++;
  while (atBrk < nBrks && nb_feed_break(b, brks[atBrk][0], brks[atBrk][1], brks[atBrk][2], brks[atBrk][3], brks[atBrk][4], brks[atBrk][5])) atBrk++;
  if (atRow >= nRows || atBrk >= nBrks) die("the deal ran out of rows", 0);
}

static void cells(Board *b, int *panels, int *garb) {
  *panels = *garb = 0;
  for (int r = 1; r < b->nrows; r++)
    for (int c = 1; c <= W; c++) {
      Panel *p = &b->p[r][c];
      if (!p->f[COLOR]) continue;
      if (p->f[ISGARBAGE]) (*garb)++; else (*panels)++;
    }
}
static void board(Board *b, char *out) {
  int k = 0;
  for (int r = b->nrows - 1 < 13 ? b->nrows - 1 : 13; r >= 0; r--) {
    for (int c = 1; c <= W; c++) {
      Panel *p = &b->p[r][c];
      int s = p->f[STATE];
      char ch = p->f[ISGARBAGE] ? 'g' : p->f[COLOR] ? (char)('0' + p->f[COLOR] % 10) : '.';
      if (p->f[COLOR] && s != NORMAL && s != DIMMED) ch = p->f[ISGARBAGE] ? 'G' : 'X';
      out[k++] = ch;
    }
    out[k++] = ' ';
  }
  out[k ? k - 1 : 0] = 0;
}

int main(int argc, char **argv) {
  if (argc < 3) die("usage: drill DEAL FRAMES [WIDTH HEIGHT LEAD CYCLE LEN]", 0);
  int frames = atoi(argv[2]);
  int gw = argc > 3 ? atoi(argv[3]) : 4, gh = argc > 4 ? atoi(argv[4]) : 1;
  int lead = argc > 5 ? atoi(argv[5]) : 150, cycle = argc > 6 ? atoi(argv[6]) : 950, len = argc > 7 ? atoi(argv[7]) : 50;
  int trace = getenv("GC_TRACE") ? atoi(getenv("GC_TRACE")) : -1;
  FILE *tape = getenv("GC_TAPE_OUT") ? fopen(getenv("GC_TAPE_OUT"), "wb") : 0;
  int probe = getenv("GC_PROBE") ? atoi(getenv("GC_PROBE")) : -1, probeEvery = getenv("GC_PROBE_EVERY") ? atoi(getenv("GC_PROBE_EVERY")) : 1;
  int takeover = getenv("GC_TAKEOVER") ? atoi(getenv("GC_TAKEOVER")) : 0, nTape = 0;
  static int32_t tapeIn[2 * 200000];
  if (getenv("GC_TAPE_IN")) {
    FILE *ti = fopen(getenv("GC_TAPE_IN"), "rb");
    if (!ti) die("cannot read ", getenv("GC_TAPE_IN"));
    nTape = (int)fread(tapeIn, 4, 2 * 200000, ti);
    fclose(ti);
  }
  Board *b = deal(argv[1]);
  if (b->startingSpeed != 32 || b->colors != 6) die("drills run at level 10 only", 0);
  int bot = front_new(b, 12, 1);
  if (bot < 0) die("no bot", 0);
  int via[64][3] = { { 0 } }, f, lastPress = -100, bySwap = 0, byCascade = 0, converted = 0;
  char text[256];
  for (f = 0; f < frames; f++) {
    if (b->stopWatchIsRunning && b->stopWatch >= lead + 1 && (b->stopWatch - lead - 1) % cycle < len)
      nb_receive(b, gw, gh, 0, 0, b->stopWatch, 1);
    feed(b);
    int bits;
    if (f < takeover) {
      if (2 * f + 1 >= nTape) die("the tape ends before the takeover", 0);
      bits = tapeIn[2 * f];
      if (tapeIn[2 * f + 1]) b->pressSwap = 1;
    } else {
      botTraceOn = getenv("GC_BOTLOG") && f >= atoi(getenv("GC_BOTLOG")) && f < atoi(getenv("GC_BOTLOG")) + (getenv("GC_BOTLOG_N") ? atoi(getenv("GC_BOTLOG_N")) : 1);
      bits = front_frame(bot, b);
      if (bits < 0) { fprintf(stderr, "drill: the bot failed at frame %d\n", f); return 2; }
    }
    b->input = bits;
    if (probe >= 0 && f >= probe && (f - probe) % probeEvery == 0) {
      int32_t line[1 + 2 * 4];
      int pb = front_probe(bot, b, 4, line);
      printf("PROBE %d topped %d", f, nb_topped(b));
      if (pb > 0) { printf(" break in %d (%d lines):", pb, line[0]); for (int k = 0; k < pb; k++) printf(" %d,%d", line[1 + 2 * k], line[2 + 2 * k]); }
      else printf(pb == 0 && line[0] == 1 ? " breaking" : " no break in 4");
      printf("\n");
      if (getenv("GC_PROBE_CELLS"))
        for (int r = b->nrows - 1; r >= 1; r--) {
          printf("  r%d", r);
          for (int c = 1; c <= W; c++) { Panel *q = &b->p[r][c]; printf(" %d%s/s%d/t%d%s", q->f[COLOR], q->f[ISGARBAGE] ? "g" : "", q->f[STATE], q->f[TIMER], SETB(q->f[DONTSWAP]) ? "/D" : ""); }
          printf("\n");
        }
    }
    if (tape) { int32_t rec[2] = { bits, b->pressSwap }; fwrite(rec, 4, 2, tape); }
    int last = f < takeover ? -1 : front_last(bot);
    if (last >= 0) {
      int k = last / 100, v = last % 100;
      if (v >= 0 && v < 64 && k >= 0 && k < 3) via[v][k]++;
      if (trace >= 0 && f >= trace)
        printf("D %d %s %s @%d,%d kb%d bf%d\n", f, KINDS[k], v < NVIAS ? VIAS[v] : "?", front_move(bot) / 10, front_move(bot) % 10,
               bot_keepbreak(), bot_breakfirst());
    }
    int cleared0 = b->sCleared, garb0 = 0, garb1 = 0;
    for (int r = 1; r < b->nrows; r++) for (int c = 1; c <= W; c++) if (b->p[r][c].f[ISGARBAGE]) garb0++;
    if (b->pressSwap || (bits & 16)) lastPress = f;
    if (nb_run(b)) { fprintf(stderr, "drill: the engine failed at frame %d (err %d)\n", f, b->err); return 2; }
    for (int r = 1; r < b->nrows; r++) for (int c = 1; c <= W; c++) if (b->p[r][c].f[ISGARBAGE]) garb1++;
    // where the panels go: matched within a swap's own clear, or by the board's cascades; garbage converted
    int dc = b->sCleared - cleared0;
    if (dc > 0) { if (f - lastPress <= 6) bySwap += dc; else byCascade += dc; }
    if (garb1 < garb0) converted += garb0 - garb1;
    if (trace >= 0 && f >= trace) {
      board(b, text);
      printf("F %d stop %d shake %d health %d disp %d cur %d,%d in %d | %s\n", f, b->stopTime, b->shakeTime, b->health,
             b->displacement, b->curRow, b->curCol, b->ninc, text);
    }
    int dead = b->gameOverClock > 0;
    if (f % 250 == 0 || dead) {
      int p, g;
      cells(b, &p, &g);
      printf("f%d panels %d garb %d top %d | cleared swap %d cascade %d converted %d |", f, p, g, nb_topped(b), bySwap, byCascade, converted);
      for (int v = 0; v < 64; v++)
        for (int k = 0; k < 3; k++)
          if (via[v][k]) { printf(" %s:%d", v < NVIAS ? VIAS[v] : "?", via[v][k]); via[v][k] = 0; }
      printf("\n");
      fflush(stdout);
    }
    if (dead) { printf("died %d\n", f); return 1; }
  }
  printf("alive %d\n", f);
  return 0;
}
