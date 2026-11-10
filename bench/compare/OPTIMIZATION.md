# Otimizando o gerador de código nativo

Registro das rodadas de otimização do compilador (`compiler/native.caju`, `compiler/x64.caju`) e
do runtime (`rt/`). Cada rodada: uma hipótese tirada da leitura do código de máquina gerado, a
mudança, os testes (`caju test`, 518 passando) e a autocompilação (estágio 2 == estágio 3), e a
medição com `bench/compare/run.py --langs=caju`.

**Onde está cada coisa**

- `rounds/roundN.json`: as 21 medições (7 desafios × 3 tamanhos) de cada rodada.
- `rounds/table.py`: gera a tabela completa abaixo a partir dos JSON.
- `rounds/roundN-sieve.asm`: o código de máquina da função `work` de `rounds/sieve_kernel.caju`
  (o laço do crivo) naquela rodada, para comparar antes e depois (`tools/disasm.sh`).
- O código de cada rodada está no histórico do git (um commit por rodada a partir da 4; as
  rodadas 1 a 3 estão juntas num commit).

**Decisão:** as otimizações entram só no compilador em Caju. O compilador em JavaScript
(`bootstrap/`) continua gerando o código antigo e serve só para compilar o primeiro estágio; a
comparação byte a byte entre os dois (`tools/compare-compilers.sh`) deixa de valer. A correção é
garantida pela suíte de testes e pela autocompilação.

## Resumo (maior tamanho de cada desafio)

| rodada | mudança | fib 35 | sieve 10M | nbody 1M | mandelbrot 1k | matmul 300 | sort 2M | maps 3M |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| 0 | antes: máquina de pilha, todo operando empilhado e desempilhado | 126 ms | 435 ms | 737 ms | 243 ms | 256 ms | 637 ms | 2.00 s |
| 1 | codificação mais curta (disp8, imm8) | 125 ms | 424 ms | 735 ms | 243 ms | 253 ms | 626 ms | 2.02 s |
| 2 | operando direito simples direto no RCX; condições viram cmp + jcc; &&, \|\|, ! viram desvios | 94 ms | 370 ms | 725 ms | 251 ms | 209 ms | 484 ms | 1.65 s |
| 3 | a[i] com índice simples e leitura num só mov; atribuição única sem temporários; constantes como imediato; teste de int sem normalizar para 0/1 | 92 ms | 317 ms | 576 ms | 237 ms | 212 ms | 390 ms | 1.60 s |
| 4 | expressões num avaliadas em registradores XMM; comparações de num viram ucomisd + jcc | 91 ms | 320 ms | 532 ms | 127 ms | 214 ms | 397 ms | 1.60 s |
| 5 | profundidade de chamadas no registrador R15 em vez de uma global em memória | 65 ms | 304 ms | 516 ms | 128 ms | 213 ms | 394 ms | 1.53 s |
| 6 | variáveis locais inteiras, bool e num mais usadas em RBX, R12, R13, R14 | 66 ms | 218 ms | 449 ms | 125 ms | 210 ms | 287 ms | 1.28 s |
| 7 | variáveis do nível de cima que nenhuma função usa viram locais (e podem ir para registradores) | 66 ms | 185 ms | 438 ms | 92 ms | 202 ms | 280 ms | 1.33 s |
| 8 | a[i] op= v direto; lado composto sem chamadas calculado primeiro (sem push/pop) | 65 ms | 185 ms | 435 ms | 93 ms | 133 ms | 283 ms | 1.21 s |

Para comparar: Go faz 39 / 24 / 172 / 38 / 32 / 141 / 599 ms e Rust 21 / 24 / 66 / 38 / 11 / 135 / 359 ms
(`RESULTS.md`).

## Todas as medições

<!-- python3 bench/compare/rounds/table.py -->
| challenge | n | round 0 | round 1 | round 2 | round 3 | round 4 | round 5 | round 6 | round 7 | round 8 | total gain |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | — | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 1.33× |
| fib | 30 | 13 ms | 13 ms | — | 10 ms | 9 ms | 7 ms | 7 ms | 7 ms | 7 ms | 1.81× |
| fib | 35 | 126 ms | 125 ms | 94 ms | 92 ms | 91 ms | 65 ms | 66 ms | 66 ms | 65 ms | 1.93× |
| sieve | 100,000 | 6 ms | 5 ms | — | 4 ms | 4 ms | 4 ms | 3 ms | 3 ms | 3 ms | 1.90× |
| sieve | 1,000,000 | 40 ms | 41 ms | — | 28 ms | 29 ms | 27 ms | 18 ms | 16 ms | 16 ms | 2.49× |
| sieve | 10,000,000 | 435 ms | 424 ms | 370 ms | 317 ms | 320 ms | 304 ms | 218 ms | 185 ms | 185 ms | 2.36× |
| nbody | 10,000 | 9 ms | 9 ms | — | 7 ms | 7 ms | 7 ms | 6 ms | 6 ms | 6 ms | 1.57× |
| nbody | 100,000 | 75 ms | 76 ms | — | 59 ms | 55 ms | 53 ms | 46 ms | 45 ms | 44 ms | 1.69× |
| nbody | 1,000,000 | 737 ms | 735 ms | 725 ms | 576 ms | 532 ms | 516 ms | 449 ms | 438 ms | 435 ms | 1.69× |
| mandelbrot | 250 | 17 ms | 17 ms | — | 17 ms | 9 ms | 10 ms | 9 ms | 7 ms | 7 ms | 2.38× |
| mandelbrot | 500 | 62 ms | 62 ms | — | 61 ms | 33 ms | 33 ms | 33 ms | 24 ms | 25 ms | 2.51× |
| mandelbrot | 1,000 | 243 ms | 243 ms | 251 ms | 237 ms | 127 ms | 128 ms | 125 ms | 92 ms | 93 ms | 2.62× |
| matmul | 100 | 12 ms | 12 ms | — | 10 ms | 10 ms | 10 ms | 9 ms | 9 ms | 7 ms | 1.69× |
| matmul | 200 | 78 ms | 79 ms | — | 65 ms | 65 ms | 66 ms | 64 ms | 62 ms | 41 ms | 1.90× |
| matmul | 300 | 256 ms | 253 ms | 209 ms | 212 ms | 214 ms | 213 ms | 210 ms | 202 ms | 133 ms | 1.92× |
| sort | 100,000 | 28 ms | 28 ms | — | 18 ms | 18 ms | 18 ms | 14 ms | 13 ms | 14 ms | 2.09× |
| sort | 500,000 | 151 ms | 148 ms | — | 92 ms | 96 ms | 94 ms | 68 ms | 67 ms | 67 ms | 2.25× |
| sort | 2,000,000 | 637 ms | 626 ms | 484 ms | 390 ms | 397 ms | 394 ms | 287 ms | 280 ms | 283 ms | 2.25× |
| maps | 100,000 | 35 ms | 35 ms | — | 25 ms | 24 ms | 24 ms | 16 ms | 16 ms | 13 ms | 2.69× |
| maps | 1,000,000 | 561 ms | 538 ms | — | 438 ms | 405 ms | 374 ms | 300 ms | 332 ms | 317 ms | 1.77× |
| maps | 3,000,000 | 2.00 s | 2.02 s | 1.65 s | 1.60 s | 1.60 s | 1.53 s | 1.28 s | 1.33 s | 1.21 s | 1.66× |

A rodada 1 foi copiada da saída impressa; da rodada 2 só os maiores tamanhos foram anotados (o
código dela não foi salvo à parte).

## Rodada 0: o ponto de partida

O gerador produz código direto da árvore, como uma máquina de pilha: toda expressão deixa o
resultado em RAX; uma operação `a op b` calcula `a`, empilha, calcula `b`, move para RCX,
desempilha e opera. Uma condição `i <= n` virava:

```
mov rax,[rbp-0x18]   ; i
push rax
mov rax,[rbp+0x10]   ; n
mov rcx,rax
pop rax
cmp rax,rcx
setle al             ; 0/1
movzx eax,al
test rax,rax         ; converte para bool de novo
setne al
movzx eax,al
test rax,rax
je fim
```

Todas as variáveis vivem na pilha (`[rbp±x]`), com deslocamento sempre de 32 bits. Ver
`rounds/round0-sieve.asm` (134 instruções na função).

## Rodada 1: codificação mais curta

**Hipótese:** instruções menores (deslocamento de 8 bits em `[rbp-0x18]`, imediato de 8 bits em
`add rsp, 24`) cabem melhor no cache de instruções.
**Mudança:** `x64.rmx` e `alu_imm` escolhem a forma curta quando cabe; o `sub rsp` do prólogo
continua com 32 bits porque é corrigido depois (`sub_imm32`).
**Resultado:** código ~10% menor, tempo igual (dentro do ruído). O custo não está no tamanho das
instruções, e sim na quantidade.

## Rodada 2: operandos simples e condições como desvios

**Hipótese:** a maioria dos operandos direitos é uma variável ou um número; e toda condição de
`if`/`while`/`for` passa por dois "0/1" desnecessários.
**Mudança:**
- `simple_to(n, reg)`: carrega um número ou uma variável direto num registrador qualquer;
  `operands(l, r)` usa isso e só empilha quando o lado direito é complexo.
- `jump_if(cond, want, dest)`: comparação de inteiros vira `cmp` + `jcc` (a condição inversa é
  `cc ^ 1`); `!x` troca o sentido; `a && b` e `a || b` viram desvios em curto-circuito.

`i <= n` agora é `mov rax,[rbp-0x18]; mov rcx,[rbp+0x10]; cmp rax,rcx; jg fim`.
**Resultado:** fib −25%, sieve −13%, matmul −17%, sort −23%, maps −18%. Ponto flutuante não mudou
(as operações com `num` continuam passando pela pilha).

## Rodada 3: índices, atribuições e constantes

**Hipótese:** em `a[i]` a lista é empilhada para calcular o índice; `a[j] = true` guarda o
endereço e o valor em duas variáveis escondidas antes de gravar; `count + 1` carrega o 1 num
registrador; `if !a[i]` normaliza o valor para 0/1 antes de testar.
**Mudança:**
- `elem_check`: índice simples vai direto para RCX; a leitura é um só `mov rax,[rax+rcx*8]`.
- `single_assign`: `x = v` e `a[i] = v` sem os temporários do caso geral (a ordem de avaliação
  continua: índice antes do valor); valor simples vai direto para a memória.
- `imm32`: `+ - & | ^` e comparações com constante de até 32 bits usam o imediato.
- Em condições, inteiros e booleanos são testados com `test rax,rax` direto.

Ver `rounds/round3-sieve.asm` (84 instruções, eram 134).
**Resultado:** sieve −14%, nbody −21%, sort −19%, matmul igual, maps −3%.

## Rodada 4: ponto flutuante em registradores XMM

**Hipótese:** toda operação com `num` fazia o caminho RAX → pilha → RAX → XMM e de volta
(`push`, `pop`, dois `movq`); o mandelbrot e o nbody são só isso. E as comparações de `num`
nas condições ainda montavam um 0/1.
**Mudança:**
- `fexpr(n, d)` avalia uma expressão `num` deixando o resultado em `xmm d`; o operando direito vai
  para `xmm d+1` (`fpair`) e a operação é uma instrução (`addsd xmm d, xmm d+1`).
- Uma chamada de função apaga todos os XMM, então só pode haver chamada numa subexpressão
  avaliada quando nada está guardado em XMM (`d == 0`); as outras precisam ser `fpure` (sem
  chamadas: números, variáveis, índices, campos). Se não forem, o valor da esquerda vai para a
  pilha só nessa hora. Expressões mais fundas que 14 registradores também usam a pilha.
- `float_jump`: `a < b` numa condição vira `ucomisd` + `jcc`, com NaN dando falso em todas as
  comparações menos `!=`, como antes.
- O `coerce` (int → num) e o arredondamento para `float32` passaram a usar o xmm15 como
  rascunho: com o xmm0 eles apagavam o operando esquerdo guardado (o erro apareceu em 7 testes
  na primeira tentativa: `n > 0` com `n` sem tipo nunca era verdadeiro).
- Testes novos: `tests/lang/float_codegen_test.caju` (inteiros misturados, chamadas no lado
  direito, expressões mais fundas que os registradores, divisão por zero aninhada, NaN).

O núcleo do mandelbrot (`rounds/float_kernel.caju`) caiu de 110 para 69 instruções
(`rounds/round3-float.asm` → `rounds/round4-float.asm`).
**Resultado:** mandelbrot −46% (237 → 127 ms), nbody −8% (o resto é a chamada a `math.sqrt`
a cada par de corpos, que ainda é uma chamada de função comum).

## Rodada 5: profundidade de chamadas num registrador

**Hipótese:** a linguagem limita a recursão a 10.000 chamadas aninhadas (a mensagem de erro cita
o número, então o limite fica). Cada chamada fazia `mov rax,[rt_depth]; cmp rax,10000; jl;
inc [rt_depth]; call; dec [rt_depth]`: duas leituras-e-escritas no mesmo endereço de memória
por chamada, uma dependência em série de uma chamada para a outra.
**Mudança:**
- A profundidade vive no R15, que o gerador nunca usava e que as convenções do Linux e do
  Windows preservam (código externo não o apaga): `cmp r15,10000; jl ok; ...; inc r15; call;
  dec r15`. O programa zera o R15 na entrada.
- O registro de `defer` guarda o R15, e a volta de um `recover` o restaura.
- O runtime (`rt/panic.caju`) lê e muda a profundidade com duas funções internas novas,
  `__depth()` e `__set_depth(x)`.
- Como o compilador em JavaScript não conhece essas funções, ele passou a usar uma cópia
  congelada do runtime (`bootstrap/rt/`); ele só compila o primeiro estágio.

`rounds/round4-fib.asm` → `rounds/round5-fib.asm`.
**Resultado:** fib −29% (91 → 65 ms); maps −4%, sieve −5% (todos chamam funções).

## Rodada 6: variáveis em registradores

**Hipótese:** depois das rodadas anteriores, o laço do crivo é quase só `mov rax,[rbp-x]` e
`mov [rbp-x],rax`: as variáveis do laço (`i`, `j`, `n`) vão e voltam da memória a cada uso.
**Mudança:** alocação de registradores simples, por função:
- Conta os usos de cada variável local (peso 8 por nível de laço) e escolhe até 4 com pelo
  menos 4 usos, que vão para RBX, R12, R13 e R14 (registradores preservados pelas funções
  chamadas, inclusive as externas).
- Só variáveis que nunca guardam ponteiro (inteiros, bool, num): o coletor de lixo procura
  ponteiros só na pilha, e um ponteiro que vivesse só num registrador seria perdido.
- Fora: variáveis em célula (endereço tomado com `&`), capturadas por funções anônimas, e todas
  as de funções com `defer`.
- O prólogo guarda os registradores usados no quadro e a saída os restaura; parâmetros escolhidos
  são carregados no registrador na entrada.
- Um `panic` recuperado pula os quadros que guardaram esses registradores; por isso uma função
  com `defer` guarda os 4 na entrada e os restaura no ponto de recuperação.

`rounds/round4-sieve.asm` (84 instruções) → `rounds/round6-sieve.asm`.
**Resultado:** sieve −28%, sort −27%, maps −16% (o runtime dos mapas também é compilado por este
gerador), nbody −13%. O matmul e o mandelbrot não mudaram: os programas do benchmark fazem os
laços no nível de cima do arquivo, onde as variáveis são globais (rodada 7).

## Rodada 7: variáveis do nível de cima como locais

**Hipótese:** em Caju é comum escrever o programa direto no nível de cima do arquivo (os
programas do benchmark são assim). Ali toda variável era global: memória, e fora da alocação de
registradores da rodada 6.
**Mudança:** uma variável do nível de cima só precisa ser global se alguma função (com nome ou
anônima) a usar, ou se o endereço dela for tomado (`&x`). As outras viram locais do código do nível
de cima (`u.top`), que passa pela mesma alocação de registradores. O nível de cima de todos os
arquivos do programa roda no mesmo `u.top`, então um módulo que usa variável de outro no nível de
cima continua vendo a mesma.
- A primeira versão esqueceu de olhar dentro dos literais de struct (`&Node{ik: NONE}`): uma
  constante usada só ali virou local e a função não a achava. O compilador acusou o erro
  (`variable "NONE" not found`) num teste; a varredura passou a visitar todas as listas de
  filhos do nó.
- Testes novos: `tests/lang/top_level_test.caju` (uso só em literal de struct, `&x`, função
  anônima, função com nome que altera a variável, laço no nível de cima, coletor de lixo).

**Resultado:** mandelbrot −26% (125 → 92 ms), sieve −15%. O matmul quase não mudou: o laço
quente dele é `c[i*n+j] += aik * b[k*n+j]`, e um `+=` com índice ainda passa pelo caminho geral
(rodada 8).

## Rodada 8: `a[i] op= v` e operandos sem pilha

**Hipótese:** o laço do matmul, `c[i*n+j] += aik * b[k*n+j]`, passava pelo caminho geral do
`op=` com alvo composto (endereço e valor atual em variáveis escondidas, um nó `·tmp`).
**Primeira mudança:** `index_op_assign`, um atalho para `a[i] op= v` (lista ou array de
inteiros, ou de `num` quando `v` não chama funções): calcula o endereço uma vez, lê o valor atual
antes de avaliar `v` (a mesma ordem do caminho geral), opera com a mesma `int_op` (com as
verificações de divisão e deslocamento) e grava. Testes novos em
`tests/lang/index_assign_test.caju`. **Resultado: nada** (matmul 202 ms).

**Segunda hipótese (lendo o código gerado):** o custo estava nos `push`/`pop`: em `b[k*n+j]` a
lista era empilhada enquanto o índice composto era calculado, e em `aik * b[...]` o `aik` era
empilhado enquanto o lado direito era calculado.
**Segunda mudança:** quando um lado é simples (variável ou número) e o outro não chama funções,
o lado composto é calculado primeiro e o simples é carregado depois direto no outro registrador.
É seguro porque em Caju atribuição é comando, não expressão: uma expressão sem chamadas não muda
nenhuma variável, então a ordem não altera o resultado.
**Resultado:** matmul −34% (202 → 133 ms), maps −9%.
