# Compilador nativo da Caju: plano

Cópia do documento de planejamento (Claude Doc "Compilador nativo da Caju: plano"), com o
andamento até a fase 5. Onde a implementação decidiu diferente do plano original, vale o que está
em `docs/arquitetura-nativo.md` (marcado aqui como "decidido na fase N").

## Objetivo e escopo

O compilador nativo transforma um projeto Caju direto em código de máquina x86-64, sem a VM no
meio. O runtime (alocador, coletor de lixo, goroutines, maps, print, panic) é escrito na própria
Caju, com um núcleo mínimo em assembly. A VM de bytecode continua rodando na página, e o runtime
em Rust continua servindo o .exe x86 e servindo de referência nos testes.

Entra:
- programas e DLLs x64 para Windows (PE), e executáveis ELF x86-64 para Linux, usados só nos testes;
- toda a linguagem que a VM roda: tipos, structs, interfaces, slices, maps, closures, defer/panic,
  ponteiros, goroutines, canais, extern e dllexport;
- um runtime em Caju, com assembly só para a entrada do programa, a troca de pilha entre
  goroutines e a chamada de funções do Windows por ponteiro.

Fica de fora, por enquanto: x86 de 32 bits (continua pela VM); o interpretador da árvore;
otimizações pesadas (inlining, alocação global de registradores), que entram depois que tudo
estiver correto.

Meta de desempenho: o exemplo Benchmark pelo menos 10 vezes mais rápido que no runtime em Rust
(hoje: ~18 a 22 vezes).

## Arquitetura

O front end que já existe (léxico, parser, ligador e verificador de tipos) alimenta um caminho
novo que termina num .exe, ao lado do caminho de bytecode. O runtime em Caju passa pelo mesmo
front end e é compilado junto com cada programa. Nas fases 1 a 8 as partes novas são escritas em
JavaScript dentro da página; na fase 9 passam para Caju.

## Representação dos valores

Plano original: o mesmo layout do Go (campos no lugar, slices de 24 bytes, interfaces de 16 bytes).
**Decidido nas fases 1 a 3:** todo valor ocupa uma palavra de 8 bytes; texto é um ponteiro para
`[tamanho][bytes][0]`; struct e array são objetos no heap (uma palavra por campo) e `*T` aponta
para o próprio objeto; slice é um ponteiro para `[dados, tamanho, capacidade]`; any/interface é 0
ou ponteiro para uma caixa `[descritor, valor]`. Variáveis capturadas ou com `&x` moram numa célula.

## Geração de código

Plano: representação intermediária de três endereços, alocação de registradores (linear scan),
convenção interna com resultados na pilha, pilhas de goroutine de 1 MB com verificação no
prólogo, pontos de troca nas voltas de laço e chamadas, verificações (índice, nil, divisão) que
saltam para o runtime, montador próprio, PE com recursos de versão e assinatura, ELF para testes.
**Decidido na fase 1:** sem IR por enquanto (código direto da árvore anotada), resultado em RAX,
resultados extras em `g.ret`; a IR entra junto com o alocador de registradores.

## Runtime em Caju

Plano: arquivos os, mem, gc, sched, chan, map, str, fmt, iface, panic, asm. **Como ficou:** comum,
gc, valores, dinamico, panico, linux, windows (sched/chan vêm na fase 6). Os arquivos do runtime
podem usar operações de baixo nível (`__load64`, `__store64`, `__syscall`...), proibidas fora dele.

## Mudanças na linguagem

1. Inteiros de 64 bits exatos no nativo (a VM é exata só até 2^53; diferença aceita).
2. Operações de baixo nível só nos arquivos do runtime (feito como funções `__nome`, não `unsafe`).
3. Marcas para o compilador (`//caju:nogc` etc.): ainda não foram necessárias.

A tipagem gradual continua: parâmetro sem tipo vira `any` e funciona, mais devagar.

## Fases e entregas

1. **Base.** Montador, PE/ELF, números, booleanos, funções, if/while/for/switch, print.
   Pronta quando o grupo Primeiros passos sai igual. — **pronta**
2. **Memória.** Textos, slices, arrays, structs, ponteiros, maps; erros ao rodar com a linha.
   Pronta quando os exemplos Go de slices, maps e ponteiros saem iguais. — **pronta**
3. **Tipos dinâmicos e funções como valores.** any, interfaces, x.(T), switch de tipos,
   closures, vários resultados, error, métodos e embutidas. — **pronta**
4. **Coletor de lixo.** Marcar e varrer, classes de tamanho. Pronta quando o teste de 3 milhões
   de objetos roda com memória limitada (18 MB). — **pronta**
5. **defer, panic e recover.** Pronta quando o exemplo de erros, defer e panic sai igual. — **pronta**
6. **Goroutines e canais.** Escalonador, canais, select, sleep, deadlock. Pronta quando o exemplo de
   goroutines e os testes de canais saem iguais (programas com corrida de dados ficam de fora).
7. **Windows.** extern com a convenção x64, alloc/peek/poke, dllexport e a DLL. Pronta quando o
   teste de FFI e o exemplo da calculadora rodam no Wine.
8. **Na página.** Opção "Nativo (x64)" no Gerar .exe / .dll, comparação de velocidade, referência
   atualizada. Pronta quando os 135 casos de paridade passam no nativo.
9. **Compilador em Caju.** Pronta quando o compilador compilado por ele mesmo gera, de novo, um
   arquivo idêntico byte a byte.

## Testes

Cada exemplo e cada programa de `runtime/tests/go` roda na VM e no nativo, e as saídas têm que ser
idênticas. Linux primeiro (rápido); Wine no fim de cada fase. Programas com corrida de dados ficam
fora da comparação. Estresse: coletor com milhões de objetos (e a suíte com coleta a cada 64 KB),
recursão profunda, milhares de goroutines, maps com muitas remoções. Fase 9: estágios 2 e 3 do
compilador idênticos byte a byte.

## Decisões (tomadas com o dono do projeto)

| Decisão | Escolha |
|---|---|
| Inteiros acima de 2^53 | aceitar a diferença entre VM e nativo e documentar |
| Alvos do nativo | só Windows x64 (+ ELF para testes); o x86 continua pela VM |
| Compilador em Caju (fase 9) | meta, depois que a fase 8 estiver estável |
| Runtime em Rust | manter: serve o x86 e é a referência dos testes |

## Riscos

- Coletor conservador: um número que parece ponteiro segura um objeto (gasta memória, não erra).
- panic/recover: a parte mais delicada (feita na fase 5, com testes de panic dentro de defer).
- Formato dos números: 12 algarismos exatos como a VM (feito na fase 1, em aritmética inteira).
- Código sem tipos ganha pouco (cada operação passa pelo runtime; ~4x mais rápido que o Rust).
- Programas que dependem da ordem exata de preempção entre goroutines vão diferir da VM.
