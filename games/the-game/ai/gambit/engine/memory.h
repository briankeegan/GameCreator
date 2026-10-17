// Memory and threads, shared by the engines (engine.c, pa.c): each defines
// Board before including this.
// ------------------------------------------------------------------ memory
// THREADS. engine-mt.wasm is this file on shared memory: every thread is an
// instance of it, with its own stack and its own copy of what is
// _Thread_local here. Memory is taken under a lock; each thread keeps its own
// free boards (a list per thread, so the main thread can hand boards over
// while the others wait).
#ifdef PA_LIB
// Linked into the bot (bit.c): one heap, the bot's.
void *paHeap(unsigned long n);
static unsigned long heapTop;
static void *grab(unsigned long n) { return paHeap(n); }
#else
extern unsigned char __heap_base;
static unsigned long heapTop;
static int32_t heapLock;
static void *grab(unsigned long n) {
  while (__atomic_exchange_n(&heapLock, 1, __ATOMIC_ACQUIRE)) {}
  if (!heapTop) heapTop = ((unsigned long)&__heap_base + 15) & ~15ul;
  n = (n + 15) & ~15ul;
  // 32-bit: a block that would run past 4 GB is refused, not wrapped.
  unsigned long at = heapTop, end = at + n, have = __builtin_wasm_memory_size(0) * 65536ul;
  void *r = (void *)at;
  if (end < at) r = 0;
  else if ((have == 0 || end > have) && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) == (unsigned long)-1) r = 0;
  else heapTop = end;
  __atomic_store_n(&heapLock, 0, __ATOMIC_RELEASE);
  return r;
}
#endif
#define MAXTHREADS 16
#ifdef THREADS
#define LOCAL _Thread_local
#else
#define LOCAL
#endif
#if defined(THREADS) || !defined(__wasm__)
static _Thread_local int32_t thId;   // 0 on the thread that runs the search
#else
static int32_t thId;
#endif
// Each thread's spare boards, on a cache line of its own: no thread writes
// another's line on a step.
static struct { Board *free; int32_t count; int32_t pad[14]; } __attribute__((aligned(64))) pool_[MAXTHREADS];
// Counters, per thread (ns_frame_stats sums them): frames per step kind
// 0..7, steps per kind 8..15, frames full, quiet, jumped, countdown 16..19.
static struct { int32_t v[32]; } __attribute__((aligned(64))) stat_[MAXTHREADS];
#define STAT(i) stat_[thId].v[i]
static int32_t statTake(int i) { int32_t v = 0; for (int k = 0; k < MAXTHREADS; k++) { v += stat_[k].v[i]; stat_[k].v[i] = 0; } return v; }
#define freeOf(k) pool_[k].free
#define freeCount(k) pool_[k].count
#define EXPORT(name) __attribute__((export_name(#name)))
// SPARES: boards any thread may take, under a lock, before the heap is
// grown -- a thread that frees more than it takes (the searching thread lets
// the other threads' boards go) hands its surplus round through them
// (search.h runPhase).
static Board *spareOf;
static int32_t spareCount, spareLock;
static Board *takeSpare(void) {
  while (__atomic_exchange_n(&spareLock, 1, __ATOMIC_ACQUIRE)) {}
  Board *b = spareOf;
  if (b) { spareOf = *(Board **)b; spareCount--; }
  __atomic_store_n(&spareLock, 0, __ATOMIC_RELEASE);
  return b;
}
EXPORT(nb_new) Board *nb_new(void) {
  Board *b = freeOf(thId);
  if (b) { freeOf(thId) = *(Board **)b; freeCount(thId)--; }
  else if (!(b = takeSpare())) b = (Board *)grab(sizeof(Board));
  return b;
}
EXPORT(nb_free) void nb_free(Board *b) { *(Board **)b = freeOf(thId); freeOf(thId) = b; freeCount(thId)++; }
// Spare boards on thread k's list; k = -1: the heap's top, in 64 KiB pages; k = -2: SPARES.
EXPORT(nb_pool_stat) int nb_pool_stat(int k) { return k == -2 ? spareCount : k < 0 ? (int)(heapTop >> 16) : k < MAXTHREADS ? freeCount(k) : 0; }
#ifdef COPY_BOARD
static void copyBoard(Board *dst, const Board *src) { COPY_BOARD(dst, src); }
#else
static void copyBoard(Board *dst, const Board *src) { memcpy(dst, src, BOARD_BYTES(src)); }
#endif
EXPORT(nb_copy) void nb_copy(Board *dst, Board *src) { copyBoard(dst, src); }

