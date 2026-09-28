use std::env;

use thesis_api::queue_digest::QueueDigestState;
use thesis_api::{router_with_sidecars, ApiDoc, RouterSidecars};
use thesis_db::Database;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;
use utoipa::OpenApi;

mod queue_digest_provider;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if arguments.iter().any(|argument| argument == "--openapi") {
        println!("{}", ApiDoc::openapi().to_pretty_json()?);
        return Ok(());
    }

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let database_url = env::var("THESIS_DATABASE_URL")
        .or_else(|_| env::var("DATABASE_URL"))
        .map_err(|_| "set THESIS_DATABASE_URL or DATABASE_URL to a PostgreSQL URL")?
        .replace("postgresql+asyncpg://", "postgresql://");
    let bind_address = env::var("THESIS_RUST_BIND").unwrap_or_else(|_| "127.0.0.1:8120".to_owned());
    let database = Database::connect(&database_url).await?;
    let mut sidecars = RouterSidecars::default();
    if let Some(provider) = queue_digest_provider::QueueDigestHttpProvider::from_env() {
        sidecars = sidecars.with_queue_digest(QueueDigestState::with_provider(provider));
    }
    let listener = TcpListener::bind(&bind_address).await?;
    tracing::info!(%bind_address, "Rust API service listening");
    axum::serve(listener, router_with_sidecars(database, sidecars))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
