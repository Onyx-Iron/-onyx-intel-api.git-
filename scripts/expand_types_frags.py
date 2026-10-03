#!/usr/bin/env python3
"""Expand portal/lib/supabase/types.ts from gzip+base64 fragment files."""
from __future__ import annotations
import base64, gzip
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "portal/lib/supabase/types.ts"
parts = []
i = 0
while True:
    frag = ROOT / f"portal/lib/supabase/types.ts.frag{i}"
    if not frag.exists():
        break
    parts.append(frag.read_text().rstrip("\n"))
    i += 1
if not parts:
    raise SystemExit(f"no types fragments found under {ROOT}/portal/lib/supabase/")
raw = gzip.decompress(base64.b64decode("".join(parts)))
OUT.write_bytes(raw)
print(f"wrote {OUT} ({len(raw)} bytes) from {i} fragments")
