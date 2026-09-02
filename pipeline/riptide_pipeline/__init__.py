"""Offline corpus pipeline for Riptide.

Everything in this package runs at build time, never in the browser:
corpus acquisition (``wiki``), chunking (``chunk``), the shared static space
with SIF folded into the word vectors (``sif``, ADR-0005), int8 quantisation
(``quantize``) with its recall loss measured (``report``), and packing into
the bundle format the BundledAdapter loads (``bundle``, ADR-0006).
``reference`` is the pure-Python twin of the adapter's arithmetic, used to
pin the golden fixture.
"""

__version__ = "0.1.0"

__all__ = ["__version__"]
