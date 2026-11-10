# Junta o compilador nativo (native.js) e o runtime em Caju (rt/*.caju) à página
import os
HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, '..', 'web', 'caju.html')
s = open(P, encoding='utf8').read()
js = open(os.path.join(HERE, 'native.js'), encoding='utf8').read()
rt = {}
for k in ['comum', 'gc', 'valores', 'dinamico', 'panico', 'linux', 'windows']:
    src = open(os.path.join(HERE, 'rt', f'{k}.caju'), encoding='utf8').read()
    assert '`' not in src and '${' not in src
    rt[k] = src.replace('\\', '\\\\')
block = ('  // ==== NATIVO: início ====\n' + js +
         '\n  // runtime do compilador nativo, escrito em Caju\n  const NATIVE_RT = {\n' +
         ''.join(f'    {k}: `{v}`,\n' for k, v in rt.items()) + '  };\n  // ==== NATIVO: fim ====\n')
a, b = '  // ==== NATIVO: início ====\n', '  // ==== NATIVO: fim ====\n'
if a in s:
    i = s.index(a); j = s.index(b) + len(b)
    s = s[:i] + block + s[j:]
else:
    k = s.index('  function disassemble(prog) {')
    s = s[:k] + block + s[k:]
open(P, 'w', encoding='utf8').write(s)
print('ok', len(block))
