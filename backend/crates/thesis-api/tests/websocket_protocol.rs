use std::net::SocketAddr;
use std::time::Duration;

use axum::Router;
use serde_json::{json, Value};
use thesis_api::websocket::{router as websocket_router, WebSocketHub};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio::time::timeout;

const RFC6455_KEY: &str = "dGhlIHNhbXBsZSBub25jZQ==";
const RFC6455_ACCEPT: &str = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
const MASK: [u8; 4] = [0x37, 0xfa, 0x21, 0x3d];
const UVICORN_MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

struct ServerGuard(JoinHandle<()>);

impl Drop for ServerGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl ServerGuard {
    async fn shutdown(mut self) {
        self.0.abort();
        let _ = (&mut self.0).await;
    }
}

async fn start_server(hub: WebSocketHub) -> (SocketAddr, ServerGuard) {
    let app = Router::new().merge(websocket_router(hub));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = ServerGuard(tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    }));
    (address, server)
}

#[tokio::test]
async fn websocket_accepts_ignores_text_broadcasts_in_order_and_cleans_up() {
    let hub = WebSocketHub::new();
    let (address, server) = start_server(hub.clone()).await;

    let mut client = timeout(Duration::from_secs(2), connect(address))
        .await
        .expect("ephemeral Axum listener accepts the handshake")
        .unwrap();
    send_client_frame(&mut client, 0x1, b"ignored client text").await;
    assert!(
        timeout(Duration::from_millis(100), client.read_u8())
            .await
            .is_err(),
        "inbound text must not be echoed or acknowledged"
    );
    send_client_frame(&mut client, 0x9, b"client ping").await;
    let (opcode, payload) = read_server_frame(&mut client).await.unwrap();
    assert_eq!(opcode, 0x0a, "client Ping must receive a Pong");
    assert_eq!(payload.as_slice(), b"client ping");
    send_client_frame(&mut client, 0x0a, b"unsolicited client Pong").await;

    let first = cache_updated(12, 3, "2026-09-25T12:00:00+00:00");
    let second = cache_updated(15, 4, "2026-09-25T12:01:00+00:00");
    timeout(Duration::from_secs(2), async {
        while hub.broadcast_json(&first).await.unwrap() != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("client is registered before the first broadcast");
    assert_eq!(hub.broadcast_json(&second).await.unwrap(), 1);

    assert_eq!(read_json_text_frame(&mut client).await, first);
    assert_eq!(read_json_text_frame(&mut client).await, second);

    send_client_frame(&mut client, 0x8, &[0x03, 0xe8]).await;
    timeout(Duration::from_secs(2), async {
        while hub.broadcast_json(&first).await.unwrap() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("closed socket receiver is removed from the hub");
    let mut reconnected_client = timeout(Duration::from_secs(2), connect(address))
        .await
        .expect("second client completes the WebSocket handshake")
        .unwrap();
    let slow_client_event = cache_updated(18, 5, "2026-09-25T12:02:00+00:00");
    timeout(Duration::from_secs(2), async {
        while hub.broadcast_json(&slow_client_event).await.unwrap() != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("new client is registered before its first broadcast");
    assert_eq!(
        read_json_text_frame(&mut reconnected_client).await,
        slow_client_event
    );

    send_client_frame(&mut reconnected_client, 0x8, &[0x03, 0xe8]).await;
    wait_for_unsubscribe(&hub, &slow_client_event).await;
    assert_eq!(hub.broadcast_json(&first).await.unwrap(), 0);

    server.shutdown().await;
}
#[tokio::test]
async fn websocket_disconnects_binary_and_oversized_messages() {
    let hub = WebSocketHub::new();
    let (address, server) = start_server(hub.clone()).await;
    let ready = json!({"type": "ready"});

    let mut binary_client = connect_registered(address, &hub, &ready).await;
    send_client_frame(&mut binary_client, 0x2, b"binary input").await;
    wait_for_disconnect(&mut binary_client).await;
    wait_for_unsubscribe(&hub, &ready).await;

    let mut oversized_client = connect_registered(address, &hub, &ready).await;
    {
        let at_limit = vec![b'x'; UVICORN_MAX_MESSAGE_SIZE];
        send_client_frame(&mut oversized_client, 0x1, &at_limit).await;
    }
    send_client_frame(&mut oversized_client, 0x9, b"message-limit-probe").await;
    let (opcode, payload) = timeout(
        Duration::from_secs(10),
        read_server_frame(&mut oversized_client),
    )
    .await
    .expect("message at the configured limit is accepted")
    .unwrap();
    assert_eq!(opcode, 0x0a);
    assert_eq!(payload.as_slice(), b"message-limit-probe");
    let boundary_event = json!({"type": "at_limit"});
    assert_eq!(hub.broadcast_json(&boundary_event).await.unwrap(), 1);
    assert_eq!(
        read_json_text_frame(&mut oversized_client).await,
        boundary_event
    );

    // The server rejects an over-limit frame from its declared length and
    // closes, so writing the full payload would race the close with a reset.
    send_client_frame_header(
        &mut oversized_client,
        0x1,
        (UVICORN_MAX_MESSAGE_SIZE + 1) as u64,
    )
    .await;
    let (opcode, payload) = timeout(
        Duration::from_secs(10),
        read_server_frame(&mut oversized_client),
    )
    .await
    .expect("over-limit input is rejected")
    .unwrap();
    assert_eq!(opcode, 0x8, "over-limit input receives a close frame");
    assert!(payload.len() >= 2);
    assert_eq!(u16::from_be_bytes([payload[0], payload[1]]), 1009);
    wait_for_unsubscribe(&hub, &ready).await;

    server.shutdown().await;
}

#[tokio::test]
async fn websocket_fans_out_events_in_order_to_each_connection() {
    let hub = WebSocketHub::new();
    let (address, server) = start_server(hub.clone()).await;
    let ready = json!({"type": "ready"});
    let mut first = connect_registered(address, &hub, &ready).await;
    let mut second = timeout(Duration::from_secs(2), connect(address))
        .await
        .expect("second client completes the WebSocket handshake")
        .unwrap();

    let probe = json!({"type": "registration_probe"});
    timeout(Duration::from_secs(2), async {
        loop {
            match hub.broadcast_json(&probe).await.unwrap() {
                0 => tokio::task::yield_now().await,
                1 => assert_eq!(read_json_text_frame(&mut first).await, probe),
                2 => break,
                subscribers => panic!("unexpected subscriber count: {subscribers}"),
            }
        }
    })
    .await
    .expect("second connection becomes a broadcast subscriber");
    assert_eq!(read_json_text_frame(&mut first).await, probe);
    assert_eq!(read_json_text_frame(&mut second).await, probe);

    let first_event = json!({"type": "ordered", "sequence": 1});
    let second_event = json!({"type": "ordered", "sequence": 2});
    assert_eq!(hub.broadcast_json(&first_event).await.unwrap(), 2);
    assert_eq!(hub.broadcast_json(&second_event).await.unwrap(), 2);
    assert_eq!(read_json_text_frame(&mut first).await, first_event);
    assert_eq!(read_json_text_frame(&mut first).await, second_event);
    assert_eq!(read_json_text_frame(&mut second).await, first_event);
    assert_eq!(read_json_text_frame(&mut second).await, second_event);

    send_client_frame(&mut first, 0x8, &[0x03, 0xe8]).await;
    send_client_frame(&mut second, 0x8, &[0x03, 0xe8]).await;
    wait_for_unsubscribe(&hub, &ready).await;
    server.shutdown().await;
}

#[tokio::test]
async fn websocket_does_not_replay_and_disconnect_releases_subscription() {
    let hub = WebSocketHub::new();
    let stale = json!({"type": "stale"});
    assert_eq!(hub.broadcast_json(&stale).await.unwrap(), 0);

    let (address, server) = start_server(hub.clone()).await;
    let ready = json!({"type": "ready"});
    let mut client = connect_registered(address, &hub, &ready).await;
    assert!(
        timeout(Duration::from_millis(100), client.read_u8())
            .await
            .is_err(),
        "events published before subscription are not replayed"
    );

    client.get_mut().shutdown().await.unwrap();
    wait_for_disconnect(&mut client).await;
    wait_for_unsubscribe(&hub, &ready).await;
    server.shutdown().await;
}

#[tokio::test]
async fn websocket_ignores_fragmented_text_and_handles_interleaved_ping() {
    let hub = WebSocketHub::new();
    let (address, server) = start_server(hub.clone()).await;
    let ready = json!({"type": "ready"});
    let mut client = connect_registered(address, &hub, &ready).await;

    send_client_frame_with_fin(&mut client, false, 0x1, b"fragment ").await;
    send_client_frame(&mut client, 0x9, b"interleaved ping").await;
    let (opcode, payload) = read_server_frame(&mut client).await.unwrap();
    assert_eq!(opcode, 0x0a);
    assert_eq!(payload.as_slice(), b"interleaved ping");
    send_client_frame_with_fin(&mut client, true, 0x0, b"message").await;

    assert!(
        timeout(Duration::from_millis(100), client.read_u8())
            .await
            .is_err(),
        "fragmented inbound text is ignored after reassembly"
    );
    let event = json!({"type": "after_fragment"});
    assert_eq!(hub.broadcast_json(&event).await.unwrap(), 1);
    assert_eq!(read_json_text_frame(&mut client).await, event);

    server.shutdown().await;
}

#[tokio::test]
async fn websocket_serialization_error_does_not_enqueue_a_frame() {
    let hub = WebSocketHub::new();
    let (address, server) = start_server(hub.clone()).await;
    let ready = json!({"type": "ready"});
    let mut client = connect_registered(address, &hub, &ready).await;

    assert!(hub.broadcast_json(&FailingEvent).await.is_err());
    assert!(
        timeout(Duration::from_millis(100), client.read_u8())
            .await
            .is_err(),
        "serialization failure does not enqueue any message"
    );

    let event = json!({"type": "after_error"});
    assert_eq!(hub.broadcast_json(&event).await.unwrap(), 1);
    assert_eq!(read_json_text_frame(&mut client).await, event);

    server.shutdown().await;
}

struct FailingEvent;

impl serde::Serialize for FailingEvent {
    fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        Err(<S::Error as serde::ser::Error>::custom(
            "intentional test serialization failure",
        ))
    }
}

fn cache_updated(total_articles: u64, sources_processed: u64, timestamp: &str) -> Value {
    json!({
        "type": "cache_updated",
        "message": "News cache has been updated",
        "timestamp": timestamp,
        "stats": {
            "total_articles": total_articles,
            "sources_processed": sources_processed,
        },
    })
}

async fn connect(address: SocketAddr) -> Result<BufReader<TcpStream>, std::io::Error> {
    let stream = TcpStream::connect(address).await?;
    let mut client = BufReader::new(stream);
    let request = format!(
        "GET /ws HTTP/1.1\r\n\
Host: {address}\r\n\
Upgrade: websocket\r\n\
Connection: Upgrade\r\n\
Sec-WebSocket-Key: {RFC6455_KEY}\r\n\
Sec-WebSocket-Version: 13\r\n\
\r\n"
    );
    client.get_mut().write_all(request.as_bytes()).await?;

    let mut headers = String::new();
    loop {
        let mut line = String::new();
        if client.read_line(&mut line).await? == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "connection closed before the WebSocket response completed",
            ));
        }
        headers.push_str(&line);
        if line == "\r\n" {
            break;
        }
    }
    assert!(headers.starts_with("HTTP/1.1 101"), "{headers}");
    // Header names are case-insensitive; the base64 accept value is not.
    let accept = headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("sec-websocket-accept")
            .then(|| value.trim())
    });
    assert_eq!(accept, Some(RFC6455_ACCEPT), "{headers}");
    Ok(client)
}

async fn connect_registered(
    address: SocketAddr,
    hub: &WebSocketHub,
    event: &Value,
) -> BufReader<TcpStream> {
    let mut client = timeout(Duration::from_secs(2), connect(address))
        .await
        .expect("ephemeral Axum listener accepts the handshake")
        .unwrap();
    timeout(Duration::from_secs(2), async {
        while hub.broadcast_json(event).await.unwrap() != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("client is registered before the first broadcast");
    assert_eq!(read_json_text_frame(&mut client).await, event.clone());
    client
}

async fn wait_for_disconnect(client: &mut BufReader<TcpStream>) {
    let mut byte = [0];
    assert_eq!(
        timeout(Duration::from_secs(2), client.read(&mut byte))
            .await
            .expect("server disconnects the client")
            .unwrap(),
        0
    );
}

async fn wait_for_unsubscribe(hub: &WebSocketHub, event: &Value) {
    timeout(Duration::from_secs(2), async {
        while hub.broadcast_json(event).await.unwrap() != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("disconnected client is removed from the hub");
}

async fn send_client_frame(client: &mut BufReader<TcpStream>, opcode: u8, payload: &[u8]) {
    send_client_frame_with_fin(client, true, opcode, payload).await;
}

/// Client frame header, including the mask key, for a payload of `length` bytes.
fn masked_frame_header(fin: bool, opcode: u8, length: u64) -> Vec<u8> {
    let mut header = vec![(if fin { 0x80 } else { 0 }) | (opcode & 0x0f)];
    match length {
        0..=125 => header.push(0x80 | length as u8),
        126..=65_535 => {
            header.push(0x80 | 126);
            header.extend_from_slice(&(length as u16).to_be_bytes());
        }
        _ => {
            header.push(0x80 | 127);
            header.extend_from_slice(&length.to_be_bytes());
        }
    }
    header.extend_from_slice(&MASK);
    header
}

/// Send only a frame header that declares `length` payload bytes.
async fn send_client_frame_header(client: &mut BufReader<TcpStream>, opcode: u8, length: u64) {
    let header = masked_frame_header(true, opcode, length);
    client.get_mut().write_all(&header).await.unwrap();
}

async fn send_client_frame_with_fin(
    client: &mut BufReader<TcpStream>,
    fin: bool,
    opcode: u8,
    payload: &[u8],
) {
    const CHUNK_SIZE: usize = 8 * 1024;

    let header = masked_frame_header(fin, opcode, payload.len() as u64);
    client.get_mut().write_all(&header).await.unwrap();

    let mut masked = [0; CHUNK_SIZE];
    for (chunk_index, chunk) in payload.chunks(CHUNK_SIZE).enumerate() {
        let offset = chunk_index * CHUNK_SIZE;
        for (index, byte) in chunk.iter().enumerate() {
            masked[index] = byte ^ MASK[(offset + index) % MASK.len()];
        }
        client
            .get_mut()
            .write_all(&masked[..chunk.len()])
            .await
            .unwrap();
    }
}

async fn read_server_frame(
    client: &mut BufReader<TcpStream>,
) -> Result<(u8, Vec<u8>), std::io::Error> {
    let mut header = [0; 2];
    client.read_exact(&mut header).await?;
    if header[1] & 0x80 != 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "server frame must not be masked",
        ));
    }

    let payload_length = match header[1] & 0x7f {
        length @ 0..=125 => u64::from(length),
        126 => {
            let mut extended = [0; 2];
            client.read_exact(&mut extended).await?;
            u64::from(u16::from_be_bytes(extended))
        }
        127 => {
            let mut extended = [0; 8];
            client.read_exact(&mut extended).await?;
            u64::from_be_bytes(extended)
        }
        _ => unreachable!(),
    };
    let payload_length = usize::try_from(payload_length).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "server frame payload is too large",
        )
    })?;
    let mut payload = vec![0; payload_length];
    client.read_exact(&mut payload).await?;
    Ok((header[0] & 0x0f, payload))
}

async fn read_json_text_frame(client: &mut BufReader<TcpStream>) -> Value {
    let (opcode, payload) = read_server_frame(client).await.unwrap();
    assert_eq!(opcode, 0x1, "expected a server text frame");
    serde_json::from_slice(&payload).unwrap()
}
