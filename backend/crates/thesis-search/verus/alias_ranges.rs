use vstd::prelude::*;

verus! {

pub open spec fn contains_span(
    outer_start: nat,
    outer_end: nat,
    inner_start: nat,
    inner_end: nat,
) -> bool {
    outer_start <= inner_start && inner_end <= outer_end
}

/// Nested alias spans remain suppressible through any enclosing alias span.
proof fn nested_alias_suppression_is_transitive(
    inner_start: nat,
    inner_end: nat,
    middle_start: nat,
    middle_end: nat,
    outer_start: nat,
    outer_end: nat,
)
    requires
        contains_span(middle_start, middle_end, inner_start, inner_end),
        contains_span(outer_start, outer_end, middle_start, middle_end),
    ensures
        contains_span(outer_start, outer_end, inner_start, inner_end),
{
    assert(outer_start <= inner_start);
    assert(inner_end <= outer_end);
}

fn main() { }

}
