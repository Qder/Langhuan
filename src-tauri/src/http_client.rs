//! Shared outbound HTTP for Android/desktop native calls (explain + updater).
//! No API keys, no extra hosts: callers pass the URL.

use std::time::Duration;

/// Android: prefer A records. Broken IPv6 on some tablets black-holes until timeout.
#[cfg(target_os = "android")]
mod android_dns {
    use reqwest::dns::{Addrs, Name, Resolve, Resolving};
    use std::net::ToSocketAddrs;
    use std::sync::Arc;

    pub struct Ipv4First;

    pub fn resolver() -> Arc<Ipv4First> {
        Arc::new(Ipv4First)
    }

    impl Resolve for Ipv4First {
        fn resolve(&self, name: Name) -> Resolving {
            let host = name.as_str().trim_end_matches('.').to_owned();
            Box::pin(async move {
                let lookup = host.clone();
                let mut addrs = tauri::async_runtime::spawn_blocking(move || {
                    (lookup.as_str(), 443)
                        .to_socket_addrs()
                        .map(|i| i.collect::<Vec<_>>())
                })
                .await
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?
                .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;
                addrs.sort_by_key(|a| a.is_ipv6());
                let iter: Addrs = Box::new(addrs.into_iter());
                Ok(iter)
            })
        }
    }
}

const UA: &str = "Langhuan/0.1 (+https://github.com/Qder/Langhuan)";

/// Do not set `read_timeout`: waiting for headers counts as a read.
pub fn outbound_http_client(
    connect_timeout: Duration,
    timeout: Duration,
) -> Result<reqwest::Client, String> {
    let http = reqwest::Client::builder()
        .connect_timeout(connect_timeout)
        .timeout(timeout)
        .tcp_nodelay(true)
        .pool_max_idle_per_host(0)
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent(UA);
    #[cfg(target_os = "android")]
    let http = http.http1_only().dns_resolver(android_dns::resolver());
    http.build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))
}
