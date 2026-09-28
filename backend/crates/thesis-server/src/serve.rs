use std::future::Future;
use std::io;
use std::time::Duration;

use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ServeExit {
    Graceful,
    DrainTimedOut,
}

/// Serve until the supplied signal resolves, then bound the in-flight drain.
pub(crate) async fn serve_until_shutdown(
    listener: TcpListener,
    app: Router,
    shutdown_signal: impl Future<Output = ()> + Send + 'static,
    drain_timeout: Duration,
) -> io::Result<ServeExit> {
    let (shutdown, shutdown_rx) = oneshot::channel();
    let server = axum::serve(listener, app).with_graceful_shutdown(async move {
        let _ = shutdown_rx.await;
    });
    tokio::pin!(server);

    tokio::select! {
        result = &mut server => {
            result?;
            Ok(ServeExit::Graceful)
        }
        _ = shutdown_signal => {
            let _ = shutdown.send(());
            match time::timeout(drain_timeout, &mut server).await {
                Ok(result) => {
                    result?;
                    Ok(ServeExit::Graceful)
                }
                Err(_) => Ok(ServeExit::DrainTimedOut),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::http::StatusCode;
    use axum::routing::get;
    use axum::Router;
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    use super::{serve_until_shutdown, ServeExit};

    #[tokio::test]
    async fn serves_real_http_request_then_drains_on_signal() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind ephemeral listener");
        let address = listener.local_addr().expect("listener address");
        let app = Router::new().route("/live", get(|| async { StatusCode::OK }));
        let (shutdown, shutdown_rx) = oneshot::channel();
        let server = tokio::spawn(serve_until_shutdown(
            listener,
            app,
            async move {
                let _ = shutdown_rx.await;
            },
            Duration::from_secs(1),
        ));

        let response = reqwest::Client::new()
            .get(format!("http://{address}/live"))
            .send()
            .await
            .expect("live HTTP response");
        assert_eq!(response.status(), StatusCode::OK);
        drop(response);
        shutdown.send(()).expect("send shutdown signal");
        assert_eq!(
            server.await.expect("server task" ).expect("server result"),
            ServeExit::Graceful
        );
    }
}
