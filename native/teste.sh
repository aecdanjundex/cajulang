#!/bin/sh
# Testes do compilador nativo: compara a saída nativa com a da VM, programa por programa.
# Uso: ./teste.sh [windows]   (windows roda os .exe no Wine)
# Antes de testar, junta native.js e rt/*.caju à página (splice.py) e gera build/core.js.
set -e
cd "$(dirname "$0")"
python3 splice.py >/dev/null
python3 ../tools/gen_core.py
G=../runtime/tests/go
TARGET=${1:-linux} node ex.js --exemplos $G/a_slices.caju $G/b_funcs.caju $G/h_panic.caju $G/c.caju $G/d_ptr.caju $G/e_iface.caju $G/g_misc.caju $G/m_maps.caju $G/n_gc.caju tests/*.caju
