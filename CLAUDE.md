# Caju: instruções para o Claude Code

Caju é uma linguagem de programação inspirada em Go, com compilador nativo para x86-64 (ELF no
Linux, PE no Windows) e runtime escrito na própria Caju. **O compilador já é escrito em Caju e
compila a si mesmo**: os estágios 1, 2 e 3 saem idênticos byte a byte. O compilador em JavaScript
(`bootstrap/`) continua só como referência e para gerar o primeiro estágio.

O dono do projeto escreve em português: responda em português. O código, os comentários e as
mensagens da linguagem estão em inglês (decisão da reorganização); mantenha assim.

## Mapa do repositório

```
compiler/*.caju      o compilador, em Caju (ver docs/compiler-port.md, tabela de módulos)
  main.caju            o comando `caju` (build, run, test, bench, version)
  build_main.caju      só o `build` (driver pequeno)
  dump_main.caju       imprime a árvore de um estágio (parse, link, check) para comparar com o JS
rt/*.caju            runtime dos programas: core, gc, values, dynamic, panic, linux, windows
lib/*.caju           biblioteca padrão (import "std/strings"): strings, strconv, math, bytes, os, net, http
bootstrap/*.js       o compilador original em JavaScript (léxico, parser, tipos, ligador, VM, native.js)
  caju.js              `node bootstrap/caju.js build|run ...`
  dump.js              a árvore canônica do JS (referência do dump_main)
tests/               programas com a saída esperada ao lado (foo.caju + foo.out, ou dir/main.caju + expected.out)
  lang examples parity native std   compilados e executados no Linux
  windows/             programas que só fazem sentido no Windows (FFI, DLL)
  run.js               runner (Node); history.jsonl guarda os resultados gravados
bench/               programs/*.caju + run.js; history.jsonl guarda a evolução da velocidade
examples/            exemplos avulsos
docs/                compiler-port.md (regras do port), arquitetura-nativo.md, plano, histórico
build/               gerado (não versionar)
```

## Como trabalhar

```sh
node bootstrap/caju.js build -o build/caju compiler/main.caju   # estágio 1 (compilado pelo JS)
build/caju build -o build/caju2 compiler/main.caju              # estágio 2 (compilado por ele mesmo)
build/caju2 build -o build/caju3 compiler/main.caju && cmp build/caju2 build/caju3   # tem que ser igual

build/caju test [filtro]          # suíte (o root é o diretório acima do binário, ou $CAJU_ROOT)
node tests/run.js                 # a mesma suíte com o compilador em JS
node tests/run.js --compiler=build/caju
build/caju run programa.caju      # compila em memória e roda
build/caju bench / node bench/run.js
```

Resultado esperado hoje da suíte: **100 passam, 3 falham, 10 pulados** (igual nos dois
compiladores). Falhas conhecidas: `parity/fn-local-before` (variável lida antes de ser atribuída
não dá erro no nativo), `parity/st-any`, `parity/st-arity`. Pulados: goroutines, canais, select,
alloc/peek/poke.

**Regra de ouro do port:** enquanto o JS existir, o compilador em Caju tem que gerar binários
idênticos aos do `bootstrap/caju.js` para todos os programas de `tests/` (Linux e `--target
windows`). Hoje: 97 binários idênticos + 16 com o mesmo erro de compilação; 59 idênticos no alvo
Windows. Ao mudar o compilador, mude os dois lados ou aposente o JS de vez (decisão do dono).

Crash no código gerado: `gdb -batch -ex run -ex 'info registers rip' binário`; os rótulos
(`u.f.nome`, `r.f.rt_x`, `u.top`, `u.l.N`) estão descritos em `docs/arquitetura-nativo.md`.

## O que falta

- Goroutines, canais, `select`, sleep com escalonador, deadlock (fase 6).
- Windows: `alloc`/`peek`/`poke`/`readstr`, `dllexport` e DLL nativa (fase 7).
- As 3 falhas da suíte acima.
- Mapas com chave struct/array/any, chamar um `any` como função, operações de bits com `any`.

## Cuidados que já custaram tempo

- Uma expressão não pode continuar na linha seguinte depois de um operador (`a +` no fim da
  linha é erro de sintaxe). Quebre em variáveis.
- `let x = 0` sem tipo vira **num**; use `x := 0` ou `let x: int = 0`. Literais inteiros acima de
  2^53 viram float: monte com `<<`.
- Variáveis são da função inteira (não do bloco): não declare o mesmo nome com tipos diferentes.
- Uma função que chama `ast.fail`/`rt_fail` e tem resultado ainda precisa de um `return` depois.
- Funções `__load8`, `__store64`, `__syscall` etc. só existem no runtime (`rt/`), com
  `typecheck(..., intrinsics)`.
- Nenhum ponteiro vivo pode ficar só num registrador durante uma chamada (o coletor só olha a
  pilha e as globais).
- Objetos de array/slice são alocados com 8 bytes a mais; textos e buffers de bytes com
  `rt_alloc_ns` (sem ponteiros).
- Mexeu no coletor? Rode a suíte com coleta a cada 64 KB (troque `8 << 20` por `1 << 16` em
  `rt/gc.caju`, dois lugares) e desfaça depois.

## Decisões já tomadas (não reabrir sem o dono pedir)

- Inteiros são 64 bits de verdade no nativo (a antiga VM em JS diferia acima de 2^53).
- Alvos: Linux x86-64 (ELF) e Windows x64 (PE).
- A página HTML e o runtime em Rust foram retirados do repositório.
- O gerador produz código direto da árvore anotada (sem IR nem alocação de registradores).
  Correção primeiro, velocidade depois.
