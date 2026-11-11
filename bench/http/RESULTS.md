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
