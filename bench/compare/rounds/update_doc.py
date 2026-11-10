#!/usr/bin/env python3
"""Rewrites the table between the markers in OPTIMIZATION.md from rounds/*.json (table.py)."""
import os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
doc = os.path.join(HERE, "..", "OPTIMIZATION.md")
table = subprocess.run([sys.executable, os.path.join(HERE, "table.py")], capture_output=True, text=True, check=True).stdout
s = open(doc).read()
a = s.index("<!-- python3 bench/compare/rounds/table.py -->")
a = s.index("\n", a) + 1
b = s.index("\n\n", a)
open(doc, "w").write(s[:a] + table.rstrip("\n") + s[b:])
