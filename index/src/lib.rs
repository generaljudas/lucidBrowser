//! Skeleton for the hand-implemented HNSW index (roadmap M3).
//!
//! Deliberately empty of index logic: session 01 pins the toolchain
//! (`rust-toolchain.toml`) and proves in CI that the crate builds for
//! `wasm32-unknown-unknown`. `wasm-bindgen` arrives with the real index,
//! keeping the boundary thin: vectors in, ids out (ADR-0003).

/// Placeholder distance kernel so the crate has one testable symbol.
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    debug_assert_eq!(a.len(), b.len());
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    use super::dot;

    #[test]
    fn orthogonal_basis_vectors_have_zero_dot() {
        assert_eq!(dot(&[1.0, 0.0], &[0.0, 1.0]), 0.0);
    }

    #[test]
    fn dot_matches_hand_computation() {
        assert_eq!(dot(&[1.0, 2.0, 3.0], &[4.0, 5.0, 6.0]), 32.0);
    }
}
