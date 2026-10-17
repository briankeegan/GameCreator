// THE CLOCK: one deadline for a decision, in the host's milliseconds (clock_ms, the one import beside abort_poll), and a share of it
// for each search. Every step a search plays goes through step() (core/nodes.h); past the share in force, or the decision's deadline,
// or the host's abort, every step comes back "not there" (STEP_NULL), so every search stops at the same moment and none keeps a clock
// of its own. Work (the engine's frames) is counted beside it, for the log.
#ifndef GAMBIT_CLOCK_H
#define GAMBIT_CLOCK_H
typedef long long int64_t;   // (the engine's libc.h has the 32-bit ones)
double clock_ms(void) __attribute__((import_module("env"), import_name("clock_ms")));
static double clockDue = 0, clockShare = 0;   // the decision's deadline and the share in force (ms since the epoch; 0: none)
static int64_t clockWork;
static int32_t clockAborted;
static double nowMs(void) { return clock_ms(); }
// A decision begun: its deadline (0: none).
static void clockStart(double due) { clockDue = due; clockShare = 0; clockWork = 0; clockAborted = 0; }
// A SEARCH'S SHARE: within the decision's deadline, a search may stop sooner -- at `by`. Shares nest; the old one comes back after.
static double clockShareBegin(double by) { double old = clockShare; clockShare = by; return old; }
static void clockShareEnd(double old) { clockShare = old; }
static int64_t clockPoll;
static int clockOut(void) {
  if (clockAborted) return 1;
  if (clockWork >= clockPoll) { clockPoll = clockWork + 400; if (abort_poll() == 1) { clockAborted = 1; return 1; } }
  if (!clockDue && !clockShare) return 0;
  double t = nowMs();
  return (clockShare && t >= clockShare) || (clockDue && t >= clockDue);
}
static void clockCharge(int64_t units) { clockWork += units > 0 ? units : 1; }
EXPORT(gb_clock_start) void gb_clock_start(double due) { clockStart(due); }
EXPORT(gb_clock_work) int gb_clock_work(void) { return (int)clockWork; }
#endif
