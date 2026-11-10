/* Funções de teste para o FFI (só nos builds de teste em Linux): o runtime procura
   cada função pelo nome aqui, em vez de numa DLL. */
#include <stdint.h>
#include <string.h>
#if defined(__x86_64__)
#define CAJU_STDCALL __attribute__((ms_abi))
#define CAJU_CDECL __attribute__((ms_abi))
#else
#define CAJU_STDCALL __attribute__((stdcall))
#define CAJU_CDECL __attribute__((cdecl))
#endif
#include "ffi-test-table.h"
void *caju_ffi_test_lookup(const char *n) { return ffi_test_lookup(n); }
