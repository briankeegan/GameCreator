# The survival loop

`loop.sh "<what changed>"` is one turn of the loop in CLAUDE.md ("Survival is a
loop on Actions"), run in the background: `ship.sh` commits the source under
`ai/eval` and pushes it (which dispatches `ai-survival-scan.yml`; the wasm is
rebuilt only with `REBUILD=1 ship.sh`), the scan is waited for, `scan_deaths.sh`
fetches it and adds its line to `survival_scans.tsv`, and the analysis below is
printed. `viz/build.py` packs the scan into the death-patterns page
(`$GC_WORK/death-patterns.html`) from `$GC_WORK/scan-<sha>/findings.json`.

Work files (scans, the git lock, the page) live in `$GC_WORK`
(default `/tmp/gc-survival`); commit trailers come from `$GC_WORK/trailer.txt`.

- `scandiff.py DIR`: this scan against the one before -- alive, mean frames
  survived (steadier than the alive count), the seeds that moved
- `flip.py`, `gates.py`, `landings.py`, `deathspend.py`: decision flips, raise
  gates, landings by material and the readiness read before each, what spent material before each death
- `slip.py DIR 900`: in each death's last 900 frames, options judged and not played
- `look.py LOG LO HI`: breaks one or two swaps away on a death's boards
- `scan.sh`: one scan, dispatch to result -- `GC_MODE=large_garbage GC_SOURCE=<commit> scan.sh` (the scan of a change beside its predecessor); the run is found among the scan workflow's own, every fetch is retried, the games are kept in `$GC_WORK/run-<id>`
- `readiness.py DIR`: was the board ready when each slab landed, how soon the first break came and how many landings were fatal, and how often the search that readies a board ran and what stopped it
