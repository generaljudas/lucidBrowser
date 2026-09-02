import numpy as np
import pytest

from riptide_pipeline import bundle


def test_round_trip_preserves_header_and_sections() -> None:
    vectors = np.arange(-6, 6, dtype=np.int8).reshape(3, 4)
    scales = np.array([0.5, 0.25, 1.0], dtype=np.float32)
    offsets, raw = bundle.string_table(["tide", "glaciér", ""])
    data = bundle.pack(
        {"kind": "tokens", "dim": 4, "count": 3},
        [
            bundle.Section("vectors", vectors),
            bundle.Section("scales", scales),
            bundle.Section("wordOffsets", offsets),
            bundle.Section("wordBytes", raw),
        ],
    )
    header, sections = bundle.unpack(data)
    assert header["kind"] == "tokens" and header["dim"] == 4
    assert [s["name"] for s in header["sections"]] == [
        "vectors",
        "scales",
        "wordOffsets",
        "wordBytes",
    ]
    np.testing.assert_array_equal(sections["vectors"], vectors)
    np.testing.assert_array_equal(sections["scales"], scales)
    assert bundle.read_strings(sections["wordOffsets"], sections["wordBytes"]) == [
        "tide",
        "glaciér",
        "",
    ]


def test_every_section_starts_on_an_eight_byte_boundary() -> None:
    data = bundle.pack(
        {"k": "v"},
        [
            bundle.Section("a", np.zeros(3, dtype=np.int8)),
            bundle.Section("b", np.zeros(5, dtype=np.float32)),
            bundle.Section("c", np.zeros(1, dtype=np.uint32)),
        ],
    )
    header_len = int.from_bytes(data[8:12], "little")
    offset = (12 + header_len + 7) // 8 * 8
    for desc in bundle.unpack(data)[0]["sections"]:
        assert offset % 8 == 0
        offset = (offset + desc["length"] + 7) // 8 * 8
    assert len(data) == offset


def test_layout_is_little_endian_and_self_describing() -> None:
    data = bundle.pack({}, [bundle.Section("n", np.array([0x01020304], dtype=np.uint32))])
    assert data[:4] == b"RIPT"
    assert int.from_bytes(data[4:8], "little") == bundle.VERSION
    assert data.endswith(b"\x04\x03\x02\x01" + b"\0" * 4)


def test_rejects_foreign_bytes_and_versions() -> None:
    with pytest.raises(ValueError, match="magic"):
        bundle.unpack(b"NOPE" + b"\0" * 16)
    data = bytearray(bundle.pack({}, []))
    data[4:8] = (99).to_bytes(4, "little")
    with pytest.raises(ValueError, match="version"):
        bundle.unpack(bytes(data))


def test_unsupported_dtypes_are_refused() -> None:
    with pytest.raises(TypeError):
        bundle.pack({}, [bundle.Section("x", np.zeros(2, dtype=np.float64))])
