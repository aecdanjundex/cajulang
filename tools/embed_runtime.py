#!/usr/bin/env python3
"""Embute os runtimes do Windows (runtime/bin/*.exe e .dll) na página, em base64, nos
<script type="application/octet-stream"> de id caju-runtime-x64, caju-runtime-x86 e
caju-runtime-x64-dll. É com eles que o botão "Gerar .exe / .dll" monta os programas da VM."""
import base64, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'web', 'caju.html')
s = open(P, encoding='utf8').read()
for id_, f in [('caju-runtime-x64', 'caju-runtime-x64.exe'), ('caju-runtime-x86', 'caju-runtime-x86.exe'), ('caju-runtime-x64-dll', 'caju-runtime-x64.dll')]:
    d = base64.b64encode(open(os.path.join(ROOT, 'runtime', 'bin', f), 'rb').read()).decode()
    d = '\n'.join(d[i:i + 76] for i in range(0, len(d), 76))
    a = s.index(f'id="{id_}">') + len(f'id="{id_}">')
    b = s.index('</script>', a)
    s = s[:a] + '\n' + d + '\n' + s[b:]
open(P, 'w', encoding='utf8').write(s)
print('ok', len(s))
