# Servidor HTTP: chamadas de sistema e vários núcleos (H3, H4)

Medido em 2026-11-11 (Ryzen 7 5700G, WSL2). Servidor: `bench/http/caju/main.caju`, rota
`GET /users/:id`. Gerador: `bench/http/load` (Go, TCP direto, keep-alive; gasta bem menos CPU
que o `hey`), sempre em núcleos separados do servidor (`taskset`). Métrica principal: CPU do
servidor por requisição (utime + stime de `/proc/<pid>/stat`, somando os processos filhos),
mediana de 5 a 7 rodadas intercaladas; a vazão sozinha varia ±10% nesta máquina.

**Topologia:** as CPUs 0-1, 2-3, 4-5... são pares de hyper-threading do mesmo núcleo físico.
"4 núcleos" em `0-3` são 2 núcleos físicos; para 4 físicos use `0,2,4,6`.

## Contagem de chamadas por requisição (versão instrumentada, não versionada)

| caso | read | write | epoll_wait | epoll_ctl | clock_gettime | eventos por wait |
|---|--:|--:|--:|--:|--:|--:|
| 1 processo, 50 conexões | 1 | 1 | 0,05 | 0 | 0,05 | 20 |
| 4 processos, 50 conexões | 1 | 1 | 0,4–0,5 | 0 | 0,4–0,5 | 2–2,6 |
| 4 processos, 1000 conexões | 1 | 1 | 0,01 | 0 | 0,01 | 77–164 |

O laço já está no mínimo: uma leitura e uma escrita por requisição, sem `read` extra com EAGAIN e
sem ligar/desligar EPOLLOUT. O tempo de sistema (~8,5 µs/req num processo) é a pilha TCP.

## Hipóteses testadas (todas rejeitadas)

| # | ideia | resultado (µs de CPU por requisição, mediana) |
|---|---|---|
| E1 | epoll edge-triggered (ler até o buffer não encher) | 16,1 × 16,2 (1 proc); 32,0 × 30,3 (4 proc): sem ganho |
| E2 | `read`/`write` no lugar de `recvfrom`/`sendto` (SIGPIPE ignorado) | 17,3 × 16,7: sem ganho |
| E3 | 50 `epoll_wait(0)` antes de bloquear | 4 proc/50 conexões: +3% req/s, mas +8,5% CPU/req; 1 proc: ruído |
| E5 | um socket compartilhado com EPOLLEXCLUSIVE no lugar de SO_REUSEPORT | 94,8 mil × 100,2 mil req/s (200 conexões): pior |
| E6 | fixar cada processo numa CPU (`sched_setaffinity`) | 34,9 × 32,6 e 29,8 × 28,3: pior |
| E7 | lista indexada por fd no lugar do mapa de clientes | 17,8 × 17,1: ruído |
| — | menos `clock_gettime` | custa 402 ns; 0,05/req (1 proc) = 20 ns/req: não compensa |

## Escala com vários núcleos (H4)

| servidor | núcleos | conexões | req/s | CPU µs/req |
|---|---|--:|--:|--:|
| Caju 1 processo | 0 | 50 / 1000 | 53.600 / 50.700 | 17,3 / 17,8 |
| Caju 4 processos | 0,2,4,6 | 200 / 1000 | 81.700–105.600 / 103.300–116.900 | 28–32 |
| Go net/http GOMAXPROCS=4 | 0,2,4,6 | 200 / 1000 | 52.700 / 72.200 | 47–49 |
| Caju 8 processos | 0-7 | 1000 | 126.400 | 42,7 |
| Go net/http GOMAXPROCS=8 | 0-7 | 1000 | 93.000 | 61,5 |

- Com 50 conexões, o limite é o próprio teste: cada conexão espera a resposta anterior, e os 4
  processos ficam ociosos (16 mil req/s cada, contra 53 mil de um só). Com 1000, ficam todos em ~90%.
- A CPU por requisição sobe de ~17 para ~30 µs com 4 processos mesmo com o laço no mínimo (2
  chamadas por requisição, sem trocas de contexto): é o tempo de sistema que dobra (9 → 20 µs). O
  Go sofre o mesmo (25 → 47 µs). É custo do kernel/WSL2 com TCP local em paralelo, não do laço.
- O SO_REUSEPORT divide as conexões de forma desigual (26–75 mil req/s por processo), mas com
  carga alta todos ficam igualmente ocupados; a alternativa (E5) foi pior.

O ganho que resta está no código de usuário (alocação e coleta de lixo: ~50% do tempo de usuário),
tratado à parte.
