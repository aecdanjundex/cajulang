# Publicando uma versão

A distribuição é um pacote para Linux x86-64 publicado nas Releases do GitHub:

```
caju-linux-x86_64.tar.gz          caju-<versão>/bin/caju, lib/, rt/, examples/, README.md
caju-linux-x86_64.tar.gz.sha256
```

O `caju` acha `lib/` e `rt/` no diretório acima do binário (ou em `CAJU_ROOT`). O link
simbólico em `~/.local/bin` funciona porque `os.executable()` lê `/proc/self/exe`, que resolve o link.

## Passos

1. Atualize `VERSION` em `compiler/pkg.caju` (é o que `caju version` mostra) e faça o commit.
2. Rode localmente: `TAG=v0.2.0 tools/release.sh`. O script faz a cadeia JS → estágio 1 → 2 → 3,
   exige estágio 2 == estágio 3, monta `dist/` e testa o pacote fora do repositório.
3. `git tag v0.2.0 && git push origin master v0.2.0`.
4. O workflow `.github/workflows/release.yml` refaz tudo, roda a suíte e o instalador, e cria a
   release com as notas geradas pelos commits.

A tag precisa bater com `VERSION`, senão o workflow falha. O instalador (`install.sh`, na raiz)
usa `releases/latest`, então a release nova vira a padrão assim que é publicada.

Testar o instalador sem baixar nada:

```sh
CAJU_PACKAGE=dist/caju-linux-x86_64.tar.gz CAJU_HOME=/tmp/c/.caju CAJU_BIN_DIR=/tmp/c/bin sh install.sh
```

## Limites atuais

- Só Linux x86-64. O compilador gerado para Windows (`--target windows compiler/main.caju`) ainda
  não roda lá (sai com código 5 logo no início; falta portar o que o próprio compilador usa do sistema).
  Os programas gerados para Windows funcionam.
- `caju bench` e os testes da linguagem só existem no repositório, não no pacote.
