# Caju: instruções para o Claude Code

Caju é uma linguagem de brinquedo **em português**, inspirada em Go, que roda inteira numa página
HTML (editor, verificador de tipos, compilador de bytecode, VM, gerador de .exe/.dll). Em volta da
página há dois runtimes nativos:

- **runtime em Rust** (`runtime/`): uma VM de bytecode em Rust; a página junta o bytecode do
  programa a ela e gera um .exe/.dll para Windows (x64 e x86). Pronto e estável.
- **compilador nativo** (`native/`): transforma o programa direto em código de máquina x86-64
  (ELF para os testes no Linux, PE para o Windows), com um runtime escrito **na própria Caju**
  (`native/rt/*.caju`). Em andamento: fases 1 a 5 de 9 prontas. **É aqui que o trabalho continua.**

O dono do projeto escreve em português. Responda em português, e mantenha em português os
comentários do código, as mensagens de erro da linguagem e os textos da página.

## Mapa do repositório

```
web/caju.html            a página: TODA a linguagem mora aqui (fonte da verdade)
  linhas ~462-5440         léxico, parser, verificador de tipos, ligador, compilador de bytecode,
                           otimizador, VM de pilha (com goroutines), serialização do bytecode
  // ==== NATIVO: início ==== ... // ==== NATIVO: fim ====
                           cópia de native/native.js + NATIVE_RT (o runtime em Caju como texto);
                           NUNCA edite esse trecho na página: edite native/ e rode native/splice.py
  depois disso             disassemble, exemplos (const EXAMPLES), .exe (versão, assinatura
                           Authenticode), DLL, interface; no fim, os runtimes do Windows em base64
native/native.js         o compilador nativo (montador x86-64, geração de código, ELF, PE)
native/rt/*.caju         runtime do nativo, em Caju: comum, gc, valores, dinamico, panico, linux, windows
native/splice.py         cola native.js + rt/*.caju dentro de web/caju.html
native/teste.sh          suíte: cada programa roda na VM e no nativo; as saídas têm que ser iguais
native/run.js, ex.js     comparar um arquivo / vários (ex.js --exemplos = todos os exemplos aceitos)
native/bench.js          velocidade: runtime em Rust × nativo (Linux)
native/mem.py            memória máxima de um programa nativo (Linux)
native/sym.js            endereço de um travamento (gdb) → função do código gerado
native/tests/*.caju      testes do nativo (erroN.caju terminam em erro de propósito)
runtime/rs/              VM em Rust (lib estática) — vm.rs, heap.rs, num.rs, prog.rs, native.rs
runtime/caju-asm-x64.S   assembly: chamadas a DLL e pontos de entrada da DLL
runtime/build.sh         compila o runtime em Rust (Linux; `windows` para .exe/.dll)
runtime/bin/             binários prontos (os .exe/.dll são os mesmos embutidos na página)
runtime/harness/         testes do runtime em Rust (viram build/*.js com tools/harness.py)
runtime/tests/go/        programas de teste no estilo Go (usados pelos dois runtimes)
tools/gen_core.py        web/caju.html → build/core.js (módulo Node com o núcleo da linguagem)
tools/harness.py         gera build/parity.js, parity-wine.js, ffi-test.js, sign-test.js
tools/embed_runtime.py   runtime/bin/*.exe|dll → base64 dentro da página
docs/                    plano do compilador nativo, arquitetura do nativo, histórico de decisões
build/                   gerado (não versionar)
```

## Como trabalhar

1. **Antes de tudo:** `python3 tools/gen_core.py` (gera `build/core.js`; os testes dependem dele).
2. **Mudou o compilador nativo ou o runtime em Caju?** Rode `native/teste.sh` (Linux, ~1 min).
   Ele faz o splice na página, regenera o core e compara VM × nativo em todos os exemplos que o
   nativo aceita, nos `runtime/tests/go` já suportados e em `native/tests/*.caju`.
   Resultado esperado hoje: **todos iguais menos `tests/numeros.caju`** (diferença aceita, ver abaixo).
3. **No fim de cada fase:** `native/teste.sh windows` (os .exe rodam no Wine; uns 10 min).
4. **Mexeu no coletor ou em qualquer coisa que guarde ponteiros?** Rode a suíte com coleta a cada
   64 KB: troque temporariamente `8 << 20` por `1 << 16` em `native/rt/gc.caju` (dois lugares),
   rode `native/teste.sh`, e **desfaça** a troca.
5. **Mudou a linguagem (página)?** Rode `node build/parity.js runtime/bin/caju-rs-linux64` depois de
   `python3 tools/harness.py`: a VM da página e o runtime em Rust têm que continuar iguais
   (`TODOS IGUAIS`). Se mudou o formato do bytecode, o runtime em Rust (`runtime/rs/src/prog.rs`)
   precisa acompanhar; aí `runtime/build.sh` (e `windows`) e `tools/embed_runtime.py`.
6. Um programa avulso: `node native/run.js arquivo.caju [windows]` mostra as duas saídas.
7. Crash no código nativo: `gdb -batch -ex run -ex 'info registers rip' binário` e depois
   `node native/sym.js arquivo.caju 0x40xxxx` diz em que função gerada (rótulos `u.f.nome`,
   `r.f.rt_x`, `u.top`, `u.l.N` para closures) caiu.

Regra de ouro: **a VM da página é a especificação.** O nativo tem que imprimir exatamente o mesmo
(inclusive mensagens de erro, com arquivo e linha: `Erro de execução em main.caju, linha N: ....`).
Quando a VM tem uma esquisitice, o nativo copia a esquisitice (há várias, documentadas em
`docs/arquitetura-nativo.md`).

## Ambiente necessário

- Node 22+, Python 3, gcc, gdb (para depurar). Wine 64/32 bits para os testes do Windows
  (os scripts procuram `/usr/lib/wine/wine64`; senão usam `wine64` do PATH; ou defina `WINE64`).
- Só para recompilar o runtime em Rust: Rust 1.97 (ou próximo), `pip install ziglang` (o zig faz
  o link do Windows), e para os alvos Windows o código-fonte da biblioteca padrão
  (`rustup component add rust-src`; sem rede para o rustup, clone `rust-lang/rust` na tag da versão
  com o submódulo `library/backtrace` e aponte `~/.rustup/toolchains/<tc>/lib/rustlib/src/rust/library`
  para ele). `runtime/rs/tools/dlltool` é um embrulho do dlltool do zig, posto no PATH pelo build.sh.
  O compilador nativo NÃO precisa de nada disso.

## Estado do compilador nativo

| Fase | O quê | Estado |
|---|---|---|
| 1 | montador, ELF/PE, números, textos, funções com tipo, if/while/for/switch, print | pronta |
| 2 | slices, arrays, structs, ponteiros, maps, métodos, embutidas, range, erros com linha | pronta |
| 3 | any, interfaces, x.(T), switch de tipos, closures, vários resultados, errors.New, sem tipos | pronta |
| 4 | coletor de lixo (marcar e varrer, conservador, classes de tamanho) | pronta |
| 5 | defer, panic, recover | pronta |
| 6 | goroutines, canais, select, sleep com escalonador, deadlock | **próxima** |
| 7 | Windows: alloc/peek/poke/readstr, extern completo, dllexport e a DLL nativa | a fazer |
| 8 | na página: opção "Nativo (x64)" no Gerar .exe/.dll, comparação de velocidade, referência | a fazer |
| 9 | compilador reescrito em Caju, autocompilação idêntica byte a byte | meta final |

O que ainda falha com "ainda não é suportado": `select`, `go`, canais (`make(chan T)`, `<-`),
`alloc`/`peek`/`poke`/`free`/`readstr`/`readwstr`, `dllexport` (o nativo só gera .exe), mapas com
chave struct/array/any, chamar um valor `any` como função, operações de bits com `any`.

Detalhes da fase 6 em diante, convenções do código gerado, layout de cada valor na memória,
descritores de tipo, coletor, defer/panic: **leia `docs/arquitetura-nativo.md` antes de mexer**.
O plano original das 9 fases está em `docs/plano-compilador-nativo.md`.

## Decisões já tomadas (não reabrir sem o dono pedir)

- Inteiros acima de 2^53: a VM (números do JS) e o nativo (64 bits de verdade) podem diferir.
  Aceito. O `tests/numeros.caju` mostra isso e também `5e-324` (o JS imprime o subnormal mais curto).
- Alvo do nativo: só Windows x64 (+ ELF para testes). O x86 continua pela VM/runtime em Rust.
- O runtime em Rust fica, como referência e para o x86.
- Fase 9 (compilador em Caju) é meta, depois da fase 8 estável.
- Não há mais "gas" no projeto (foi removido; bytecode v6).
- O compilador nativo, por enquanto, gera código direto da árvore anotada (sem representação
  intermediária nem alocação de registradores). Correção primeiro, velocidade depois.

## Cuidados que já custaram tempo

- O runtime em Caju é compilado pelo mesmo front end: `let x = 0` sem tipo vira **num**; use
  `x := 0` ou `let x: int = 0`. Literais inteiros acima de 2^53 viram float: monte com `<<`.
  Variáveis são da função inteira (não do bloco): não declare o mesmo nome com tipos diferentes.
  `rt_fail` não "devolve": se a função tem resultado, escreva um `return` depois.
- Funções `__load8`, `__load64`, `__store8`, `__store64`, `__syscall`, `__argp`, `__sp`, `__strp`,
  `__pstr`, `__fbits`, `__bitsf`, `__sqrt`, `__fmod`, `__calldefer`, `__jump` só existem nos arquivos
  do runtime (`typecheck(ast, {intrinsics: true})`); a assinatura de cada uma está em
  `INTRINSIC_SIG` na página e a geração de código em `builtin()` de native.js.
- Nenhum ponteiro vivo pode ficar só num registrador durante uma chamada (o coletor só olha a
  pilha e as globais). O gerador sempre empilha ou guarda em lugar escondido (`hidden()`).
- Objetos de array/slice são alocados com 8 bytes a mais (`8*n + 8`): uma fatia vazia no fim do
  array aponta para o fim, e esse ponteiro tem que cair dentro do mesmo objeto.
- Textos são alocados com `rt_alloc_ns` (sem ponteiros). Qualquer buffer de bytes também.
- Exemplos da página com vários arquivos são `{ files: [[nome, código], ...] }`; use `filesOf()`
  de `native/run.js`. (Até a fase 5 os testes passavam esses exemplos errado; corrigido no pacote.)
- O `print` avalia todos os argumentos antes de escrever (um erro no meio não deixa linha pela metade).
- Ao publicar a página em algum lugar que reclame de U+FFFD: a página usa `"�"` escrito
  como escape, nunca o caractere.
