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
            let client = client.clone();
            let url = url.clone();
            let source_name = source.name.clone();

            join_set.spawn(async move {
                let _permit = permit;
                let request_started = Instant::now();
                match client.get(&url).send().await {
                    Ok(resp) => match resp.error_for_status() {
                        Ok(ok_resp) => match ok_resp.text().await {
                            Ok(body) => FetchResult::Success(RawFeed {
                                source_name,
                                url,
                                xml: body,
                                duration_ms: request_started.elapsed().as_millis(),
                            }),
                            Err(err) => FetchResult::Error(FetchError {
                                source_name,
                                url,
                                message: format!("Failed to read body: {err}"),
                                duration_ms: request_started.elapsed().as_millis(),
                                timed_out: err.is_timeout(),
                            }),
                        },
                        Err(status_err) => FetchResult::Error(FetchError {
                            source_name,
                            url,
                            message: status_err.to_string(),
                            duration_ms: request_started.elapsed().as_millis(),
                            timed_out: status_err.is_timeout(),
                        }),
                    },
                    Err(err) => FetchResult::Error(FetchError {
                        source_name,
                        url,
                        message: err.to_string(),
                        duration_ms: request_started.elapsed().as_millis(),
                        timed_out: err.is_timeout(),
                    }),
                }
            });
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

async fn acquire_permit(semaphore: Arc<Semaphore>) -> OwnedSemaphorePermit {
    loop {
        match semaphore.clone().acquire_owned().await {
            Ok(permit) => return permit,
            Err(_) => tokio::task::yield_now().await,
        }
    }
}
