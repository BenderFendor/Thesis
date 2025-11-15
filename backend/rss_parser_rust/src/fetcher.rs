use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinSet;

use crate::types::{FetchError, FetchResult, RawFeed, SourceRequest};

fn build_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent("ThesisNewsBot/2.0 (+https://github.com/BenderFendor/Thesis)")
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .build()
        .expect("failed to build reqwest client")
}

pub async fn fetch_all(
    sources: Vec<SourceRequest>,
    max_concurrent: usize,
) -> Vec<FetchResult> {
    let semaphore = Arc::new(Semaphore::new(max_concurrent.max(1)));
    let client = Arc::new(build_client());
    let mut join_set = JoinSet::new();

    for source in sources {
        for url in &source.urls {
            let permit = acquire_permit(semaphore.clone()).await;
            let client = client.clone();
            let url = url.clone();
            let source_name = source.name.clone();

            join_set.spawn(async move {
                let _permit = permit;
                match client.get(&url).send().await {
                    Ok(resp) => match resp.error_for_status() {
                        Ok(ok_resp) => match ok_resp.text().await {
                            Ok(body) => FetchResult::Success(RawFeed {
                                source_name,
                                url,
                                xml: body,
                            }),
                            Err(err) => FetchResult::Error(FetchError {
                                source_name,
                                url,
                                message: format!("Failed to read body: {err}"),
                            }),
                        },
                        Err(status_err) => FetchResult::Error(FetchError {
                            source_name,
                            url,
                            message: status_err.to_string(),
                        }),
                    },
                    Err(err) => FetchResult::Error(FetchError {
                        source_name,
                        url,
                        message: err.to_string(),
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
