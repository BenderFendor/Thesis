use std::env;

use thesis_db::Database;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_url = env::var("THESIS_DATABASE_URL")
        .or_else(|_| env::var("DATABASE_URL"))
        .map_err(|_| "set THESIS_DATABASE_URL or DATABASE_URL to a PostgreSQL URL")?
        .replace("postgresql+asyncpg://", "postgresql://");
    let database = Database::connect(&database_url).await?;
    let summary = thesis_funding_bias::run(&database).await?;
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}
