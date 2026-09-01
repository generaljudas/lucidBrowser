"""Offline corpus pipeline for Riptide (skeleton).

Everything in this package runs at build time, never in the browser: corpus
acquisition, chunking, document embedding into the static space (SIF
weighting, ADR-0002 v1), int8 quantisation with measured recall loss, and
packing into the shipped binary index format consumed by the BundledAdapter
(ADR-0004). Real implementation arrives with roadmap milestone M2.
"""

__version__ = "0.0.1"

__all__ = ["__version__"]
