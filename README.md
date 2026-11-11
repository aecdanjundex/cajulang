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

## Instalação

Linux x86-64 (no Windows, use o WSL; o `caju` do Linux também gera `.exe` com `--target windows`):

```sh
curl -fsSL https://raw.githubusercontent.com/aecdanjundex/caju/master/install.sh | sh
```

O instalador baixa a última release, confere o SHA-256, instala em `~/.caju` e cria o comando
`~/.local/bin/caju`. Variáveis: `CAJU_VERSION=0.1.0` (uma versão específica), `CAJU_HOME`,
`CAJU_BIN_DIR`. Para instalar à mão, baixe `caju-linux-x86_64.tar.gz` em
[Releases](https://github.com/aecdanjundex/caju/releases), extraia e ponha `caju-<versão>/bin` no
`PATH`. Para desinstalar: `rm -rf ~/.caju ~/.local/bin/caju`.

```sh
caju run programa.caju              # compila em memória e roda
caju build -o programa programa.caju
caju test                           # roda os *_test.caju do diretório
caju version
```

## Compilando do código-fonte

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

- `docs/releasing.md`: como publicar uma versão nova.

- `CLAUDE.md`: mapa do projeto, como trabalhar, estado e cuidados.
- `docs/packages.md`: o gerenciador de pacotes (caju.toml, caju.lock, hashes).
- `docs/testing.md`: testes com `caju test` e `std/testing`.
- `docs/compiler-port.md`: como o compilador foi portado de JavaScript para Caju.
- `docs/arquitetura-nativo.md`: como o compilador nativo funciona por dentro.
- `docs/plano-compilador-nativo.md`: o plano das fases.
- `docs/historico.md`: o que foi feito até aqui e por quê.

## Licença

MIT (ver `LICENSE`).
