// Memory and threads, shared by the engines (engine.c, pa.c): each defines
// Board before including this.
// ------------------------------------------------------------------ memory
// THREADS. engine-mt.wasm is this file on shared memory: every thread is an
// instance of it, with its own stack and its own copy of what is
// _Thread_local here. Memory is taken under a lock; each thread keeps its own
// free boards (a list per thread, so the main thread can hand boards over
// while the others wait).
extern unsigned char __heap_base;
static unsigned long heapTop;
static int32_t heapLock;
static void *grab(unsigned long n) {
  while (__atomic_exchange_n(&heapLock, 1, __ATOMIC_ACQUIRE)) {}
  if (!heapTop) heapTop = ((unsigned long)&__heap_base + 15) & ~15ul;
  n = (n + 15) & ~15ul;
  unsigned long at = heapTop, end = at + n, have = __builtin_wasm_memory_size(0) * 65536ul;
  void *r = (void *)at;
  if (end > have && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) == (unsigned long)-1) r = 0;
  else heapTop = end;
  __atomic_store_n(&heapLock, 0, __ATOMIC_RELEASE);
  return r;
}
#define MAXTHREADS 16
#ifdef THREADS
#define LOCAL _Thread_local
#else
#define LOCAL
#endif
static LOCAL int32_t thId;          // 0 on the thread that runs the search
static Board *freeOf[MAXTHREADS];
static int32_t freeCount[MAXTHREADS];
#define EXPORT(name) __attribute__((export_name(#name)))
EXPORT(nb_new) Board *nb_new(void) {
  Board *b = freeOf[thId];
  if (b) { freeOf[thId] = *(Board **)b; freeCount[thId]--; return b; }
  return (Board *)grab(sizeof(Board));
}
EXPORT(nb_free) void nb_free(Board *b) { *(Board **)b = freeOf[thId]; freeOf[thId] = b; freeCount[thId]++; }
// Spare boards on thread k's list; k = -1: the heap's top, in 64 KiB pages.
EXPORT(nb_pool_stat) int nb_pool_stat(int k) { return k < 0 ? (int)(heapTop >> 16) : k < MAXTHREADS ? freeCount[k] : 0; }
static void copyBoard(Board *dst, const Board *src) { memcpy(dst, src, BOARD_BYTES(src)); }
EXPORT(nb_copy) void nb_copy(Board *dst, Board *src) { copyBoard(dst, src); }

