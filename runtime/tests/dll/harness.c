#include <stdio.h>
#include <stdint.h>
#define MS __attribute__((ms_abi))
extern struct { char magic[16]; uint32_t n, space; void *slots[64]; void *le; unsigned char area[12288]; } caju_exports;
typedef MS const char *(*LE)(void);
int main(void) {
  LE le = (LE)caju_exports.le;
  printf("magic=%s n=%u\n", caju_exports.magic, caju_exports.n);
  int32_t (*soma)(int32_t, int32_t) MS = caju_exports.slots[0];
  double (*media)(double, double) MS = caju_exports.slots[1];
  const char *(*saud)(const char *) MS = caju_exports.slots[2];
  int32_t (*quebra)(int32_t) MS = caju_exports.slots[3];
  int64_t (*par)(int32_t) MS = caju_exports.slots[4];
  int32_t (*seguro)(int32_t) MS = caju_exports.slots[5];
  int32_t (*total)(void) MS = caju_exports.slots[6];
  printf("soma=%d err=%s\n", soma(2, 40), le() ? le() : "-");
  printf("media=%g\n", media(1.5, 2.25));
  printf("saud=%s\n", saud("Rust"));
  int q = quebra(1); printf("quebra(1)=%d err=%s\n", q, le() ? le() : "-");
  q = quebra(7); printf("quebra(7)=%d err=%s\n", q, le() ? le() : "-");
  q = soma(1, 1); printf("depois=%d err=%s\n", q, le() ? le() : "-");
  printf("paralelo=%lld\n", (long long)par(1000));
  printf("seguro(5)=%d seguro(-1)=%d err=%s\n", seguro(5), seguro(-1), le() ? le() : "-");
  printf("total=%d\n", total());
  return 0;
}
