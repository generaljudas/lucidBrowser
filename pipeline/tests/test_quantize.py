import numpy as np

from riptide_pipeline.quantize import QMAX, dequantize, quantize


def test_rounding_error_is_bounded_by_half_a_step_per_component() -> None:
    rng = np.random.default_rng(1)
    m = rng.normal(size=(200, 50)) * rng.uniform(0.01, 3.0, size=(200, 1))
    q, scales = quantize(m)
    assert q.dtype == np.int8 and scales.dtype == np.float32
    assert np.abs(q).max() <= QMAX
    back = dequantize(q, scales)
    step = scales.astype(np.float64)[:, None]
    assert np.all(np.abs(back - m) <= step / 2 + 1e-9)


def test_magnitude_survives_because_scales_are_per_vector() -> None:
    # A stop word is a short vector; after int8 it must still be a short vector.
    long = np.ones((1, 8))
    short = np.ones((1, 8)) * 0.01
    q, s = quantize(np.vstack([long, short]))
    back = dequantize(q, s)
    assert np.isclose(np.linalg.norm(back[1]) / np.linalg.norm(back[0]), 0.01)


def test_zero_rows_do_not_divide_by_zero() -> None:
    q, s = quantize(np.zeros((2, 4)))
    assert np.all(q == 0) and np.all(np.isfinite(s))
