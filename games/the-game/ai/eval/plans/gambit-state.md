# Gambit's carried state: what was pressed follows the answer played; what was found is kept

A decision leaves two kinds of state for the next.

- **What it pressed**, the board's history: the line in progress (`theCarry`, `theCarryNext`), the break search's frontier and the
  planner's lines past the move (`theKept`, `thePlanKept`), the pair kept from being swapped back (`lastA` .. `blockUntil`), the hold
  (`C2.idle`). These hold only if the answer was pressed.
- **What it found**, ideas about the board: the intentions (`theIntents`) -- lines that clear, chain, combo or break, each anchored to a
  bottom-row panel. These are true whatever was played. Several live at once; each is judged again on the engine every decision and let
  go only when it no longer makes something or is outranked.

The frame loop plays only the answers it takes. An answer that comes back after its question was replaced (`unasked`), late, refused
or guarded is never played -- 1153 combo_storm-6: ten of 887 decisions.

## The rule

What was pressed: the state a decision starts from is the state the answer the frame loop last played left -- never merely the last
decision's. What was found: kept, from every decision, played or not -- the line an unplayed answer chose is an idea too.

## The pieces

1. The frame loop says it: every question carries `played`, the id of the last answer it put in its plan (front.c take: the swap, the
   hold, the raise put off), 0 none yet; the host hands it over with `gb_played` before the question.
2. What was pressed is kept per answer in one ring, `Carried` (answer.c): `carriedKeep(qid)` at the end of every decision,
   `carriedResume()` at the start of the next, before the mode's switch is read (a state kept under another mode is let go, as a switch
   lets it go). A new game's ring holds one state, the empty one, as answer 0.
3. What was found is one pool, outside the ring: the intentions. When a decision resumes from an older answer, the line in progress the
   unplayed answer left -- its move and the rest, and the break it lived by next -- goes first in the pool (decide.c `intentOfCarry`),
   found again by its anchor and judged whole, like every intention.
4. A host that does not say (no `gb_played`: the JavaScript host, the C checks) gets the last decision's state.
5. It is counted, not trusted: each decision logs `resumed=ID/N` when it started from an answer older than the last decision (N: the
   lines not pressed kept as ideas), `lost=ID` when the ring no longer held the answer played; the summary counts them (`state:`), and
   Gambit 24 is red on a lost one ("The state held").

The board itself is never carried: every decision reads it from its question. The dig (`digSeen`), the readiness kept
(`readyKept`), the saving band and the opener are read off boards the game stood on, true whatever was played, and are not in the ring.
