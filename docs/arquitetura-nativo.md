# Compilador nativo da Caju: como está feito (fases 1 a 5)

Referência técnica para quem continua o trabalho. O código está em `native/native.js` (o
compilador, em JavaScript, colado dentro de `web/caju.html` pelo `native/splice.py`) e em
`native/rt/*.caju` (o runtime, escrito em Caju e compilado junto com cada programa).

## Visão geral

```
compileNative(files, { target: "linux" | "windows" })  →  Uint8Array (ELF ou PE)
```

1. O programa do usuário passa por `link(files)` e `compile(ast)` (o compilador de bytecode):
   assim todos os erros de tipo/compilação são os mesmos da VM, e a árvore fica **anotada** pelo
   verificador (`n.ty`, `n.ik`, `callKind`, `convMode`, `celled`, `captures`, ...).
2. O runtime: `NATIVE_RT.comum + gc + valores + dinamico + panico + (linux | windows)` vira um
   arquivo só, `link` + `typecheck(ast, { intrinsics: true })`.
3. Duas "unidades": `r` (runtime) e `u` (usuário). Símbolos: funções `r.f.nome` / `u.f.nome`,
   globais `r.g.nome` / `u.g.nome`, código de topo `r.top` / `u.top`, closures `u.l.N`,
   closures fixas de funções com nome `u.c.nome`, "thunks" de método preso `u.t.Tipo.metodo`,
   descritores `desc.N`, tabelas de métodos `mt.N`, textos `str.N`.
4. Gera código **direto da árvore** (sem IR), com um montador x86-64 próprio (`class X64`), e
   escreve ELF (base 0x400000, código no offset 0x1000) ou PE32+ (ImageBase 0x140000000, sem
   relocations, 2 seções, pilha de 64 MB, importação estática das DLLs dos `extern`).

Entrada (`start`): no Linux guarda RSP em `g.argp`; alinha a pilha; `call r.top` (globais do
runtime); grava `rt_stack_top`, `rt_data_lo/hi` (para o coletor); `rt_init`; grava os
descritores que o runtime usa (`rt_d_int`, `rt_d_num`, `rt_d_bool`, `rt_d_str`, `rt_d_any`,
`rt_d_err`); `call u.top`; `rt_exit(0)`.

## Convenção de chamada e quadros

- Todo valor cabe em 64 bits e cada expressão deixa o resultado em **RAX**. Floats viajam como
  bits em RAX e vão para XMM0/XMM1 só na conta.
- Argumentos empilhados da esquerda para a direita; quem chama tira. Parâmetro i (de n) fica em
  `[rbp + 16 + 8*(n-1-i)]`. Locais em `[rbp - 8k]`. O tamanho do quadro é corrigido no fim
  (`frameAt`).
- **Vários resultados:** o 1º em RAX, os outros em `g.ret + 8*i` (globais); quem chama copia
  para lugares escondidos logo depois da chamada (`unpackCall`).
- **Closure** = ponteiro para `[código, célula1, célula2, ...]`. Chamar um valor função: empilha o
  objeto da closure **antes** dos argumentos, chama `[obj]`, tira n+1. A closure lê as células em
  `[rbp + 16 + 8*nparams]`. Funções com nome ignoram esse argumento extra, por isso servem de
  closure "fixa" (`u.c.nome` nos dados = `[u.f.nome]`).
- Profundidade de chamadas em `r.g.rt_depth` (inc/dec em volta de cada chamada do usuário);
  passou de 10.000 → "Recursão demais: mais de 10.000 chamadas de função abertas ao mesmo tempo".
- `extern` no Windows: um thunk por função converte para a convenção Win64 (RCX, RDX, R8, R9,
  XMM0-3, 32 bytes de sombra, pilha alinhada) e chama `[iat.dll.símbolo]`.
- Lugares escondidos (`hidden()`): slot no quadro, ou um símbolo de dados no código de topo.
- Variáveis com célula (capturadas por closure ou com endereço tomado com `&`): o slot guarda o
  ponteiro da célula; `loadV`/`storeV` dereferenciam. Laço `for i := ...` com variável capturada
  ganha célula nova a cada volta (como Go 1.22 e a VM: `REBOX`).

## Representação dos valores (uma palavra de 8 bytes cada)

| Tipo | Na palavra |
|---|---|
| int, int8..int64, uint..., bool | o inteiro (os menores dão a volta: `wrapKind`) |
| num, float32 | bits do double (float32 arredondado com cvtsd2ss/cvtss2sd) |
| str | ponteiro para `[tamanho:8][bytes UTF-8][0]` (imutável; literais nos dados) |
| []T | 0 (nil) ou ponteiro para o cabeçalho `[dados, tamanho, capacidade]` |
| [N]T e struct | ponteiro para um objeto com N palavras (array) / uma palavra por campo |
| *Struct, *[N]T | o próprio objeto (mesmo ponteiro do valor) |
| *T (outros) | endereço de uma palavra (célula, global, campo, elemento) |
| map[K]V | 0 ou ponteiro para a tabela do runtime (ordem de inserção + índice aberto) |
| fn(...) | 0 ou ponteiro para a closure |
| any, interface, error | 0 (nil) ou ponteiro para a caixa `[descritor, valor]` |

Cópia como na VM (`bindValue`): struct/array são copiados ao atribuir/passar/devolver quando a
expressão não é "nova" (`fresh`: variável, campo, índice, deref, x.(T) não são novos);
atribuir por cima de uma struct que já existe usa `rt_copy_into` (ponteiros para ela continuam).

### Descritor de tipo (8 palavras, nos dados, um por tipo canônico)

`[0] tipo, [8] n (campos/elementos), [16] elemento (ou valor do map), [24] chave, [32] nome (texto),
[40] tabela de campos ([nome, descritor, é-valor?] × n), [48] código do inteiro (KIND_CODE),
[56] tabela de métodos (struct, *struct, erro) ou lista de nomes de métodos (interface)`.
Tipos: 1 int, 2 uint, 3 num, 4 bool, 5 str, 6 slice, 7 array, 8 struct, 9 ponteiro, 10 map,
11 any, 12 interface, 13 erro de errors.New, 14 função, 15 outro.
As palavras com endereço são "data relocations" (`dataRelocs`), resolvidas na escrita do arquivo.

Tabela de métodos: `[n]` e n entradas de 48 bytes `[nome, código, caminho, descritor-da-cópia,
por-valor?, descritor-do-resultado]`. `caminho` = `[n, índice de campo...]` pelos campos
embutidos até o receptor. Chamada por interface: `rt_method` acha a entrada comparando o
**ponteiro** do nome (textos iguais são o mesmo literal), `rt_method_recv` segue o caminho e
copia se for por valor, e o código chama `[entrada+8]`. Num `any`, o resultado ganha caixa com o
descritor do resultado.

### any e as regras da VM

A VM guarda números do JS: inteiro "cru" é `int`, número com parte decimal é `num`, e
int8/uint/num-inteiro/*struct vão numa caixa. O nativo reproduz pelo descritor da caixa:
- conta com `any` (`rt_dyn_op`): em double; resultado inteiro (cabe em int64) vira `int`, senão
  `num`; `+` com texto concatena o `fmt` dos dois; erros com as mensagens da VM;
- verdade (`rt_truthy`): só `int` (descritor `rt_d_int`), `bool` e `str` são avaliados; qualquer
  outra caixa (num, int8, uint...) conta como verdadeira, como a caixa da VM;
- `==` (`rt_dyn_eq`): mesmo descritor e mesmo valor; `*struct` compara campo a campo (como a VM);
- caixas prontas para inteiros de -128 a 1023 e para true/false (`rt_box_int`, `rt_box_bool`);
- `any` indo para um tipo concreto (tipagem gradual) passa por `rt_unbox`; a VM não confere, o
  nativo dá erro se o tipo não bater (única diferença intencional);
- `x.(T)` (`rt_assert`) e o switch de tipos (`rt_type_is`) usam o descritor; a mensagem de erro
  é a da VM (`x.(T): o valor guardado é U, não T`).

## Runtime em Caju (`native/rt/`)

| Arquivo | Conteúdo |
|---|---|
| comum.caju | init, textos (concat, comparação), números em texto (12 algarismos, como o JS), bignums, pow/log/exp, saída com buffer, `rt_fatal`, sleep |
| gc.caju | alocador (arena de 16 GB reservada, páginas de 64 KB, 40 classes de 16 a 16384 bytes, objetos maiores em páginas inteiras) e o coletor |
| valores.caju | zero/cópia/igualdade por descritor, slices, append, sub-slices, UTF-8, conversões texto↔bytes↔runas, maps, `rt_fmt` (o print de valores compostos) |
| dinamico.caju | caixas, contas com any, `x.(T)`, métodos por nome, `rt_unbox` |
| panico.caju | defer, panic, recover, `rt_fail` (erro ao rodar = panic) |
| linux.caju / windows.caju | escrever, memória (`rt_os_mem`, `rt_os_reserve`, `rt_os_commit`), dormir, sair |

### Coletor (fase 4)

Marcar e varrer, sem mover, **conservador** em tudo: qualquer palavra na pilha (de `__sp()` até
`rt_stack_top`), nas globais (`g.data_lo`..`g.data_hi`, que inclui `g.ret` e os lugares
escondidos do topo) ou dentro de um objeto, que aponte para **dentro** de um objeto em uso, o
mantém vivo. Página pequena: 2 KB de cabeçalho com bits de marca (+0), em uso (+512) e sem
ponteiros (+1024); objetos a partir de +2048. Página grande: `rt_pg_kind` 2/3, marca em
`rt_pg_flag`. Coleta quando o alocado desde a última passa do que sobreviveu (mínimo 8 MB).
Invariantes: ver "Cuidados" no CLAUDE.md (nada vivo só em registrador; +8 bytes nos arrays;
textos `rt_alloc_ns`). O teste de estresse é rodar a suíte com o mínimo em 64 KB.

### defer, panic, recover (fase 5)

Função com `defer` tem um registro de 6 palavras no quadro:
`[0] anterior, [8] lista de defers, [16] RBP, [24] endereço "recuperado", [32] rt_depth, [40] livre`,
ligado em `rt_dtop`. Cada `defer` cria o nó `[próximo, closure, n, argumentos...]` (função e
argumentos avaliados na hora; chamada de builtin vira uma função de embrulho; método por
interface é resolvido na hora). `rt.calldefer` (assembly gerado) chama o nó.
- Volta normal: o resultado é guardado, `rt_run_defers` roda a lista, resultados com nome são
  relidos (o defer pode mudá-los).
- `panic(v)` / erro ao rodar (`rt_fail`): `rt_panic` roda os defers dos registros do mais novo para
  o mais antigo, com `rt_depth` = profundidade daquela função. `recover()` só vale se
  `rt_depth == rt_pdepth` (chamado direto pela função adiada, como na VM). Recuperado:
  `__jump(rbp, recuperado)`; o código do "recuperado" refaz RSP, religa `rt_dtop`, restaura a
  profundidade, zera os resultados sem nome e segue para a volta normal (que roda os defers que
  sobraram). Ninguém recuperou: `rt_fatal` com a mensagem do último panic.
- Valor de um erro ao rodar = caixa de erro com a mensagem; `panic(v)` imprime `panic: <fmt(v)>`.

## Fase 6: goroutines e canais (próxima)

Leia na página (`web/caju.html`, procure `async function runVM`): `newG`, `schedule`, `runq`,
`sleepers`, `GO_SLICE = 2000`, e os casos `CHAN_SEND`, `CHAN_RECV`, `CHAN_CLOSE`, `SELECT`, `GO`.
A VM é **determinística**: fila de prontas FIFO, troca a cada 2000 instruções de bytecode,
relógio virtual para o `sleep` (com `skipSleep` não espera de verdade; a ordem continua a do
relógio), deadlock = nenhuma pronta e nenhuma dormindo → "Todas as goroutines estão bloqueadas,
esperando umas pelas outras (deadlock)" na linha onde a main parou. Canal com buffer, fila de
envio e de recebimento; `select` com `default`; envio num canal fechado é erro na goroutine que
espera ("Envio num canal fechado").

Sugestão de desenho (do plano): cada goroutine com pilha própria (reservar 1 MB, como a arena do
coletor), troca de pilha por um trecho de assembly gerado (salva RSP/RBP, carrega os da próxima),
pontos de troca nas voltas de laço e nas chamadas (um contador; o plano aceita que os pontos de
troca não sejam os mesmos da VM, então programas que dependem de preempção, como
`runtime/tests/go/o_preempt.caju`, ficam fora da comparação). Para o coletor: varrer a pilha de
**todas** as goroutines (de RSP salvo até o topo de cada uma). Para o panic: `rt_dtop` e a
profundidade passam a ser por goroutine; panic não recuperado numa goroutine termina o programa.
`sleep` passa pelo escalonador (relógio virtual quando `CAJU_SKIP_SLEEP=1`, que os testes usam).
Testes-alvo: exemplo "Go: goroutines e canais", `runtime/tests/go/f_go`, `i_deadlock`,
`j_fechado`, `k_workers`.

## Fases 7 a 9

- **7 Windows:** `alloc/free/peek*/poke*/readstr/readwstr` (a VM simula a memória; o nativo usa
  memória de verdade, mas as mensagens de erro para ponteiro nulo/inválido devem continuar as
  mesmas onde der), `extern` completo (cdecl, wstr, ptr), `dllexport` e gerar uma DLL nativa
  (diretório de exportação: a página já tem esse código para o runtime em Rust). Testes:
  `build/ffi-test.js` (adaptar para o nativo), exemplos "Windows: ..." e "DLL: calculadora" no Wine.
- **8 Na página:** opção "Nativo (x64)" no diálogo "Gerar .exe / .dll" (procure `buildExe` e a
  interface), recursos de versão/assinatura (a página já assina os .exe do runtime em Rust), e a
  comparação de velocidade. Meta: os 135 casos de `build/parity.js` passando no nativo.
- **9 Compilador em Caju:** reescrever léxico, parser, verificador, gerador e montador em Caju;
  estágio 2 e estágio 3 idênticos byte a byte.

## Números de referência (Linux, fim da fase 5)

| Programa | Runtime em Rust | Nativo |
|---|---|---|
| Benchmark | ~140 ms | ~8 ms (18x) |
| fib(26) sem tipos | ~70 ms | ~18 ms (4x) |
| 1 milhão de append + map | ~580 ms | ~210 ms (2,7x) |
| tests/gc3m.caju (3 milhões de objetos) | — | 18 MB de memória máxima |
