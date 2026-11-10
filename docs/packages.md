# Pacotes (`caju pkg`)

Um pacote Caju é um repositório do GitHub com um `caju.toml` na raiz. O nome do pacote é o
caminho do repositório, e é também o que os programas importam:

```caju
import "github.com/acme/strutil"            # o arquivo principal do pacote
import "github.com/acme/strutil/extra"      # outro arquivo do pacote (extra.caju)

print(strutil.shout("oi"))
```

## `caju.toml`: o manifesto

Todo pacote, e todo projeto que usa pacotes, tem um `caju.toml` ([TOML](https://toml.io)):

```toml
[package]
name = "github.com/acme/greet"     # obrigatório: github.com/dono/repositório
version = "0.3.0"                  # versão semântica MAJOR.MINOR.PATCH
description = "Saudações"
license = "MIT"
authors = ["Acme"]
entry = "greet.caju"               # opcional; padrão: <nome do repositório>.caju
caju = "0.1.0"                     # opcional; versão mínima do compilador

[dependencies]
"github.com/acme/strutil" = "1.1.0"   # a versão MÍNIMA de que este pacote precisa
```

## Publicar uma versão

1. Ajuste `version` no `caju.toml` (ex.: `1.2.0`).
2. Faça commit e crie a tag com o mesmo número e um `v` na frente: `git tag v1.2.0 && git push --tags`.

O gerenciador confere que a tag `vX.Y.Z` tem `version = "X.Y.Z"` no `caju.toml`; se não tiver,
recusa o pacote. Uma versão publicada não deve mudar: se a tag for movida para outro commit, quem
já tem o `caju.lock` recebe um erro.

## Comandos

```sh
caju pkg init [github.com/dono/repo]   # cria caju.toml (sem nome: usa o remote origin do git)
caju pkg add github.com/acme/greet     # última versão publicada; ou ...@0.2.0
caju pkg remove github.com/acme/greet
caju pkg update [nome]                 # leva as dependências à última versão publicada
caju pkg install                       # baixa o que falta e confere tudo pelo caju.lock
caju pkg verify                        # confere os pacotes do cache contra os hashes do lock
caju pkg tree                          # árvore de dependências
caju pkg hash [dir]                    # o hash de um diretório de pacote
```

`add`, `remove` e `update` editam só a seção `[dependencies]` do `caju.toml` (comentários e o
resto do arquivo ficam como estão) e, se a instalação falhar, deixam o arquivo como era.

## Dependências recursivas e escolha de versões

`install` lê as dependências do projeto, baixa cada uma, lê o `caju.toml` dela e segue as
dependências dela, e assim por diante. Quando dois pacotes pedem versões diferentes do mesmo
pacote, vale a **maior das versões mínimas** pedidas (*minimal version selection*, como no Go):

```
app      precisa de greet ≥ 0.3.0 e strutil ≥ 1.0.0
greet    precisa de strutil ≥ 1.1.0
→ greet 0.3.0, strutil 1.1.0
```

O resultado não muda quando alguém publica uma versão nova: só muda quando um `caju.toml` pede uma
versão maior. Versões de MAJOR diferente (1.x e 2.x) não são compatíveis: pedir as duas é erro.

## `caju.lock`: versões e hashes

`install` grava `caju.lock`, que fixa cada pacote usado (direto ou indireto):

```toml
version = 1
requires = ["github.com/acme/greet@0.3.0"]   # as dependências do caju.toml quando o lock foi feito

[[package]]
name = "github.com/acme/strutil"
version = "1.1.0"
source = "https://github.com/acme/strutil"
commit = "f24b50965ae800cdfeef2d9f9bc3e21f5e12d6a3"
hash = "sha256:fe890cc2d93fc5890a50a22d1d8638543b47e2e3e7953481fa272bb6120c1531"
dependencies = []
```

Faça commit do `caju.lock`. Com ele, todo mundo compila exatamente os mesmos arquivos.

**O hash** é calculado sobre os arquivos, não sobre o git: para cada arquivo do pacote (em ordem
de caminho, sem `.git`), a linha `<sha256 do conteúdo>  <caminho>`; o hash do pacote é o SHA-256
dessa lista. Um link simbólico conta como o texto `symlink <destino>`. O mesmo conteúdo dá sempre o
mesmo hash, em qualquer máquina.

**As verificações:**

| quando | o que é conferido |
|---|---|
| `install` / `add` baixando um pacote | o commit da tag e o hash dos arquivos batem com o `caju.lock` (se o pacote já está nele) |
| `install` com o pacote já no cache | o hash dos arquivos do cache bate com o `caju.lock` |
| `caju build` / `caju run` | o `caju.lock` está em dia com o `caju.toml`, e o hash de cada pacote no cache bate com o lock |
| `caju pkg verify` | o hash de cada pacote no cache, com relatório |

Qualquer diferença é erro, com os dois hashes (ou commits) na mensagem.

## Onde ficam os arquivos

- Cache: `$CAJU_HOME/pkg/<nome>@<versão>/` (padrão `~/.caju/pkg`), com `<nome>@<versão>.info`
  guardando o commit.
- Download: `git clone --depth 1 --branch vX.Y.Z https://github.com/dono/repo`. O `git` precisa
  estar instalado. `CAJU_PKG_SOURCE=/caminho` troca `https://` por um diretório local ou espelho
  (`/caminho/github.com/dono/repo`); os testes usam isso.

## Regras para o código de um pacote

- Dentro de um pacote, os arquivos se importam pelo caminho completo:
  `import "github.com/acme/strutil/extra"`, não `import "extra"`. O compilador dá um erro claro
  se um arquivo de pacote usar um caminho relativo.
- A biblioteca padrão se importa normalmente (`import "std/strings"`).
- Um pacote só deve importar os pacotes que estão no `[dependencies]` dele.
