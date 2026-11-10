#!/usr/bin/env python3
"""Gera os testes do runtime em Rust em build/: o núcleo da página (como em gen_core.py) seguido
de um dos arquivos de runtime/harness/. Os testes usam funções internas da página (não só as
exportadas), por isso são concatenados em vez de usar require.

  python3 tools/harness.py            gera build/parity.js, parity-wine.js, ffi-test.js, sign-test.js
  node build/parity.js runtime/bin/caju-rs-linux64        VM da página × runtime em Rust (Linux)
  node build/parity-wine.js runtime/bin/caju-runtime-x64.exe   o mesmo no Wine (x64 ou x86)
  node build/ffi-test.js runtime/bin/caju-rs-linux64-ffi  extern/FFI com a tabela de teste em C
  node build/sign-test.js runtime/bin/caju-runtime-x86.exe     versão e assinatura Authenticode"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(ROOT, 'web', 'caju.html'), encoding='utf8').read()
js = re.search(r'<script>(.*?)</script>', s, re.S).group(1)
core = js[js.index('class CajuError'):js.index('  const DEFAULT')]
HEAD = r'''
const CAJU_RT = require("path").join(__dirname, "..", "runtime");
const CAJU_TMP = require("os").tmpdir();
const CAJU_WINE64 = process.env.WINE64 || (require("fs").existsSync("/usr/lib/wine/wine64") ? "/usr/lib/wine/wine64" : "wine64");
const CAJU_WINE32 = process.env.WINE32 || (require("fs").existsSync("/usr/lib/wine/wine") ? "/usr/lib/wine/wine" : "wine");
'''
os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
hd = os.path.join(ROOT, 'runtime', 'harness')
for f in sorted(os.listdir(hd)):
    tail = open(os.path.join(hd, f), encoding='utf8').read()
    open(os.path.join(ROOT, 'build', f), 'w', encoding='utf8').write(core + HEAD + tail)
    print('build/' + f)
