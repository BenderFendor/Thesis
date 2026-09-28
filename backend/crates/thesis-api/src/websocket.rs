//! Process-local `/ws` broadcast transport compatible with FastAPI's news push.
//!
//! In `lib.rs`, expose this module with `pub mod websocket;`, construct one
//! `WebSocketHub::new()` per process, store clones in application state, and
//! merge `websocket::router(hub.clone())` into the API router. The cache
//! completion publisher should await `hub.broadcast_json(&cache_updated)` for
//! the WebSocket payload while preserving the distinct `invalidate` SSE
//! payload. This hub has no replay and does not share events across processes.
//! Broadcasts snapshot connections in registration order and await each socket
//! write before sending to the next client; slow clients apply backpressure.
//! Client text is ignored; binary input disconnects, as Starlette's
//! `receive_text()` raises when no `text` field is present. Ping/Pong control
//! frames stay below the ASGI message layer. The 16 MiB message limit and
//! 20-second ping/timeout values mirror this repository's Uvicorn defaults.

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex as StdMutex,
};
use std::time::Duration;
#[cfg(test)]
use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};

use axum::extract::{
    ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    State,
};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
#[cfg(test)]
use futures_util::Sink;
use futures_util::{stream::SplitSink, SinkExt, StreamExt};
use serde::Serialize;
#[cfg(test)]
use tokio::sync::{mpsc, oneshot};
use tokio::sync::{watch, Mutex};
use tokio::time::Instant;

const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(20);
const KEEPALIVE_TIMEOUT: Duration = Duration::from_secs(20);
const TUNGSTENITE_MESSAGE_TOO_LONG_PREFIX: &str = "Space limit exceeded: Message too long:";

#[cfg(test)]
enum SocketSink {
    WebSocket(SplitSink<WebSocket, Message>),
    Pending(PendingTestSink),
}

#[cfg(not(test))]
type SocketSink = SplitSink<WebSocket, Message>;

#[cfg(test)]
struct PendingTestSink {
    started: mpsc::UnboundedSender<Message>,
    release: Pin<Box<oneshot::Receiver<()>>>,
    pending: Option<Message>,
}

#[cfg(test)]
impl Sink<Message> for PendingTestSink {
    type Error = axum::Error;

    fn poll_ready(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn start_send(mut self: Pin<&mut Self>, item: Message) -> Result<(), Self::Error> {
        self.as_mut().get_mut().pending = Some(item);
        Ok(())
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        let this = self.as_mut().get_mut();
        if let Some(message) = this.pending.take() {
            let _ = this.started.send(message);
        }
        match this.release.as_mut().poll(cx) {
            Poll::Ready(_) => Poll::Ready(Ok(())),
            Poll::Pending => Poll::Pending,
        }
    }

    fn poll_close(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }
}

#[cfg(test)]
impl Sink<Message> for SocketSink {
    type Error = axum::Error;

    fn poll_ready(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        match self.get_mut() {
            Self::WebSocket(sink) => Pin::new(sink).poll_ready(cx),
            Self::Pending(sink) => Pin::new(sink).poll_ready(cx),
        }
    }

    fn start_send(mut self: Pin<&mut Self>, item: Message) -> Result<(), Self::Error> {
        match self.as_mut().get_mut() {
            Self::WebSocket(sink) => Pin::new(sink).start_send(item),
            Self::Pending(sink) => Pin::new(sink).start_send(item),
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        match self.as_mut().get_mut() {
            Self::WebSocket(sink) => Pin::new(sink).poll_flush(cx),
            Self::Pending(sink) => Pin::new(sink).poll_flush(cx),
        }
    }

    fn poll_close(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        match self.as_mut().get_mut() {
            Self::WebSocket(sink) => Pin::new(sink).poll_close(cx),
            Self::Pending(sink) => Pin::new(sink).poll_close(cx),
        }
    }
}

#[derive(Clone)]
struct Connection {
    id: u64,
    sink: Arc<Mutex<SocketSink>>,
    cancel: watch::Sender<bool>,
}

struct HubState {
    connections: StdMutex<Vec<Connection>>,
    next_connection_id: AtomicU64,
}

/// Cloneable process-local news event fanout for `/ws` connections.
#[derive(Clone)]
pub struct WebSocketHub {
    state: Arc<HubState>,
}

impl WebSocketHub {
    /// Create a hub with no replay or application-level message queue.
    pub fn new() -> Self {
        Self {
            state: Arc::new(HubState {
                connections: StdMutex::new(Vec::new()),
                next_connection_id: AtomicU64::new(0),
            }),
        }
    }

    /// Serialize once and await a text-frame write to each current connection.
    ///
    /// Connections are visited in registration order, matching FastAPI's
    /// sequential `send_text` loop. Concurrent calls have no global order, but
    /// each socket serializes complete frame writes. A slow socket blocks this
    /// broadcast and later clients until its write completes. Write failures
    /// remove that client and do not stop delivery to the rest of the snapshot.
    /// The return value counts completed socket writes, not client
    /// acknowledgements.
    /// Canceling an in-flight socket write disconnects that peer to prevent a
    /// partial frame from being reused; earlier peers may already have received
    /// the event. No event is replayed. Serialization errors happen before writes.
    pub async fn broadcast_json<T>(&self, event: &T) -> Result<usize, serde_json::Error>
    where
        T: Serialize + Sync + ?Sized,
    {
        let frame = Message::Text(serde_json::to_string(event)?.into());
        let connections = self
            .state
            .connections
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let mut sent = 0;

        for connection in connections {
            let mut sink = connection.sink.lock().await;
            let mut delivery = DeliveryGuard {
                hub: self,
                id: connection.id,
                completed: false,
            };
            if sink.send(frame.clone()).await.is_ok() {
                delivery.completed = true;
                sent += 1;
            }
        }

        Ok(sent)
    }

    fn register(&self, sink: Arc<Mutex<SocketSink>>) -> (ConnectionGuard, watch::Receiver<bool>) {
        let id = self
            .state
            .next_connection_id
            .fetch_add(1, Ordering::Relaxed);
        let (cancel, cancellation) = watch::channel(false);
        self.state
            .connections
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(Connection { id, sink, cancel });
        (
            ConnectionGuard {
                hub: self.clone(),
                id,
            },
            cancellation,
        )
    }

    fn disconnect(&self, id: u64) {
        let connection = {
            let mut connections = self
                .state
                .connections
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            connections
                .iter()
                .position(|connection| connection.id == id)
                .map(|index| connections.remove(index))
        };
        if let Some(connection) = connection {
            let _ = connection.cancel.send(true);
        }
    }
}

impl Default for WebSocketHub {
    fn default() -> Self {
        Self::new()
    }
}

struct ConnectionGuard {
    hub: WebSocketHub,
    id: u64,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.hub.disconnect(self.id);
    }
}

struct DeliveryGuard<'hub> {
    hub: &'hub WebSocketHub,
    id: u64,
    completed: bool,
}

impl Drop for DeliveryGuard<'_> {
    fn drop(&mut self) {
        if !self.completed {
            self.hub.disconnect(self.id);
        }
    }
}

enum ConnectionActivity<Incoming> {
    Incoming(Incoming),
    KeepalivePing,
    PongTimeout,
    Cancelled,
}

/// Router for the FastAPI-compatible `/ws` endpoint.
pub fn router(hub: WebSocketHub) -> Router {
    Router::new()
        .route("/ws", get(upgrade_websocket))
        .with_state(hub)
}

async fn upgrade_websocket(upgrade: WebSocketUpgrade, State(hub): State<WebSocketHub>) -> Response {
    upgrade
        .max_message_size(MAX_MESSAGE_SIZE)
        .on_upgrade(move |socket| handle_connection(socket, hub))
}

async fn handle_connection(socket: WebSocket, hub: WebSocketHub) {
    let (sink, mut incoming) = socket.split();
    #[cfg(test)]
    let sink = Arc::new(Mutex::new(SocketSink::WebSocket(sink)));
    #[cfg(not(test))]
    let sink = Arc::new(Mutex::new(sink));
    let (_connection, mut cancellation) = hub.register(Arc::clone(&sink));
    let mut ping_interval = tokio::time::sleep(KEEPALIVE_INTERVAL);
    tokio::pin!(ping_interval);
    let mut pong_timeout = tokio::time::sleep(KEEPALIVE_TIMEOUT);
    tokio::pin!(pong_timeout);
    let mut ping_payload = None;
    let mut ping_sequence = 0_u64;

    loop {
        let activity = tokio::select! {
            incoming = incoming.next() => ConnectionActivity::Incoming(incoming),
            _ = cancellation.changed() => ConnectionActivity::Cancelled,
            _ = &mut ping_interval, if ping_payload.is_none() => {
                ConnectionActivity::KeepalivePing
            },
            _ = &mut pong_timeout, if ping_payload.is_some() => {
                ConnectionActivity::PongTimeout
            },
        };

        match activity {
            ConnectionActivity::Incoming(Some(Ok(Message::Text(_))))
            | ConnectionActivity::Incoming(Some(Ok(Message::Ping(_)))) => {}
            ConnectionActivity::Incoming(Some(Ok(Message::Pong(payload)))) => {
                if ping_payload
                    .is_some_and(|expected: [u8; 8]| payload.as_ref() == expected.as_slice())
                {
                    ping_payload = None;
                    ping_interval
                        .as_mut()
                        .reset(Instant::now() + KEEPALIVE_INTERVAL);
                }
            }
            ConnectionActivity::Incoming(Some(Ok(Message::Binary(_))))
            | ConnectionActivity::Incoming(Some(Ok(Message::Close(_))))
            | ConnectionActivity::Incoming(None)
            | ConnectionActivity::Cancelled => break,
            ConnectionActivity::Incoming(Some(Err(error))) => {
                // Axum wraps Tungstenite's typed capacity error in axum::Error.
                // Preserve Uvicorn's 1009 close without a direct dependency.
                if error
                    .to_string()
                    .starts_with(TUNGSTENITE_MESSAGE_TOO_LONG_PREFIX)
                {
                    let close = Message::Close(Some(CloseFrame {
                        code: 1009,
                        reason: "".into(),
                    }));
                    let _ = sink.lock().await.send(close).await;
                }
                break;
            }
            ConnectionActivity::KeepalivePing => {
                let payload = ping_sequence.to_be_bytes();
                ping_sequence = ping_sequence.wrapping_add(1);
                if sink
                    .lock()
                    .await
                    .send(Message::Ping(payload.to_vec().into()))
                    .await
                    .is_err()
                {
                    break;
                }
                ping_payload = Some(payload);
                pong_timeout
                    .as_mut()
                    .reset(Instant::now() + KEEPALIVE_TIMEOUT);
            }
            ConnectionActivity::PongTimeout => {
                let close = Message::Close(Some(CloseFrame {
                    code: 1011,
                    reason: "keepalive ping timeout".into(),
                }));
                let _ = sink.lock().await.send(close).await;
                break;
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::time::timeout;

    fn pending_sink() -> (
        SocketSink,
        mpsc::UnboundedReceiver<Message>,
        oneshot::Sender<()>,
    ) {
        let (started, writes) = mpsc::unbounded_channel();
        let (release, release_receiver) = oneshot::channel();
        (
            SocketSink::Pending(PendingTestSink {
                started,
                release: Box::pin(release_receiver),
                pending: None,
            }),
            writes,
            release,
        )
    }

    fn ready_sink() -> (SocketSink, mpsc::UnboundedReceiver<Message>) {
        let (sink, writes, release) = pending_sink();
        drop(release);
        (sink, writes)
    }

    async fn next_write(receiver: &mut mpsc::UnboundedReceiver<Message>) -> Message {
        timeout(Duration::from_secs(5), receiver.recv())
            .await
            .expect("test sink observes a write")
            .expect("test sink remains connected")
    }

    fn text_payload(message: Message) -> String {
        match message {
            Message::Text(text) => text.to_string(),
            other => panic!("expected a text frame, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn broadcast_awaits_each_pending_sink_before_visiting_the_next() {
        let hub = WebSocketHub::new();
        let (first_sink, mut first_writes, release_first) = pending_sink();
        let (second_sink, mut second_writes) = ready_sink();
        let (_first_guard, _) = hub.register(Arc::new(Mutex::new(first_sink)));
        let (_second_guard, _) = hub.register(Arc::new(Mutex::new(second_sink)));

        let event = json!({"type": "ordered"});
        let expected = serde_json::to_string(&event).unwrap();
        let broadcast = {
            let hub = hub.clone();
            tokio::spawn(async move { hub.broadcast_json(&event).await })
        };

        assert_eq!(text_payload(next_write(&mut first_writes).await), expected);
        assert!(matches!(
            second_writes.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));

        release_first.send(()).unwrap();
        let completed = timeout(Duration::from_secs(5), broadcast)
            .await
            .expect("broadcast resumes after the first writer is released")
            .unwrap()
            .unwrap();
        assert_eq!(completed, 2);
        assert_eq!(text_payload(second_writes.try_recv().unwrap()), expected);
        assert!(first_writes.try_recv().is_err());
    }

    #[tokio::test]
    async fn canceling_a_pending_write_disconnects_only_that_connection() {
        let hub = WebSocketHub::new();
        let (first_sink, mut first_writes, _release_first) = pending_sink();
        let (second_sink, mut second_writes) = ready_sink();
        let (_first_guard, mut first_cancellation) = hub.register(Arc::new(Mutex::new(first_sink)));
        let (_second_guard, second_cancellation) = hub.register(Arc::new(Mutex::new(second_sink)));

        let event = json!({"type": "cancelled"});
        let expected = serde_json::to_string(&event).unwrap();
        let broadcast = {
            let hub = hub.clone();
            tokio::spawn(async move { hub.broadcast_json(&event).await })
        };
        assert_eq!(text_payload(next_write(&mut first_writes).await), expected);
        assert!(matches!(
            second_writes.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));

        broadcast.abort();
        assert!(broadcast.await.unwrap_err().is_cancelled());
        timeout(Duration::from_secs(5), first_cancellation.changed())
            .await
            .expect("canceled write removes and signals its connection")
            .unwrap();
        assert!(*first_cancellation.borrow());
        assert!(!second_cancellation.has_changed().unwrap());

        let following = json!({"type": "following"});
        assert_eq!(hub.broadcast_json(&following).await.unwrap(), 1);
        assert_eq!(
            text_payload(second_writes.try_recv().unwrap()),
            serde_json::to_string(&following).unwrap()
        );
        assert!(first_writes.try_recv().is_err());
    }
}
