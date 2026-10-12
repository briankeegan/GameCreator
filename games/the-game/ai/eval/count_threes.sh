#!/usr/bin/env bash
# THE THREES A RUN MADE: every swap pressed (PRESSED) joined to the SWAP line that last chose that cell, and counted by
# what the swap clears -- a plain three (three 1), another clear (total > 0), or nothing (a walk, a setup, a step of a line).
#   ./count_threes.sh run.log
awk '
/(^| )SWAP clock / { for (i = 1; i <= NF; i++) { if ($i == "via") { cell = $(i + 2) } if ($i == "total") tot = $(i + 1); if ($i == "three") th = $(i + 1); if ($i == "chain") ch = $(i + 1); if ($i == "biggest") bg = $(i + 1) } T[cell] = tot; H[cell] = th; B[cell] = bg; C[cell] = ch }
/(^| )PRESSED clock / { for (i = 1; i <= NF; i++) if ($i == "at") cell = $(i + 1); n++; if (H[cell] == 1) three++; else if (T[cell] > 0) { other++; if (C[cell] >= 2) chain++; else if (B[cell] >= 4) combo++ } else none++ }
END { printf "presses %d: plain threes %d, other clears %d (combos %d, chains %d), no clear %d\n", n, three, other, combo, chain, none }' "$@"
