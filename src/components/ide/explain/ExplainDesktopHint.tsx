"use client";

import { IDE_NOTE_DESTINATION_HINT } from "@/lib/ide/captureNote";
import { TAURI_EXPLAIN_HINT } from "@/lib/ide/explain";
import { isTauriRuntime } from "@/lib/storage/contentApi";
import { useIdeStore } from "@/lib/ide/store";

/**
 * Settings strip: API fields + the desktop-only transport note.
 * Browser keeps using `.env.local`; packaged app has no Next route, so Key
 * and Base URL here are the only way to reach a model.
 */
export function ExplainDesktopHint() {
  const isDesktop = isTauriRuntime();
  const explainSettings = useIdeStore((s) => s.explainSettings);
  const setExplainSettings = useIdeStore((s) => s.setExplainSettings);

  return (
    <div className="px-3 py-2 border-b border-[var(--chrome-border)] space-y-2 text-xs font-ui">
      <div className="text-[var(--muted)]">
        Key 只存在本机 IDE 存储；也可放在 <code>.env.local</code>
        {isDesktop ? "（桌面版不支持 .env，只用这里的设置）" : ""}。
      </div>
      <div className="text-[var(--muted)] space-y-1">
        {IDE_NOTE_DESTINATION_HINT.split("\n").map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {isDesktop && (
        <div className="text-[var(--muted)]">{TAURI_EXPLAIN_HINT}</div>
      )}
      <label className="block">
        <span className="text-[var(--muted)]">API Key</span>
        <input
          type="password"
          className="mt-0.5 w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2"
          value={explainSettings.apiKey}
          onChange={(e) => setExplainSettings({ apiKey: e.target.value })}
          placeholder="sk-… / 留空则用 mock"
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className="text-[var(--muted)]">Base URL</span>
        <input
          className="mt-0.5 w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2"
          value={explainSettings.baseUrl}
          onChange={(e) => setExplainSettings({ baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1 或 Ollama …/v1"
        />
      </label>
      <label className="block">
        <span className="text-[var(--muted)]">Model</span>
        <input
          className="mt-0.5 w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2"
          value={explainSettings.model}
          onChange={(e) => setExplainSettings({ model: e.target.value })}
          placeholder="gpt-4o-mini"
        />
      </label>
    </div>
  );
}
