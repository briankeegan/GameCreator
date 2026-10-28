// WHAT A NATIVE HOST GIVES GAMBIT (native.c): the heap, the monotonic clock, one lock with its wait, a thread, and the run's log.
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <time.h>
#include <sched.h>
#include <string.h>
#include <sys/resource.h>
#include <signal.h>
#include <unistd.h>
#include <execinfo.h>
#include <dlfcn.h>

void *paHeap(unsigned long n) { return calloc(1, (n + 15) & ~15ul); }
// The calling thread's own account: its CPU time (ms), the times it was taken off its core and gave it up, its page faults.
void hostThreadStats(double *out) {
  struct timespec t; clock_gettime(CLOCK_THREAD_CPUTIME_ID, &t);
  struct rusage u; getrusage(RUSAGE_THREAD, &u);
  out[0] = (double)t.tv_sec * 1e3 + (double)t.tv_nsec / 1e6; out[1] = (double)u.ru_nivcsw; out[2] = (double)u.ru_nvcsw;
  out[3] = (double)(u.ru_minflt + u.ru_majflt);
}
double hostNowMs(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (double)t.tv_sec * 1e3 + (double)t.tv_nsec / 1e6; }

static pthread_mutex_t mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t cv = PTHREAD_COND_INITIALIZER;
void hostLock(void) { pthread_mutex_lock(&mu); }
void hostUnlock(void) { pthread_mutex_unlock(&mu); }
void hostWait(void) { pthread_cond_wait(&cv, &mu); }
void hostSignal(void) { pthread_cond_signal(&cv); }
// (and the frame loop's own wait, in lockstep: for Gambit's thread to be done with every question asked -- native.c gn_frame)
static pthread_cond_t cvDone = PTHREAD_COND_INITIALIZER;
void hostWaitDone(void) { pthread_cond_wait(&cvDone, &mu); }
void hostSignalDone(void) { pthread_cond_signal(&cvDone); }
int hostLockstep(void) { const char *l = getenv("GC_GAMBIT_LOCKSTEP"); return l && *l == '1'; }
// (A REPLAY'S FORCED OPTION: GC_GAMBIT_FORCE=F:K -- the first decision at or after frame F plays the order's option K, 0 its first;
// -1 none)
int hostForce(int *at, int *k) { const char *f = getenv("GC_GAMBIT_FORCE"); *at = -1; *k = 0; return f && sscanf(f, "%d:%d", at, k) == 2 && *at >= 0; }
// GAMBIT'S THREAD: the room the main thread has for its stack (the searches keep their scratch there), and the cores GC_GAMBIT_CPUS
// names ("1-3", "2,3"), so it thinks beside the game rather than on the game's own core; the workers on GC_GAMBIT_WORKER_CPUS's
// (else Gambit's), so they take a core of their own rather than Gambit's.
static void *(*threadFn)(void *);
static void pinnedTo(const char *cpus) {
  if (cpus && *cpus) {
    cpu_set_t set; CPU_ZERO(&set);
    for (const char *p = cpus; *p;) {
      int a = atoi(p), b = a;
      while (*p >= '0' && *p <= '9') p++;
      if (*p == '-') { p++; b = atoi(p); while (*p >= '0' && *p <= '9') p++; }
      for (int c = a; c <= b && c < CPU_SETSIZE; c++) CPU_SET(c, &set);
      if (*p == ',') p++; else if (*p) break;
    }
    if (CPU_COUNT(&set)) pthread_setaffinity_np(pthread_self(), sizeof set, &set);
  }
}
static void pinned(void) { pinnedTo(getenv("GC_GAMBIT_CPUS")); }
static void *threadStart(void *arg) { pinned(); pthread_setname_np(pthread_self(), "gambit"); return threadFn(arg); }
int hostThread(void *(*fn)(void *)) {
  pthread_t t; pthread_attr_t at;
  threadFn = fn;
  pthread_attr_init(&at); pthread_attr_setstacksize(&at, 64ul << 20);
  int r = pthread_create(&t, &at, threadStart, 0);
  pthread_attr_destroy(&at);
  return r;
}

// THE ENGINE'S WAITS (search.h's pool, natively): a futex on the word.
#include <linux/futex.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <limits.h>
int hostFutexWait(int *p, int v) { return (int)syscall(SYS_futex, p, FUTEX_WAIT_PRIVATE, v, NULL, NULL, 0); }
int hostFutexWake(int *p, int n) { return (int)syscall(SYS_futex, p, FUTEX_WAKE_PRIVATE, n < 0 ? INT_MAX : n, NULL, NULL, 0); }
// THE WORKERS: GC_GAMBIT_WORKERS of them (at most `most`; none when it is not set), each started with its id (1, 2, ...), pinned where
// Gambit is (GC_GAMBIT_CPUS) and named gworkerN, as Gambit's own thread is named gambit (eval/cpu_watch.sh counts them by name). The
// number started.
static void *(*workerFn)(void *);
// (each at the idle class, SCHED_IDLE: it runs only on a CPU nothing else wants, so it never takes a cycle from Gambit's own thread
// or the game's -- on a runner whose four threads are two cores' worth, a worker at the normal class took them and lost games)
static void *workerStart(void *arg) {
  const char *w = getenv("GC_GAMBIT_WORKER_CPUS");
  if (w && *w) pinnedTo(w); else pinned();
  char name[16]; snprintf(name, sizeof name, "gworker%ld", (long)arg); pthread_setname_np(pthread_self(), name);
  struct sched_param sp = { 0 }; pthread_setschedparam(pthread_self(), SCHED_IDLE, &sp);
  return workerFn(arg);
}
// A THREAD AT THE IDLE CLASS beside the workers, on their CPUs, named `name`: 0 started
static void *(*idleFn)(void *); static const char *idleName;
// (on GC_GAMBIT_SPARE_CPU where it is set -- the game's own CPU, eval/training.sh: at the idle class it takes only the cycles the game
// leaves, about seven tenths of that CPU -- else where the workers are)
static void *idleStart(void *arg) {
  const char *w = getenv("GC_GAMBIT_SPARE_CPU");
  if (!w || !*w) w = getenv("GC_GAMBIT_WORKER_CPUS");
  if (w && *w) pinnedTo(w); else pinned();
  pthread_setname_np(pthread_self(), idleName);
  struct sched_param sp = { 0 }; pthread_setschedparam(pthread_self(), SCHED_IDLE, &sp);
  return idleFn(arg);
}
int hostIdleThread(void *(*fn)(void *), const char *name) {
  pthread_t t; pthread_attr_t at;
  idleFn = fn; idleName = name;
  pthread_attr_init(&at); pthread_attr_setstacksize(&at, 64ul << 20);
  int r = pthread_create(&t, &at, idleStart, 0);
  pthread_attr_destroy(&at);
  return r;
}
int hostWorkers(void *(*fn)(void *), int most) {
  const char *e = getenv("GC_GAMBIT_WORKERS");
  int n = e && *e ? atoi(e) : 0;
  if (n > most) n = most;
  if (n < 0) n = 0;
  workerFn = fn;
  for (int i = 0; i < n; i++) {
    pthread_t t; pthread_attr_t at;
    pthread_attr_init(&at); pthread_attr_setstacksize(&at, 64ul << 20);
    int r = pthread_create(&t, &at, workerStart, (void *)(long)(i + 1));
    pthread_attr_destroy(&at);
    if (r) return i;
  }
  return n;
}
static FILE *logFile;
static pthread_mutex_t logMu = PTHREAD_MUTEX_INITIALIZER;
int hostOpenLog(const char *path) { if (!logFile) logFile = fopen(path, "a"); return logFile ? 0 : -1; }
// A CRASH, SAID WHERE IT HAPPENED: on a fault in any thread of the game's process, the faulting thread's stack -- each frame its file
// and its offset in it -- to stderr (the client's log) and the run's log, then the fault let through as the process would take it.
// training.sh resolves the frames in libgambit.so (built with -g) with addr2line.
static void crashFrames(int fd, int sig) {
  void *f[64]; int n = backtrace(f, 64);
  dprintf(fd, "GAMBIT CRASH signal %d, %d frames\n", sig, n);
  for (int i = 0; i < n; i++) {
    Dl_info d;
    if (dladdr(f[i], &d) && d.dli_fname) dprintf(fd, "GAMBIT FRAME %d %s 0x%lx\n", i, d.dli_fname, (unsigned long)((char *)f[i] - (char *)d.dli_fbase));
    else dprintf(fd, "GAMBIT FRAME %d ? %p\n", i, f[i]);
  }
}
static void crashOut(int sig) {
  crashFrames(2, sig);
  if (logFile) crashFrames(fileno(logFile), sig);
  signal(sig, SIG_DFL);
  raise(sig);
}
void hostCrashHandler(void) {
  static char alt[1 << 16];
  stack_t ss = { .ss_sp = alt, .ss_size = sizeof alt, .ss_flags = 0 };
  sigaltstack(&ss, 0);   // (the handler's own stack: a fault from a stack run out still says where)
  { void *f[1]; backtrace(f, 1); }   // (its library loaded now, not inside a handler)
  struct sigaction sa; memset(&sa, 0, sizeof sa);
  sa.sa_handler = crashOut; sa.sa_flags = SA_ONSTACK | SA_RESETHAND;
  int sigs[] = { SIGSEGV, SIGBUS, SIGFPE, SIGILL, SIGABRT };
  for (int i = 0; i < 5; i++) sigaction(sigs[i], &sa, 0);
}
void hostLog(const char *s) {
  if (!logFile) return;
  pthread_mutex_lock(&logMu);
  fputs(s, logFile); fputc('\n', logFile); fflush(logFile);
  pthread_mutex_unlock(&logMu);
}
