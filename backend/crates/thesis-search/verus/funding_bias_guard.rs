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

/// The kernel's degenerate guard (`n == 0 || rows < 2 || cols < 2`) is
/// exactly the complement of `statistic_is_defined`: the production
/// `cramers_v` takes the degenerate branch (returning `None` with a note)
/// precisely when the statistic is not defined, and computes a value
/// precisely when it is defined. Neither branch is ever taken when the
/// other's condition holds.
pub open spec fn is_degenerate(n: nat, rows: nat, cols: nat) -> bool {
    n == 0 || rows < 2 || cols < 2
}

proof fn degenerate_guard_is_exactly_not_defined(n: nat, rows: nat, cols: nat)
    ensures
        is_degenerate(n, rows, cols) == !statistic_is_defined(n, rows, cols),
{
}

/// Every non-degenerate shape has at least one degree of freedom: with
/// `rows >= 2` and `cols >= 2`, `(rows - 1) * (cols - 1) >= 1`. The
/// production kernel only ever reports a `degrees_of_freedom` value under
/// this same non-degenerate condition.
proof fn non_degenerate_table_has_at_least_one_degree_of_freedom(n: nat, rows: nat, cols: nat)
    requires
        statistic_is_defined(n, rows, cols),
    ensures
        (rows as int - 1) * (cols as int - 1) >= 1,
{
    assert(rows as int - 1 >= 1) by (nonlinear_arith)
        requires rows >= 2;
    assert(cols as int - 1 >= 1) by (nonlinear_arith)
        requires cols >= 2;
    assert((rows as int - 1) * (cols as int - 1) >= 1) by (nonlinear_arith)
        requires
            rows as int - 1 >= 1,
            cols as int - 1 >= 1;
}

fn main() { }

}
