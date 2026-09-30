// What the engines take from a C library, which they are built without
// (-nostdlib): the integer types, and memcpy / memset as the single
// bulk-memory instructions (memory.copy, memory.fill).
typedef int int32_t;
typedef unsigned int uint32_t;
typedef unsigned char uint8_t;
void *memcpy(void *d, const void *s, unsigned long n) { __builtin_memcpy(d, s, n); return d; }
void *memset(void *d, int c, unsigned long n) { __builtin_memset(d, c, n); return d; }
