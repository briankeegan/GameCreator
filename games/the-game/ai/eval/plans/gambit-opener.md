# Gambit: the opener, planned

**The opener has the whole board and the most time it will ever have: the countdown, and the seconds before any garbage lands. It
plans one big chain that uses every panel it can reach, builds it swap by swap, and fires it to top the enemy out.**

## What it is up against

- Strong players' first garbage lands at about 9 s, ours at 14.6 s (live, 81 games); by 30 s they have landed 53 cells, we 36
  (`eval/openers.py`, `plans/gambit-goal.md`).
- Today's opener asks the list (4+, then 3+, before the next block lands) and searches it a decision at a time, in a decision's
  share of the time. `search/chainup.c` climbs one set-up swap at a time. Neither looks more than a few swaps ahead, so neither
  builds a big chain.
- An n-chain sends a 6 x (n - 1) block: a 6-chain 30 cells, an 8-chain 42. One big chain landing early is the top-out.

## The plan

1. **The opening search, its own.** A beam over set-up sequences from the first board, scored by what the trigger chain sends
   (its length, the cells of its block), the panels it uses, and the walk. Depth up to 20 set-ups; the beam kept across decisions
   (re-rooted under each swap pressed, as the planner's is), so the whole opening is one search, not a search a decision.
2. **All the time there is.** It starts at the countdown (`front.c frontCountdown` already asks the opening then) and runs on
   every worker until the plan is pressed or the first block is about to land. The decisions in between take the plan's next swap
   unless survival needs another.
3. **Every piece.** Set-ups stack colours in columns two and three rows apart (the shapes the players' long chains are made of);
   the score counts the panels left over that no link uses, so a plan that uses more of the board scores higher.
4. **Pressed as planned.** Each swap is judged as any line before it is pressed (the truth: every board predicted is the board the
   game makes). The input allowance (76 actions in 600 frames) bounds the plan: a set-up the window cannot pay for is not in it.
5. **Fired before the garbage.** The trigger fires before the first block lands, or the plan fires the longest chain it has by
   then. A plan the garbage reaches first is the plan a board digs out with: survival wins, the plan waits.

## How it is measured

- The opener run (`gambit-24.yml`, mode `opener`, 112 games): the chain fired, its frame, the enemy at row 11 by, survival.
  Target: a 6-chain or longer by 9 s in most games, the enemy at row 11 sooner than 1167 frames.
- Live: `eval/openers.py live` on the stats page's replays -- first garbage landed and cells landed by 30 s, against Tanycanayt's
  9.3 s and 53.
- Finish them and fill on sets 86-87: no game lost in the opening.
