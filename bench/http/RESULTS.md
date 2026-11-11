# Servidor HTTP: Caju × Go

A mesma API nas três versões: `caju/main.caju` (framework github.com/aecdanjundex/web, copie o
`web.caju` do pacote para o lado do `main.caju`), `gin/` (Gin) e `nethttp/` (só biblioteca padrão).
Rotas: `GET /users/:id` (mapa pequeno em JSON), `GET /users` (lista de 50 structs), `POST /users`
(lê um JSON para struct e devolve). Carga com `hey -n 20000 -c 50` (com e sem keep-alive), na mesma
máquina (Ryzen 7 5700G, 16 threads, WSL2): o próprio `hey` divide a CPU com o servidor, então
os números perto de 35 mil req/s estão no limite do gerador de carga.

Requisições por segundo, 50 clientes (2026-11-11):

| rota | conexão | Caju 0.2 | Caju 1 proc | Caju 4 proc | Caju 16 proc | Gin | Go net/http |
|---|---|--:|--:|--:|--:|--:|--:|
| GET /users/:id | keep-alive | 11.579 | 33.915 | **41.026** | 35.840 | 32.743 | 34.471 |
| GET /users/:id | nova a cada req | 11.424 | 11.115 | **11.547** | 11.148 | 10.566 | 11.185 |
| GET /users (50) | keep-alive | 5.059 | 21.632 | 28.754 | **30.737** | 23.949 | 22.299 |
| GET /users (50) | nova a cada req | 5.648 | 9.884 | **10.363** | 10.109 | 9.307 | 9.286 |
| POST /users | keep-alive | 9.069 | 30.671 | 29.003 | **36.592** | 31.265 | 29.382 |
| POST /users | nova a cada req | 8.638 | 11.228 | 10.375 | **11.767** | 11.107 | 11.105 |
| memória máxima | | 19 MB | 32 MB | 114 MB* | 347 MB* | 36 MB | 23 MB |
| executável | | 281 KB | | | | 31,6 MB | 9,8 MB |

\* soma do RSS dos processos (conta várias vezes as páginas compartilhadas depois do fork).

O que mudou desde a Caju 0.2: keep-alive, laço de eventos com epoll, vários processos com
SO_REUSEPORT (`http.listen_and_serve_workers`, `r.run_workers`) e std/json de 2 a 20× mais rápido
(bench/json/RESULTS.md).

## Medição justa: servidor e gerador em CPUs separadas (rodada 2, 2026-11-11)

O `hey` saturava antes do servidor. `run.py` (nesta pasta) fixa o servidor em CPUs com `taskset`,
roda o gerador `load/` (Go, TCP direto, keep-alive) nas outras e mede a CPU do servidor por
requisição (/proc). Compile `caju/server` (com o web.caju do pacote ao lado), `gin/server` e
`nethttp/server` antes; `LGC=1,3,5,7,8-15 python3 run.py`. Na máquina, CPUs 2k e 2k+1 são o
mesmo núcleo físico: "4 núcleos físicos" = CPUs 0,2,4,6. Depois das otimizações de alocação
(OPTIMIZATION.md, rodada 26) e do roteador do web; as hipóteses de chamadas de sistema estão em
SYSCALLS.md (nenhuma ganhou: o laço já faz 1 read + 1 write por requisição).

| cenário | rota | Caju | Gin | Go net/http |
|---|---|--:|--:|--:|
| 1 CPU, 50 conexões | GET /users/:id | **65.198** (13,0 µs) | 33.424 (28,2 µs) | 32.687 (29,2 µs) |
| | GET /users (50) | **32.177** (29,7 µs) | 18.824 (50,2 µs) | 21.054 (45,8 µs) |
| | POST /users | **65.470** (15,0 µs) | 29.354 (35,1 µs) | 31.434 (30,5 µs) |
| 4 núcleos, 1000 conexões | GET /users/:id | **122.188** (27,3 µs) | 70.738 (48,6 µs) | 71.297 (48,1 µs) |
| | GET /users (50) | **61.202** (58,7 µs) | 43.028 (84,8 µs) | 38.256 (92,2 µs) |
| | POST /users | **118.174** (30,7 µs) | 60.591 (56,4 µs) | 66.844 (51,8 µs) |

req/s (CPU do servidor por requisição). Nenhum erro em nenhum teste.
