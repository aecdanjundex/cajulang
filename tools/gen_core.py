#!/usr/bin/env python3
"""Extrai o núcleo da linguagem (léxico, parser, verificador, compiladores, VM, exemplos e o
compilador nativo) de web/caju.html para build/core.js, um módulo do Node usado pelos testes.

O núcleo vai de "class CajuError" até "  const DEFAULT" dentro do <script> da página.
Rode de novo sempre que web/caju.html mudar (os scripts de teste já fazem isso)."""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(ROOT, 'web', 'caju.html'), encoding='utf8').read()
js = re.search(r'<script>(.*?)</script>', s, re.S).group(1)
core = js[js.index('class CajuError'):js.index('  const DEFAULT')]
os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
open(os.path.join(ROOT, 'build', 'core.js'), 'w', encoding='utf8').write(
    core + '\nmodule.exports={lex,parse,link,compile,optimizeProgram,runVM,runTree,EXAMPLES,CajuError,typecheck,serializeProgram,disassemble,compileNative};\n')
