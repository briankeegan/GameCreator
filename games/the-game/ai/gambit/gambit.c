// GAMBIT, in C (PLAN.md). One translation unit: the server's engine and its node store (engine/), the clock and the nodes every search
// plays its lines through (core/), then Gambit's own pieces on top of them.
#include "engine/pa.c"
#include "core/nodes.h"

EXPORT(gb_version) int gb_version(void) { return 1; }
