// What the engines take from a C library, which they are built without
// (-nostdlib): the integer types, and memcpy / memset as the single
// bulk-memory instructions (memory.copy, memory.fill); weak, so two files that
// both include this can be linked into one module (bit.c with pa.c). A native
// build (the drill, drill.c) takes them from the system's C library.
#ifndef LIBC_H
#define LIBC_H
typedef int int32_t;
typedef unsigned int uint32_t;
typedef unsigned char uint8_t;
#ifdef __wasm__
__attribute__((weak)) void *memcpy(void *d, const void *s, unsigned long n) { __builtin_memcpy(d, s, n); return d; }
__attribute__((weak)) void *memset(void *d, int c, unsigned long n) { __builtin_memset(d, c, n); return d; }
#else
void *memcpy(void *d, const void *s, unsigned long n);
void *memset(void *d, int c, unsigned long n);
#endif
#endif
