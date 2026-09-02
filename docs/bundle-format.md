# Bundle format (version 1)

The two tables the app loads — the token embedder and the document index —
share one container. Written by `pipeline/riptide_pipeline/bundle.py`, read
by `app/src/bundle/format.ts`; the rationale is in ADR-0006.

```
offset  size   field
0       4      magic  "RIPT"
4       4      u32 LE version = 1
8       4      u32 LE header length, H
12      H      header: UTF-8 JSON
        pad    zeros to the next multiple of 8
        …      section 0, then zeros to a multiple of 8
        …      section 1, then zeros to a multiple of 8
        …
```

Section offsets are not stored: they follow from the header's `sections`
array (order and byte `length`), so the header need not know its own size.
All multi-byte integers and floats are little-endian; the reader asserts the
platform is too, rather than swapping.

## Header

Common to every kind:

| field | |
|---|---|
| `kind` | `"tokens"` or `"docs"` |
| `dim` | vector dimension (100) |
| `count` | rows |
| `space` | `{ id, source, sourceSha256, sif: { a, probability }, commonDirectionRemoved, commonDirectionVarianceRatio }` — `id` is a 16-hex fingerprint of source, source hash, `a` and the removed direction; both bundles must carry the same one |
| `pipeline` | pipeline package version that wrote the file |
| `sections` | `[{ name, dtype, shape, length }]` in file order; `dtype` ∈ `i8 u8 u32 f32`, `length` in bytes |

`tokens` adds `oovSalience` (the length given to out-of-vocabulary
vectors, 0.1) and `licence`. `docs` adds `corpus` `{ source, licence,
fetched, articles, chunks }` and `articles: [{ title, url }]`.

## Sections

**tokens**

| name | dtype | shape | |
|---|---|---|---|
| `vectors` | i8 | `[count, dim]` | quantised, row-major |
| `scales` | f32 | `[count]` | `v ≈ scale · q` |
| `wordOffsets` | u32 | `[count + 1]` | string table offsets |
| `wordBytes` | u8 | `[bytes]` | UTF-8, word *i* is `bytes[offsets[i], offsets[i+1])` |

Rows are in frequency rank order (the shipped subset of it).

**docs**

| name | dtype | shape | |
|---|---|---|---|
| `vectors` | i8 | `[count, dim]` | quantised; the reader normalises after dequantising |
| `scales` | f32 | `[count]` | |
| `article` | u32 | `[count]` | index into the header's `articles` |
| `snippetOffsets` | u32 | `[count + 1]` | string table offsets |
| `snippetBytes` | u8 | `[bytes]` | UTF-8 |

## Arithmetic the reader must match

Dequantise as `float64(scale) * q[i]`. Normalise a document as
`acc += x·x` over the row in order, `n = sqrt(acc)`, `x / n` (a norm ≤ 1e-12
is an error in the docs bundle). Score as `acc += query[i] · doc[i]` in
order. Rank by score descending, ties by row ascending. The pure-Python
twin of this is `pipeline/riptide_pipeline/reference.py`, and the golden
fixture under `app/test/fixtures/tiny` holds both sides to exact equality.
