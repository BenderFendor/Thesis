use std::collections::BTreeSet;
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use reqwest::header::{
    ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE, LOCATION, HeaderMap, HeaderValue,
    USER_AGENT as USER_AGENT_HEADER,
};
use reqwest::redirect::Policy;
use reqwest::{Client, StatusCode, Url};
use tokio::net::lookup_host;
use tokio::time;

const DEFAULT_USER_AGENT: &str = "ThesisRustShadow/0.1";

/// A generic, DNS-pinned HTTP fetcher for caller-supplied URLs.
///
/// The shared `ProviderClients::http` client is reserved for configured upstream
/// endpoints. This transport rebuilds a client for each DNS-pinned redirect hop.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct SafeHttpFetcher;

#[derive(Debug)]
pub(crate) struct SafeHttpResponse {
    pub(crate) status: StatusCode,
    pub(crate) headers: HeaderMap,
    pub(crate) body: Vec<u8>,
    pub(crate) final_url: String,
    pub(crate) resolved_addresses: Vec<IpAddr>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SafeHttpError {
    InvalidUrl,
    UnsafeAddress,
    Resolve,
    Timeout,
    RedirectLimit,
    Request,
    UnsupportedContentType,
    BodyTooLarge,
}

impl fmt::Display for SafeHttpError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidUrl => "URL must be an HTTP(S) URL without credentials or an IP literal",
            Self::UnsafeAddress => "URL resolved to a private or reserved network address",
            Self::Resolve => "URL host could not be resolved safely",
            Self::Timeout => "safe HTTP request timed out",
            Self::RedirectLimit => "safe HTTP redirect limit exceeded",
            Self::Request => "safe HTTP request failed",
            Self::UnsupportedContentType => "safe HTTP response content type is not allowed",
            Self::BodyTooLarge => "safe HTTP response exceeded its byte limit",
        })
    }
}

impl std::error::Error for SafeHttpError {}

impl SafeHttpFetcher {
    pub(crate) fn new() -> Self {
        Self
    }

    /// Fetch an untrusted HTTP(S) URL with DNS pinning and caller-bounded policy.
    ///
    /// `Some(&[...])` requires a normalized media-type match; `None` skips only this check.
    pub(crate) async fn fetch(
        &self,
        url: &str,
        timeout: Duration,
        max_redirects: u8,
        max_bytes: usize,
        allowed_content_types: Option<&[&str]>,
    ) -> Result<SafeHttpResponse, SafeHttpError> {
        self.fetch_with_user_agent(
            url,
            timeout,
            max_redirects,
            max_bytes,
            allowed_content_types,
            DEFAULT_USER_AGENT,
        )
        .await
    }

    /// Fetch an untrusted URL with the same DNS-pinned policy and one caller-selected User-Agent.
    pub(crate) async fn fetch_with_user_agent(
        &self,
        url: &str,
        timeout: Duration,
        max_redirects: u8,
        max_bytes: usize,
        allowed_content_types: Option<&[&str]>,
        user_agent: &str,
    ) -> Result<SafeHttpResponse, SafeHttpError> {
        if allowed_content_types.is_some_and(<[&str]>::is_empty) {
            return Err(SafeHttpError::UnsupportedContentType);
        }
        let user_agent = user_agent_header(user_agent)?;

        let mut current_url = parse_http_url(url)?;
        let mut redirect_count = 0_u8;
        let mut all_resolved_addresses = Vec::new();

        loop {
            let (host, port) = host_and_port(&current_url)?;
            let socket_addresses = resolve_public_addresses(host, port, timeout).await?;
            all_resolved_addresses.extend(socket_addresses.iter().map(SocketAddr::ip));

            let client = Client::builder()
                .no_proxy()
                .redirect(Policy::none())
                .connect_timeout(timeout)
                .timeout(timeout)
                .resolve_to_addrs(host, &socket_addresses)
                .build()
                .map_err(|error| map_reqwest_error(&error))?;
            let response = client
                .get(current_url.clone())
                .header(ACCEPT_ENCODING, HeaderValue::from_static("identity"))
                .header(USER_AGENT_HEADER, user_agent.clone())
                .send()
                .await
                .map_err(|error| map_reqwest_error(&error))?;

            if response.status().is_redirection() {
                if let Some(location) = response.headers().get(LOCATION) {
                    if redirect_count >= max_redirects {
                        return Err(SafeHttpError::RedirectLimit);
                    }
                    let location = location
                        .to_str()
                        .map_err(|_| SafeHttpError::InvalidUrl)?;
                    let redirected_url = current_url
                        .join(location)
                        .map_err(|_| SafeHttpError::InvalidUrl)?;
                    current_url = parse_http_url(redirected_url.as_str())?;
                    redirect_count += 1;
                    continue;
                }
            }

            validate_content_type(response.headers(), allowed_content_types)?;
            if response
                .content_length()
                .is_some_and(|length| length > max_bytes as u64)
                || response
                    .headers()
                    .get(CONTENT_LENGTH)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .is_some_and(|length| length > max_bytes as u64)
            {
                return Err(SafeHttpError::BodyTooLarge);
            }

            let status = response.status();
            let headers = response.headers().clone();
            let capacity = response
                .content_length()
                .and_then(|length| usize::try_from(length).ok())
                .map_or(max_bytes.min(4096), |length| length.min(max_bytes));
            let mut body = Vec::with_capacity(capacity);
            let mut response = response;
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|error| map_reqwest_error(&error))?
            {
                if body
                    .len()
                    .checked_add(chunk.len())
                    .is_none_or(|length| length > max_bytes)
                {
                    return Err(SafeHttpError::BodyTooLarge);
                }
                body.extend_from_slice(&chunk);
            }

            all_resolved_addresses.sort_unstable();
            all_resolved_addresses.dedup();
            return Ok(SafeHttpResponse {
                status,
                headers,
                body,
                final_url: current_url.to_string(),
                resolved_addresses: all_resolved_addresses,
            });
        }
    }
}

fn parse_http_url(value: &str) -> Result<Url, SafeHttpError> {
    let url = Url::parse(value).map_err(|_| SafeHttpError::InvalidUrl)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url
            .host_str()
            .is_some_and(|host| host.parse::<IpAddr>().is_ok())
    {
        return Err(SafeHttpError::InvalidUrl);
    }
    Ok(url)
}

fn host_and_port(url: &Url) -> Result<(&str, u16), SafeHttpError> {
    Ok((
        url.host_str().ok_or(SafeHttpError::InvalidUrl)?,
        url.port_or_known_default().ok_or(SafeHttpError::InvalidUrl)?,
    ))
}

async fn resolve_public_addresses(
    host: &str,
    port: u16,
    timeout: Duration,
) -> Result<Vec<SocketAddr>, SafeHttpError> {
    let resolved = time::timeout(timeout, lookup_host((host, port)))
        .await
        .map_err(|_| SafeHttpError::Timeout)?
        .map_err(|_| SafeHttpError::Resolve)?;
    let addresses = resolved.collect::<BTreeSet<_>>().into_iter().collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(SafeHttpError::UnsafeAddress);
    }
    Ok(addresses)
}

fn validate_content_type(
    headers: &HeaderMap,
    allowed_content_types: Option<&[&str]>,
) -> Result<(), SafeHttpError> {
    let Some(allowed_content_types) = allowed_content_types else {
        return Ok(());
    };
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(SafeHttpError::UnsupportedContentType)?;
    if allowed_content_types
        .iter()
        .any(|allowed| content_type.eq_ignore_ascii_case(allowed.trim()))
    {
        Ok(())
    } else {
        Err(SafeHttpError::UnsupportedContentType)
    }
}

fn map_reqwest_error(error: &reqwest::Error) -> SafeHttpError {
    if error.is_timeout() {
        SafeHttpError::Timeout
    } else {
        SafeHttpError::Request
    }
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let [first, second, third, _] = address.octets();
    !(first == 0
        || first == 10
        || first == 100 && (64..=127).contains(&second)
        || first == 127
        || first == 169 && second == 254
        || first == 172 && (16..=31).contains(&second)
        || first == 192 && (second == 0 || second == 168)
        || first == 192 && second == 88 && third == 99
        || first == 192 && second == 175 && third == 48
        || first == 198 && (18..=51).contains(&second)
        || first == 203 && second == 0 && third == 113
        || first >= 224)
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    let first = segments[0];
    let is_ipv4_mapped = segments[..5].iter().all(|segment| *segment == 0) && segments[5] == 0xffff;
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || (first & 0xfe00 == 0xfc00)
        || (first & 0xffc0 == 0xfe80)
        || first & 0xe000 != 0x2000
        || first == 0x2001 && segments[1] <= 0x01ff
        || first == 0x2002
        || first == 0x3fff
        || is_ipv4_mapped)
}

fn user_agent_header(value: &str) -> Result<HeaderValue, SafeHttpError> {
    HeaderValue::from_bytes(value.as_bytes()).map_err(|_| SafeHttpError::Request)
}

#[cfg(test)]
mod tests {
    use std::net::IpAddr;

    use reqwest::header::{HeaderMap, CONTENT_TYPE, USER_AGENT};

    use super::{
        is_public_ip, parse_http_url, user_agent_header, validate_content_type, SafeHttpError,
    };

    #[test]
    fn rejects_non_http_credentials_and_ip_literal_urls() {
        for url in [
            "file:///etc/passwd",
            "http://user:password@example.com/feed.xml",
            "http://127.0.0.1/feed.xml",
            "http://[::1]/feed.xml",
        ] {
            assert_eq!(parse_http_url(url), Err(SafeHttpError::InvalidUrl));
        }
        assert!(parse_http_url("https://example.com/feed.xml").is_ok());
    }

    #[test]
    fn denies_private_reserved_and_mapped_addresses() {
        for address in [
            "0.0.0.0",
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "192.0.2.1",
            "192.168.0.1",
            "198.18.0.1",
            "203.0.113.1",
            "224.0.0.1",
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "2002::1",
            "ff02::1",
        ] {
            let address = address.parse::<IpAddr>().expect("valid fixture address");
            assert!(!is_public_ip(address), "unexpectedly public: {address}");
        }
        for address in ["1.1.1.1", "2606:4700:4700::1111"] {
            let address = address.parse::<IpAddr>().expect("valid public fixture address");
            assert!(is_public_ip(address), "unexpectedly rejected: {address}");
        }
    }

    #[test]
    fn content_type_policy_is_optional_only_when_explicitly_requested() {
        let mut valid = HeaderMap::new();
        valid.insert(CONTENT_TYPE, "Text/HTML; charset=utf-8".parse().expect("header"));
        let missing = HeaderMap::new();
        let mut unexpected = HeaderMap::new();
        unexpected.insert(CONTENT_TYPE, "application/json".parse().expect("header"));

        assert!(validate_content_type(&valid, Some(&["text/html"])).is_ok());
        assert_eq!(
            validate_content_type(&missing, Some(&["text/html"])),
            Err(SafeHttpError::UnsupportedContentType)
        );
        assert_eq!(
            validate_content_type(&unexpected, Some(&["text/html"])),
            Err(SafeHttpError::UnsupportedContentType)
        );
        assert!(validate_content_type(&valid, None).is_ok());
        assert!(validate_content_type(&missing, None).is_ok());
        assert!(validate_content_type(&unexpected, None).is_ok());
        assert_eq!(
            validate_content_type(&missing, Some(&[])),
            Err(SafeHttpError::UnsupportedContentType)
        );
    }

    #[test]
    fn request_user_agent_is_a_single_valid_header() {
        let user_agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
        let header = user_agent_header(user_agent).expect("valid User-Agent");
        let request = reqwest::Client::new()
            .get("https://example.test/article")
            .header(USER_AGENT, header)
            .build()
            .expect("request with User-Agent");

        assert_eq!(request.headers().get(USER_AGENT).unwrap(), user_agent);
        assert_eq!(
            user_agent_header("Mozilla/5.0\r\nX-Injected: true"),
            Err(SafeHttpError::Request)
        );
    }
}
