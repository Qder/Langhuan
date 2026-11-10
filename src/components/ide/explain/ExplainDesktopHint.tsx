"use client";

import { useIdeStore } from "@/lib/ide/store";
import { ExplainUsageHelp } from "./ExplainUsageHelp";

/**
 * Settings strip: API fields + opt-in help.
 * Browser keeps using `.env.local`; packaged app has no Next route, so Key
 * and Base URL here are the only way to reach a model.
 */
export function ExplainDesktopHint() {
  const explainSettings = useIdeStore((s) => s.explainSettings);
  const setExplainSettings = useIdeStore((s) => s.setExplainSettings);

  return (
    <div className="px-3 py-2 border-b border-[var(--chrome-border)] space-y-2 text-xs font-ui">
      <ExplainUsageHelp settings />
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
          placeholder="https://api.deepseek.com 或 https://api.openai.com/v1"
        />
      </label>
      <label className="block">
        <span className="text-[var(--muted)]">Model</span>
        <input
          className="mt-0.5 w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2"
          value={explainSettings.model}
          onChange={(e) => setExplainSettings({ model: e.target.value })}
          placeholder="deepseek-flash / gpt-4o-mini"
        />
      </label>
    </div>
  );
}
