# std/json: velocidade (ns por operação, menos é melhor)

Microbenchmark `bench/json/bench.caju` e o equivalente em Go, `bench/json/bench.go`
(`encoding/json`, Go 1.27). Ryzen 7 5700G, WSL2; melhor de 5 rodadas.

```sh
CAJU_ROOT=$PWD build/caju build -o /tmp/jb bench/json/bench.caju && /tmp/jb
cd bench/json && go run bench.go
```

| caso | Caju antes | Caju depois | Go | ganho | Caju ÷ Go |
|---|--:|--:|--:|--:|--:|
| marshal de []User com 50 itens | 95.108 | **12.544** | 11.179 | 7,6× | 1,12 |
| marshal de map[str]any pequeno | 2.400 | **1.194** | 936 | 2,0× | 1,28 |
| unmarshal de um User | 4.353 | **1.058** | 498 | 4,1× | 2,12 |
| unmarshal de []User com 50 itens | 737.255 | **36.395** | 23.219 | 20,3× | 1,57 |
| parse de um documento médio (Go: em `any`) | 178.033 | **65.218** | 35.808 | 2,7× | 1,82 |
| unmarshal do documento médio numa struct | 217.372 | **20.822** | 12.092 | 10,4× | 1,72 |
| marshal do documento médio | 55.045 | **8.082** | 5.950 | 6,8× | 1,36 |

User = {id int, name str, email str, active bool}. O documento médio tem texto com escape,
inteiro, número quebrado, lista de textos, um User, 20 Users e um map[str]int.

## O que mudou (lib/json.caju)

**marshal**
- Plano por tipo de struct (`Plan`, em cache por descritor): nomes já entre aspas (`"nome":` e
  `,"nome":`), descritores e campos embutidos calculados uma vez (antes: `embedded()` comparava
  nomes de tipo a cada campo de cada item).
- Buffer próprio (`Enc.mem`) que copia de 8 em 8 bytes e é reaproveitado entre chamadas
  (`spare_mem`; um marshal dentro de um método `Error` usa outro). O `strings.Builder` copiava
  byte a byte e crescia 256 → 4 KB a cada chamada.
- Inteiros escritos direto no buffer; texto sem escape copiado de uma vez; `str`, `int` e `bool`
  tratados no laço dos campos, sem passar por `word`.
- `e.err != ""` virava uma chamada de comparação de texto a cada campo: agora `len(e.err) != 0`.
- `&first` alocava uma célula por struct: agora é valor de retorno.
- Números quebrados: caminho rápido (`short_fixed`, menor número de casas que relê igual,
  conferido com `parse_float`) antes do `toml.format_float` exato, que usa números grandes.
  Igual ao antigo em 131.815 valores aleatórios.
- Mapas: chaves e valores em duas listas ordenadas juntas (antes: um mapa auxiliar).

**unmarshal**
- Antes: montava a árvore `json.Value` inteira (um objeto por valor, um mapa por objeto, uma
  cópia com validação UTF-8 por texto) e depois a percorria.
- Agora, duas passadas sobre o texto, sem árvore:
  1. `vtyped` valida a sintaxe (a mesma gramática e limites de `parse`) e confere que cada
     valor cabe no seu lugar pelo tipo de destino: tipo, faixa dos inteiros, chaves com escape,
     campos repetidos, structs com campo embutido... Anota a quantidade de itens de cada lista e,
     para cada chave de struct, o campo escolhido e onde o valor começa.
  2. `Fast` decodifica direto na memória seguindo os descritores, sem reler as chaves.
  Se a primeira passada recusa, roda o decodificador antigo pela árvore, que dá as mesmas
  mensagens de erro de antes. Como a recusa vem antes de qualquer escrita, um texto com erro de
  sintaxe continua sem mexer no valor de destino.
- `parse`: `p.word("true")` fazia `p.s[p.i:]` (copiava e revalidava o resto inteiro do texto a
  cada true/false/null); textos e números ASCII sem a revalidação de UTF-8.

## Como foi verificado
- `lib/json_test.caju`: 9 testes novos (cada tipo de campo, nil, listas de bool de 1 byte,
  faixas de int8..uint32, chaves repetidas e sem diferenciar maiúsculas, escapes em chaves,
  erro de sintaxe sem escrita parcial, marshal dentro de `Error`); os 37 testes passam também
  com a biblioteca antiga.
- Teste diferencial (fora do repositório): 100 mil documentos JSON gerados (tipos certos e
  errados, chaves repetidas e com maiúsculas, escapes, UTF-8, espaços, documentos cortados)
  decodificados pelo caminho novo e pelo decodificador da árvore, em valores zerados e
  pré-preenchidos e em []T, map[str]*T e any: nenhuma diferença, também com coleta de lixo a
  cada 64 KB. A saída do marshal e do marshal_indent de 6 mil valores (884 mil linhas) é
  idêntica à da versão anterior.
- Suíte inteira: 794 passam, 0 falham, 9 pulados.

## O que ainda separa do Go
O resto é principalmente o código gerado (cada acesso a campo passa pela memória com teste de
nil, chamadas pequenas não são expandidas no lugar): ver `tools/disasm.sh`. `parse` em árvore
paga uma alocação por valor e um mapa por objeto, inerente ao formato `json.Value`.

## Rodada 2: funções-folha e tabelas reaproveitadas (2026-11-11)

Ponto de partida já inclui a rodada 26 de alocação (OPTIMIZATION.md), que baixou tudo um pouco.
Melhor de 5 rodadas, ns por operação:

| caso | Caju antes | Caju depois | Go | Caju ÷ Go |
|---|--:|--:|--:|--:|
| marshal de []User com 50 itens | 11.672 | **7.859** | 10.701 | 0,73 |
| marshal de map[str]any pequeno | 549 | **549** | 896 | 0,61 |
| unmarshal de um User | 648 | **473** | 490 | 0,97 |
| unmarshal de []User com 50 itens | 27.301 | **18.653** | 22.320 | 0,84 |
| parse de um documento médio | 31.579 | **31.613** | 34.197 | 0,92 |
| unmarshal do documento médio | 14.278 | **10.498** | 11.685 | 0,90 |
| marshal do documento médio | 6.348 | **4.801** | 5.757 | 0,83 |

No servidor HTTP (bench/http, 1 CPU, `split.sh`), `GET /users` (50 itens): CPU de usuário por
requisição 20,1 → 15,2 µs, 34,1 → 37,2–38,9 mil req/s; `POST /users`: 7,2 → 5,4 µs.

Hipóteses:

| | ideia | resultado |
|---|---|---|
| J1 | structs "planas" (só str, int e bool, sem embutidos) no marshal compacto: espaço do objeto inteiro reservado uma vez, escrita por funções-folha (`wcopy`, `wquote` com 8 bytes por vez/SWAR, `wint`) sem chamadas, logo com as variáveis em registradores (`Enc.flat`); a lista de structs planas chama `flat` direto | aceita: 11.672 → 7.859 |
| J2a | conferência (VScan) dos valores de campos str/int/bool por funções-folha (`plain_end` SWAR, `int_end`, `bool_end`) no lugar de `typed()` | aceita: 27,3 → 24,2 mil |
| J2b | o mesmo no lado que escreve (Fast: `int_at`, bool direto) | rejeitada (empate); fica só `plain_end` no `str_word` |
| J2c | objeto de struct plana validado inteiro numa função-folha (`vflat`): chaves exatas pela dica e depois pela lista, cada campo uma vez, valores simples; grava os pares [campo, posição] direto no bloco de `keys`; qualquer outra coisa (null, chave desconhecida ou com outra caixa, escape, número que não é inteiro simples) volta ao caminho geral | aceita: 24,2 → 21,7 mil |
| J2d | tabelas `keys` e `arrs` do VScan reaproveitadas entre chamadas (`spare_keys`, `spare_arrs`) | aceita: 21,7 → 18,7 mil; um User: 540 → 473 |
| J3 | mudanças no gerador (expandir funções pequenas, menos testes de nil) | não feita: as funções-folha na biblioteca já passaram o Go sem mexer no compilador |
| J4 | árvore do parse com menos alocações | não feita: o parse já está abaixo do Go (31,6 contra 34,2 mil) |

Conferência: os 42 testes de lib/json_test.caju (5 novos para os caminhos planos) passam também
com a biblioteca antiga; um teste diferencial de 26 mil linhas (structs planas aleatórias com
escapes e UTF-8, 20 mil objetos JSON aleatórios com espaços, chaves fora de ordem, desconhecidas,
com outra caixa, null, números inválidos e erros) sai idêntico ao da biblioteca antiga, também com
coleta a cada 64 KB.
