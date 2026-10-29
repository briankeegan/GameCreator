# Gambit in real time

The game is played in real time. Lockstep (`GC_GAMBIT_LOCKSTEP=1`, `PA_UNPACED=1`) waits on every answer, and the look-ahead drains
its whole queue before each decision (decide.c lookPause), so a lockstep score is not a real-time score. A mode is measured with
`gambit-24.yml`, `bot: gambit-paced`.

## Where it stands

| build | real time, pressure | lockstep, pressure |
| --- | --- | --- |
| main `2c27fd76` (the work clock) | 3/24 (1511) | -- |
| main + the wall clock | 1/24 (1515) | -- |
| + the look-ahead off the game's CPU | 2/24 (1517) | -- |
| + a decision's jobs stop on its frame | 8/24 (1519) | -- |
| + the opener (countdown) | 10/24 (1520) | -- |

Before lockstep (`32fb0ff4`, Oct 24) every run was real time:

- `adb566a6`, runs 927-930: 93 of 96, pressure 24/24 twice -- on Gambit's own input budget, 900 actions a minute, with the DAS wall
  rule. Kept as the version `apm900` (`../gambit-versions.txt`; `gambit_from: apm900`).
- `062bd73a`, the standard input budget (456 a minute, the game's): 21 of 96.
- `92272757`, runs 1019-1022, the best on the standard budget: 70 of 96 (finish 18, big chain 19, pressure 17, build 16).

## The plan

1. Find the build that plays best in real time on today's runner: `92272757` and `adb566a6` replayed real time (runs 1523, 1524).
2. Start from it. Diff it against main, and bring the ideas since back one at a time, each measured real time, kept only if it
   holds the score.

## What must come forward (the owner's list, and today's)

- The modes enforced: a mode's profile is what plays (it had been ignored).
- The countdown: the opening planned in the 3 s before play, on the layers shown, with a break ready in time for the first garbage.
  No raise is decided there -- no garbage is shown before play begins, and the raise is the first decision's in play.
- The full budget used, none wasted.
- The standard input budget: it is the game's own limit.
- Real-time infra, each found today:
  - In real time a decision runs on the wall clock (lockstep on the work clock). An answer's time is measured from its question.
  - The countdown publishes its frame. Without it the opening's guard read frame 0, cut the opening, and every later decision with it.
  - The look-ahead runs on the workers' CPUs in real time. On the game's CPU, which draws the game, it got 1% of a CPU.
  - A decision out on its frame stops its jobs. It waits on them (search.h jobsAll), and a job running on to its own share is
    closing work the move waits for -- 100-400 ms. The guard takes the worst of the last 32 closes, so one slow close cut the 32
    decisions after it.
