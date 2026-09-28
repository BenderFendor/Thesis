use vstd::prelude::*;

verus! {

/// The exact finite-count relation represented by the MinHash estimator.
pub open spec fn count_ratio(matches: nat, total: nat) -> real {
    matches as real / total as real
}

/// A matching-position ratio remains in the unit interval for any signature
/// length, independent of a model-checking bound.
proof fn matching_count_ratio_is_bounded(matches: nat, total: nat)
    requires
        total > 0,
        matches <= total,
    ensures
        0.0real <= count_ratio(matches, total),
        count_ratio(matches, total) <= 1.0real,
{
    assert((matches as real) >= 0.0real);
    assert((matches as real) <= (total as real));
    assert((total as real) > 0.0real);
    assert(0.0real <= count_ratio(matches, total)) by (nonlinear_arith)
        requires
            matches as real >= 0.0real,
            total as real > 0.0real;
    assert(count_ratio(matches, total) <= 1.0real) by (nonlinear_arith)
        requires
            matches as real <= total as real,
            total as real > 0.0real;
}

proof fn perfect_signature_match_is_reachable()
    ensures
        count_ratio(4, 4) == 1.0real,
{
    assert(count_ratio(4, 4) == 1.0real) by (compute);
}

fn main() { }

}
