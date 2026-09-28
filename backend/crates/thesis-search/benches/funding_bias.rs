use std::hint::black_box;

use criterion::{criterion_group, criterion_main, Criterion};
use thesis_search::funding_bias::{build_contingency_table, cramers_v};

fn observed_pairs(count: usize) -> Vec<(String, String)> {
    (0..count)
        .map(|index| {
            (
                format!("funding-{}", index % 16),
                format!("bias-{}", (index * 7) % 9),
            )
        })
        .collect()
}

fn funding_bias_benchmarks(criterion: &mut Criterion) {
    let pairs = observed_pairs(20_000);
    let (_, _, table) = build_contingency_table(&pairs);

    criterion.bench_function("funding_bias/build_table_20k_pairs", |bencher| {
        bencher.iter(|| build_contingency_table(black_box(&pairs)));
    });
    criterion.bench_function("funding_bias/cramers_v_16x9", |bencher| {
        bencher.iter(|| cramers_v(black_box(&table)).expect("fixture table is rectangular"));
    });
}

criterion_group!(benches, funding_bias_benchmarks);
criterion_main!(benches);
