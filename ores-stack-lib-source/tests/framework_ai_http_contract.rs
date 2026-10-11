//! Real loopback HTTP boundary checks (the in-memory answer verifier is insufficient).
use ores_stack_lib_core::{FrameworkAiClient, FrameworkAiError, FrameworkAiPolicy, FrameworkAiQuery, ReleaseRef};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

fn release() -> ReleaseRef {
    ReleaseRef {
        version: "0.1.0".to_owned(),
        git_sha: "a".repeat(40),
        channel: Some("stable".to_owned()),
    }
}

fn run_once(response: Vec<u8>, case: impl FnOnce(FrameworkAiClient) -> Result<(), FrameworkAiError>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback listener");
    let endpoint = format!("http://{}", listener.local_addr().expect("local address"));
    let server = thread::spawn(move || {
        let (mut conn, _) = listener.accept().expect("accept request");
        conn.set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .expect("request read timeout");
        let mut buffer = [0_u8; 8192];
        let received = conn.read(&mut buffer).expect("read HTTP request");
        assert!(String::from_utf8_lossy(&buffer[..received]).contains("/v1/framework-ai/query"));
        // The client may terminate early after Content-Length; EPIPE is fine here.
        let _ = conn.write_all(&response);
    });
    let client = FrameworkAiClient::new(FrameworkAiPolicy::strict(endpoint, release()));
    let outcome = case(client);
    server.join().expect("mock HTTP server thread");
    outcome.expect("expected fail-closed behavior");
}

fn query(client: FrameworkAiClient) -> Result<FrameworkAiError, FrameworkAiError> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("single-threaded Tokio executor");
    match runtime.block_on(client.query(FrameworkAiQuery::new(release(), "explain policy"))) {
        Ok(_) => Err(FrameworkAiError::Schema("request unexpectedly succeeded".into())),
        Err(err) => Ok(err),
    }
}

#[test]
fn redirect_cannot_forward_query_to_an_untrusted_location() {
    run_once(
        b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/untrusted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
        |client| {
            assert!(matches!(query(client)?, FrameworkAiError::Http(status) if status.as_u16() == 302));
            Ok(())
        },
    );
}

#[test]
fn content_length_above_limit_is_rejected_before_parsing() {
    run_once(
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2097153\r\nConnection: close\r\n\r\n".to_vec(),
        |client| {
            assert!(matches!(query(client)?, FrameworkAiError::ResponseTooLarge));
            Ok(())
        },
    );
}

#[test]
fn chunked_body_exceeding_limit_is_rejected_even_without_content_length() {
    let chunk = vec![b'x'; 2 * 1024 * 1024 + 1];
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n",
        chunk.len()
    )
    .into_bytes();
    response.extend_from_slice(&chunk);
    response.extend_from_slice(b"\r\n0\r\n\r\n");
    run_once(response, |client| {
        assert!(matches!(query(client)?, FrameworkAiError::ResponseTooLarge));
        Ok(())
    });
}

#[test]
fn malformed_json_is_not_accepted_as_an_answer() {
    run_once(
        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 7\r\nConnection: close\r\n\r\ninvalid".to_vec(),
        |client| {
            assert!(matches!(query(client)?, FrameworkAiError::Schema(_)));
            Ok(())
        },
    );
}
