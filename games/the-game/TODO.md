# Newsey — running to-do list

1. **BitBot plans the opening during the countdown.** The board is shown
   for about three seconds before play starts, so the first decision has
   that long, not one frame's budget, to plan its opening. Not urgent; it
   may improve the start board.

2. **The game tells BitBot who is across the table.** Before each frame the
   host calls `front_opponent(fid, present, topped)` (`native/front.c`):
   `present` is 1 in any match with another player, and `topped` is 1 once
   that player's stack has lost. With an opponent present the bot assumes no
   first wave (no phantom slab, and the opening ends) and uses idle time for setups, combos and chains; `topped`
   makes a combo go before a chain (`attackCmp`), otherwise a chain goes
   first. Never called, as in the survival scan, it is alone: the first wave
   is assumed. The game's own bot hookup (panel-game, `BitBotNative.lua`) must
   declare and call it each frame.

3. **The game tells BitBot the time.** The bot holds itself to the think budget
   from what the host tells it (`bot_time(ceilingMs, lastMs, leftMs)` in
   `native/bot.c`): the ceiling from `ThinkBudget:snapshot()`, what the last
   frame's thinking was charged, and the time left in this frame before the
   bot is called. `ai/eval/lua/train.lua` does it; the game's own bot hookup
   (panel-game, `BitBotNative.lua`) must call it before each frame, or the bot
   keeps the start values and no clock guard.
