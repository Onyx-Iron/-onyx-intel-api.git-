"""Onyx Intel — CSI Takeoff Stream API (loader).

Implementation is stored gzip+base64 in `_takeoff_api_payload.py` so GitHub MCP
can push the full module; this loader expands it at import time.
"""
from __future__ import annotations

import base64
import gzip
import os
import sys
from pathlib import Path
from types import ModuleType

from _takeoff_api_payload import PAYLOAD_B64

_code = gzip.decompress(base64.b64decode(PAYLOAD_B64)).decode("utf-8")
_mod = ModuleType("_takeoff_api_impl")
_mod.__file__ = str(Path(__file__).with_name("_takeoff_api_impl.py"))
sys.modules["_takeoff_api_impl"] = _mod
exec(compile(_code, _mod.__file__, "exec"), _mod.__dict__)

app = _mod.app
for _name in ("verify_secret", "API_SECRET", "ALLOWED_ORIGINS"):
    if hasattr(_mod, _name):
        globals()[_name] = getattr(_mod, _name)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "takeoff_api:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5050")),
        reload=True,
        log_level="info",
    )
