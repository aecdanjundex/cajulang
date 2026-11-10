/* Funções de teste para o FFI, só no build de teste em Linux x86 de 32 bits.
   Cada uma exercita uma combinação de convenção de chamada, argumentos e retorno. */
static int32_t CAJU_STDCALL t_soma3(int32_t a, int32_t b, int32_t c) { return a + b + c; }
static double CAJU_STDCALL t_media(double a, double b) { return (a + b) / 2; }
static int64_t CAJU_CDECL t_mul64(int64_t a, int64_t b) { return a * b; }
static uint32_t CAJU_STDCALL t_conta_wchars(const uint16_t *s) { uint32_t n = 0; while (s[n]) n++; return n; }
static uint32_t CAJU_CDECL t_conta_bytes(const char *s) { return (uint32_t)strlen(s); }
static int32_t CAJU_STDCALL t_nome(uint16_t *buf, uint32_t *size) {
  static const uint16_t nome[] = { 'O', 'l', 0xE1, ' ', 0xD83D, 0xDE00, 0 };   /* "Olá 😀" */
  uint32_t n = 6;
  if (*size < n + 1) { *size = n + 1; return 0; }
  memcpy(buf, nome, sizeof nome);
  *size = n;
  return 1;
}
static float CAJU_STDCALL t_metade(float x) { return x / 2; }
static const uint16_t *CAJU_CDECL t_saudacao(void) { static const uint16_t s[] = { 'O', 'i', ',', ' ', 'C', 'a', 'j', 'u', 0 }; return s; }
static const char *CAJU_STDCALL t_texto(void) { return "texto ANSI"; }
static void CAJU_STDCALL t_nada(void) { }
static uint32_t CAJU_STDCALL t_soma12(uint32_t a, uint32_t b, uint32_t c, uint32_t d, uint32_t e, uint32_t f,
                                      uint32_t g, uint32_t h, uint32_t i, uint32_t j, uint32_t k, uint32_t l) {
  return a + b + c + d + e + f + g + h + i + j + k + l;
}
static int32_t CAJU_STDCALL t_negativo(void) { return -5; }
static int32_t CAJU_CDECL t_bool(int32_t b) { return b ? 7 : 3; }
static uint64_t CAJU_STDCALL t_grande(void) { return 0x123456789ULL; }
static double CAJU_CDECL t_mistura(int32_t a, double b, int64_t c, float d) { return a + b + (double)c + d; }
static const char *CAJU_STDCALL t_nulo(void) { return NULL; }
static void *ffi_test_lookup(const char *name) {
  static const struct { const char *n; void *f; } tab[] = {
    { "soma3", (void *)t_soma3 }, { "media", (void *)t_media }, { "mul64", (void *)t_mul64 },
    { "conta_wchars", (void *)t_conta_wchars }, { "conta_bytes", (void *)t_conta_bytes }, { "nome", (void *)t_nome },
    { "metade", (void *)t_metade }, { "saudacao", (void *)t_saudacao }, { "texto", (void *)t_texto },
    { "nada", (void *)t_nada }, { "soma12", (void *)t_soma12 }, { "negativo", (void *)t_negativo },
    { "booleano", (void *)t_bool }, { "grande", (void *)t_grande }, { "mistura", (void *)t_mistura }, { "nulo", (void *)t_nulo },
  };
  for (size_t i = 0; i < sizeof tab / sizeof tab[0]; i++) if (strcmp(tab[i].n, name) == 0) return tab[i].f;
  return NULL;
}
