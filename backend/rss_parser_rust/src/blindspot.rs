use pyo3::prelude::*;
use pyo3::types::PyList;

pub fn mean_vector(vectors: &[Vec<f64>]) -> Vec<f64> {
    if vectors.is_empty() {
        return vec![];
    }
    let dimension = vectors[0].len();
    let count = vectors.len() as f64;
    let mut totals = vec![0.0; dimension];
    for vector in vectors {
        for (i, &value) in vector.iter().enumerate() {
            totals[i] += value;
        }
    }
    totals.iter_mut().for_each(|v| *v /= count);
    totals
}

pub fn subtract_vectors(left: &[f64], right: &[f64]) -> Vec<f64> {
    let len = left.len().min(right.len());
    let mut result = vec![0.0; len];
    for i in 0..len {
        result[i] = left[i] - right[i];
    }
    result
}

#[allow(dead_code)]
pub fn add_vectors(left: &[f64], right: &[f64]) -> Vec<f64> {
    let len = left.len().min(right.len());
    let mut result = vec![0.0; len];
    for i in 0..len {
        result[i] = left[i] + right[i];
    }
    result
}

pub fn normalize_vector(vector: &[f64]) -> Vec<f64> {
    let magnitude: f64 = vector.iter().map(|v| v * v).sum::<f64>().sqrt();
    if magnitude <= 0.0 {
        return vec![];
    }
    vector.iter().map(|v| v / magnitude).collect()
}

pub fn dot_product(left: &[f64], right: &[f64]) -> f64 {
    let len = left.len().min(right.len());
    let mut sum = 0.0;
    for i in 0..len {
        sum += left[i] * right[i];
    }
    sum
}

pub fn cosine_similarity(left: &[f64], right: &[f64]) -> f64 {
    let len = left.len().min(right.len());
    let mut dot = 0.0;
    let mut mag_left = 0.0;
    let mut mag_right = 0.0;
    for i in 0..len {
        dot += left[i] * right[i];
        mag_left += left[i] * left[i];
        mag_right += right[i] * right[i];
    }
    let denom = mag_left.sqrt() * mag_right.sqrt();
    if denom <= 0.0 {
        return 0.0;
    }
    dot / denom
}

pub fn quantile(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut ordered: Vec<f64> = values.to_vec();
    ordered.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    if ordered.len() == 1 {
        return ordered[0];
    }
    let position = (ordered.len() - 1) as f64 * percentile;
    let lower = position as usize;
    let upper = (lower + 1).min(ordered.len() - 1);
    let weight = position - lower as f64;
    ordered[lower] * (1.0 - weight) + ordered[upper] * weight
}

pub fn build_semaxis(
    positive_vectors: Vec<Vec<f64>>,
    negative_vectors: Vec<Vec<f64>>,
) -> Option<Vec<f64>> {
    if positive_vectors.is_empty() || negative_vectors.is_empty() {
        return None;
    }
    let pos_mean = mean_vector(&positive_vectors);
    let neg_mean = mean_vector(&negative_vectors);
    let diff = subtract_vectors(&pos_mean, &neg_mean);
    let axis = normalize_vector(&diff);
    if axis.is_empty() {
        return None;
    }
    Some(axis)
}

pub fn score_articles_against_axis(
    article_vectors: &[(i64, Vec<f64>)],
    axis: &[f64],
) -> Vec<(i64, f64)> {
    let normalized_axis = normalize_vector(axis);
    if normalized_axis.is_empty() {
        return article_vectors.iter().map(|(id, _)| (*id, 0.0)).collect();
    }

    article_vectors
        .iter()
        .map(|(article_id, vector)| {
            let normalized = normalize_vector(vector);
            if normalized.is_empty() {
                return (*article_id, 0.0);
            }
            (*article_id, dot_product(&normalized, &normalized_axis))
        })
        .collect()
}

#[pyfunction]
pub fn rust_mean_vector<'py>(
    py: Python<'py>,
    vectors: Vec<Vec<f64>>,
) -> PyResult<Bound<'py, PyList>> {
    let result = mean_vector(&vectors);
    let list = PyList::empty_bound(py);
    for v in result {
        list.append(v)?;
    }
    Ok(list)
}

#[pyfunction]
pub fn rust_subtract_vectors<'py>(
    py: Python<'py>,
    left: Vec<f64>,
    right: Vec<f64>,
) -> PyResult<Bound<'py, PyList>> {
    let result = subtract_vectors(&left, &right);
    let list = PyList::empty_bound(py);
    for v in result {
        list.append(v)?;
    }
    Ok(list)
}

#[pyfunction]
pub fn rust_normalize_vector<'py>(
    py: Python<'py>,
    vector: Vec<f64>,
) -> PyResult<Bound<'py, PyList>> {
    let result = normalize_vector(&vector);
    let list = PyList::empty_bound(py);
    for v in result {
        list.append(v)?;
    }
    Ok(list)
}

#[pyfunction]
pub fn rust_dot_product(left: Vec<f64>, right: Vec<f64>) -> f64 {
    dot_product(&left, &right)
}

#[pyfunction]
pub fn rust_cosine_similarity(left: Vec<f64>, right: Vec<f64>) -> f64 {
    cosine_similarity(&left, &right)
}

#[pyfunction]
pub fn rust_quantile(values: Vec<f64>, percentile: f64) -> f64 {
    quantile(&values, percentile)
}

#[pyfunction]
pub fn rust_build_semaxis(
    positive_vectors: Vec<Vec<f64>>,
    negative_vectors: Vec<Vec<f64>>,
) -> Option<Vec<f64>> {
    build_semaxis(positive_vectors, negative_vectors)
}

#[pyfunction]
pub fn rust_score_against_axis(
    article_vectors: Vec<(i64, Vec<f64>)>,
    axis: Vec<f64>,
) -> Vec<(i64, f64)> {
    score_articles_against_axis(&article_vectors, &axis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mean_vector_computes_average() {
        let vectors = vec![vec![2.0, 4.0], vec![4.0, 6.0]];
        let mean = mean_vector(&vectors);
        assert_eq!(mean.len(), 2);
        assert!((mean[0] - 3.0).abs() < 0.001);
        assert!((mean[1] - 5.0).abs() < 0.001);
    }

    #[test]
    fn mean_vector_empty_returns_empty() {
        let mean = mean_vector(&[]);
        assert!(mean.is_empty());
    }

    #[test]
    fn subtract_vectors_works() {
        let result = subtract_vectors(&[5.0, 3.0], &[2.0, 1.0]);
        assert_eq!(result, vec![3.0, 2.0]);
    }

    #[test]
    fn normalize_unit_vector_stays_same() {
        let result = normalize_vector(&[1.0, 0.0]);
        assert!((result[0] - 1.0).abs() < 0.001);
        assert!((result[1] - 0.0).abs() < 0.001);
    }

    #[test]
    fn normalize_zero_vector_is_empty() {
        let result = normalize_vector(&[0.0, 0.0]);
        assert!(result.is_empty());
    }

    #[test]
    fn dot_product_of_orthogonal_is_zero() {
        let result = dot_product(&[1.0, 0.0], &[0.0, 1.0]);
        assert!((result - 0.0).abs() < 0.001);
    }

    #[test]
    fn dot_product_of_same_is_positive() {
        let result = dot_product(&[1.0, 2.0], &[1.0, 2.0]);
        assert!((result - 5.0).abs() < 0.001);
    }

    #[test]
    fn cosine_similarity_identical_is_one() {
        let result = cosine_similarity(&[1.0, 2.0, 3.0], &[1.0, 2.0, 3.0]);
        assert!((result - 1.0).abs() < 0.0001);
    }

    #[test]
    fn cosine_similarity_orthogonal_is_zero() {
        let result = cosine_similarity(&[1.0, 0.0, 0.0], &[0.0, 1.0, 0.0]);
        assert!((result - 0.0).abs() < 0.001);
    }

    #[test]
    fn quantile_median_of_three() {
        let result = quantile(&[1.0, 2.0, 3.0], 0.5);
        assert!((result - 2.0).abs() < 0.001);
    }

    #[test]
    fn quantile_single_value() {
        let result = quantile(&[5.0], 0.5);
        assert!((result - 5.0).abs() < 0.001);
    }

    #[test]
    fn quantile_empty() {
        let result = quantile(&[], 0.5);
        assert!((result - 0.0).abs() < 0.001);
    }

    #[test]
    fn semaxis_builds_valid_axis() {
        let positive = vec![vec![1.0, 0.0, 0.0]];
        let negative = vec![vec![0.0, 1.0, 0.0]];
        let axis = build_semaxis(positive, negative);
        assert!(axis.is_some());
        let axis = axis.unwrap();
        assert_eq!(axis.len(), 3);
    }

    #[test]
    fn semaxis_empty_inputs_none() {
        let axis = build_semaxis(vec![vec![1.0, 0.0]], vec![]);
        assert!(axis.is_none());
    }

    #[test]
    fn score_against_axis_ranks_correctly() {
        let articles = vec![
            (1, vec![1.0, 0.0, 0.0]),
            (2, vec![0.0, 1.0, 0.0]),
            (3, vec![-1.0, 0.0, 0.0]),
        ];
        let axis = vec![1.0, 0.0, 0.0];
        let scores = score_articles_against_axis(&articles, &axis);
        assert_eq!(scores.len(), 3);
        assert!(scores.iter().find(|(id, _)| *id == 1).unwrap().1 > 0.9);
        assert!(scores.iter().find(|(id, _)| *id == 3).unwrap().1 < -0.9);
    }
}
