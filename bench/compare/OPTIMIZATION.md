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

Para comparar: Go faz 39 / 24 / 172 / 38 / 32 / 141 / 599 ms e Rust 21 / 24 / 66 / 38 / 11 / 135 / 359 ms
(`RESULTS.md`).

## Todas as medições

<!-- python3 bench/compare/rounds/table.py -->
| challenge | n | round 0 | round 1 | round 2 | round 3 | total gain |
|---|--:|--:|--:|--:|--:|--:|
| fib | 25 | 2 ms | 2 ms | — | 2 ms | 1.18× |
| fib | 30 | 13 ms | 13 ms | — | 10 ms | 1.30× |
| fib | 35 | 126 ms | 125 ms | 94 ms | 92 ms | 1.37× |
| sieve | 100,000 | 6 ms | 5 ms | — | 4 ms | 1.49× |
| sieve | 1,000,000 | 40 ms | 41 ms | — | 28 ms | 1.44× |
| sieve | 10,000,000 | 435 ms | 424 ms | 370 ms | 317 ms | 1.37× |
| nbody | 10,000 | 9 ms | 9 ms | — | 7 ms | 1.24× |
| nbody | 100,000 | 75 ms | 76 ms | — | 59 ms | 1.27× |
| nbody | 1,000,000 | 737 ms | 735 ms | 725 ms | 576 ms | 1.28× |
| mandelbrot | 250 | 17 ms | 17 ms | — | 17 ms | 1.03× |
| mandelbrot | 500 | 62 ms | 62 ms | — | 61 ms | 1.02× |
| mandelbrot | 1,000 | 243 ms | 243 ms | 251 ms | 237 ms | 1.02× |
| matmul | 100 | 12 ms | 12 ms | — | 10 ms | 1.16× |
| matmul | 200 | 78 ms | 79 ms | — | 65 ms | 1.20× |
| matmul | 300 | 256 ms | 253 ms | 209 ms | 212 ms | 1.20× |
| sort | 100,000 | 28 ms | 28 ms | — | 18 ms | 1.56× |
| sort | 500,000 | 151 ms | 148 ms | — | 92 ms | 1.63× |
| sort | 2,000,000 | 637 ms | 626 ms | 484 ms | 390 ms | 1.63× |
| maps | 100,000 | 35 ms | 35 ms | — | 25 ms | 1.36× |
| maps | 1,000,000 | 561 ms | 538 ms | — | 438 ms | 1.28× |
| maps | 3,000,000 | 2.00 s | 2.02 s | 1.65 s | 1.60 s | 1.25× |

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
