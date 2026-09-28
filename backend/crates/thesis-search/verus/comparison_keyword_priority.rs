use vstd::prelude::*;

verus! {

/// The comparison keyword sort key: greater counts first, then earlier positions.
pub open spec fn keyword_precedes(
    left_count: nat,
    left_first_seen: nat,
    right_count: nat,
    right_first_seen: nat,
) -> bool {
    left_count > right_count
        || (left_count == right_count && left_first_seen < right_first_seen)
}

proof fn higher_frequency_precedes(
    left_count: nat,
    left_first_seen: nat,
    right_count: nat,
    right_first_seen: nat,
)
    requires
        left_count > right_count,
    ensures
        keyword_precedes(left_count, left_first_seen, right_count, right_first_seen),
{
}

proof fn equal_frequency_uses_first_seen_order(
    left_count: nat,
    left_first_seen: nat,
    right_first_seen: nat,
)
    ensures
        keyword_precedes(left_count, left_first_seen, left_count, right_first_seen)
            == (left_first_seen < right_first_seen),
{
}

proof fn keyword_priority_is_irreflexive(count: nat, first_seen: nat)
    ensures
        !keyword_precedes(count, first_seen, count, first_seen),
{
}

/// The strict priority relation is transitive for unbounded natural counts and positions.
proof fn keyword_priority_is_transitive(
    first_count: nat,
    first_seen: nat,
    second_count: nat,
    second_seen: nat,
    third_count: nat,
    third_seen: nat,
)
    requires
        keyword_precedes(first_count, first_seen, second_count, second_seen),
        keyword_precedes(second_count, second_seen, third_count, third_seen),
    ensures
        keyword_precedes(first_count, first_seen, third_count, third_seen),
{
    if first_count > second_count {
        if second_count > third_count {
        } else {
            assert(second_count == third_count);
        }
        assert(first_count > third_count);
    } else {
        assert(first_count == second_count);
        assert(first_seen < second_seen);
        if second_count > third_count {
            assert(first_count > third_count);
        } else {
            assert(second_count == third_count);
            assert(first_count == third_count);
            assert(first_seen < third_seen);
        }
    }
}

fn main() { }

}
