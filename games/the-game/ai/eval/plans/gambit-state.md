# Gambit's carried state belongs to the answer the frame loop played

A decision leaves state for the next: the line in progress (`theCarry`, `theCarryNext`), the break search's frontier and the
planner's lines (`theKept`, `thePlanKept`), the intentions (`theIntents`), the line toward a break (`towardPlayed`, `towardRest`),
the pairs kept from being swapped back (`lastA` .. `blockUntil`), the floor's saving band, the opener, and the last life (`lifeLived`).

The frame loop plays only the answers it takes. An answer that comes back after the question was replaced (`unasked`), late, refused or
guarded is never played -- 1153 combo_storm-6: ten of 887 decisions -- yet its decision had already changed the state, and the next
decision built on a line nobody pressed (14936: a break of 28 carried without its move, judged to break nothing, dropped).

## The rule

The state a decision starts from is the state the answer the frame loop last played left -- never merely the last decision's.

## The pieces

1. The frame loop says it: every question carries `played`, the id of the last answer it put in its plan (front.c take: the swap, the
   hold, the raise put off), 0 none yet; the host hands it over with `gb_played` before the question.
2. One place holds the state: `Carried` (answer.c), every piece above in one struct, kept per answer in a ring -- `carriedKeep(qid)` at
   the end of every decision, `carriedResume()` at the start of the next, before the mode's switch is read (a state kept under another
   mode is let go, as a switch lets it go). A new game's ring holds one state, the empty one, as answer 0. The decision's own variables are what it works on; the
   ring is what is true.
3. A host that does not say (no `gb_played`: the JavaScript host, the C checks) gets the last decision's state.
4. It is counted, not trusted: each decision logs `resumed=ID` when it started from an answer older than the last decision, `lost=ID`
   when the ring no longer held the answer played; the summary counts both (`state:`), and Gambit 24 is red on a lost one ("The state
   held").

The board itself is never carried: every decision reads it from its question. The dig (`digSeen`) is boards the game stood on, true
whatever was played, and is not in the ring.
