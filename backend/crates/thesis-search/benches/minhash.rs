use criterion::{criterion_group, criterion_main, Criterion};
use std::hint::black_box;
use thesis_search::minhash::{
    compute_minhash_signature, deduplicate_article_groups, find_duplicate_pairs,
};

fn article_fixture(count: usize) -> Vec<(String, String)> {
    (0..count)
        .map(|index| {
            (
                format!("article-{index}"),
                format!(
                    "Climate policy talks focus on emissions targets and regional energy costs; report {index}."
                ),
            )
        })
        .collect()
}

fn minhash_benchmarks(criterion: &mut Criterion) {
    let text = "Climate policy talks focus on emissions targets and regional energy costs.";
    let articles = article_fixture(64);

    criterion.bench_function("minhash_signature_128", |bencher| {
        bencher.iter(|| compute_minhash_signature(black_box(text), 128, 42));
    });
    criterion.bench_function("minhash_pairs_64_articles", |bencher| {
        bencher.iter(|| find_duplicate_pairs(black_box(&articles), 0.85, 128));
    });
    criterion.bench_function("minhash_groups_64_articles", |bencher| {
        bencher.iter(|| deduplicate_article_groups(black_box(&articles), 0.85, 128));
    });
}

criterion_group!(benches, minhash_benchmarks);
criterion_main!(benches);
