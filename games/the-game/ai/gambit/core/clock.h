// THE CLOCK: one budget for a decision, in work. Every step a search plays goes through step() (core/nodes.h), which charges the
// frames the engine played for it; past the budget, or past the host's time (abort_poll, read every CLOCK_POLL units), every step
// comes back "not there" (STEP_NULL), so every search stops at the same moment and none keeps a clock of its own.
#ifndef GAMBIT_CLOCK_H
#define GAMBIT_CLOCK_H
int abort_poll(void);   // the host's: 1 aborted, 2 past its deadline, 0 on time
typedef long long int64_t;   // (engine/libc.h has the 32-bit ones)
#define CLOCK_POLL 400
static int64_t clockWork, clockCap, clockNextPoll;
static int32_t clockSpent;   // 1 once the budget or the host's time ran out: it stays out until clockStart
// A decision's budget: cap units of work (0: only the host's time bounds it).
static void clockStart(int64_t cap) { clockWork = 0; clockCap = cap; clockNextPoll = CLOCK_POLL; clockSpent = 0; }
// A SEARCH'S SHARE: within the decision's budget, a search may stop sooner -- at clockWork + share. Shares nest; past one the search's
// steps come back "not there" as past the budget, and the decision's clock runs on for the next.
static int64_t clockShare = 0;   // the work at which the current share ends (0: none)
static int64_t clockShareBegin(int64_t share) { int64_t old = clockShare; clockShare = share > 0 ? clockWork + share : 0; return old; }
static void clockShareEnd(int64_t old) { clockShare = old; }
static int clockOut(void) {
  if (clockShare && clockWork >= clockShare) return 1;
  if (clockSpent) return 1;
  if (clockCap > 0 && clockWork >= clockCap) clockSpent = 1;
  else if (clockWork >= clockNextPoll) { clockNextPoll = clockWork + CLOCK_POLL; if (abort_poll()) clockSpent = 1; }
  return clockSpent;
}
static void clockCharge(int64_t units) { clockWork += units > 0 ? units : 1; }
EXPORT(gb_clock_start) void gb_clock_start(int cap) { clockStart(cap); }
EXPORT(gb_clock_work) int gb_clock_work(void) { return (int)clockWork; }
EXPORT(gb_clock_spent) int gb_clock_spent(void) { return clockSpent; }
#endif
