# Histórico do projeto (o que foi feito e por quê)

Resumo das conversas que construíram a Caju, para dar contexto a quem continua.

## A linguagem e a página

- A Caju nasceu como uma linguagem de brinquedo em português, numa página HTML só
  (`web/caju.html`): editor, árvore sintática, interpretador da árvore, compilador de bytecode,
  otimizador, VM de pilha, aba de tipos, desmontador, referência e dezenas de exemplos.
- Ganhou recursos do Go: tipos com verificação (tipagem gradual: o que não tem tipo é `any`),
  structs, métodos, interfaces, slices, maps, ponteiros, closures, vários resultados, `defer`,
  `panic`/`recover`, goroutines, canais, `select`, inteiros de tamanho fixo (int8...uint64), vários
  arquivos com `import`/`export`, `extern` para chamar DLLs do Windows e `dllexport`.
- "Gerar .exe / .dll": a página junta o bytecode do programa (formato v6, ver `serializeProgram`)
  a um runtime nativo já compilado e embutido em base64 (x64, x86 e DLL x64), escreve as
  informações de versão no recurso VERSIONINFO e pode assinar o .exe (Authenticode, com um
  certificado gerado na hora ou um do usuário).
- O antigo sistema de "gas" (limite de custo por instrução) foi **removido** a pedido do dono;
  o bytecode passou para a versão 6.

## Runtime em Rust

- O runtime nativo era em C; foi **reescrito em Rust** (`runtime/rs/`) e passou em todos os testes
  de paridade (Linux, Wine x64 e x86, DLL e FFI).
- Detalhes do build: o Rust compila uma biblioteca estática; o zig faz o link para Windows (com
  `-fno-compiler-rt` para não duplicar `___chkstk_ms` e `-lunwind`); `-Z build-std` com o código da
  biblioteca padrão (clonado do repositório do Rust, porque o rustup não conseguia baixar o
  rust-std do Windows); um embrulho de `dlltool` do zig em `rs/tools`; DLL com tabela de
  exportação em assembly (`.cajuexp` em `caju-asm-x64.S`).

## Compilador nativo

- Pergunta do dono: "é possível criar o próprio runtime na linguagem Caju?". Resposta: sim, com um
  compilador nativo; ele escolheu esse caminho. O plano em 9 fases está em
  `docs/plano-compilador-nativo.md`, com as decisões recomendadas aceitas.
- Fase 1: montador x86-64, ELF/PE, números (impressão com 12 algarismos idêntica ao JS),
  textos, funções, controle de fluxo, extern por thunks Win64. Benchmark 17x mais rápido.
- Fase 2: valores compostos com descritores de tipo nos dados; erros ao rodar com a mesma
  mensagem e linha da VM.
- Fase 3: any/interfaces (caixas), switch de tipos, closures (`[código, células]`), métodos por
  nome, vários resultados, `errors.New`, parâmetros sem tipo. As regras numéricas da VM para `any`
  foram copiadas (inclusive a "caixa conta como verdadeiro").
- Fase 4: coletor de lixo conservador com classes de tamanho; 3 milhões de objetos em 18 MB.
  Um erro na tabela de classes de tamanho (classes não chegavam a 16384) foi achado com gdb +
  `native/sym.js`.
- Fase 5: defer/panic/recover com registro no quadro e salto para o "recuperado".
- Ao empacotar o projeto para o Claude Code, descobriu-se que os testes passavam os exemplos de
  vários arquivos de um jeito errado (VM e nativo falhavam iguais); corrigido (`filesOf` em
  `native/run.js`), e o nativo passou a aceitar módulos (`Módulo` na árvore ligada).

## Diferenças aceitas entre a VM e o nativo

- Inteiros acima de 2^53 (a VM usa números do JS).
- `5e-324`: o JS imprime o subnormal mais curto; o nativo imprime 12 algarismos.
- `any` com tipo errado indo para um tipo concreto: a VM segue sem conferir; o nativo dá erro.
- (Fase 6) a ordem de preempção entre goroutines não será a mesma.
