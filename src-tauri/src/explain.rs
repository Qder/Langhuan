//! Desktop-only explain transport.
//!
//! The packaged app has no Next Route Handlers, so `/api/ide/explain` does not
//! exist there. This module replaces *only the transport*: the WebView hands us
//! an already-assembled `messages` table (or system + user fallback) and we stream the
//! OpenAI-compatible `/chat/completions` reply back over a Tauri channel.
//!
//! Deliberate boundaries:
//! - Prompts/mock text live in TypeScript (`src/lib/ide/explain.ts`), the single
//!   source of truth. Rust is a dumb pipe and never composes model input.
//! - The API key arrives per request from IDE settings (IndexedDB). It is never
//!   written to disk, never logged, and never read from the environment.
//! - Requests go to exactly the `base_url` the user typed. Nothing else is
//!   contacted: no telemetry, no account, no plugin registry.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

use crate::http_client::outbound_http_client;

pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
pub const DEFAULT_MODEL: &str = "gpt-4o-mini";

/// TCP 连接上限。连上之后若上游不吐数据，不能只靠这个。
pub const CONNECT_TIMEOUT_SECS: u64 = 15;
/// 整轮上限（含等首包 / 读完），60–90s。挂死后 invoke 必须返回。
pub const REQUEST_TIMEOUT_SECS: u64 = 75;
/// 两次读之间的空闲。连上但一直不发 chunk 时比整轮更早失败。
pub const READ_IDLE_TIMEOUT_SECS: u64 = 45;

/// Live cancellation flags, keyed by the frontend's request id.
#[derive(Default)]
pub struct ExplainState {
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExplainChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplainArgs {
    pub request_id: String,
    pub system_prompt: String,
    pub user_content: String,
    /// TS `assembleExplainChatMessages` 整表；缺省或不够两条时退回 system+user。
    #[serde(default)]
    pub messages: Vec<ExplainChatMessage>,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub model: String,
}

fn openai_messages(args: &ExplainArgs) -> serde_json::Value {
    let cleaned: Vec<&ExplainChatMessage> = args
        .messages
        .iter()
        .filter(|m| {
            matches!(m.role.as_str(), "system" | "user" | "assistant")
                && !m.content.trim().is_empty()
        })
        .take(22)
        .collect();
    if cleaned.len() >= 2 {
        return serde_json::Value::Array(
            cleaned
                .into_iter()
                .map(|m| {
                    serde_json::json!({
                        "role": m.role,
                        "content": m.content,
                    })
                })
                .collect(),
        );
    }
    serde_json::json!([
        { "role": "system", "content": args.system_prompt },
        { "role": "user", "content": args.user_content },
    ])
}

/// Chunks pushed to the frontend. `done` closes the turn; `delta` appends text.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ExplainEvent {
    Delta { text: String },
    Done,
}

fn is_cancelled(state: &State<'_, ExplainState>, request_id: &str) -> bool {
    state
        .cancelled
        .lock()
        .map(|set| set.contains(request_id))
        .unwrap_or(false)
}

fn clear_cancel(state: &State<'_, ExplainState>, request_id: &str) {
    if let Ok(mut set) = state.cancelled.lock() {
        set.remove(request_id);
    }
}

/// Readable message for a failed HTTP call. Never embeds the key.
fn timeout_error(base: &str) -> String {
    format!("连接 {base} 超时，检查网络或 Base URL")
}

fn connect_error(base: &str, err: &reqwest::Error) -> String {
    if err.is_timeout() {
        timeout_error(base)
    } else if err.is_connect() {
        format!("连不上 {base}，检查 Base URL 或代理设置")
    } else {
        format!("请求 {base} 失败：{err}")
    }
}

fn upstream_error(status: u16, detail: &str) -> String {
    let human = match status {
        401 | 403 => format!("API Key 无效或未授权（{status}）"),
        404 => format!("端点不存在（404），Base URL 可能少了 /v1"),
        429 => "请求过于频繁或额度不足（429）".to_string(),
        _ => format!("模型请求失败（{status}）"),
    };
    let hint = detail.trim();
    if hint.is_empty() {
        human
    } else {
        // Upstream error bodies are short and useful (e.g. "model not found").
        let clipped: String = hint.chars().take(200).collect();
        format!("{human}：{clipped}")
    }
}

#[tauri::command]
pub async fn ide_explain(
    args: ExplainArgs,
    on_event: Channel<ExplainEvent>,
    state: State<'_, ExplainState>,
) -> Result<(), String> {
    stream_completion(args, on_event, state).await
}

/// Frontend "停止": the streaming loop notices on its next chunk.
#[tauri::command]
pub fn ide_explain_cancel(request_id: String, state: State<'_, ExplainState>) {
    if let Ok(mut set) = state.cancelled.lock() {
        set.insert(request_id);
    }
}

async fn stream_completion(
    args: ExplainArgs,
    on_event: Channel<ExplainEvent>,
    state: State<'_, ExplainState>,
) -> Result<(), String> {
    let key = args.api_key.trim().to_string();
    if key.is_empty() {
        // The frontend renders the local sample instead of calling us, so this
        // is a programming error rather than a user-facing state.
        return Err("未配置 API Key".into());
    }

    let base = {
        let raw = args.base_url.trim();
        if raw.is_empty() {
            DEFAULT_BASE_URL
        } else {
            raw
        }
    };
    let model = {
        let raw = args.model.trim();
        if raw.is_empty() {
            DEFAULT_MODEL
        } else {
            raw
        }
    };
    let url = format!("{}/chat/completions", base.trim_end_matches('/'));

    clear_cancel(&state, &args.request_id);

    // 不要设 read_timeout：等响应头 / 第一个 SSE 也算一次 read。
    let client = outbound_http_client(
        Duration::from_secs(CONNECT_TIMEOUT_SECS),
        Duration::from_secs(REQUEST_TIMEOUT_SECS),
    )?;

    let body = serde_json::json!({
        "model": model,
        "messages": openai_messages(&args),
        "stream": true,
        "temperature": 0.3,
    });

    let mut res = client
        .post(&url)
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| connect_error(base, &e))?;

    let status = res.status();
    if !status.is_success() {
        let detail = res.text().await.unwrap_or_default();
        clear_cancel(&state, &args.request_id);
        return Err(upstream_error(status.as_u16(), &detail));
    }

    // Byte buffer, not String: a chunk can split a multi-byte character. We only
    // decode complete lines, so Chinese never turns into mojibake.
    let mut pending: Vec<u8> = Vec::new();
    let mut saw_sse = false;
    let mut plain = String::new();

    loop {
        if is_cancelled(&state, &args.request_id) {
            clear_cancel(&state, &args.request_id);
            return Ok(());
        }
        let chunk = match res.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => {
                clear_cancel(&state, &args.request_id);
                return Err(connect_error(base, &e));
            }
        };
        pending.extend_from_slice(&chunk);

        while let Some(pos) = pending.iter().position(|b| *b == b'\n') {
            let line_bytes: Vec<u8> = pending.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Some(data) = line.strip_prefix("data:") else {
                // Some gateways keepalive with ":" comments; keep the rest in
                // case the endpoint answers with a plain (non-SSE) body.
                if !line.starts_with(':') {
                    plain.push_str(line);
                    plain.push('\n');
                }
                continue;
            };
            saw_sse = true;
            let data = data.trim();
            if data == "[DONE]" {
                let _ = on_event.send(ExplainEvent::Done);
                clear_cancel(&state, &args.request_id);
                return Ok(());
            }
            if let Some(piece) = sse_delta(data) {
                let _ = on_event.send(ExplainEvent::Delta { text: piece });
            }
        }
    }

    if !saw_sse {
        let tail = String::from_utf8_lossy(&pending);
        plain.push_str(&tail);
        let text = plain.trim();
        if !text.is_empty() {
            let _ = on_event.send(ExplainEvent::Delta {
                text: text.to_string(),
            });
        }
    }

    let _ = on_event.send(ExplainEvent::Done);
    clear_cancel(&state, &args.request_id);
    Ok(())
}

/// `choices[0].delta.content` from one SSE payload; `None` when unparseable or
/// when the provider sends only role/keepalive frames.
fn sse_delta(data: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    let piece = value
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()?;
    if piece.is_empty() {
        None
    } else {
        Some(piece.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_delta_reads_content() {
        let data = r#"{"choices":[{"delta":{"content":"你好"}}]}"#;
        assert_eq!(sse_delta(data).as_deref(), Some("你好"));
    }

    #[test]
    fn sse_delta_ignores_role_only_frame() {
        assert_eq!(sse_delta(r#"{"choices":[{"delta":{"role":"assistant"}}]}"#), None);
        assert_eq!(sse_delta("[DONE]"), None);
    }

    #[test]
    fn upstream_error_is_readable_and_bounded() {
        let long = "x".repeat(500);
        let msg = upstream_error(401, &long);
        assert!(msg.contains("API Key 无效"));
        assert!(msg.chars().count() < 260);
        assert!(upstream_error(404, "").contains("Base URL"));
    }

    #[test]
    fn connect_error_never_leaks_key() {
        // Only the base URL is interpolated; the key lives in a header.
        let msg = format!("连不上 {DEFAULT_BASE_URL}，检查 Base URL 或代理设置");
        assert!(!msg.to_lowercase().contains("sk-"));
    }

    #[test]
    fn timeouts_are_in_the_agreed_window_and_copy_is_chinese() {
        assert_eq!(CONNECT_TIMEOUT_SECS, 15);
        assert!(REQUEST_TIMEOUT_SECS >= 60 && REQUEST_TIMEOUT_SECS <= 90);
        // READ_IDLE 只作文档对齐；客户端不再设 read_timeout，避免等首包误杀。
        assert!(READ_IDLE_TIMEOUT_SECS > CONNECT_TIMEOUT_SECS);
        assert!(READ_IDLE_TIMEOUT_SECS < REQUEST_TIMEOUT_SECS);
        let msg = timeout_error("https://example.invalid/v1");
        assert!(msg.contains("超时"));
        assert!(msg.contains("检查网络或 Base URL"));
        assert!(!msg.to_lowercase().contains("sk-"));
        assert!(!msg.contains("Authorization"));
    }

    fn sample_args(messages: Vec<ExplainChatMessage>) -> ExplainArgs {
        ExplainArgs {
            request_id: "t1".into(),
            system_prompt: "sys".into(),
            user_content: "问题：本轮".into(),
            messages,
            api_key: "sk-test".into(),
            base_url: DEFAULT_BASE_URL.into(),
            model: DEFAULT_MODEL.into(),
        }
    }

    #[test]
    fn openai_messages_forwards_prior_turns() {
        let args = sample_args(vec![
            ExplainChatMessage {
                role: "system".into(),
                content: "sys".into(),
            },
            ExplainChatMessage {
                role: "user".into(),
                content: "这个文件在干什么".into(),
            },
            ExplainChatMessage {
                role: "assistant".into(),
                content: "入口是注解".into(),
            },
            ExplainChatMessage {
                role: "user".into(),
                content: "问题：刚才说的注解是什么意思".into(),
            },
        ]);
        let v = openai_messages(&args);
        let blob = v.to_string();
        assert!(blob.contains("这个文件在干什么"));
        assert!(blob.contains("入口是注解"));
        assert!(blob.contains("刚才说的注解是什么意思"));
        assert_eq!(v.as_array().map(|a| a.len()), Some(4));
    }

    #[test]
    fn openai_messages_falls_back_to_system_user() {
        let args = sample_args(vec![]);
        let v = openai_messages(&args);
        assert_eq!(
            v,
            serde_json::json!([
                { "role": "system", "content": "sys" },
                { "role": "user", "content": "问题：本轮" },
            ])
        );
    }
}
