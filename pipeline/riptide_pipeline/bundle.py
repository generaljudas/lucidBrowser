"""The packed binary format the app loads (``docs/bundle-format.md``).

    "RIPT" · u32 version · u32 header length · header JSON · pad to 8
    · section₀ · pad to 8 · section₁ · pad to 8 · …

The header is JSON because the small, irregular data (provenance, licence,
the article table) wants to be readable by a human with ``head``; the large,
regular data (vectors, scales, string tables) is raw little-endian typed
memory, viewable in place by the browser without parsing. Section offsets
are not stored — they follow from the order and lengths in the header, so
the header never has to know its own size.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np

MAGIC = b"RIPT"
VERSION = 1
ALIGN = 8

DTYPES: dict[str, np.dtype] = {
    "i8": np.dtype("<i1"),
    "u8": np.dtype("<u1"),
    "u32": np.dtype("<u4"),
    "f32": np.dtype("<f4"),
}
_DTYPE_NAMES = {v: k for k, v in DTYPES.items()}


def _align(n: int) -> int:
    return (n + ALIGN - 1) // ALIGN * ALIGN


@dataclass(frozen=True)
class Section:
    name: str
    array: np.ndarray


def string_table(strings: list[str]) -> tuple[np.ndarray, np.ndarray]:
    """``(offsets u32 [n+1], bytes u8)`` — string i is bytes[offsets[i]:offsets[i+1]], UTF-8."""
    encoded = [s.encode("utf-8") for s in strings]
    offsets = np.zeros(len(encoded) + 1, dtype=np.uint32)
    if encoded:
        offsets[1:] = np.cumsum([len(b) for b in encoded], dtype=np.uint64)
    return offsets, np.frombuffer(b"".join(encoded), dtype=np.uint8)


def pack(header: dict, sections: list[Section]) -> bytes:
    described = []
    for section in sections:
        dtype = np.dtype(section.array.dtype).newbyteorder("<")
        if dtype not in _DTYPE_NAMES:
            raise TypeError(f"section {section.name}: unsupported dtype {section.array.dtype}")
        described.append(
            {
                "name": section.name,
                "dtype": _DTYPE_NAMES[dtype],
                "shape": list(section.array.shape),
                "length": int(section.array.nbytes),
            }
        )
    full_header = {**header, "sections": described}
    header_bytes = json.dumps(full_header, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    out = bytearray()
    out += MAGIC
    out += VERSION.to_bytes(4, "little")
    out += len(header_bytes).to_bytes(4, "little")
    out += header_bytes
    out += b"\0" * (_align(len(out)) - len(out))
    for section in sections:
        out += (
            np.ascontiguousarray(section.array)
            .astype(section.array.dtype.newbyteorder("<"))
            .tobytes()
        )
        out += b"\0" * (_align(len(out)) - len(out))
    return bytes(out)


def unpack(data: bytes) -> tuple[dict, dict[str, np.ndarray]]:
    if data[:4] != MAGIC:
        raise ValueError("not a Riptide bundle (bad magic)")
    version = int.from_bytes(data[4:8], "little")
    if version != VERSION:
        raise ValueError(f"bundle version {version}, expected {VERSION}")
    header_len = int.from_bytes(data[8:12], "little")
    header = json.loads(data[12 : 12 + header_len].decode("utf-8"))
    offset = _align(12 + header_len)
    sections: dict[str, np.ndarray] = {}
    for desc in header["sections"]:
        dtype = DTYPES[desc["dtype"]]
        length = desc["length"]
        array = np.frombuffer(data, dtype=dtype, count=length // dtype.itemsize, offset=offset)
        sections[desc["name"]] = array.reshape(desc["shape"])
        offset = _align(offset + length)
    return header, sections


def read_strings(offsets: np.ndarray, raw: np.ndarray) -> list[str]:
    buf = raw.tobytes()
    return [buf[offsets[i] : offsets[i + 1]].decode("utf-8") for i in range(len(offsets) - 1)]
