use vstd::prelude::*;

verus! {

/// Whether the Cramer's V expression has a strictly positive denominator.
pub open spec fn statistic_is_defined(n: nat, rows: nat, cols: nat) -> bool {
    n > 0 && rows >= 2 && cols >= 2
}

/// The denominator used by V = sqrt(chi-square / (n * (min(rows, cols) - 1))).
pub open spec fn cramers_v_denominator(n: nat, rows: nat, cols: nat) -> int {
    (n as int) * ((if rows < cols { rows as int } else { cols as int }) - 1)
}

proof fn positive_product_is_positive(left: int, right: int)
    requires
        left > 0,
        right > 0,
    ensures
        left * right > 0,
{
    assert(left >= 1) by (nonlinear_arith)
        requires left > 0;
    assert(right >= 1) by (nonlinear_arith)
        requires right > 0;
    assert(left * right >= 1) by (nonlinear_arith)
        requires
            left >= 1,
            right >= 1;
}

/// The production kernel returns no V unless these dimensions are present;
/// every accepted non-degenerate shape has a positive denominator.
proof fn non_degenerate_table_has_positive_denominator(n: nat, rows: nat, cols: nat)
    requires
        statistic_is_defined(n, rows, cols),
    ensures
        cramers_v_denominator(n, rows, cols) > 0,
{
    let smaller_axis = if rows < cols { rows } else { cols };
    if rows < cols {
        assert(smaller_axis == rows);
        assert(smaller_axis >= 2);
    } else {
        assert(smaller_axis == cols);
        assert(smaller_axis >= 2);
    }
    assert(smaller_axis as int - 1 > 0) by (nonlinear_arith)
        requires smaller_axis >= 2;
    assert(n > 0);
    assert(n as int >= 1) by (nonlinear_arith)
        requires n > 0;
    assert(smaller_axis as int - 1 >= 1) by (nonlinear_arith)
        requires smaller_axis >= 2;
    assert(cramers_v_denominator(n, rows, cols)
        == (n as int) * (smaller_axis as int - 1)) by (compute);
    positive_product_is_positive(n as int, smaller_axis as int - 1);
    assert(cramers_v_denominator(n, rows, cols) > 0) by (compute);
}

fn main() { }

}
