"""
Brotli (preferred) / gzip response compression for FastAPI JSON payloads.

Heavy takeoff coordinate arrays compress ~60–80% with Brotli, which matters
on mobile canvas sync. Negotiates via Accept-Encoding; skips tiny bodies and
already-encoded responses.
"""

from __future__ import annotations

import gzip
from typing import Callable

try:
    import brotli as _brotli
except ImportError:  # pragma: no cover
    _brotli = None


_MIN_BYTES = 512
_COMPRESSIBLE = (
    "application/json",
    "application/javascript",
    "text/plain",
    "text/css",
    "text/html",
    "text/csv",
    "application/xml",
    "text/xml",
)


class BrotliGzipMiddleware:
    """Pure-ASGI middleware — Brotli when Accept-Encoding includes br, else gzip."""

    def __init__(self, app: Callable, minimum_size: int = _MIN_BYTES) -> None:
        self.app = app
        self.minimum_size = minimum_size

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        accept = b""
        for key, value in scope.get("headers") or []:
            if key == b"accept-encoding":
                accept = value.lower()
                break

        prefer_br = b"br" in accept and _brotli is not None
        prefer_gzip = b"gzip" in accept
        if not prefer_br and not prefer_gzip:
            await self.app(scope, receive, send)
            return

        start_message = None
        body = bytearray()

        async def send_wrapper(message):  # noqa: ANN001
            nonlocal start_message, body
            if message["type"] == "http.response.start":
                start_message = message
                return
            if message["type"] == "http.response.body":
                body.extend(message.get("body") or b"")
                if message.get("more_body"):
                    return
                await self._flush(start_message, bytes(body), prefer_br, prefer_gzip, send)
                return
            await send(message)

        await self.app(scope, receive, send_wrapper)

    async def _flush(self, start, body: bytes, prefer_br: bool, prefer_gzip: bool, send) -> None:  # noqa: ANN001
        if start is None:
            return
        headers = [(k, v) for k, v in start.get("headers", [])]
        header_map = {k.lower(): v for k, v in headers}

        if b"content-encoding" in header_map:
            await send(start)
            await send({"type": "http.response.body", "body": body})
            return

        ctype = header_map.get(b"content-type", b"").split(b";")[0].strip().decode("latin-1")
        if len(body) < self.minimum_size or not any(ctype.startswith(t) for t in _COMPRESSIBLE):
            await send(start)
            await send({"type": "http.response.body", "body": body})
            return

        encoding = None
        compressed = body
        if prefer_br and _brotli is not None:
            compressed = _brotli.compress(body, quality=5)
            encoding = b"br"
        elif prefer_gzip:
            compressed = gzip.compress(body, compresslevel=5)
            encoding = b"gzip"

        if encoding is None or len(compressed) >= len(body):
            await send(start)
            await send({"type": "http.response.body", "body": body})
            return

        new_headers = [
            (k, v)
            for k, v in headers
            if k.lower() not in (b"content-length", b"content-encoding")
        ]
        new_headers.append((b"content-encoding", encoding))
        new_headers.append((b"content-length", str(len(compressed)).encode("latin-1")))
        new_headers.append((b"vary", b"Accept-Encoding"))

        await send({
            "type": "http.response.start",
            "status": start["status"],
            "headers": new_headers,
        })
        await send({"type": "http.response.body", "body": compressed})
