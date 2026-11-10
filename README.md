# Caju

Uma linguagem de programação inspirada em Go, que compila direto para código de máquina x86-64
(Linux e Windows). O compilador e o runtime são escritos na própria Caju, e o compilador compila
a si mesmo.

```
fn greet(name: str) -> str {
  return "Hello, " + name + "!"
}

print(greet("world"))
```

## Começando

Precisa de Node 22+ só para o primeiro estágio (o compilador original em JavaScript):

```sh
node bootstrap/caju.js build -o build/caju compiler/main.caju   # gera o compilador
build/caju run examples/hello-server.caju                       # compila e roda (servidor na porta 3200)
build/caju build -o hello programa.caju                         # gera um executável Linux
build/caju build --target windows programa.caju                 # gera um .exe
build/caju test                                                 # todos os *_test.caju
build/caju pkg add github.com/dono/pacote                       # adiciona uma dependência
```

Testes no estilo BDD, ao lado do código (`strings_test.caju` junto de `strings.caju`):

```
import { describe, it, expect } from "std/testing"

describe("strings.split", fn() {
  it("cuts the text at every separator", fn() {
    expect(strings.split("a,b", ",")).to_equal([]str{"a", "b"})
  })
})
```

## Documentos

- `CLAUDE.md`: mapa do projeto, como trabalhar, estado e cuidados.
- `docs/packages.md`: o gerenciador de pacotes (caju.toml, caju.lock, hashes).
- `docs/testing.md`: testes com `caju test` e `std/testing`.
- `docs/compiler-port.md`: como o compilador foi portado de JavaScript para Caju.
- `docs/arquitetura-nativo.md`: como o compilador nativo funciona por dentro.
- `docs/plano-compilador-nativo.md`: o plano das fases.
- `docs/historico.md`: o que foi feito até aqui e por quê.
