"use client";

import * as React from "react";
import { Pin, X, Columns2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn, titleOf } from "@/lib/utils";
import { tabCloseActionDisabled, type TabCloseMode } from "@/lib/tabClose";
import { PreviewContextMenu, type ContextMenuItem } from "./locate/PreviewContextMenu";

type TabMenuState = { x: number; y: number; tabId: string };

export function TabBar() {
  const openTabs = useStore((s) => s.openTabs);
  const pinnedTabs = useStore((s) => s.pinnedTabs);
  const documents = useStore((s) => s.documents);
  const activeId = useStore((s) => s.activeId);
  const secondaryId = useStore((s) => s.secondaryId);
  const openDoc = useStore((s) => s.requestOpenDoc);
  const closeTab = useStore((s) => s.closeTab);
  const closeTabsInMode = useStore((s) => s.closeTabsInMode);
  const togglePinTab = useStore((s) => s.togglePinTab);
  const requestTreeReveal = useStore((s) => s.requestTreeReveal);
  const openInSplit = useStore((s) => s.openInSplit);
  const isDirty = useStore((s) => s.isDirty);
  const reorderTabs = useStore((s) => s.reorderTabs);
  const [dragIdx, setDragIdx] = React.useState<number | null>(null);
  const [menu, setMenu] = React.useState<TabMenuState | null>(null);

  const tabs = openTabs
    .map((id) => documents.find((d) => d.id === id))
    .filter(Boolean);

  const menuItems = React.useMemo((): ContextMenuItem[] => {
    if (!menu) return [];
    const targetId = menu.tabId;
    const run = (mode: TabCloseMode) => {
      if (mode === "self") closeTab(targetId);
      else closeTabsInMode(targetId, mode);
    };
    const item = (id: string, label: string, mode: TabCloseMode, danger?: boolean): ContextMenuItem => ({
      id,
      label,
      danger,
      disabled: tabCloseActionDisabled(openTabs, pinnedTabs, targetId, mode),
      onSelect: () => run(mode),
    });
    return [
      item("close", "关闭", "self"),
      item("close-left", "关闭左侧", "left"),
      item("close-right", "关闭右侧", "right"),
      item("close-others", "关闭其他", "others"),
      item("close-all", "关闭全部", "all", true),
    ];
  }, [menu, openTabs, pinnedTabs, closeTab, closeTabsInMode]);

  if (!tabs.length) return null;

  return (
    <>
      <div
        className="shrink-0 flex items-stretch gap-0.5 px-2 pt-1.5 pb-0 overflow-x-auto scroll-thin border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-elevated)_80%,transparent)]"
        role="tablist"
        aria-label="打开的文档"
      >
        {tabs.map((doc, i) => {
          if (!doc) return null;
          const active = doc.id === activeId;
          const inSplit = doc.id === secondaryId;
          const pinned = pinnedTabs.includes(doc.id);
          const dirty = isDirty(doc.id);
          return (
            <div
              key={doc.id}
              role="tab"
              aria-selected={active}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx == null || dragIdx === i) return;
                reorderTabs(dragIdx, i);
                setDragIdx(null);
              }}
              onDragEnd={() => setDragIdx(null)}
              className={cn(
                "group relative flex max-w-[180px] min-w-[96px] items-center gap-1 rounded-t-lg border border-b-0 px-2 py-1.5 text-xs font-ui cursor-pointer select-none",
                active
                  ? "bg-[var(--card)] border-[var(--border)] text-[var(--fg)]"
                  : "bg-transparent border-transparent text-[var(--muted)] hover:bg-[var(--hover)]"
              )}
              onClick={() => openDoc(doc.id)}
              onDoubleClick={(e) => {
                e.preventDefault();
                requestTreeReveal(doc.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY, tabId: doc.id });
              }}
              title={doc.path}
            >
              {pinned && (
                <Pin className="h-2.5 w-2.5 shrink-0 text-[var(--gold)] fill-[var(--gold)]" />
              )}
              <span className="truncate flex-1 min-w-0">{titleOf(doc.path)}</span>
              {dirty && (
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shrink-0" />
              )}
              {inSplit && !active && (
                <Columns2 className="h-2.5 w-2.5 text-[var(--teal)] shrink-0" />
              )}
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--hover)]"
                aria-label="固定标签"
                title="固定 / 取消固定"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePinTab(doc.id);
                }}
              >
                <Pin className={cn("h-3 w-3", pinned && "text-[var(--gold)]")} />
              </button>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--hover)]"
                aria-label="分屏打开"
                title="分屏打开"
                onClick={(e) => {
                  e.stopPropagation();
                  openInSplit(doc.id);
                }}
              >
                <Columns2 className="h-3 w-3" />
              </button>
              {!pinned && (
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--hover)]"
                  aria-label="关闭标签"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(doc.id);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <PreviewContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
          ariaLabel="标签栏菜单"
        />
      )}
    </>
  );
}
