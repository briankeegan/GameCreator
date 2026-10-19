// WHAT A NATIVE HOST GIVES GAMBIT (native.c): the heap, the monotonic clock, one lock with its wait, a thread, and the run's log.
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <pthread.h>
#include <time.h>
#include <sched.h>
#include <string.h>
#include <sys/resource.h>

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
// GAMBIT'S THREAD: the room the main thread has for its stack (the searches keep their scratch there), and the cores GC_GAMBIT_CPUS
// names ("1-3", "2,3"), so it thinks beside the game rather than on the game's own core.
static void *(*threadFn)(void *);
static void pinned(void) {
  const char *cpus = getenv("GC_GAMBIT_CPUS");
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
static void *threadStart(void *arg) { pinned(); return threadFn(arg); }
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
// THE WORKERS: GC_GAMBIT_WORKERS of them (at most `most`; none when it is not set), each started with its id (1, 2, ...) and pinned
// where Gambit is (GC_GAMBIT_CPUS). The number started.
static void *(*workerFn)(void *);
static void *workerStart(void *arg) { pinned(); return workerFn(arg); }
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
void hostLog(const char *s) {
  if (!logFile) return;
  pthread_mutex_lock(&logMu);
  fputs(s, logFile); fputc('\n', logFile); fflush(logFile);
  pthread_mutex_unlock(&logMu);
}
