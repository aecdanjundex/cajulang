# Testes (`caju test` e `std/testing`)

Os testes seguem o estilo do Go na organização e o estilo BDD na escrita:

- um arquivo de teste termina em `_test.caju` e fica **ao lado** do código que testa
  (`lib/strings.caju` → `lib/strings_test.caju`);
- programas auxiliares de teste ficam em `testdata/` (o `caju test` não procura testes lá);
- cada teste tem um **título em texto** que diz o comportamento esperado, e os valores são
  verificados com `expect`. Não há arquivos `.out`.

```caju
import "std/strings"
import { describe, it, expect } from "std/testing"

describe("strings.split", fn() {
  it("cuts the text at every separator", fn() {
    expect(strings.split("a,b,c", ",")).to_equal([]str{"a", "b", "c"})
  })

  it("keeps empty parts between two separators", fn() {
    expect(strings.split("a,,b", ",")).to_have_length(3)
  })
})
```

## Rodar

```sh
caju test                   # todos os *_test.caju sob o diretório atual
caju test lib compiler      # sob estes diretórios (ou arquivos)
caju test -v lib            # mostra cada teste, não só os arquivos
caju test --run "split"     # só os testes cujo título completo contém "split"
```

Saída de um arquivo com falha:

```
FAIL lib/strings_test.caju
strings.split
  ✓ cuts the text at every separator
  ✗ keeps empty parts between two separators
      expected ["a" "b"] to have length 3
      length: 2

FAIL: strings.split › keeps empty parts between two separators
# 1 passed, 1 failed, 0 skipped
```

Cada arquivo de teste é compilado como um programa e roda no próprio diretório (caminhos como
`testdata/x.caju` são relativos ao arquivo de teste). O `caju test` termina com código 1 se algum
teste falhar.

## Estrutura

| função | para quê |
|---|---|
| `describe(título, fn() {...})` | agrupa testes de um assunto; pode ter `describe` dentro |
| `it(título, fn() {...})` | um teste; para no primeiro `expect` que falha, ou num `panic`/erro de execução |
| `skip(título, fn() {...})` | um teste escrito mas não executado (aparece como *skipped*) |
| `before_each(fn() {...})` | roda antes de cada teste do bloco (e dos blocos de dentro) |
| `after_each(fn() {...})` | roda depois de cada teste do bloco, mesmo se ele falhar |
| `fail(mensagem)` | faz o teste atual falhar |

## Verificações (`expect(valor)....`)

| método | passa quando |
|---|---|
| `to_equal(x)` | os valores são iguais; listas, mapas e structs pelo conteúdo. Texto e número são diferentes (`"1"` ≠ `1`) |
| `to_be_true()`, `to_be_false()`, `to_be_nil()` | o valor é `true`, `false`, `nil` |
| `to_contain(x)` | texto contém o trecho; lista contém o elemento; mapa (chave texto) contém a chave |
| `to_have_length(n)` | texto (em bytes), lista ou mapa tem tamanho `n` |
| `to_start_with(s)`, `to_end_with(s)` | texto começa / termina com `s` |
| `to_be_greater_than(n)`, `to_be_less_than(n)`, `to_be_at_least(n)`, `to_be_at_most(n)` | comparação de números (int ou float) |
| `to_be_close_to(n, eps)` | número a no máximo `eps` de `n` |
| `to_be_error(msg)` | é um `error` (não nil) com essa mensagem |
| `to_panic()`, `to_panic_with(msg)` | `expect(fn() {...})`: a função entra em pânico (ou para num erro de execução), com essa mensagem |

`expect(x).not_()` inverte a verificação: `expect(lista).not_().to_contain("a")`.
(`not` é palavra reservada; o `_` segue a mesma convenção de `fn_`, `from_`.)

## Programas inteiros

Para testar o que só aparece na saída de um programa (erros de compilação, erros de execução com
arquivo e linha, `os.exit`):

```caju
import { describe, it, expect, run_file, run_source } from "std/testing"

it("reports a division by zero with the line", fn() {
  r := run_file("testdata/div0.caju")         # compila e roda com `caju run`
  expect(r.output).to_equal("Runtime error in div0.caju, line 2: Integer division by zero.")
  expect(r.code).to_equal(1)
})

it("rejects a name that was never declared", fn() {
  r := run_source("print(nome)\n")             # um programa dado como texto
  expect(r.output).to_start_with("Compile error in main.caju, line 1:")
})
```

`r.output` junta saída padrão e de erro, sem a última quebra de linha; `r.code` é o código de saída.
