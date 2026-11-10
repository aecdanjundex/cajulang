# Caju

Uma linguagem de programação em português, inspirada em Go, que roda inteira no navegador.

- **Abrir:** `web/caju.html` num navegador (não precisa de servidor). Tem editor, exemplos,
  referência, aba de tipos, bytecode, e o botão "Gerar .exe / .dll" para Windows.
- **Runtime em Rust** (`runtime/`): a VM que vai dentro dos .exe/.dll gerados pela página.
- **Compilador nativo** (`native/`): compila Caju direto para x86-64, com o runtime escrito em
  Caju. Fases 1 a 5 de 9 prontas.

Para continuar o desenvolvimento com o Claude Code, abra esta pasta e comece por `CLAUDE.md`.

## Comandos

```sh
python3 tools/gen_core.py               # gera build/core.js a partir da página
native/teste.sh                          # VM × nativo (Linux)
native/teste.sh windows                  # VM × nativo (.exe no Wine)
node native/run.js programa.caju         # um programa: saída da VM e do nativo
node native/bench.js Benchmark           # velocidade: runtime em Rust × nativo
python3 tools/harness.py && node build/parity.js runtime/bin/caju-rs-linux64   # VM × runtime em Rust
runtime/build.sh [windows]               # recompila o runtime em Rust (ver CLAUDE.md)
```

## Documentos

- `CLAUDE.md`: mapa do projeto, como trabalhar, estado e cuidados.
- `docs/arquitetura-nativo.md`: como o compilador nativo funciona por dentro, e o que vem nas fases 6 a 9.
- `docs/plano-compilador-nativo.md`: o plano das 9 fases e as decisões.
- `docs/historico.md`: o que foi feito até aqui e por quê.
