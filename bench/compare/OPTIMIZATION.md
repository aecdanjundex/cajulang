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
| 9 | inline de funções `return E` pequenas; `__sqrt` vira sqrtsd no registrador | 66 ms | 187 ms | 427 ms | 94 ms | 136 ms | 287 ms | 1.26 s |
| 10 | mapas: caminho de chave inteira sem chamadas; leitura `m[k]` numa só chamada | 69 ms | 188 ms | 419 ms | 94 ms | 145 ms | 284 ms | 966 ms |
| 11 | listas em laço: tamanho e dados lidos uma vez; `a[i]` sem verificação em `for i := 0; i < len(a); i++` | 64 ms | 144 ms | 425 ms | 90 ms | 108 ms | 234 ms | 833 ms |
| 12 | `[]bool` e `[N]bool` com 1 byte por elemento | 64 ms | 70 ms | 396 ms | 90 ms | 107 ms | 229 ms | 852 ms |
| 13–16 | mapas com etiqueta; listas globais em laços; operações direto em registradores; `num` em XMM; RSI/RDI/R8–R11 | 62 ms | 29 ms | 175 ms | 37 ms | 35 ms | 184 ms | 605 ms |
| 17–18 | laços com teste no fim, código frio, desvios curtos; divisão e resto por constante sem `idiv` | 57 ms | 21 ms | 175 ms | 37 ms | 33 ms | 164 ms | 607 ms |
| 19 | guarda antes do prólogo; `leave`; profundidade contando para baixo | 41 ms | 21 ms | 175 ms | 37 ms | 33 ms | 164 ms | 607 ms |
| 20–25 | recursão com acumulador; limites fora de laços constantes; argumentos em registradores; laços versionados e vetorizados; índices já conferidos; mapas com `op=` numa sondagem | 26 ms | 22 ms | 65 ms | 40 ms | 14 ms | 140 ms | 632 ms |

**Ganho total (rodada 0 → 10), maior tamanho:** fib 1,8×, sieve 2,3×, nbody 1,8×, mandelbrot 2,6×,
matmul 1,8×, sort 2,2×, maps 2,1×.

**Contra as outras linguagens** (mesma máquina, `RESULTS.md`, maior tamanho, depois da rodada 25;
maps 3M remedido intercalado, porque a rodada do RESULTS.md pegou uma variação da máquina):

| desafio | Caju antes | Caju depois | Go | Rust | Python | Caju ÷ Go | Caju ÷ Rust |
|---|--:|--:|--:|--:|--:|--:|--:|
| fib 35 | 126 ms | 26 ms | 40 ms | 21 ms | 1.22 s | 0.7× | 1.3× |
| sieve 10M | 435 ms | 22 ms | 20 ms | 21 ms | 2.12 s | 1.1× | 1.0× |
| nbody 1M | 737 ms | 65 ms | 173 ms | 66 ms | 9.78 s | 0.4× | 1.0× |
| mandelbrot 1k | 243 ms | 40 ms | 38 ms | 38 ms | 6.30 s | 1.1× | 1.1× |
| matmul 300 | 256 ms | 14 ms | 32 ms | 11 ms | 6.10 s | 0.4× | 1.2× |
| sort 2M | 637 ms | 140 ms | 140 ms | 135 ms | 7.34 s | 1.0× | 1.0× |
| maps 1M | — | 111 ms | 182 ms | 104 ms | 607 ms | 0.6× | 1.1× |
| maps 3M | 2.00 s | 632 ms | 607 ms | 334 ms | 1.91 s | 1.0× | 1.9× |

Contra Python, a Caju passou de 3 a 25 vezes mais rápida para 2 a 70 vezes (e nos mapas, de empate
para 2× mais rápida). Os tempos têm ruído de alguns por cento entre execuções (o matmul variou de
133 a 145 ms sem mudança no código dele).

## Todas as medições

<!-- python3 bench/compare/rounds/table.py -->
| challenge | n | round 0 | round 1 | round 2 | round 3 | round 4 | round 5 | round 6 | round 7 | round 8 | round 9 | round 10 | round 11 | round 12 | round 16 | round 18 | total gain |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | — | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 2 ms | 1 ms | 1.71× |
| fib | 30 | 13 ms | 13 ms | — | 10 ms | 9 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 6 ms | 2.08× |
| fib | 35 | 126 ms | 125 ms | 94 ms | 92 ms | 91 ms | 65 ms | 66 ms | 66 ms | 65 ms | 66 ms | 69 ms | 64 ms | 64 ms | 62 ms | 57 ms | 2.21× |
| sieve | 100,000 | 6 ms | 5 ms | — | 4 ms | 4 ms | 4 ms | 3 ms | 3 ms | 3 ms | 3 ms | 3 ms | 2 ms | 2 ms | 1 ms | 1 ms | 4.65× |
| sieve | 1,000,000 | 40 ms | 41 ms | — | 28 ms | 29 ms | 27 ms | 18 ms | 16 ms | 16 ms | 16 ms | 17 ms | 11 ms | 7 ms | 4 ms | 3 ms | 13.77× |
| sieve | 10,000,000 | 435 ms | 424 ms | 370 ms | 317 ms | 320 ms | 304 ms | 218 ms | 185 ms | 185 ms | 187 ms | 188 ms | 144 ms | 70 ms | 29 ms | 21 ms | 20.83× |
| nbody | 10,000 | 9 ms | 9 ms | — | 7 ms | 7 ms | 7 ms | 6 ms | 6 ms | 6 ms | 6 ms | 6 ms | 5 ms | 5 ms | 3 ms | 3 ms | 3.09× |
| nbody | 100,000 | 75 ms | 76 ms | — | 59 ms | 55 ms | 53 ms | 46 ms | 45 ms | 44 ms | 43 ms | 44 ms | 44 ms | 41 ms | 19 ms | 18 ms | 4.08× |
| nbody | 1,000,000 | 737 ms | 735 ms | 725 ms | 576 ms | 532 ms | 516 ms | 449 ms | 438 ms | 435 ms | 427 ms | 419 ms | 425 ms | 396 ms | 175 ms | 175 ms | 4.21× |
| mandelbrot | 250 | 17 ms | 17 ms | — | 17 ms | 9 ms | 10 ms | 9 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 7 ms | 3 ms | 3 ms | 5.08× |
| mandelbrot | 500 | 62 ms | 62 ms | — | 61 ms | 33 ms | 33 ms | 33 ms | 24 ms | 25 ms | 25 ms | 25 ms | 24 ms | 23 ms | 10 ms | 10 ms | 6.05× |
| mandelbrot | 1,000 | 243 ms | 243 ms | 251 ms | 237 ms | 127 ms | 128 ms | 125 ms | 92 ms | 93 ms | 94 ms | 94 ms | 90 ms | 90 ms | 37 ms | 37 ms | 6.51× |
| matmul | 100 | 12 ms | 12 ms | — | 10 ms | 10 ms | 10 ms | 9 ms | 9 ms | 7 ms | 7 ms | 7 ms | 5 ms | 5 ms | 3 ms | 2 ms | 5.08× |
| matmul | 200 | 78 ms | 79 ms | — | 65 ms | 65 ms | 66 ms | 64 ms | 62 ms | 41 ms | 41 ms | 45 ms | 33 ms | 33 ms | 11 ms | 11 ms | 7.34× |
| matmul | 300 | 256 ms | 253 ms | 209 ms | 212 ms | 214 ms | 213 ms | 210 ms | 202 ms | 133 ms | 136 ms | 145 ms | 108 ms | 107 ms | 35 ms | 33 ms | 7.75× |
| sort | 100,000 | 28 ms | 28 ms | — | 18 ms | 18 ms | 18 ms | 14 ms | 13 ms | 14 ms | 14 ms | 13 ms | 11 ms | 11 ms | 9 ms | 8 ms | 3.48× |
| sort | 500,000 | 151 ms | 148 ms | — | 92 ms | 96 ms | 94 ms | 68 ms | 67 ms | 67 ms | 69 ms | 68 ms | 56 ms | 54 ms | 44 ms | 40 ms | 3.81× |
| sort | 2,000,000 | 637 ms | 626 ms | 484 ms | 390 ms | 397 ms | 394 ms | 287 ms | 280 ms | 283 ms | 287 ms | 284 ms | 234 ms | 229 ms | 184 ms | 164 ms | 3.88× |
| maps | 100,000 | 35 ms | 35 ms | — | 25 ms | 24 ms | 24 ms | 16 ms | 16 ms | 13 ms | 13 ms | 11 ms | 10 ms | 10 ms | 10 ms | 10 ms | 3.61× |
| maps | 1,000,000 | 561 ms | 538 ms | — | 438 ms | 405 ms | 374 ms | 300 ms | 332 ms | 317 ms | 334 ms | 253 ms | 176 ms | 191 ms | 115 ms | 115 ms | 4.89× |
| maps | 3,000,000 | 2.00 s | 2.02 s | 1.65 s | 1.60 s | 1.60 s | 1.53 s | 1.28 s | 1.33 s | 1.21 s | 1.26 s | 966 ms | 833 ms | 852 ms | 605 ms | 607 ms | 3.30× |

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

## Rodada 9: inline de funções pequenas

**Hipótese:** no nbody, `math.sqrt(d2)` é uma chamada de função comum por par de corpos
(`math.sqrt` é `return __sqrt(x)`), com o custo de chamada e com o valor saindo dos registradores
XMM.
**Mudança:** `try_inline` troca a chamada a uma função cujo corpo é só `return E` (sem chamar
funções do programa, até 40 nós) por uma cópia de `E` com os parâmetros trocados pelos
argumentos. Para não mudar o significado: os argumentos não podem chamar funções, o tipo de cada
um tem que ser o do parâmetro, um parâmetro usado mais de uma vez (ou nenhuma) só aceita
argumento simples, e o inline é recusado se uma variável local de quem chama tiver o nome de uma
global usada no corpo. `fexpr` entende chamadas inline que devolvem `num`, e `__sqrt` vira
`sqrtsd` direto no registrador.
- A primeira versão fez inline de `fn helper() -> any { return recover() }`: o `recover` só vale
  na própria função adiada, e o inline mudou isso (um teste de `panic` acusou). Funções internas
  que dependem da chamada em que estão (`recover`, `__depth`, `__sp`...) ficaram fora.
- Testes novos: `tests/lang/inline_test.caju`.

**Resultado:** nbody −2%: o `sqrt` não era o custo principal. O que sobra no nbody: cada `x[i]`
de uma lista global lê o ponteiro da memória e confere nil e limite; há 8 variáveis `num` para 4
registradores; e ainda há 156 `push` na função `advance`.

## Rodada 10: mapas

**Hipótese:** ler `m[k]` eram duas chamadas ao runtime (`rt_map_find` e `rt_map_val`), e cada
tentativa da busca chamava `rt_hash` e `rt_keq`, mesmo com chave inteira.
**Mudança:**
- `rt_map_find` (runtime, `rt/values.caju`) tem um caminho para chaves inteiras com o hash e a
  comparação escritos no próprio laço, sem chamadas; `rt_hash` testa a chave inteira primeiro.
- `rt_map_get` devolve o valor (ou 0) e se a chave foi achada; o código gerado faz uma chamada só
  e só chama `rt_zero` quando o valor zero do tipo não é 0 (textos, structs).
- Testes novos: `tests/lang/map_values_test.caju` (valores zero de cada tipo, `v, ok`, chaves
  negativas e grandes, `0.0` e `-0.0`, 50 mil chaves, structs como valores).

**Resultado:** maps −23% (1,26 s → 966 ms).

## Rodada 11: listas dentro de laços

**Hipótese:** em `for i := 0; i < len(a); i++ { ... a[i] ... }`, cada volta chamava `rt_slen`
para o `len(a)`, e cada `a[i]` lia o cabeçalho da lista, conferia nil, lia o tamanho, comparava
e lia o ponteiro dos dados. Mas o cabeçalho de uma lista nunca muda: `append` e `a[x:y]` criam
um cabeçalho novo (`rt_hdr`). Se o laço não atribui a variável, o tamanho e os dados não mudam.
**Mudança:**
- `scan_loop` lista as variáveis que um laço (condição, passo e corpo) indexa e as que ele
  atribui. Antes de um `while`, `for` ou `range`, `enter_scache` guarda o tamanho e o ponteiro
  dos dados de cada lista local que o laço indexa e não atribui (fora: listas em célula,
  capturadas, globais ou em registrador) em duas variáveis escondidas na pilha (o coletor vê o
  ponteiro ali). Dentro do laço, `len(a)` lê a variável escondida e `a[i]` faz só
  `cmp rcx,[tamanho]; jae lento; mov rax,[dados]`; o caminho lento é o de antes e dá o mesmo erro.
- `counted_loop`: em `for i := K; i < len(a); i++` com `K >= 0` e nem `i` nem `a` atribuídos na
  condição ou no corpo, `a[i]` está sempre dentro dos limites e não é conferido. `i` tem que ser
  um `int` local fora de célula e não capturado (um `*p = 7` com `p := &i`, ou uma função anônima
  que muda `i`, mudariam o índice sem que a varredura visse).
- `len`/`cap` de uma lista viram duas instruções (sem chamar `rt_slen`), e o `range` lê os dados
  uma vez.
- O agente que escreveu a primeira versão mediu o ganho, mas o `counted_loop` nunca era ativado:
  o `0` de `i := 0` e o `1` de `i++` vêm sem tipo anotado (`imm32` os tomava por `num`), e a
  varredura incluía o próprio `i++`, então `i` sempre parecia atribuído. Corrigido com `int_lit`
  e varrendo só a condição e o corpo; o código gerado (`tools/disasm.sh`) conferido.
- Testes novos: `tests/lang/loop_lists_test.caju` (lista atribuída no laço, `append` sem
  atribuir, lista nil, índice que não é a variável do laço, `&i`, função anônima que muda `i` ou
  a lista). A suíte também passou com coleta a cada 64 KB.

O laço de soma de uma lista (`for i := 0; i < len(a); i++ { s += a[i] }`) passou de 26
instruções mais uma chamada a `rt_slen` por volta para 17 instruções.
**Resultado** (base remedida na mesma sessão, melhor de 3 passadas de 5 execuções): matmul −21%
(136 → 108 ms), crivo −17% (173 → 144 ms), sort −13% (269 → 234 ms). O nbody ficou 7% mais lento,
mas o código de `advance` é idêntico instrução por instrução: só o endereço da função mudou
(o nbody usa listas globais, que a rodada não toca). É efeito de alinhamento do código.

## Rodada 12: listas de bool com 1 byte por elemento

**Hipótese:** todo elemento de lista ocupava 8 bytes; o crivo de 10 milhões varria 80 MB (o Go,
10 MB). O custo é de memória e de cache, não de instruções.
**Mudança:** listas e arrays de `bool` guardam 1 byte por elemento.
- Gerador: `byte_elems(t)` diz se a lista é de bool; ler é `movzx eax, byte [rax+rcx]`, o
  endereço é `lea rax, [rax+rcx]`; literais e `append` gravam bytes; `a[x:y]` passa o tamanho do
  elemento ao runtime (`rt_sub_slice`/`rt_sub_array` ganharam um argumento).
- Um `*bool` pode apontar para dentro de uma lista de bool (1 byte) ou para uma variável ou campo
  (8 bytes, cujos bytes de cima são sempre 0 num bool): por isso todo bool lido ou gravado por
  endereço usa 1 byte (`load_at`/`store_at`).
- Runtime (`rt/values.caju`): `rt_esize`, `rt_eload`, `rt_estore`, `rt_ecopy`, `rt_edata`; o
  bloco de dados de uma lista de bool vem de `rt_alloc_ns` (sem ponteiros, já zerado: tudo
  `false`). `make`, `append`, `copy`, comparação, cópia de arrays, valores zero e a impressão
  conhecem o tamanho.
- `[]uint8` continua com 8 bytes (fica para depois: aparece em mais lugares da biblioteca).
- **Bootstrap:** como o formato dos dados mudou, o compilador anterior não pode compilar este
  (ele gera leituras de 8 bytes, e o runtime novo aloca 1). A cadeia tem que começar no JS:
  `node bootstrap/caju.js build -o build/s1 ...`, depois s1 → s2 → s3.
- Testes novos: `tests/lang/bool_lists_test.caju` (make, literais, índices, ponteiros para
  elementos, append, copy com sobreposição, fatias que compartilham memória, arrays em structs,
  comparação, impressão). A suíte também passou com coleta a cada 64 KB.

**Resultado:** crivo −52% (146 → 70 ms) e memória de 79 para 11 MB no tamanho maior; o resto não
mudou (o nbody voltou aos 396 ms: confirma que os 7% da rodada 11 eram alinhamento).

## Rodadas 13 a 16: sete ângulos em paralelo

Com `perf` e `valgrind` instalados (docs/tools.md), a contagem exata de instruções mostrou que a
Caju executava 1,7 a 3,2 vezes mais instruções que o Go: o problema era o código gerado, não a
memória (exceto nos mapas, com 0,77 instrução por ciclo). Sete agentes testaram uma hipótese
cada, num worktree, com a suíte e a autocompilação como prova; cada um foi integrado e validado
de novo (cadeia desde o JS, suíte normal e com coleta a cada 64 KB, saídas iguais às do Go).

| mudança | commit | efeito principal (instruções) |
|---|---|---|
| mapas: etiqueta do hash no índice, entradas de 16 bytes | 4c410db | maps −20% (ciclos −28%, falhas de cache −38%) |
| 13: listas globais em laços sem chamadas; `movsd` direto; `jb` no caminho rápido | dc7734d | nbody −31%, matmul −14% |
| 14: operações direto nas variáveis em registrador/slot (`inc rbx`, `cmp rbx,r12`, `add [rax+rbx*8],imm`) | 6cbb73d | sieve −42%, matmul −36%, mandelbrot −34% |
| 15: variáveis `num` em xmm8–14 (salvas em volta das chamadas) | c91bf28 | mandelbrot −28%, nbody −6% |
| 16: RSI, RDI, R8–R11 para variáveis; dados/tamanho das listas em registrador nos laços | 01668a2 | sieve −11%, matmul −8% (ciclos do matmul −60%) |

**Tempo** (rodada 12 × rodada 16, mesma sessão, intercaladas, melhor de 3 passadas de 5
execuções, maior tamanho): sieve 67 → 29 ms (−57%), nbody 390 → 175 ms (−55%), mandelbrot 89 →
37 ms (−58%), matmul 106 → 35 ms (−67%), sort 225 → 184 ms (−18%), maps 809 → 605 ms (−25%),
fib 63 → 62 ms.

## Rodadas 17 e 18: fluxo de controle e divisão por constante

- **17 (ângulo 7, cfad91b):** laços `while`/`for`/`range` com a condição depois do corpo (um
  desvio por volta); caminhos de erro (limites, nil, divisão, deslocamento, profundidade) no
  código frio, depois do `ret`; `x64.finish` encurta desvios para rel8 e tira desvios para a
  instrução seguinte; `return` no meio da função faz o epílogo ali. Testes:
  `tests/lang/loop_layout_test.caju`.
- **18 (ângulo 1, 9c18cb7):** `x / d` e `x % d` com `d` constante sem `idiv` nem verificações
  (deslocamentos para potências de 2, multiplicação pelo número mágico para os outros). Testes:
  `tests/lang/const_div_test.caju` (10 tipos inteiros, conferidos contra o caminho geral).

Medidas separadas sobre a rodada 16 (tempo, 3 passadas intercaladas): a 17 deu sieve −31%,
sort −11%, fib −7%; a 18 deu sort −5% e matmul −15% sozinha, mas na combinação o matmul fica em
−4% (a inicialização do matmul faz só 90 mil divisões, ~1 ms: o −15% era efeito de alinhamento).
Juntas, sobre a rodada 16: sieve 29 → 21 ms (−28%), sort 184 → 164 ms (−11%), fib 62 → 57 ms
(−8%); o resto igual. A 18 vale mais fora destes desafios: −21% de ciclos num laço com `%`
constante.

## Rodada 19: o custo das chamadas (fib)

**Hipótese:** depois das rodadas anteriores o fib era o único desafio ainda a 1,6× do Go. Pelo
código de máquina (`tools/disasm.sh`), a Caju executava 12 instruções numa chamada-folha
(`n < 2`) e 29 nas outras; o Go, 10 e 20 (`go tool objdump`). Três sobras:
1. A folha montava o quadro inteiro (push rbp, sub rsp, guardar e carregar rbx) só para
   comparar `n` e voltar.
2. `mov rsp, rbp; pop rbp` em todo retorno.
3. A profundidade de chamadas custava `cmp r15,10000; jge; inc r15` antes de cada chamada.

**Mudança:**
- `early_guard`: uma função cujo primeiro comando é `if p < K { return q }` (p parâmetro `int`;
  K constante ou outro parâmetro; q parâmetro ou constante; qualquer comparação) faz o teste
  antes do prólogo, lendo os argumentos acima do endereço de retorno (`[rsp+8+...]`), e volta
  sem montar o quadro. Nada roda antes desse comando na função, então pular o prólogo não muda
  nada; ficam fora funções com `defer`, funções anônimas, parâmetros em célula e resultados
  com nome. A folha do fib: `mov rax,[rsp+8]; cmp rax,2; jge corpo; ret` (4 instruções).
- `leave` no lugar de `mov rsp, rbp; pop rbp`.
- R15 conta as chamadas que ainda cabem: começa em 10.000 e cada chamada faz
  `dec r15; js erro` (e `inc r15` na volta). A 10.001ª chamada aninhada falha, como antes; o
  runtime só guarda, restaura e compara o valor (`__depth`/`__set_depth`), então nada mais muda.
- Testes novos: `tests/lang/calls_test.caju` (variações da guarda, métodos, exatamente 10.000
  chamadas passam e 10.001 falham, a profundidade inteira de volta depois de um panic
  recuperado); passam também no compilador anterior.

**Resultado:** instruções do fib 32 de 144,7 M para 109,5 M (−24%; o Go faz 103 M); os outros
desafios caíram de 0 a 1%. Tempo (5 passadas intercaladas): fib 35 de 58 para 41 ms (−30%);
o Go faz 36,7 ms. O que sobra é a passagem de argumentos pela pilha (o Go usa registradores) e
guardar/restaurar o RBX nas chamadas que não são folha.

## Rodada 20 (ângulo C): recursão como laço com acumulador

**Hipótese:** o Rust transforma `fib(n - 1) + fib(n - 2)` num laço (`acc += fib(n - 1); n -= 2`):
metade das chamadas. Com inteiros de 64 bits que dão a volta, + * & | ^ são exatamente
associativas e comutativas, então vale para qualquer função assim.

**Mudança (`acc_plan`, `acc_loop`, `acc_return` em native.caju):** numa função (não método, sem
`defer`, sem resultados com nome, sem variáveis em célula, resultado `int`) cujos `return` diretos
no corpo ou em blocos if/else são `L op f(args)`, `f(args) op L` (L literal ou variável local) ou
`f(args)`, esses `return` fazem `acc = acc op L`, passam os argumentos aos parâmetros e voltam ao
começo; os outros `return q` dão `acc op q`. A ordem de avaliação fica (L, os argumentos, depois a
"chamada"). Cada volta faz o `dec r15; js` da chamada que substitui (no mesmo nó, mesma
mensagem); quando L é ela mesma uma chamada e os argumentos não chamam nada, a unidade da chamada
de L fica (sem `inc r15`/`dec r15`), porque a chamada substituída é da mesma profundidade. Na saída
o R15 volta ao valor da entrada (guardado no quadro). Com `early_guard`, a guarda é testada de
novo no fim de cada volta (o laço vai direto para o segundo comando). O laço do fib:
`lea rax,[rbx-1]; push rax; dec r15; js; call fib; add rsp,8; add [acc],rax; sub rbx,2; cmp rbx,2; jge`.

**Resultado:** fib 32 de 109,5 M para 75,7 M instruções (−31%; Go 102,8 M, Rust 69,4 M); ciclos
42 M → 33 M (ruidoso). Os outros desafios não mudam. Testes: `tests/lang/self_calls_test.caju`
(resultados, volta dos 64 bits, ordem dos efeitos, structs por valor, exatamente 10.000 chamadas
em seis formas, profundidade das chamadas nos argumentos, recursão infinita, divisão por zero na
mesma linha, panic recuperado); passam também no compilador anterior.

## Rodadas 20 a 25: atrás do Rust

Com o Go alcançado, o alvo passou a ser o Rust, que executava 1,5× a 3× menos instruções em
fib, nbody, matmul, sort e maps (`perf stat` nos três binários; `objdump` do Rust e `go tool
objdump` mostraram o porquê). Seis agentes, um por hipótese, cada um num worktree; integrados um
por um (cadeia desde o JS, suíte normal e com coleta a cada 64 KB, saídas iguais às do Go).
Nenhum programa do benchmark foi alterado.

| rodada | mudança | commit | efeito (instruções) |
|---|---|---|---|
| 20 | recursão como laço com acumulador: `return f(a) + f(b)` vira laço numa das chamadas (como o LLVM), com a profundidade contada por volta e devolvida no retorno | 3db2a83 | fib −31% |
| 21 | laços `for v := E; v < C` com C constante: listas conferidas uma vez antes do laço; cópia sem verificações e o laço original quando falha; operandos `num` direto da memória | 719f14e | nbody −56% |
| 22 | argumentos não-ponteiro em registradores (RSI, RDI, R8–R11) nas chamadas diretas; duas entradas por função (`u.r.` e `u.f.`); `early_guard` nos registradores | 3fcce14 | fib −12% |
| 23 | laços contados versionados (limites conferidos antes, cópia sem verificações desenrolada ×4) e vetorizados com SSE2 quando o resultado é idêntico (aliasing conferido) | ca7cec0 | matmul −80% |
| 24 | fatos de índice (`a[i]` já conferido não é conferido de novo até `a` ou `i` mudarem); `make` sem zerar de novo; páginas novas sem zerar (`rt_fresh`); condição repetida antes do corpo | 6529562 | sort −29%, sieve −5% |
| 25 | mapas: `m[k] op= v` numa sondagem só (`rt_map_slot`); índice de 32 bits; vetores velhos liberados na hora e memória livre devolvida ao sistema | b2f68a7 | maps −36%; memória do maps 3M 132 → 50 MB |

Resultados negativos registrados pelos agentes: sondagem em grupos estilo SwissTable com SSE2
(menos desvios errados, mas mais instruções e mais ciclos); multiplicação vetorial de inteiros
de 64 bits com `pmuludq` (o próprio Rust gasta mais instruções por elemento do que o escalar
desenrolado).

**Onde o Rust ainda ganha:** fib (1,3×: o laço do acumulador tem 10 instruções contra 7, pelo
limite de profundidade e o `push` de volta), matmul (1,2×), mandelbrot (1,1×) e o maps grande
(1,9×: a tabela do Rust é mais compacta e o hash mais barato).

## Rodada 26: alocação e coleta (servidor HTTP)

Perfil do servidor HTTP (`bench/http`, `GET /users/:id`, um núcleo): ~55% do tempo de usuário
em alocação e coleta, 33% só dentro de `rt_alloc_x`, quase tudo numa instrução: a leitura do
próximo nó da lista livre (`__load64(p)`), que era uma falha de cache (objetos livres frios).
Medido com instruções exatas por requisição (callgrind) e CPU de usuário por requisição.

| hipótese | resultado |
|---|---|
| H2a alocar pela varredura do bitmap "em uso" em vez de lista livre (sem divisão, sem `rt_bit_set`/`rt_bit_clr`, bit "sem ponteiros" por página: chave = classe×2 + sem ponteiros) | aceita: 33,3 → 29,5 mil instr./req. |
| H2b faixas: reserva uma sequência de posições livres de uma vez (bits e zeragem juntos); cada alocação só avança um ponteiro; a coleta devolve o resto das faixas antes de marcar; varredura = `em uso &= marcado` | aceita: → 24,6 mil |
| H2c caminho rápido completo em `rt_alloc`/`rt_alloc_ns` ([próximo, fim, tamanho] por chave), o resto em `rt_alloc_slow` | aceita: → 22,5 mil |
| H2d limite de coleta menor (2 MB, 1 MB) para caber no cache | inconclusiva (ruído de outro processo); não mudou |
| H2e alocação expandida no lugar pelo gerador para tamanhos constantes | não feita: ~35 instr. por struct, ~1% por requisição |
| H1a mapa num bloco só (72 + 128 + 64 bytes) | rejeitada: menos alocações, mesmas instruções e mais bytes (classe de 320) |
| H1a′ mapa num bloco de 168 bytes (cabeçalho + 4 entradas + índice de 8) | aceita: 17,8 → 17,2 mil; 272 → 176 bytes por mapa vazio |
| H1b literais de struct: campo omitido cujo zero é 0 não chama `rt_zero` (texto: o literal `""`) | aceita: 18,3 → 17,8 mil |
| H1c `std/http`: linha de status e Content-Length sem concatenar (`put_int`), método/versão/nomes de cabeçalho comuns sem alocar (`mem_known`), `has_token` sem `split` | aceita: 18,9 → 18,3 mil |
| H1d framework web: roteador sem `split` (compara os bytes do caminho com os filhos fixos), `params`/`keys` criados só quando usados, cadeia de handlers guardada por rota | aceita: 22,5 → 18,9 mil |

Total no servidor, num núcleo (req/s, CPU de usuário por requisição):

| rota | antes | depois |
|---|---|---|
| GET /users/:id | 56,9 mil, 8,0 µs | 67,5 mil (+19%), 4,4 µs |
| GET /users (50) | 30,3 mil, 21,3 µs | 32,7 mil (+8%), 19,1 µs |
| POST /users | 50,4 mil, 10,7 µs | 64,2 mil (+27%), 6,1 µs |

O compilador compilando a si mesmo: 12,17 → 9,85 bilhões de instruções (−19%), 7,1 → 5,1
bilhões de ciclos (−28%). Benchmarks de CPU (fib...maps): ±0,1% de instruções. Memória: maps 3M
igual; sort 2M 16,9 → 19,9 MB (páginas separadas por "sem ponteiros").

## O que ficou para depois

Em ordem de ganho esperado:
1. ~~`[]bool` com 1 byte por elemento~~ (rodada 12). Falta `[]uint8`.
2. **Mais registradores para `num`** (XMM preservados não existem no Linux: precisaria guardar em
   volta das chamadas) e carregar `num` da memória direto para XMM (`movsd xmm, [rbp-x]`).
3. ~~Tirar verificações repetidas de laço~~ (rodada 11, para listas locais). Falta: listas
   globais (o nbody), e manter o ponteiro de dados num registrador.
4. **Desvios curtos** (`jcc rel8`) e código frio (chamadas de erro) fora do caminho quente.
5. **Uma representação intermediária** com alocação de registradores de verdade: o salto maior,
   mas é reescrever o gerador.
