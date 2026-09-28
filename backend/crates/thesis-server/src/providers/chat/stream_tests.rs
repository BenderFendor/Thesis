mod tests {
    use super::super::tests::request;
    use super::super::{
        ChatBackend, ChatClientError, ChatCompletionClient, ChatConfiguration, ChatStreamEvent,
        OPENROUTER_DEFAULT_MODEL,
    };
    use futures_util::StreamExt;
    use serde_json::{json, Value};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;
    use std::sync::mpsc::{self, Receiver};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;
    fn stream_client(base_url: &str) -> (ChatCompletionClient, PathBuf) {
        let log_directory = std::env::temp_dir().join(format!(
            "thesis-chat-stream-{}-{}",
            std::process::id(),
            super::super::super::llm_logs::next_request_id()
        ));
        let configuration = ChatConfiguration {
            backend: ChatBackend::LlamaCpp,
            base_url: base_url.to_owned(),
            api_key: String::new(),
            model: "configured-model".to_owned(),
            openrouter_model: OPENROUTER_DEFAULT_MODEL.to_owned(),
            timeout: Duration::from_secs(5),
        };
        let client = ChatCompletionClient::new(
            reqwest::Client::builder()
                .no_proxy()
                .build()
                .expect("test HTTP client"),
            configuration,
            super::super::super::llm_logs::LlmCallLogger::for_session_directory(
                log_directory.clone(),
            ),
        );
        (client, log_directory)
    }

    fn start_sse_server(
        chunks: Vec<String>,
        leave_incomplete: bool,
    ) -> (
        String,
        Receiver<String>,
        Receiver<()>,
        JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback fixture");
        let address = listener.local_addr().expect("fixture address");
        let (request_sender, request_receiver) = mpsc::channel();
        let (disconnect_sender, disconnect_receiver) = mpsc::channel();
        let worker = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept chat request");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("set fixture read timeout");
            request_sender
                .send(read_http_request(&mut stream))
                .expect("send captured request");

            let body_length = chunks.iter().map(String::len).sum::<usize>();
            let content_length = if leave_incomplete {
                body_length.saturating_add(1_000_000)
            } else {
                body_length
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {content_length}\r\nConnection: close\r\n\r\n"
            )
            .expect("write fixture response headers");
            for chunk in chunks {
                stream
                    .write_all(chunk.as_bytes())
                    .expect("write SSE fixture chunk");
                stream.flush().expect("flush SSE fixture chunk");
            }

            if leave_incomplete {
                let mut buffer = [0; 1024];
                loop {
                    match stream.read(&mut buffer) {
                        Ok(0) => {
                            let _ = disconnect_sender.send(());
                            break;
                        }
                        Ok(_) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    }
                }
            }
        });
        (
            format!("http://{address}/v1"),
            request_receiver,
            disconnect_receiver,
            worker,
        )
    }

    fn read_http_request(stream: &mut TcpStream) -> String {
        let mut request = Vec::new();
        let mut buffer = [0; 4096];
        let mut body_start = None;
        let mut content_length = 0;
        loop {
            let bytes_read = stream.read(&mut buffer).expect("read request bytes");
            assert_ne!(bytes_read, 0, "client closed before sending the request");
            request.extend_from_slice(&buffer[..bytes_read]);
            if body_start.is_none() {
                if let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    content_length = headers
                        .lines()
                        .filter_map(|line| line.split_once(':'))
                        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                        .unwrap_or_default();
                    body_start = Some(header_end + 4);
                }
            }
            if body_start.is_some_and(|start| request.len() >= start + content_length) {
                return String::from_utf8_lossy(&request).into_owned();
            }
        }
    }

    fn request_json(request: &str) -> Value {
        let body = request
            .split_once("\r\n\r\n")
            .map(|(_, body)| body)
            .expect("HTTP request body separator");
        serde_json::from_str(body).expect("request JSON")
    }

    fn read_json_lines(path: PathBuf) -> Vec<Value> {
        std::fs::read_to_string(path)
            .expect("JSONL log")
            .lines()
            .map(|line| serde_json::from_str(line).expect("valid JSONL row"))
            .collect()
    }
    #[tokio::test]
    async fn stream_decodes_multiline_sse_and_reassembles_tool_call_fragments() {
        let (base_url, requests, _, server) = start_sse_server(
            vec![
                "data: {\"id\":\"response-1\",\"choices\":[{\"delta\":\n".to_owned(),
                "data: {\"content\":\"Hel\",\"reasoning\":\"private thought\"},\"finish_reason\":null}]}\n\n".to_owned(),
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"search_\",\"arguments\":\"{\\\"query\\\":\"}}]},\"finish_reason\":null}]}\n\n".to_owned(),
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"articles\",\"arguments\":\"\\\"climate\\\"}\"}}]},\"finish_reason\":null}]}\n\n".to_owned(),
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n".to_owned(),
                "data: [DONE]\n\n".to_owned(),
            ],
            false,
        );
        let (client, log_directory) = stream_client(&base_url);
        let mut request = request("llamacpp");
        request.model = "explicit-stream-model".to_owned();
        let events = client
            .stream(request)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<Result<Vec<_>, _>>()
            .expect("SSE stream");

        assert_eq!(events.len(), 4);
        assert_eq!(
            events[0],
            ChatStreamEvent::ContentDelta {
                message_id: Some("response-1".to_owned()),
                content: "Hel".to_owned(),
                reasoning: "private thought".to_owned(),
            }
        );
        assert!(matches!(
            &events[1],
            ChatStreamEvent::ToolCallDelta {
                index: 0,
                name: Some(name),
                arguments,
                ..
            } if name == "search_" && arguments == "{\"query\":"
        ));
        assert!(matches!(
            &events[2],
            ChatStreamEvent::ToolCallDelta {
                index: 0,
                name: Some(name),
                arguments,
                ..
            } if name == "articles" && arguments == "\"climate\"}"
        ));
        assert!(matches!(
            &events[3],
            ChatStreamEvent::Finished { finish_reason, tool_calls }
                if finish_reason.as_deref() == Some("tool_calls")
                    && tool_calls.len() == 1
                    && tool_calls[0].id == "call-1"
                    && tool_calls[0].name == "search_articles"
                    && tool_calls[0].arguments == json!({"query": "climate"})
        ));

        let captured = requests
            .recv_timeout(Duration::from_secs(2))
            .expect("server captured request");
        let body = request_json(&captured);
        assert_eq!(body["model"], "explicit-stream-model");
        assert_eq!(body["stream"], true);
        server.join().expect("server thread");
        drop(client);
        std::fs::remove_dir_all(log_directory).expect("remove stream log directory");
    }

    #[tokio::test]
    async fn stream_eof_emits_finished_event_without_done_sentinel() {
        let (base_url, requests, _, server) = start_sse_server(
            vec!["data: {\"choices\":[{\"delta\":{\"content\":\"answer\"},\"finish_reason\":\"stop\"}]}".to_owned()],
            false,
        );
        let (client, log_directory) = stream_client(&base_url);
        let events = client
            .stream(request("llamacpp"))
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect::<Result<Vec<_>, _>>()
            .expect("EOF is a normal stream finish");

        assert!(matches!(
            events.as_slice(),
            [
                ChatStreamEvent::ContentDelta { content, .. },
                ChatStreamEvent::Finished { finish_reason, tool_calls }
            ] if content == "answer" && finish_reason.as_deref() == Some("stop") && tool_calls.is_empty()
        ));
        requests
            .recv_timeout(Duration::from_secs(2))
            .expect("server captured request");
        server.join().expect("server thread");
        drop(client);
        std::fs::remove_dir_all(log_directory).expect("remove stream log directory");
    }

    #[tokio::test]
    async fn malformed_sse_is_reported_and_logged_as_a_failed_call() {
        let (base_url, requests, _, server) =
            start_sse_server(vec!["data: not-json\n\n".to_owned()], false);
        let (client, log_directory) = stream_client(&base_url);
        let mut stream = client.stream(request("llamacpp"));

        assert_eq!(
            stream.next().await.expect("malformed frame event").unwrap_err(),
            ChatClientError::InvalidResponse
        );
        requests
            .recv_timeout(Duration::from_secs(2))
            .expect("server captured request");
        server.join().expect("server thread");
        let calls = read_json_lines(log_directory.join("llm_calls.log"));
        let errors = read_json_lines(log_directory.join("api_errors.log"));
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["success"], false);
        assert_eq!(calls[0]["error_type"], "InvalidResponse");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0]["error_type"], "InvalidResponse");
        drop(stream);
        drop(client);
        std::fs::remove_dir_all(log_directory).expect("remove stream log directory");
    }

    #[tokio::test]
    async fn dropping_live_stream_cancels_request_and_logs_cancellation() {
        let (base_url, requests, disconnected, server) = start_sse_server(
            vec!["data: {\"choices\":[{\"delta\":{\"content\":\"first\"},\"finish_reason\":null}]}\n\n".to_owned()],
            true,
        );
        let (client, log_directory) = stream_client(&base_url);
        let mut stream = client.stream(request("llamacpp"));

        assert!(matches!(
            stream.next().await.expect("first delta").expect("SSE event"),
            ChatStreamEvent::ContentDelta { content, .. } if content == "first"
        ));
        requests
            .recv_timeout(Duration::from_secs(2))
            .expect("server captured request");
        drop(stream);
        disconnected
            .recv_timeout(Duration::from_secs(3))
            .expect("dropping stream closes upstream connection");
        server.join().expect("server thread");

        let calls = read_json_lines(log_directory.join("llm_calls.log"));
        let errors = read_json_lines(log_directory.join("api_errors.log"));
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["success"], false);
        assert_eq!(calls[0]["error_type"], "Cancelled");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0]["error_type"], "Cancelled");
        drop(client);
        std::fs::remove_dir_all(log_directory).expect("remove stream log directory");
    }
}
