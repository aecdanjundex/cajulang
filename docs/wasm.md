# Caju em WebAssembly

`caju build --target wasm -o programa.wasm programa.caju` gera um módulo WebAssembly com o mesmo
programa e o mesmo runtime do alvo nativo. O próprio compilador compila para wasm (`caju.wasm`) e,
dentro de um navegador ou do Node, compila programas para wasm: é o que o playground do site usa.

## Arquivos

| Arquivo | O que é |
|---|---|
| `compiler/wasm.caju` | o gerador: da árvore anotada para wasm (mesma semântica de `native.caju`) |
| `compiler/wasmenc.caju` | o codificador do formato binário (tipos, funções, tabela, memória, dados, tags) |
| `rt/wasm.caju` | a parte de sistema do runtime (como `rt/linux.caju`), por chamadas de sistema do hospedeiro |
| `tools/wasm/caju-host.mjs` | o hospedeiro: imita as chamadas de sistema do Linux sobre um objeto de arquivos |
| `tools/wasm/run.mjs` | roda um `.wasm` no Node com os arquivos de verdade (`node tools/wasm/run.mjs p.wasm args`) |
| `tools/wasm/caju-browser.mjs` | `loadCaju()`: `compile(fonte)` e `run(wasm)`, com arquivos em memória (`MemFS`) |
| `tools/wasm/package.sh` | monta `dist/caju-wasm.tar.gz` (vai na release; o site baixa no build) |
| `tools/wasm/caju-wasm.sh` | o `caju run` dos subprogramas dos testes em `caju test --target wasm` |

## O modelo (igual ao nativo, para o runtime não mudar)

- Todo valor é um i64; floats viajam como bits. Ponteiros são endereços da memória linear.
- Argumentos, variáveis e todo temporário que precisa sobreviver a uma chamada ficam numa pilha
  **na memória** (global `$sp`), nunca só na pilha do wasm: o coletor varre essa pilha de `$sp`
  até `rt_stack_top`, como varre a pilha da máquina no nativo. `push`/`pop` do gerador nativo
  viram escrita e leitura nessa pilha.
- Toda função é `() -> i64`. Chamar: empilhar (a closure e) os argumentos, `call`, desempilhar. O
  parâmetro i de n fica em `$fp + 8*(n-1-i)`; as variáveis, em `$fb + deslocamento` (o tamanho do
  quadro é corrigido no fim da função). Closures e tabelas de métodos guardam o **índice na
  tabela** como "endereço do código" (`call_indirect`).
- Resultados 2, 3... em `g.ret`; o segundo valor de `v, ok := m[k]` e `x.(T)` no global `$aux`.
- `defer`/`recover`: o registro de 6 palavras é o mesmo; `[16]` guarda `$fp`. `__jump` vira
  `throw $jump($fp)`; a função com `defer` roda o corpo num `try` e, ao pegar `$jump` com o seu
  `$fp`, faz o caminho "recuperado" e roda os `defer` que sobraram (exceções do wasm legado:
  `try`/`catch`/`rethrow`, que Node 22 e os navegadores atuais aceitam).
- Profundidade: o global `$depth` faz o papel do R15.

Memória: `[1024, 64 KB)` argumentos e ambiente (o hospedeiro escreve antes de `_start`), dados a
partir de 64 KB, pilha de 16 MB, uma reserva de 48 MB para o `mmap` do runtime e a arena do
coletor (2 GB de endereços; o hospedeiro faz a memória crescer quando o coletor pede páginas).

## Profundidade de chamadas

Cada chamada da Caju é também um quadro da pilha do motor JavaScript. No Node, `run.mjs` roda o
programa numa thread com 256 MB de pilha e o limite de 10.000 chamadas aninhadas vale igual ao
nativo. Num navegador a pilha é fixa: no worker do Chrome cabem cerca de 6.300 chamadas; passando
disso, o programa termina com "too much recursion for this browser's stack" (o hospedeiro
converte o `RangeError`). Por isso as funções usam poucas locais do wasm (4 fixas).

## O hospedeiro

`caju.syscall(n, a1..a6)` recebe os números do Linux: read, write, open, close, stat, fstat, lstat,
lseek, mmap (reserva/arena), mprotect (crescer a memória), nanosleep, access, getcwd, rename,
mkdir, rmdir, unlink, symlink, readlink, chmod, getdents64, clock_gettime, getrandom, exit. O
resto devolve ENOSYS (sockets, fork). `1000` é do hospedeiro: roda um programa e devolve a saída
(o `os.run` tenta essa chamada antes do fork; o Linux responde ENOSYS). `caju.fmod` é o `%` do
JavaScript (o resto exato de floats).

## Conferir

```sh
build/caju build --target wasm -o /tmp/p.wasm programa.caju && node tools/wasm/run.mjs /tmp/p.wasm
build/caju test --target wasm tests/lang lib examples    # mesma suíte, programas em wasm
CAJU=build/caju tools/wasm/package.sh                    # o compilador em wasm compila a si mesmo
                                                         # igual byte a byte, e o teste de navegador
```

Hoje: os testes de linguagem, da biblioteca e dos exemplos passam em wasm, menos `net` e `http`
(sem sockets). Goroutines e `alloc`/`peek`/`poke` faltam, como no nativo.
