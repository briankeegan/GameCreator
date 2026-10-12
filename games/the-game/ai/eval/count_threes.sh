#!/usr/bin/env bash
# THE THREES A RUN MADE: every swap pressed (PRESSED) joined to the SWAP line that last chose that cell, counted by what the
# swap clears -- a plain three (three 1), a combo (a match of four or more), a chain, or nothing (a walk, a setup, a step of a
# line) -- and, of the swaps that broke garbage, how many were plain threes. Each file is its own run.
#   ./count_threes.sh run.log [more.log ...]
awk '
FNR == 1 { delete T; delete H; delete B; delete C; delete K }
/(^| )SWAP clock / { for (i = 1; i <= NF; i++) { if ($i == "via") cell = $(i + 2); if ($i == "total") tot = $(i + 1); if ($i == "three") th = $(i + 1); if ($i == "chain") ch = $(i + 1); if ($i == "biggest") bg = $(i + 1); if ($i == "broke") br = $(i + 1) } T[cell] = tot; H[cell] = th; B[cell] = bg; C[cell] = ch; K[cell] = br }
/(^| )PRESSED clock / { for (i = 1; i <= NF; i++) if ($i == "at") cell = $(i + 1); n++
  if (K[cell] > 0) { brk++; if (H[cell] == 1) brk3++ }
  if (H[cell] == 1) three++; else if (C[cell] >= 2) chain++; else if (B[cell] >= 4) combo++; else if (T[cell] > 0) other++; else none++ }
END { printf "presses %d: plain threes %d, combos %d, chains %d, other clears %d, no clear %d | garbage breaks %d, of them plain threes %d\n", n, three, combo, chain, other, none, brk, brk3 }' "$@"
