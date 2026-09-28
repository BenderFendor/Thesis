use super::*;
fn point(value: &str) -> InterestRange {
    InterestRange::point(value).unwrap()
}
fn edge(owner: &str, owned: &str, value: &str, claim: &str) -> OwnershipEdge {
    OwnershipEdge::new(owner, owned, point(value), InterestType::Economic).with_claim_id(claim)
}
#[test]
fn multiplication_is_exact() {
    let left = InterestRange::new("0.25", "0.50").unwrap();
    let right = InterestRange::new("0.50", "0.75").unwrap();
    assert_eq!(
        left.multiply(&right).unwrap(),
        InterestRange::new("0.1250", "0.3750").unwrap()
    );
}
#[test]
fn subunit_product_compares_above_zero() {
    let point = InterestRange::point("0.001").unwrap();
    let product = point.multiply(&point).unwrap();
    assert_eq!(product, InterestRange::point("0.000001").unwrap());
    assert!(product.lower > Fraction::zero());
    assert!(product.upper <= Fraction::one());
}
#[test]
fn mixed_scale_decimal_ordering_is_exact() {
    let hundredth: Fraction = "0.01".parse().unwrap();
    let nine_thousandths: Fraction = "0.009".parse().unwrap();
    assert!(hundredth > nine_thousandths);
    assert_eq!(hundredth, "1e-2".parse::<Fraction>().unwrap());
    assert_eq!(nine_thousandths, "9E-3".parse::<Fraction>().unwrap());
}
#[test]
fn invalid_ranges_are_rejected() {
    assert_eq!(
        InterestRange::new("-0.1", "0.2"),
        Err(OwnershipMathError::NegativeOwnershipInterest)
    );
    assert_eq!(
        InterestRange::new("0.8", "0.2"),
        Err(OwnershipMathError::InvertedOwnershipRange)
    );
    assert_eq!(
        InterestRange::point("1.01"),
        Err(OwnershipMathError::OwnershipInterestAboveOne)
    );
    assert_eq!(
        InterestRange::new("0.4", "0.6").unwrap().add(&point("0.5")),
        Err(OwnershipMathError::SummedOwnershipInterestAboveOne)
    );
}
#[test]
fn percentage_qualifiers_convert_exactly() {
    let range = InterestRange::from_percentages("25.00", "50.00").unwrap();
    assert_eq!(range, InterestRange::new("0.25", "0.50").unwrap());
}
#[test]
fn cycle_is_unresolved_and_sccs_are_stable() {
    let edges = vec![
        edge("b", "a", "0.1", "ba"),
        edge("a", "b", "0.5", "ab"),
        edge("b", "c", "0.4", "bc"),
    ];
    assert_eq!(
        strongly_connected_components(&edges),
        vec![vec!["c".to_owned()], vec!["a".to_owned(), "b".to_owned()]]
    );
    let result =
        compute_indirect_interest_default(&edges, "a", "c", InterestType::Economic).unwrap();
    assert!(
        result.cross_holding_unresolved && result.aggregate.is_none() && result.paths.is_empty()
    );
}
#[test]
fn overlap_is_refused() {
    let edges = vec![
        edge("a", "b", "0.5", "ab"),
        edge("b", "d", "0.5", "bd"),
        edge("a", "c", "0.5", "ac"),
        edge("c", "d", "0.5", "cd"),
    ];
    let result =
        compute_indirect_interest_default(&edges, "a", "d", InterestType::Economic).unwrap();
    assert!(result.aggregate.is_none() && result.possibly_overlapping && result.paths.len() == 2);
}
#[test]
fn documented_disjoint_paths_sum() {
    let edges = vec![
        edge("a", "b", "0.5", "ab").with_disjoint_group("g1"),
        edge("b", "d", "0.5", "bd").with_disjoint_group("g1"),
        edge("a", "c", "0.5", "ac").with_disjoint_group("g2"),
        edge("c", "d", "0.5", "cd").with_disjoint_group("g2"),
    ];
    let result =
        compute_indirect_interest_default(&edges, "a", "d", InterestType::Economic).unwrap();
    assert_eq!(result.aggregate, Some(point("0.50")));
}
#[test]
fn paths_are_ordered_by_owned_then_claim() {
    let edges = vec![
        edge("a", "z", "0.4", "z"),
        edge("a", "b", "0.4", "b"),
        edge("b", "d", "0.5", "bd"),
        edge("z", "d", "0.5", "zd"),
    ];
    let result =
        compute_indirect_interest_default(&edges, "a", "d", InterestType::Economic).unwrap();
    assert_eq!(result.paths[0].entity_ids, vec!["a", "b", "d"]);
    assert_eq!(result.paths[1].entity_ids, vec!["a", "z", "d"]);
}
#[test]
fn trace_uses_python_percentage_shape() {
    let result = compute_indirect_interest_default(
        &[edge("a", "b", "0.5", "ab")],
        "a",
        "b",
        InterestType::Economic,
    )
    .unwrap();
    let json = serde_json::to_value(result).unwrap();
    assert_eq!(json["aggregate"]["lower"], 50.0);
    assert_eq!(json["paths"][0]["interest"]["upper"], 50.0);
    assert_eq!(json["interest_type"], "economic");
}
#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;
    proptest! { #[test] fn product_stays_a_valid_fraction(a in 0u16..=1000, b in 0u16..=1000) { let left = InterestRange::point(format!("0.{a:03}")).unwrap(); let right = InterestRange::point(format!("0.{b:03}")).unwrap(); let product = left.multiply(&right).unwrap(); prop_assert!(product.lower >= Fraction::zero() && product.lower <= product.upper && product.upper <= Fraction::one()); } }
}
