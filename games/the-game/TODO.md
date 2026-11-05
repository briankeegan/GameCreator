# Newsey — running to-do list

## Gambit (the bot) — the owner's asks, top first

Each line: the ask, then where it stands. A fix ships to main only when it holds survival over two runs; one that costs survival is
narrowed, not dropped.

1. **No 2x chains it does not continue.** A 2x is taken to three, or not made, unless doing otherwise kills the board.
   - On main: a 2x going is taken to three among lines that survive alike, and at least to three in every mode; the extension offers
     the three that breaks the most; a line making a 2x not taken to three is taken out unless every other is lost within a break's
     time, a plain break offered beside it. 2x share 42% to 33%, switching 24/24 on 6-minute games (run 2010).
   - On main: a 2x is read on the judge's count where the board is lost during the line, so the rule takes it out (c3413ac8).
   - Not better, each costing survival: the 3x put before survival, or before it within a break's time; the extension's three kept
     whatever material it leaves; the extension or the wider break search given the planner's half's thread.
   - Put before survival the 3x cost survival (19/24, 2x share 26%). Open: the 2x with no three found (465 of 1411 decisions with a
     2x going, run 2006).
2. **No flipping back and forth.** A swap and its swap back is two inputs for nothing.
   - On main: the swap back the last swap pressed refused; a swap and its swap back inside a line handed on as a wait; no search grows
     a line by swapping straight back; no swap back among lines lost alike. 3.1% of swaps to 1.2% (runs 1972-1979).
   - Open: the rest are a change of mind once garbage turns to panels -- the next line begins by undoing the swap just pressed.
     Such a line judged again without the swap back: on main. Next: a swap handed on asked again before it is pressed once garbage
     turned to panels since the line was judged.
3. **No lazy waits.** Never sit with the cursor still and then rush; play what can be swapped now.
   - Steady over a popping slab (a line not found to break pressed straight through): on main.
   - A swap whose pair stays locked over 20 frames is not there, so lines that use what can be swapped now are played: on main
     (8354a299).
   - Still 13% of gaps between swaps over a second: they are decisions that hold. Waits filled with setup and flattening: next.
4. **Every round a new game, nothing carried over.** Every match a fresh Gambit -- the library loaded anew, the last match's quit
   (030c5f11); the live deploy (Ranmaru_TEST_CPU) is on it.
5. **No early deaths in a live fight.** Every line unjudged at the first garbage, the planner having taken the decision's time: the
   planner takes half when garbage is on the board or the loss is near, on main (8354a299).
6. **Look further ahead, in general.** The next break in reach after the next landing ranked right after survival: not better yet
   (switching 18/24), not shipped.
   - Deaths on main, 6-minute fights: of 183 boards a lost game found no break on, re-searched without a limit, 168 had none to find
     (33 of them one past the input window) and 15 a break the live search missed -- 11 for want of work, not its order. A turn a
     break was last there is most often a hold. Not better: the window's reserve 30 actions; below the reserve the line that spends the
     least (both cost survival).
   - Where the losses are, main's runs 2011-2035: combo_storm 14 of 25, large_garbage 6, factory 5. combo_storm's stream of small
     slabs keeps the board from settling: a manual raise is never open under garbage there (search/ready.c raiseOpenIn: 0 raises in
     76,866 decisions under garbage), waits for a settle do not end, and a break timed to a landing is planned again each decision.
     Next: combo_storm played as a board that never settles.
7. **The weakest mode first.** On main 9cee5ff5: big chain 24/24 (run 2061), switching 24 (2057), finish 22 (2063), pressure 21
   (2064), build 19-23 over four runs (2058, 2062, 2065, 2066: 20.5 on average) -- the same code swings about 4 games in 24, so a
   change is judged over two runs or more. Build's losses are mostly large_garbage: re-searched without a limit, every board before a
   loss had no break to find (107 of 107, run 2066); the panels left, the readiness asked and found (about 8%) and the clears breaking
   nothing do not tell a lost game from a survived one. Next: play that keeps a break in reach before the slab lands.
   On main a703196d, seed 91, 48 games a run (rounds [1,2]): switching 43/48 (run 2103), build 43/48 (2105) -- the reference an idea
   is measured against on the same games; seed 92: switching 46/48 (2121), build 41/48 (2123). Not better there: two lines lost far off alike only within half again the sooner (37/48
   switching), or alike from two breaks' time off (39/48 switching, 42/48 build); a three taken out of a break line; a swap far off
   its line's way judged out of it; a chain past the list's longest counted as stop time bought with panels (42/48, 42/48); a
   board stands 360 frames out, not 240 (41/48, 39/48); a three let through on a stack near the top (18-37/48).
   Level: the best breaks asked for a second break on the board they leave, one that has it first (90/96 switching, 84/96 build over
   seeds 91 and 92 against main's 89/96 and 84/96) -- a second break is found on 429 of 99,117 lines asked.
   Main's 19 losses on those games: 11 with no break to find, 3 the search cut by the clock, 5 the input window spent (walks held
   already). The next break is mostly made of the panels the one before converts, and their colours are not shown until the slab
   pops: planning several breaks ahead means planning on colours the game has not shown -- the owner: out of bounds; efficiency
   instead, every move counting. 12% of the cursor's actions are on swaps that come to nothing (seed 92, switching): carry 2,723,
   break line 1,571, ready 1,374 (half its swaps), break search 1,090, survive 1,062. Not better on those games: the line in progress
   kept, nothing new told, over one lost up to two breaks' time later (84/96 against 87/96, put-downs 16% fewer); no ready lines
   (81/96); a save across the board charged 16 frames an action, not 8 (174/192 against 173/192 over both seeds, round trips no fewer).
   Earlier:  Switching (21/24 on 8354a299; finish them 22, pressure 23), then the others; every mode 24/24 twice in a row
   (`ai/eval/plans/gambit-goal.md`).
8. **Efficiency.** The fewest cursor moves to the goal: the break search's beam ranks by actions to a break, on main.
   - On main: a line's loss less 8 frames for each action it walks (rank.c WALK_FRAMES). Seed 92, 48 games each: cursor 307 to 272
     cells a minute in switching and 306 to 274 in build, survived 46+41 to 44+43. At 12 it is being measured; at 16, 3/48.
   - **No long trips for nothing** (the owner: at the top about to break garbage, it walks to the very bottom, makes one swap and walks
     all the way back -- wasted input). Open.
   - **No moving and moving back** (the owner: panels between garbage moved, moved back, moved again, often never broken). Seed 92,
     48 games: 4.5% of swaps (8.6% of actions) are a pair swapped again within 600 frames with other swaps between -- carry 272, entry
     145, break line 139, break search 132 (scratchpad undo2.py on GAMBITM ids). Open.
   - **Plans go to completion** (the owner). 37% of actions are spent on lines put down before their end, a third of them with nothing
     new told (the same garbage as the decision before). Cause: a line lives where it stands the horizon and REST after its last swap,
     so a line near that edge lives one decision and dies the next as the horizon moves on, and lives before does not. On main: the line
     in progress lives while it stands the horizon from now (rank.c livesOn). Switching, seeds 92 and 91: 30% and 26% of actions on lines
     not played out, survived 41/44 and 36/41 (main 37%, 42/48 and 42/48).
   - **Waiting while the tower grows** (the owner). Two lines lost past three breaks' time are alike (lostAlike), and then the list put
     the hold before a line outside it: the board left alone to the frame it dies while a line that lives 200 frames longer waited. On
     main: the list does not put the hold before a line lost a break's time later. Switching, seeds 92 and 91: 44/48 and 44/48 (main
     42/48 each); holds over a later loss 245 to 166.
     Tried: the hold and a line alike only less than a break's time apart, everywhere (idea117) -- 39/48 and 41/48; the alike past three
     breaks' time keeps more boards than it costs.
     Tried: the line in progress kept past the horizon gives way to a line that lives standing it whole, not by a promise (idea118) --
     42/48 on seed 92 against 44/48.
   - **A pair swapped and swapped back within one line** (0.16% of swaps did nothing either time, most of them one line's own). Tried:
     the line judged without both swaps where they are the same two panels at the same columns (idea122) -- 59 lines trimmed, 365
     kept (the pair did something), true undos 3.3% to 3.0% of swaps, survived 39/48 and 43/48 against 44/48 and 44/48.
   - **The cursor near the top under garbage** (the owner: where the breaks are). Tried (idea104): under garbage a hold walks only
     toward a line that breaks, else under the lowest garbage -- cursor 269-271 cells a minute against 272, survival level. Open.
   - **Live is three times training here.** Live run 41565622573: 13.4% of swaps (27% of actions) made and unmade within 600 frames,
     against 4.5% (8.6%) in training -- most of them of a line played out, then swapped back by a later one: the plans do not know about
     each other. Tried in training, seeds 91 and 92 (about 40 games each, the rest lost to a fetch): a swap back of any pair pressed
     within 600 frames (idea106) 4.3-4.6%; the panels the line in progress was played for kept, put down, as a purpose and an intention
     (idea107) 4.0-4.2%; a line that is not the plan in progress charged the actions pressed for it (idea109) 4.2-4.4%, unfinished
     lines 37% to 34-35%. None moves training much; live is where it shows. Open.
9. **No wasted threes against garbage not ready to break.** A block still falling, landing or shaking is not broken by a clear beside
   it; the three pressed against it then breaks nothing. The wasted-three test counted any three touching garbage as a break: in test
   as a three that breaks no garbage (idea59).
10. **Play slow and steady** -- walk to the next swap early and unhurried rather than in bursts, within the time the line has; only
   where it does not change what is played. Open.
11. **Bigger combos, finish them above all.** A combo of 4 is close to useless; 5 is good; 8 and up are what matter -- what a combo
   sends grows faster than the panels it spends, so a couple more moves for an 8 over a 6 (or a 5 over a 4) is far less wasteful.
   The cost-per-gain arithmetic still rules a low stack. Finish them should go for the biggest combos only: it is allowed an 8 and
   up and plays 6s. The table and the causes: `ai/eval/plans/gambit-combos.md`.
   - On main: under garbage the rank and the searches keep the list as written (8 and up, not 5 and up), and of two breaks the
     earlier combo entry is first. Finish them on one seed: 8+ 9 to 40, cells sent by combos 2199 to 3324, survived 19 to 21
     (runs 2083, 2088). Two runs of a combo each grown a panel into an 8: 47 (run 2090). Next: why 6s are still the most played.
   - Why the two-column eight is rare in finish them (run 2196, switching, seed 92): 89% of its decisions are under garbage; in 90%
     the board has fewer than 4 rows of six panels at rest, and none is within 24 swaps where none is within 12. Offered, it lost to
     survival 638 of 720 times (the line played lived where it did not, or it was lost sooner) and the reserve 104.
     Tried: sorted through any cells of panels at rest, not only full rows (idea120) -- found in 21% of finish decisions against 9%,
     played 4 times, 8+ 0.11 a minute against 0.16, survived 40/48 and 39/48 against 44/48. The eight after each of the first four
     break lines (idea121) -- offered in 1% of finish decisions, played 4 times, survived 40/48. Under garbage an eight costs the
     board more than it gives here; what is open is building it where the board is clear.
     Tried: under garbage only an eight with a garbage cell beside a cell it clears, sorted through any cells at rest (idea123) --
     offered in 186 of 13414 finish decisions, played once, 8+ 0.15 a minute, survived 38/48.
   - **Set up outside the mode, fired in it** (the owner). The set-up key (rank.c 7d) puts the line nearer a two-column eight first
     among lines every key above leaves equal; on main its distance is 99 (none within 12 swaps of full rows) on most boards. Read
     through any cells of panels at rest, to 20 swaps, every mode (idea124): 8+ 0.14, survived 42/48. With finish them taking a line
     two swaps nearer as a set-up toward its first entry (the goal key): any line lost alike (idea125) 8+ 0.28 and 0.20, survived 42/48
     and 38/48; living lines only (idea126) 0.15 and 0.18, 44/48 and 42/48; living or lost three breaks' time away (idea127) 0.32 --
     9 of the eights two-column lines played on boards set up in the modes before -- 40/48 and 26/32. The distance in finish them only
     (idea128): round 1 23/24, 8+ 0.19 (main's round 1 23/24, 0.18). The set-up key only where the nearer line is lost no sooner
     (idea129): 22/24, 0.17. The owner: never at the cost of the board's life -- set up between moves, of what is free.
   - **Set up between moves** (the owner: a partial set-up, finished later; the time the board waits). Half the decisions are the hold.
     The set-ups lost to the hold at the same loss because lostOf charges the walk (8 frames an action): a set-up held to "lost no
     sooner" read as lost sooner on the hold's own frame. diesAt is the frame the board is lost, no walk charged. With it (idea138: one
     eight kept as the target across decisions, its next swap pressed where the decision is the hold and it costs nothing -- free8=;
     the first swaps of the cheapest eights offered as set-ups, ranked before the wait where lost no sooner and the reserve kept):
     survived 42/48 and 45/48 against 44/48 and 44/48, 329 set-up swaps pressed over the hold and 377 by the rank, 8+ 0.16 a minute
     against 0.16-0.19, an eight loaded at 2 of 477 switches into finish them. The set-ups are free and are played; on most boards no
     two-column eight is within 20 swaps, so there is little to set up.
     On main: the eight's shapes widened -- each swapped panel may also complete a three along the trigger row (a column run and its
     arm, a cross or an L; a side its arm alone). Switching, seeds 92 and 91: survived 43/48 and 46/48 (main 44/48 and 44/48), finish
     them 8+ 0.32 a minute (0.35, 0.33, 0.29 a run) against 0.16-0.19, an eight within 20 swaps on 940 holds of a round against 675.
     Next: the eight loaded before finish them (1 of 488 switches).
   - **Starved boards** (the owner, live: three rows or less, dying for want of panels). The material floor is 40 (the owner). On main:
     under garbage below the floor, a clear that breaks nothing goes after a line that keeps the panels and is lost a break's time away.
     96 games: boards under 20 panels 12.3% of decisions against 18.4%, large garbage 31/32 against 29/32, survived 88/96 against
     89/96; finish them 8+ 0.24 a minute against 0.32 -- the eights it gave up are open.
   - **The mode passed over for survival only** (the owner). goalMiss logs each decision where a line of the mode's first entry was
     offered, living as the line played or lost no sooner, and passed over, and the key. On main: the plan in progress living by the
     horizon alone and the walk-charged survival key no longer do it; build 24/24 and 20/24, pressure 22/24. Still passing it over (a
     run of build, about 27,000 decisions): the floor (k451, the owner's rule, ~250), the window's reserve (~100), garbage broken an
     action between two breaks (~60), the line in progress kept (~35), the chain carried on (the owner's rule, ~50).
   - **The mode debounced** (the owner): the enemy topped out calls finish them at once; any other change of mode is taken once it has
     been called for 60 frames, and a line begun in another mode is carried on only where it meets the new mode's first entry or
     breaks. Build: 20/24 and 20/24 on seed 62.
   - **The opener's second hand** (the owner: the opener has the time to set its chain up): where the opener holds with no garbage on
     the board, the trigger of the first entry's chain, else the set-up swap the trigger chain is longest after -- judged as any line.
     In the 24-game fights every such hold is on a board a block on its way kills whatever is pressed (20 offered, 0 lived), so it is
     measured live.
   - **No line is capped at a number of swaps**: the planner's and the extension's lines are kept as a tree, depth bounded by the
     clock (plan= /d the depth planned, /l the longest line kept). Build seed 74 (run 2249): planned to 63 deep in 698 decisions, a
     line over 16 swaps kept in 9 of about 33,000 -- the old cap was rarely what stopped a line. Survived 20/24.
   - **The break search's own board first**: lines carried from the last decision seeded the touch beam deep and crowded out a break
     the board had now -- in run 2249, 29 of 102 boards before the losses had a break the live search missed, 16 of them found again
     fresh in the same work. The beam from the board's own first swaps first, in half the share: 0 of 52 missed (run 2250, same
     games), build survived 22/24 against 20/24. Pressure still missed 21 of 86 (run 2251): many need more than half the share. On
     main one beam over the whole share, lines carried on holding at most half of it: pressure 6 of 51 missed, survived 22/24 against
     21/24 (run 2254, same games).
   - **Low, spend less and break** (the owner): below the floor, a clear that breaks nothing goes after a line that keeps the panels
     with garbage on its way as well as on the board. Build seed 78: 22/24 against 19/24, large garbage 7/8 against 5/8 (runs 2260,
     2256). Main on seed 78 before it: finish them 22, big chain 21, pressure 19 (runs 2257-2259).
   - **Under garbage, break; while it pops, set up** (the owner: it holds too much, it waits too long to break garbage, it can do
     things while garbage is breaking). Under garbage a break goes before a line that breaks none and meets nothing the mode asks (both
     living, or lost alike and the break no sooner; below the floor before any); while a slab pops a set-up goes before the hold, the
     reserve kept. Seed 78: big chain 22/24 against 21, pressure 22/24 against 21 (runs 2266, 2267 against 2262, 2261); the hold
     while a slab pops 50% of those decisions against 67%. What holds it now is the input window (holdOver=k520: 10-22 actions left
     of a break's 20): the next lever is fewer actions spent on lines put down (31% of them).
     Any line before the hold while a slab pops took build to 17/24 (run 2268): survival lines pressed for nothing (817 swaps against
     139) spent the window. On main only a set-up, a lineup, a line toward the next break or nearest the list: build 23/24 (run 2270).
   - **Every mode together** (run 2276, seed 80, 6e020486's play): 86/96 -- build 23, finish them 22, pressure 21, big chain 20. Of the
     boards before the losses 207 of 226 had no break to find; the hold never passed over a break line lost later (holdLate) -- the holds
     over longer lines are the window's reserve (k527) and the floor's spend rule (k455), over lines that break nothing. What is left is
     the board starved under large and constant garbage: material under garbage 24 in large garbage, under 20 panels 14-18% of it.
     Tried and not kept: wasted threes ranked against the line (idea157, 158: 2.00 to 1.75 a minute, the threes beside bigger breaks);
     the panels kept a row below the floor (idea160: big chain 21, pressure 20, finish 21 -- material no higher). A change of a game a
     mode is under one run's noise: the next measures are 48 games a mode.
   - **On main tonight** (finish them, the worst, sets 82 and 84): the walk never turns a life into a death (lostOf's walk charge put a
     hold before a break line alive 140 frames longer; the mode passed over 291 against 459); a set-up while the board's own chain falls
     (45/48 against 43/48). Threes break only topped out (the owner; finish them 41/48 against 44/48 on sets 80 and 82). Low, a spend held
     back only where it buys less than a break's time (43/48 against 41/48).
   - **Set up, then undone** (the owner, watching: setup and unsetup while waiting, nothing changing): 8% of swaps move a panel that a
     swap 3 s before moved the other way. Each decision plans afresh, a one-swap set-up is never carried (carryOf: more than one swap),
     and only the exact pair swapped back is caught (rules.c swappedBack, judge.c noops). A memory of the last pair pressed (idea168) did
     not change it (8.1% to 7.9%, 43/48 against 45/48): most of it is lines in progress, and the host hands on only the last pair. Next:
     the host hands every pressed swap with the line it belongs to, and a line's first swap may not move back what another line moved.
   - **Live, against Gambit_100** (gambit-w100: 100 actions a window against the standard 76). Over loose sync every attack is known
     only once it is in the stack's own queue: played that way in training (gambit-24 `blind`), finish them is 13/24 where the same
     games with the telegraph are 23/24 (run 2299). On main: the Lua client reads the copy of the opponent played here as the forecast
     -- what it stages and each transit not yet finished on its own stopWatch (8f2b3f8b); a fight's divergences and unforeseen garbage
     say whether it holds. On main: GC_GAMBIT_WORKERS unset is 4, so a fight searches on the four workers training measures (a fight
     started without it ran on none, its search time half of training's).
   - **Every death, live and in training, is the break search cut by the clock**: in a lost game's last 900 frames it is cut in 13 to
     38 of 36 to 74 decisions. A board where it found nothing in 200 ms had a break 8 swaps deep, found in 3.4 s (2291 large_garbage-8,
     frame 461). breakNear, the beam's guide, brings panels along their rows only, never over a gap they fall through. Next: a guide
     that counts a fall.
   - **Lost alike by the frame each is lost too** (idea171, 45d8aea2): a line lost at 293 and the hold at 97 were alike once the walk
     was charged, and the mode's key took the hold. With it 45/48 against 45/48 (runs 2300, 2301): main's three losses survived, three
     others lost; with the set-up undone key too (idea172) 45/48 (runs 2302, 2303). Neither better.
   - **Under garbage, away from it, beside the hold** (1'g, rank.c): a line that walks to the bottom goes after the hold. Kept only
     between moves (idea173) 39/48 against 45/48 (runs 2304, 2305): the hold there is right.
   - **The break search's share under garbage** (answer.c UNDER_SHARE 0.75): 0.9 (idea174) 43/48 against 45/48 (runs 2306, 2307).
   - Across five variants on sets 82 and 84 no game was lost more than twice: each loss is the clock's draw, about 6% a game, not a
     game the bot cannot play.
   - **Main, each mode** (runs 2291-2326): switching 24/24 (set 82); pressure 65/72 (19, 24, 22 on sets 82, 84, 86); finish them 45/48;
     big chain 43/48 (22, 21); build 41/48 (21, 20) -- build the worst. One build, 19 and 24 on two sets: a 24-game run tells
     a gap of a game or two from none. The set-up undone key (idea169) on pressure 44/48 against 43/48.
   - **Pressure's deaths are the window, not the search** (run 2308, factory-8): on the last boards a break is there -- the search
     alone finds it in 55-153 ms natively -- but 5-7 swaps across the board, 30-odd actions, with 20-23 left in the window. 36% of
     the window goes on lines not played out (13,996 of 38,445 actions): the next lever is fewer lines begun and dropped.
     Not better: the line in progress put down only for a loss a break's time later (idea175, 44/48 against 43/48); a hold keeping
     the line in progress (idea176, 67/72 against 65/72 on sets 82, 84, 86) -- neither moved the window spent on lines not played out
     (35%). 99% of the lines of two swaps or more played are handed on (cof=, run 2316): "none carried by the last answer" is not a
     line left unhanded. Of the decisions that found none in progress (c16=, run 2320, pressure 22/24 on set 88): 11,740 after a
     hold, 2,715 after a move of one swap -- a move's walk the next decision can drop, since nothing of a one-swap line is carried.
     Next: the frame loop counts the move among the line's swaps pressed (front.c lineOfPressed counts only the swaps handed on after
     it), so the move itself can be carried until it is pressed. Tried by the move's two panels (idea177): 62/72 against 65/72, and
     the actions moved from "none carried" to "all pressed" whole (35% still) -- the move's panels had shifted before it was pressed,
     the walk lost either way.
   - **A 24-game run is noisy**: the same behaviour on the same seed gave 20/24 and 23/24 (runs 2247, 2248) -- the clock decides how
     far each search goes, and the runner's clock differs run to run. A gap of 3 games in 24 is not a measurement.
   - The players who make them (live replays, `ai/eval/plans/gambit-combos.md`): Tanycanayt 1.46 combos of 8+ a minute, PDR_Lava
     0.89, Gambit 0.08 in the same games. Most are two vertical runs in adjacent columns, built by sorting the rows, then one swap.
11b. **Finish them whenever the enemy is topped out**, its stop time or not (the owner: their stack above the board, so that they could
   die). Live, a topped enemy with more than 120 frames of stop was played in pressure -- 40% of the topped time in runs 41502147856
   and 41565622573 (6801 and 11060 decisions). The rule asks only `enemy.topped` and has no deadline.
12. **Live deaths are stack-outs, not starvation** (Ranmaru_TEST_CPU run 41439012381, 6 losses of 30). The boards had 34-57 panels,
   9-12 rows high, when they died. Twice the opponent sat topped out with no stop time while Gambit held beside lines that threw 4-5
   blocks and lived as long (g28 at 19334-19365, g30 at 3972): those lines were outside the finish list, and Gambit has no model of
   the opponent dying. A board fuller than it lives longest with is flagged (`full=1`) and nothing acts on it. The owner: no attack
   outside the list -- it just should not die.
   - Run 41467121001 (6 losses of 40): five stack-outs, 47-54 panels. A three let through on a stack near the top costs survival in
     training badly (switching 43/48 to 18-37/48 on seed 91), so the stack is not cleared that way.
   - THE TRUTH FALTERS LIVE: every live game diverges about once in 1,500 frames, always garbageCreatedCount N vs N+1 -- the game lands
     a block the frame loop knew was due a frame before it does. Each comes the frame after the host logs a landing while the
     opponent's copy runs 7-9 frames behind (0-1 behind: none); 0 rollbacks. Three of the six losses had one within 70 frames of the
     end (g04 7879, g12 8034, g28 1067: forecast lost at 298, dead 8 frames later). Each follows a transit landing the frame it was due
     (190 of 600 such landings; none of 1,474 others): upstream delivers before the frame runs, after its keys are asked, and the frame
     loop landed it a frame late. On main (24c7c4d9): landed before the frame on an engine without GarbageDelivery. Next: the next live
     run's DIVERGED count.
