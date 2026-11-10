#!/usr/bin/env python3
"""Prints the time of every challenge and size in every round (rounds/roundN.json), with the
change from the previous round and from round 0, as a markdown table."""
import glob, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
rounds = sorted((int(re.search(r"round(\d+)", p).group(1)), json.load(open(p))) for p in glob.glob(os.path.join(HERE, "round*.json")))
def t(d, name, i):
    for c in d["challenges"]:
        if c["name"] == name:
            return c["sizes"][i]["caju"]["time"]
def fmt(s):
    if s is None: return "—"
    return f"{s*1000:.0f} ms" if s < 1 else f"{s:.2f} s"
base = rounds[0][1]
print("| challenge | n | " + " | ".join(f"round {r}" for r, _ in rounds) + " | total gain |")
print("|---|--:|" + "--:|" * (len(rounds) + 1))
for c in base["challenges"]:
    for i, sz in enumerate(c["sizes"]):
        vals = [t(d, c["name"], i) for _, d in rounds]
        last = next((v for v in reversed(vals) if v), None)
        gain = f"{vals[0]/last:.2f}×" if vals[0] and last else "—"
        print(f"| {c['name']} | {sz['n']:,} | " + " | ".join(fmt(v) for v in vals) + f" | {gain} |")
