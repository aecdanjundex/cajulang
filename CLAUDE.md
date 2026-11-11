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
  main.caju            o comando `caju` (build, run, test, bench, pkg, version)
  pkg.caju             o gerenciador de pacotes (docs/packages.md)
  build_main.caju      só o `build` (driver pequeno)
  dump_main.caju       imprime a árvore de um estágio (parse, link, check) para comparar com o JS
  *_test.caju          testes do compilador nativo, do runtime, do pkg e do alvo Windows
  testdata/            programas auxiliares desses testes
rt/*.caju            runtime dos programas: core, gc, values, dynamic, panic, linux, windows
lib/*.caju           biblioteca padrão (import "std/x"): strings, strconv, math, bytes, os, fs, path,
                     net, http, toml, json, crypto, hash, hex, base64, testing; cada uma com seu _test.caju
bootstrap/*.js       o compilador original em JavaScript (léxico, parser, tipos, ligador, VM, native.js)
tests/lang/          testes da linguagem (*_test.caju + testdata/)
examples/            exemplos da linguagem; examples_test.caju roda cada um e confere a saída
bench/               programs/*.caju + run.js; history.jsonl guarda a evolução da velocidade
tools/compare-compilers.sh   JS × compilador em Caju: binários idênticos em todos os programas
tools/release.sh     monta dist/caju-linux-x86_64.tar.gz (docs/releasing.md); install.sh na raiz instala
.github/workflows/   ci.yml (cadeia + suíte a cada push) e release.yml (tag v* → GitHub Release)
docs/                packages.md, testing.md, compiler-port.md, arquitetura-nativo.md, plano, histórico
build/, dist/        gerados (não versionar)
```

## Como trabalhar

```sh
node bootstrap/caju.js build -o build/caju compiler/main.caju   # estágio 1 (compilado pelo JS)
build/caju build -o build/caju2 compiler/main.caju              # estágio 2 (compilado por ele mesmo)
build/caju2 build -o build/caju3 compiler/main.caju && cmp build/caju2 build/caju3   # tem que ser igual

build/caju test                   # todos os *_test.caju (≈30 s); -v mostra cada teste
build/caju test lib/fs_test.caju --run "mkdir_all"
build/caju run programa.caju      # compila em memória e roda
```

**Testes** (docs/testing.md): estilo Go na organização (`x_test.caju` ao lado de `x.caju`,
auxiliares em `testdata/`) e BDD na escrita: `describe("assunto", fn() { it("frase do
comportamento", fn() { expect(v).to_equal(w) }) })`. Não existem arquivos `.out`. Erros de
compilação/execução de um programa inteiro: `run_file("testdata/x.caju")` → `r.output`, `r.code`.
Bug conhecido ainda não corrigido: escreva o teste certo com `skip("... (known bug)", ...)`.

Resultado esperado hoje: **809 passam, 0 falham, 9 pulados** (goroutines, alloc/peek/poke,
programas Windows das fases 6 e 7, e 3 bugs conhecidos em `tests/lang`: variável lida antes de
receber valor dá lixo; chamada dinâmica de método em `any` não converte argumento sem tipo nem
confere a quantidade de argumentos).

**O compilador em JS é só o estágio 0.** Desde as otimizações (bench/compare/OPTIMIZATION.md), o
compilador em Caju gera código melhor que o do JS; o JS só compila o primeiro estágio e usa uma
cópia congelada do runtime (`bootstrap/rt/`). A correção é garantida pela suíte e pela
autocompilação (estágio 2 == estágio 3). `tools/compare-compilers.sh` ficou como histórico.
Mudou o gerador de código ou o `rt/`? Rode a suíte, a autocompilação e
`python3 bench/compare/run.py --langs=caju`; registre a medição em OPTIMIZATION.md.

Medir: `tools/profile.sh` (tempo por função) e `tools/icount.sh` (instruções exatas, ciclos,
falhas de cache), ver docs/tools.md. Ver o código gerado: `tools/disasm.sh programa.caju função` (usa `CAJU_SYMS=arquivo`, que grava
o endereço de cada símbolo). Crash: `gdb -batch -ex run -ex 'info registers rip' binário` e
procure o endereço no arquivo do `CAJU_SYMS`.

**Convenções do código gerado que as otimizações criaram** (respeite ao mexer no gerador):
- R15 conta as chamadas que ainda cabem (começa em 10.000; `dec r15; js erro` antes de cada
  chamada); `__depth`/`__set_depth` no runtime só guardam e comparam.
- `early_guard`: `if p < K { return q }` no começo da função roda antes do prólogo.
- RBX, R12, R13, R14 guardam até 4 variáveis por função que nunca são ponteiro (`alloc_regs`);
  funções com `defer` guardam os 4 e os restauram no `recover`.
- xmm0..`xtop` seguram valores durante uma expressão `num` (`fexpr`); xmm15 é rascunho (`coerce`,
  `float32`, divisão). Nada pode chamar função enquanto um XMM de expressão guarda valor.
- Até 7 variáveis `num` por função vivem em xmm14, xmm13... (`alloc_regs`, `Var.xr`; `xtop` desce).
  Toda chamada (`A.call`, `A.call_rax`) as grava no slot delas antes e relê depois; erros do
  runtime que não voltam usam `A.call_noret`. Funções com `defer` não usam.
- RSI, RDI, R8..R11 (`EXTRA_REGS`) guardam mais variáveis inteiras (`alloc_regs`, se os usos
  pesam mais que as chamadas) e, em laços sem chamadas (ou só dentro de ramos de `if`/`switch`),
  o tamanho e os dados das listas do SCache (`scache_slot`). Toda chamada as grava no slot antes e relê depois (`A.spill`/`A.fill`, junto
  com as XMM), então um ponteiro de dados nelas está na pilha durante a chamada. `__syscall` também.
- Variáveis do nível de cima que nenhuma função usa (nem `&x`) são locais do `u.top` (uma variável
  da própria função com o mesmo nome não conta: `func_locals`).
- `Fn.kn`: depois de conferir `a[i]` (a e i locais fora de célula), os `a[i]` seguintes não
  conferem até a ou i serem atribuídos. `stmt()` mantém os fatos (ver "indexes known in range");
  código que pode não rodar (ramos, lado direito de and/or, `switch`) não aprende nada (`kn_off`).
- Laços com condição barata (`loop_entry`) repetem a condição antes do corpo (sem o `jmp` de entrada).
- Chamadas a funções `return E` pequenas viram a expressão (`try_inline`).
- `return L op f(args)` / `return f(args) op L` / `return f(args)` (f a própria função, op + * & | ^
  em int) viram laço com acumulador (`acc_plan`): cada volta gasta uma unidade de R15 e os
  `return` devolvem o R15 da entrada (`acc_depth`); os outros `return q` dão `acc op q`.
- Chamadas diretas a funções do programa sem `defer` (`reg_call`) passam os argumentos que nunca
  são ponteiro (int, bool, num; até 6, `arg_plan`) em RSI, RDI, R8..R11 (`ARG_REGS`) e entram em
  `u.r.nome`; os outros (ponteiros, textos, structs, receptor) vão na pilha como antes. `u.f.nome`
  (chamadas indiretas: valores de função, interfaces, defer) carrega os registradores e cai em
  `u.r.nome` (ou empilha de novo os da pilha e chama). O chamador faz `A.spill` antes de carregar
  os argumentos; argumentos com chamadas são avaliados antes (pilha ou slot escondido).
- Caminhos de erro vão para o código frio (`A.cold_begin`/`cold_end`, `f.fail_if`): o código vai
  para depois do `ret` da função (`flush_cold`) e o caminho quente segue reto. Código frio não
  volta sozinho: termina num erro que não retorna ou num `jmp` explícito.
- Laços `while`/`for`/`range` têm a condição depois do corpo (um desvio por volta). O `x64.finish`
  (ao gravar o executável) encurta desvios para rel8 e tira desvios para a instrução seguinte:
  posições guardadas com `A.pos()` só valem até lá, e nada pode emitir desvios em bytes crus.

## O que falta

- Goroutines, canais, `select`, sleep com escalonador, deadlock (fase 6).
- Windows: `alloc`/`peek`/`poke`/`readstr`, `dllexport` e DLL nativa (fase 7).
- Os 3 bugs conhecidos acima.
- `to_have_length`/`to_contain` do std/testing só conhecem listas e mapas de tipos básicos
  (a linguagem não tem `len` sobre `any`); para outros, `expect(len(x)).to_equal(n)`.
- Mapas com chave struct/array/any, chamar um `any` como função, operações de bits com `any`.

## Cuidados que já custaram tempo

- `not` é palavra reservada (por isso `expect(x).not_()`); `s[i]` é `uint8` (use `int(s[i])`);
  não há operador `~` (use `x ^ -1`); `"\xff"` é o caractere U+00FF em UTF-8, não o byte 0xFF.
- Um nome de variável igual ao de um namespace importado é erro (`path` vs `import "std/path"`):
  importe com outro nome (`import filepath "std/path"`).
- Uma expressão não pode continuar na linha seguinte depois de um operador (`a +` no fim da
  linha é erro de sintaxe). Quebre em variáveis.
- `let x = 0` sem tipo vira **num**; use `x := 0` ou `let x: int = 0`. Literais inteiros acima de
  2^53 viram float: monte com `<<`.
- Variáveis são da função inteira (não do bloco): não declare o mesmo nome com tipos diferentes.
- Uma função que chama `ast.fail`/`rt_fail` e tem resultado ainda precisa de um `return` depois.
- Funções `__load8`, `__store64`, `__syscall` etc. só existem no runtime (`rt/`), com
  `typecheck(..., intrinsics)`.
  A biblioteca padrão (`std/`) também pode usá-las (chamadas `privileged`). Para o `std/json` há
  intrínsecos de reflexão: `__anyp(any) -> int` (a caixa [descritor, valor] de um any) e
  `__pany(int) -> any` (o contrário), e `__alloc`, `__zero(desc)`, `__make_slice(ed, n, c)`,
  `__map_new(kk)`, `__map_set(m, k, v)`, que chamam as rotinas do runtime. O layout dos
  descritores está em `rt/values.caju`; mudou o layout? Atualize `lib/json.caju` também.
- `std/http` é um laço de eventos (epoll, `net.Poller`) com keep-alive e pipelining; os handlers
  rodam um por vez. `listen_and_serve_workers` faz fork de n processos com `SO_REUSEPORT` (sem
  memória compartilhada; os filhos morrem com o pai via `PR_SET_PDEATHSIG`). Os buffers de cada
  conexão são memória crua (`Client.inb`/`outb`, campos `int`): só vivem porque o coletor é
  conservador e o `Client` os guarda. `lib/http_test.caju` sobe `testdata/http_server.caju` de verdade.
- Nenhum ponteiro vivo pode ficar só num registrador durante uma chamada (o coletor só olha a
  pilha e as globais).
- Objetos de array/slice são alocados com 8 bytes a mais; textos e buffers de bytes com
  `rt_alloc_ns` (sem ponteiros).
- Mudou o formato dos dados (tamanho de elemento, cabeçalho de lista...)? O compilador anterior
  não compila o novo (gera o formato velho e liga o runtime novo: o estágio 2 cai). Comece a
  cadeia pelo JS (`node bootstrap/caju.js build -o build/s1 ...`), que usa o runtime congelado.
- Listas e arrays de `bool` têm 1 byte por elemento (`byte_elems`, `rt_esize`); todo o resto, 8.
- Alocador (`rt/gc.caju`): sem listas livres. Cada "chave" (classe × 2 + sem ponteiros) tem
  páginas próprias e uma faixa [próximo, fim, tamanho] em `rt_krun`; `rt_alloc`/`rt_alloc_ns`
  só avançam o ponteiro da faixa, `rt_alloc_slow`/`rt_next_run` reservam a próxima faixa de
  posições livres (bits "em uso" + zeragem). A coleta começa com `rt_drop_runs` (devolve o resto
  das faixas) e a varredura faz só "em uso &= marcado". O bit "sem ponteiros" é da página
  (`rt_pg_flag` & 2). Um mapa novo é um bloco de 168 bytes (cabeçalho, 4 entradas, índice de 8).
- Mexeu no coletor? Rode a suíte com coleta a cada 64 KB (troque `8 << 20` por `1 << 16` em
  `rt/gc.caju`, dois lugares) e desfaça depois.

## Decisões já tomadas (não reabrir sem o dono pedir)

- Inteiros são 64 bits de verdade no nativo (a antiga VM em JS diferia acima de 2^53).
- Alvos: Linux x86-64 (ELF) e Windows x64 (PE).
- A página HTML e o runtime em Rust foram retirados do repositório.
- O gerador produz código direto da árvore anotada (sem IR nem alocação de registradores).
  Correção primeiro, velocidade depois.
