"""int8 quantisation with one float32 scale per vector.

``v ≈ scale · q`` with ``q ∈ [−127, 127]`` and ``scale = max|v| / 127``.
Per-row scaling keeps the magnitude information the SIF salience lives in
(a stop word is a tiny vector, and stays one), and costs four bytes a row.
Whether the rounding costs any recall is measured, not assumed — see
``report.py`` and the shipped report.
"""

from __future__ import annotations

import numpy as np

QMAX = 127


def quantize(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Returns ``(q int8 [n, dim], scales float32 [n])``."""
    amax = np.abs(matrix).max(axis=1).astype(np.float64)
    amax[amax == 0] = 1.0
    scales = (amax / QMAX).astype(np.float32)
    q = np.rint(matrix.astype(np.float64) / scales.astype(np.float64)[:, None])
    return np.clip(q, -QMAX, QMAX).astype(np.int8), scales


def dequantize(q: np.ndarray, scales: np.ndarray) -> np.ndarray:
    """float64, computed exactly as the adapter does it: ``float64(scale) * int``."""
    return q.astype(np.float64) * scales.astype(np.float64)[:, None]
