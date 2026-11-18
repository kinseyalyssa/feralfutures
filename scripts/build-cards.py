#!/usr/bin/env python3
"""Regenerate cards.js from cards.json.

cards.js is a fallback copy of the content (window.CARDS = {...}) so the page
also works when index.html is opened straight from disk, where fetch() is blocked.

Run from the project folder:  python3 scripts/build-cards.py
"""
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent.parent
src = root / "cards.json"
out = root / "cards.js"

try:
    data = json.loads(src.read_text(encoding="utf-8"))
except json.JSONDecodeError as err:
    sys.exit(f"cards.json has a typo near line {err.lineno}, column {err.colno}: {err.msg}")

expected = ["areas", "creatures", "worlds", "twists", "ways", "rules"]
missing = [key for key in expected if key not in data]
if missing:
    sys.exit(f"cards.json is missing: {', '.join(missing)}")

body = json.dumps(data, ensure_ascii=False, indent=2)
out.write_text(
    "// Generated from cards.json by scripts/build-cards.py. Don't edit by hand.\n"
    f"window.CARDS = {body};\n",
    encoding="utf-8",
)
print("cards.js updated: " + ", ".join(f"{len(data[k])} {k}" for k in expected))
