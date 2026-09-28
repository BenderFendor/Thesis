use std::collections::{BTreeSet, HashMap};
use std::fmt;

const DEGENERATE_NOTE: &str = "degenerate: empty population or fewer than two categories on one axis -- no association statistic is computable";

/// Contingency-table statistics for the funding-versus-bias analysis.
#[derive(Clone, Debug, PartialEq)]
pub struct CramersVResult {
    /// Total number of observations in the table.
    pub n: u64,
    /// Number of row categories.
    pub rows: usize,
    /// Number of column categories.
    pub cols: usize,
    /// Pearson chi-square statistic, or None for a degenerate table.
    pub chi_square: Option<f64>,
    /// Degrees of freedom, or None for a degenerate table.
    pub degrees_of_freedom: Option<usize>,
    /// Cramer's V, or None when it cannot be computed.
    pub cramers_v: Option<f64>,
    /// Explanation for a degenerate table.
    pub note: Option<&'static str>,
}

/// Invalid input to a contingency-table statistic.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContingencyTableError {
    /// One or more rows has a different number of columns.
    RaggedRows,
    /// A count total exceeds the supported u64 range.
    CountOverflow,
}

impl fmt::Display for ContingencyTableError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RaggedRows => formatter.write_str("contingency table rows must have equal width"),
            Self::CountOverflow => formatter.write_str("contingency table count exceeds u64"),
        }
    }
}

impl std::error::Error for ContingencyTableError {}

fn checked_row_totals(table: &[Vec<u64>]) -> Result<(Vec<u64>, u64), ContingencyTableError> {
    let mut row_totals = Vec::with_capacity(table.len());
    let mut population_size = 0_u64;
    for row in table {
        let row_total = row
            .iter()
            .try_fold(0_u64, |total, value| total.checked_add(*value))
            .ok_or(ContingencyTableError::CountOverflow)?;
        population_size = population_size
            .checked_add(row_total)
            .ok_or(ContingencyTableError::CountOverflow)?;
        row_totals.push(row_total);
    }
    Ok((row_totals, population_size))
}

/// Build a sorted-category contingency table from observed row/column pairs.
///
/// Category order matches Python's sorted Unicode string order. Duplicate input
/// pairs increment the same cell.
pub fn build_contingency_table(
    pairs: &[(String, String)],
) -> (Vec<String>, Vec<String>, Vec<Vec<u64>>) {
    let rows = pairs
        .iter()
        .map(|(row, _)| row.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let cols = pairs
        .iter()
        .map(|(_, col)| col.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let row_index = rows
        .iter()
        .enumerate()
        .map(|(index, value)| (value.as_str(), index))
        .collect::<HashMap<_, _>>();
    let col_index = cols
        .iter()
        .enumerate()
        .map(|(index, value)| (value.as_str(), index))
        .collect::<HashMap<_, _>>();
    let mut table = vec![vec![0; cols.len()]; rows.len()];

    for (row, col) in pairs {
        table[row_index[row.as_str()]][col_index[col.as_str()]] += 1;
    }

    (rows, cols, table)
}

/// Compute Pearson chi-square and Cramer's V for a rectangular count table.
///
/// Degenerate tables preserve the existing Python contract: n, rows, and cols
/// are returned, while the statistics are None with an explanatory note when
/// the population is empty or either axis has fewer than two values.
pub fn cramers_v(table: &[Vec<u64>]) -> Result<CramersVResult, ContingencyTableError> {
    let rows = table.len();
    let cols = table.first().map_or(0, Vec::len);
    if table.iter().any(|row| row.len() != cols) {
        return Err(ContingencyTableError::RaggedRows);
    }

    let (row_totals, population_size) = checked_row_totals(table)?;

    if population_size == 0 || rows < 2 || cols < 2 {
        return Ok(CramersVResult {
            n: population_size,
            rows,
            cols,
            chi_square: None,
            degrees_of_freedom: None,
            cramers_v: None,
            note: Some(DEGENERATE_NOTE),
        });
    }

    let mut col_totals = vec![0_u64; cols];
    for row in table {
        for (index, value) in row.iter().enumerate() {
            col_totals[index] = col_totals[index]
                .checked_add(*value)
                .ok_or(ContingencyTableError::CountOverflow)?;
        }
    }

    let population_as_float = population_size as f64;
    let mut chi_square = 0.0_f64;
    for (row_index, row) in table.iter().enumerate() {
        for (col_index, observed) in row.iter().enumerate() {
            let expected =
                (row_totals[row_index] as f64 * col_totals[col_index] as f64) / population_as_float;
            if expected > 0.0 {
                let difference = *observed as f64 - expected;
                chi_square += difference * difference / expected;
            }
        }
    }

    let degrees_of_freedom = (rows - 1)
        .checked_mul(cols - 1)
        .ok_or(ContingencyTableError::CountOverflow)?;
    let denominator = population_as_float * (rows.min(cols) - 1) as f64;
    let cramers_v = (denominator > 0.0).then(|| (chi_square / denominator).sqrt());

    Ok(CramersVResult {
        n: population_size,
        rows,
        cols,
        chi_square: Some(chi_square),
        degrees_of_freedom: Some(degrees_of_freedom),
        cramers_v,
        note: None,
    })
}

#[cfg(test)]
mod tests {
    use super::{build_contingency_table, cramers_v, ContingencyTableError};
    use proptest::prelude::*;

    #[test]
    fn table_categories_are_sorted_and_duplicate_pairs_are_counted() {
        let pairs = vec![
            ("state-funded".to_owned(), "right".to_owned()),
            ("commercial".to_owned(), "left".to_owned()),
            ("state-funded".to_owned(), "right".to_owned()),
            ("commercial".to_owned(), "right".to_owned()),
        ];

        assert_eq!(
            build_contingency_table(&pairs),
            (
                vec!["commercial".to_owned(), "state-funded".to_owned()],
                vec!["left".to_owned(), "right".to_owned()],
                vec![vec![1, 1], vec![0, 2]],
            )
        );
    }

    #[test]
    fn cramer_statistic_matches_hand_computed_fixture() {
        let result = cramers_v(&[vec![2, 8], vec![8, 2]]).expect("fixture is rectangular");
        assert_eq!(result.n, 20);
        assert_eq!(result.rows, 2);
        assert_eq!(result.cols, 2);
        assert_eq!(result.chi_square, Some(7.2));
        assert_eq!(result.degrees_of_freedom, Some(1));
        assert_eq!(result.cramers_v, Some(0.6));
        assert_eq!(result.note, None);
    }

    #[test]
    fn degenerate_tables_preserve_the_empty_statistic_contract() {
        for table in [
            Vec::new(),
            vec![vec![0, 0], vec![0, 0]],
            vec![vec![2, 3]],
            vec![vec![2], vec![3]],
        ] {
            let result = cramers_v(&table).expect("table is rectangular");
            assert_eq!(result.chi_square, None);
            assert_eq!(result.degrees_of_freedom, None);
            assert_eq!(result.cramers_v, None);
            assert!(result.note.is_some());
        }
    }

    #[test]
    fn ragged_tables_are_rejected() {
        assert_eq!(
            cramers_v(&[vec![1, 2], vec![3]]),
            Err(ContingencyTableError::RaggedRows)
        );
    }

    proptest! {
        #[test]
        fn two_by_two_cramers_v_stays_in_unit_interval(
            a in 0_u8..=255,
            b in 0_u8..=255,
            c in 0_u8..=255,
            d in 0_u8..=255,
        ) {
            let result = cramers_v(&[
                vec![u64::from(a), u64::from(b)],
                vec![u64::from(c), u64::from(d)],
            ]).expect("fixed-width table is rectangular");
            if let Some(value) = result.cramers_v {
                prop_assert!(value.is_finite());
                prop_assert!((0.0..=1.000_001).contains(&value));
            }
        }
    }
}

#[cfg(kani)]
mod kani_proofs {
    use super::{build_contingency_table, checked_row_totals, ContingencyTableError};

    /// Over unbounded `u64` cells, `checked_row_totals` overflows exactly when
    /// the true `u128` total exceeds `u64::MAX` and otherwise returns exact sums.
    #[kani::proof]
    #[kani::unwind(4)]
    fn checked_row_totals_matches_u128_ground_truth_or_overflows_exactly() {
        let a: u64 = kani::any();
        let b: u64 = kani::any();
        let c: u64 = kani::any();
        let d: u64 = kani::any();
        let table = vec![vec![a, b], vec![c, d]];

        let true_row0 = u128::from(a) + u128::from(b);
        let true_row1 = u128::from(c) + u128::from(d);
        let true_total = true_row0 + true_row1;

        match checked_row_totals(&table) {
            Ok((row_totals, population_size)) => {
                assert!(true_total <= u128::from(u64::MAX));
                assert_eq!(u128::from(row_totals[0]), true_row0);
                assert_eq!(u128::from(row_totals[1]), true_row1);
                assert_eq!(u128::from(population_size), true_total);
            }
            Err(ContingencyTableError::CountOverflow) => {
                assert!(true_total > u128::from(u64::MAX));
            }
            Err(ContingencyTableError::RaggedRows) => {
                panic!("checked_row_totals never returns RaggedRows");
            }
        }
    }

    /// For up to three pairs over two-symbol axes, the table is rectangular
    /// and its cells sum to the number of pairs.
    #[kani::proof]
    #[kani::unwind(4)]
    fn contingency_table_cells_sum_to_input_length_and_stay_rectangular() {
        let count: u8 = kani::any();
        kani::assume(count <= 3);

        let mut pairs: Vec<(String, String)> = Vec::new();
        for _ in 0..count {
            let row_symbol: bool = kani::any();
            let col_symbol: bool = kani::any();
            let row = if row_symbol { "r1" } else { "r0" }.to_owned();
            let col = if col_symbol { "c1" } else { "c0" }.to_owned();
            pairs.push((row, col));
        }

        let (rows, cols, table) = build_contingency_table(&pairs);
        assert_eq!(table.len(), rows.len());
        for row in &table {
            assert_eq!(row.len(), cols.len());
        }
        let total: u64 = table.iter().flat_map(|row| row.iter()).sum();
        assert_eq!(total, u64::from(count));
    }
}
