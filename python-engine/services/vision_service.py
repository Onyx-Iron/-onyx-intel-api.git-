"""Symbol counting with template matching.

OpenCV scans a rendered sheet for copies of a symbol the estimator selected.
Matches are suppressed when they overlap, so one symbol is not counted as a
cluster of hits. This does not call a vision model.
"""

from __future__ import annotations

import cv2
import numpy as np


def _bgr(image: np.ndarray) -> np.ndarray:
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    if image.shape[2] == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    return image


def decode_image(data: bytes) -> np.ndarray:
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("could not decode image")
    return image


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    return inter / float(area_a + area_b - inter)


_ROTATE = {
    90: cv2.ROTATE_90_CLOCKWISE,
    180: cv2.ROTATE_180,
    270: cv2.ROTATE_90_COUNTERCLOCKWISE,
}


def _variant(template: np.ndarray, scale: float, rotation: int) -> np.ndarray:
    image = template
    if rotation in _ROTATE:
        image = cv2.rotate(image, _ROTATE[rotation])
    if abs(scale - 1.0) > 1e-6:
        height, width = image.shape[:2]
        image = cv2.resize(
            image,
            (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
            interpolation=cv2.INTER_LINEAR,
        )
    return image


def _suppress(hits: list[tuple[int, int, int, int, float]]) -> list[tuple[int, int, int, int, float]]:
    ordered = sorted(hits, key=lambda hit: hit[4], reverse=True)
    kept: list[tuple[int, int, int, int, float]] = []
    for hit in ordered:
        if any(_iou(hit[:4], previous[:4]) > 0.3 for previous in kept):
            continue
        kept.append(hit)
    return kept


def count_template(
    page: np.ndarray,
    template: np.ndarray,
    threshold: float = 0.8,
    scales: tuple[float, ...] = (1.0,),
    rotations: tuple[int, ...] = (0,),
) -> dict:
    sheet = _bgr(page)
    symbol = _bgr(template)
    if symbol.shape[0] < 1 or symbol.shape[1] < 1:
        raise ValueError("template image is empty")
    if not 0 < threshold <= 1:
        raise ValueError("threshold must be between 0 and 1")

    hits: list[tuple[int, int, int, int, float]] = []
    for scale in scales:
        for rotation in rotations:
            variant = _variant(symbol, float(scale), int(rotation))
            symbol_h, symbol_w = variant.shape[:2]
            if sheet.shape[0] < symbol_h or sheet.shape[1] < symbol_w:
                continue
            scores = cv2.matchTemplate(sheet, variant, cv2.TM_CCOEFF_NORMED)
            ys, xs = np.where(scores >= threshold)
            hits.extend(
                (int(x), int(y), int(x + symbol_w), int(y + symbol_h), float(scores[y, x]))
                for x, y in zip(xs, ys)
            )
    kept = _suppress(hits)
    return {
        "count": len(kept),
        "matches": [{"x": hit[0], "y": hit[1], "score": round(hit[4], 4)} for hit in kept],
    }


def count_classes(page: np.ndarray, templates: dict[str, np.ndarray], threshold: float = 0.8) -> dict:
    """One sheet pass per named legend crop (hydrant, valve, fixture)."""
    classes = {}
    for name, template in templates.items():
        classes[name] = count_template(
            page,
            template,
            threshold,
            scales=(0.8, 1.0, 1.2),
            rotations=(0, 90, 180, 270),
        )
    return {"classes": classes}
