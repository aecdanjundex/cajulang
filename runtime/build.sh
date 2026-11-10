#!/bin/sh
# Compila todas as variantes do runtime da Caju.
#
# A máquina virtual é escrita em Rust (rs/) e vira uma biblioteca estática; o linker de C
# (zig no Windows, gcc no Linux) junta essa biblioteca com o assembly x64 (caju-asm-x64.S:
# chamadas a DLLs e os pontos de entrada da DLL) e com os recursos de versão (.rc).
#
#   ./build.sh          só os builds de teste em Linux
#   ./build.sh windows  também os .exe x86/x64 e a .dll x64
#
# Os binários vão para bin/. Depois de mudar o runtime, rode python3 ../tools/embed_runtime.py
# para trocar as cópias embutidas (base64) na página.
#
# Os alvos do Windows usam -Z build-std (a biblioteca padrão do Rust é compilada a partir
# do código-fonte, que precisa estar instalado como o componente rust-src).
set -e
cd "$(dirname "$0")"
Z="python3 -m ziglang"
CARGO="cargo build --release --manifest-path rs/Cargo.toml"
LINUX_LIBS="-lgcc_s -lutil -lrt -lpthread -lm -ldl -lc"

# ---- Linux (testes de paridade, FFI e DLL) ----
$CARGO --target-dir rs/build/linux64
mkdir -p bin
gcc -O2 -o bin/caju-rs-linux64 caju-asm-x64.S rs/build/linux64/release/libcaju.a $LINUX_LIBS
$CARGO --features ffitest --target-dir rs/build/linux64-ffi
gcc -O2 -o bin/caju-rs-linux64-ffi ffi-test-table.c caju-asm-x64.S rs/build/linux64-ffi/release/libcaju.a $LINUX_LIBS

[ "$1" = "windows" ] || exit 0

# ---- Windows ----
# O std do Rust importa funções do Windows por raw-dylib: o dlltool é o do zig (rs/tools).
export RUSTC_BOOTSTRAP=1 PATH="$PWD/rs/tools:$PATH"
STD="-Z build-std=std,panic_abort"
$CARGO --target x86_64-pc-windows-gnu $STD --target-dir rs/build/win64
$CARGO --target i686-pc-windows-gnu $STD --target-dir rs/build/win32
$CARGO --target x86_64-pc-windows-gnu $STD --features dll --target-dir rs/build/win64-dll
# -fno-compiler-rt: as rotinas de baixo nível já vêm no compiler_builtins do Rust
# -lunwind: o libunwind do zig no lugar do libgcc_eh do MinGW
LINK="-lc -lunwind -fno-compiler-rt"
WIN_LIBS="-lkernel32 -lntdll -luserenv -lws2_32 -ldbghelp"
$Z build-exe $LINK caju-asm-x64.S caju-runtime.rc rs/build/win64/x86_64-pc-windows-gnu/release/libcaju.a $WIN_LIBS \
  -target x86_64-windows-gnu -O ReleaseFast -fstrip -femit-bin=bin/caju-runtime-x64.exe
$Z build-exe $LINK caju-runtime.rc rs/build/win32/i686-pc-windows-gnu/release/libcaju.a $WIN_LIBS \
  -target x86-windows-gnu -mcpu pentium4 -O ReleaseFast -fstrip -femit-bin=bin/caju-runtime-x86.exe
$Z build-lib -dynamic $LINK -cflags -DCAJU_DLL -- caju-asm-x64.S caju-runtime-dll.rc rs/build/win64-dll/x86_64-pc-windows-gnu/release/libcaju.a $WIN_LIBS \
  -target x86_64-windows-gnu -O ReleaseFast -fstrip -femit-bin=bin/caju-runtime-x64.dll
rm -f bin/*.pdb bin/*.lib bin/*.exp *.pdb *.lib *.exp
