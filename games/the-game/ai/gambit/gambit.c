// GAMBIT, in C (PLAN.md). One translation unit: the server's engine and its node store (eval/native: pa.c, search.h), the clock and the nodes every search
// plays its lines through (core/), then Gambit's own pieces on top of them.
#include "../eval/native/pa.c"
// (A SWAP AND ITS WAIT: a line's swap is r * 8 + c (under 512, MAXROWS 48); above that, the frames the board is let run before it is
// pressed -- DLY -- so a line can time a swap to the panels falling: a chain's next link swapped in as they land, not before)
#undef CR
#undef CC
#define CR(x) (((x) >> 3) & 63)
#define CC(x) ((x) & 7)
#define DLY(x) ((x) >> 9)
#define MOVE_AFTER(m, d) (((m) & 511) | ((d) << 9))
#include "core/nodes.h"
#include "rules.c"
#include "judge.c"
#include "outcome.c"
#include "core/sort.h"
#include "search/bits.c"
#include "search/break.c"
#include "facts.c"
#include "search/plan.c"
#include "search/extend.c"
#include "search/ready.c"
#include "search/level.c"
#include "search/outlive.c"
#include "search/fill.c"
#include "search/ideas.c"
#include "rank.c"
#include "propose.c"
#include "decide.c"
#include "answer.c"

EXPORT(gb_version) int gb_version(void) { return 1; }
