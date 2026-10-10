# Newsey — running to-do list

1. **BitBot plans the opening during the countdown.** The board is shown
   for about three seconds before play starts, so the first decision has
   that long, not one frame's budget, to plan its opening. Not urgent; it
   may improve the start board.

2. **BitBot is told when the other player is topped out.** The bot ranks a
   combo against a chain by whether the opponent is topped out (combos
   first) or not (chains first), reading the input `IN_OPPTOPPED`
   (`native/bot.c`). Nothing sets it yet: the front needs a setter the game
   calls each frame from the opponent's stack, and `PuyoCpu.onPA`'s `opp`
   should pass it. Until then every opponent counts as not topped out, so
   chains come first. The survival scan has no opponent to set it from.
