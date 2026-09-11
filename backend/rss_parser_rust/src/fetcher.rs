use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::Client;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinSet;

use crate::types::{FetchError, FetchResult, RawFeed, SourceRequest};

fn build_client(timeout: Duration) -> Client {
    Client::builder()
        .timeout(timeout)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36") // I don't want to get blocked
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .build()
        .expect("failed to build reqwest client")
}

/// Fetches all feed URLs across all sources concurrently, obeying the
/// `max_concurrent` limit via a shared semaphore.
///
/// Returns a flat list of [`FetchResult`] values, one per URL attempt.
pub async fn fetch_all(
    sources: Vec<SourceRequest>,
    max_concurrent: usize,
    request_timeout: Duration,
) -> Vec<FetchResult> {
    let semaphore = Arc::new(Semaphore::new(max_concurrent.max(1)));
    let client = Arc::new(build_client(request_timeout));
    let mut join_set = JoinSet::new();

    for source in sources {
        for url in &source.urls {
            let permit = acquire_permit(semaphore.clone()).await;
            join_set.spawn(fetch_url(
                client.clone(),
                permit,
                source.name.clone(),
                url.clone(),
            ));
        }
    }

    let mut results = Vec::new();
    while let Some(res) = join_set.join_next().await {
        if let Ok(fetch_result) = res {
            results.push(fetch_result);
        }
    }

    results
}

async fn fetch_url(
    client: Arc<Client>,
    _permit: OwnedSemaphorePermit,
    source_name: String,
    url: String,
) -> FetchResult {
    let request_started = Instant::now();
    match client.get(&url).send().await {
        Ok(response) => read_response(response, source_name, url, request_started).await,
        Err(error) => request_error(source_name, url, request_started, error),
    }
}

async fn read_response(
    response: reqwest::Response,
    source_name: String,
    url: String,
    request_started: Instant,
) -> FetchResult {
    match response.error_for_status() {
        Ok(response) => match response.text().await {
            Ok(xml) => FetchResult::Success(RawFeed {
                source_name,
                url,
                xml,
                duration_ms: request_started.elapsed().as_millis(),
            }),
            Err(error) => request_error(source_name, url, request_started, error),
        },
        Err(error) => request_error(source_name, url, request_started, error),
    }
}

fn request_error(
    source_name: String,
    url: String,
    request_started: Instant,
    error: reqwest::Error,
) -> FetchResult {
    FetchResult::Error(FetchError {
        source_name,
        url,
        message: error.to_string(),
        duration_ms: request_started.elapsed().as_millis(),
        timed_out: error.is_timeout(),
    })
}

async fn acquire_permit(semaphore: Arc<Semaphore>) -> OwnedSemaphorePermit {
    loop {
        match semaphore.clone().acquire_owned().await {
            Ok(permit) => return permit,
            Err(_) => tokio::task::yield_now().await,
        }
    }
}
