"use client";

import * as React from "react";
import { Menu, Save, Search } from "lucide-react";
import { Button } from "./ui/button";
import { AppModeSwitch } from "./AppModeSwitch";
import { useStore } from "@/lib/store";
import { runLibraryImageUpload } from "@/lib/assets/runImageUpload";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { basename, cn } from "@/lib/utils";
import { normalizeHtmlPrefs } from "@/lib/htmlPreviewPrefs";
import { openHtmlInNewTab } from "./HtmlReader";
/** 拆分后的 TopBar 子件：菜单 / 视图 / 阅读 / 标题 / 弹层，主文件只做编排。 */
import { DocTitle } from "./topbar/DocTitle";
import { ViewModeSegment } from "./topbar/ViewModeSegment";
import { ReadingPopover } from "./topbar/ReadingPopover";
import { ReadingTools, DocActions } from "./topbar/ReadingTools";
import { MoreMenu } from "./topbar/MoreMenu";
import { TagsPopover } from "./topbar/TagsPopover";
import { TocPopover } from "./topbar/TocPopover";
import { RenameDialog, DeleteDialog } from "./topbar/DocDialogs";
import { usePopover } from "./topbar/usePopover";
import { useActiveHeading } from "./topbar/useActiveHeading";
import { useDocAsideData } from "./topbar/useDocAsideData";
import { useTocPanel } from "@/lib/tocPanel";

/**
 * 藏书阁 TopBar — orchestration only.
 *
 * Every panel and button lives in `./topbar/*`; this file picks which cluster
 * to mount for the current width / doc type and owns the transient dialog
 * state. The tiering contract (phone / tablet / wide) is documented in the
 * child components and must not change without re-running the 390/768/1280
 * manual pass.
 */
export function TopBar() {
  const active = useStore((s) => s.getActive());
  const documents = useStore((s) => s.documents);
  const getContent = useStore((s) => s.getContent);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);
  const splitSourceFirst = useStore((s) => s.splitSourceFirst);
  const toggleSyncScroll = useStore((s) => s.toggleSyncScroll);
  const syncScrollOn = useStore((s) =>
    active ? s.getSyncScrollEnabled(active.id) : true
  );
  const toggleSplitSourceFirst = useStore((s) => s.toggleSplitSourceFirst);
  const saveDoc = useStore((s) => s.saveDoc);
  const isDirty = useStore((s) => s.isDirty);
  const toggleStar = useStore((s) => s.toggleStar);
  const renameDoc = useStore((s) => s.renameDoc);
  const deleteDoc = useStore((s) => s.deleteDoc);
  const discardDraft = useStore((s) => s.discardDraft);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const setSettingsDialogOpen = useStore((s) => s.setSettingsDialogOpen);
  const setFindInFileOpen = useStore((s) => s.setFindInFileOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const setStatus = useStore((s) => s.setStatus);
  const outlineRailOpen = useStore((s) => s.outlineRailOpen);
  const toggleOutlineRail = useStore((s) => s.toggleOutlineRail);
  const setOutlineRailOpen = useStore((s) => s.setOutlineRailOpen);
  const htmlImmersive = useStore((s) => s.htmlImmersive);
  const setHtmlImmersive = useStore((s) => s.setHtmlImmersive);
  const htmlInspectEnabled = useStore((s) => s.htmlInspectEnabled);
  const toggleHtmlInspectEnabled = useStore((s) => s.toggleHtmlInspectEnabled);
  const setHtmlPreviewPrefs = useStore((s) => s.setHtmlPreviewPrefs);
  const htmlPreviewPrefs = useStore((s) => s.htmlPreviewPrefs);
  const bumpHtmlReload = useStore((s) => s.bumpHtmlReload);
  const readingPrefs = useStore((s) => s.readingPrefs);
  const setReadingPrefs = useStore((s) => s.setReadingPrefs);
  const mdFocusMode = useStore((s) => s.mdFocusMode);
  const setMdFocusMode = useStore((s) => s.setMdFocusMode);
  const setDocTags = useStore((s) => s.setDocTags);
  const setVersionDialogOpen = useStore((s) => s.setVersionDialogOpen);
  const setPropsDialogOpen = useStore((s) => s.setPropsDialogOpen);
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen);
  const setGraphDialogOpen = useStore((s) => s.setGraphDialogOpen);
  const annotations = useStore((s) => s.annotations);
  const assetsForDoc = useStore((s) => s.assetsForDoc);

  // Transient UI: two confirmations + three anchored popovers.
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const tags = usePopover();
  const reading = usePopover();
  const [tagInput, setTagInput] = React.useState("");

  const wide = useMediaQuery("(min-width: 1280px)");
  const tabletUp = useMediaQuery("(min-width: 1024px)");

  const dirty = active ? isDirty(active.id) : false;
  const isHtml = active?.type === "html";
  const htmlPrefs = active && isHtml ? normalizeHtmlPrefs(htmlPreviewPrefs[active.id]) : null;
  const { docTags, outline, backlinks, asideAvailable } = useDocAsideData({
    active,
    documents,
    getContent,
    annotations,
    assetsForDoc,
  });

  // 目录开关与其他 popover 共用一套「点外部/Esc 收起」，但 open 状态是全局
  // 共享的（专注浮动条读同一份），这样 mod+shift+o 不必去 DOM 里探测。
  const toc = useTocPanel({ docId: active?.id, available: asideAvailable });
  const setTocOpen = toc.setOpen;

  const [activeHeading, setActiveHeading] = useActiveHeading({
    enabled: toc.open,
    wide,
    docId: active?.id,
  });

  const showTocButton = asideAvailable && (!wide || !outlineRailOpen);
  const showRailToggle = asideAvailable && wide;

  const exportDoc = () => {
    if (!active) return;
    const blob = new Blob([getContent(active.id)], {
      type: active.type === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = basename(active.path);
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus(`已导出 ${basename(active.path)}`);
  };

  const copySource = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(getContent(active.id));
    setStatus("已复制源码");
  };

  if (htmlImmersive && isHtml) {
    return null;
  }

  const touchIcon = "max-lg:h-11 max-lg:w-11";

  return (
    <>
      <header className="h-14 shrink-0 flex items-center gap-2 px-3 md:px-4 overflow-hidden bg-[var(--chrome)] border-b border-[var(--chrome-border)]">
        <Button
          variant="ghost"
          size="icon"
          className={cn("lg:hidden", touchIcon)}
          aria-label="打开侧栏"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>

        <DocTitle active={active} dirty={dirty} />

        <div className="relative flex items-center gap-1.5 shrink-0">
          {active && (
            <>
              <ViewModeSegment viewMode={viewMode} onChange={setViewMode} tabletUp={tabletUp} />

              <ReadingTools
                isHtml={isHtml}
                viewMode={viewMode}
                hasHtmlPrefs={!!htmlPrefs}
                readingFontSize={readingPrefs.fontSize}
                onCycleFontSize={() => {
                  const sizes = [15, 17, 19, 21];
                  const i = sizes.indexOf(readingPrefs.fontSize);
                  setReadingPrefs({
                    fontSize: i < 0 ? sizes[1]! : sizes[(i + 1) % sizes.length]!,
                  });
                }}
                mdFocusMode={mdFocusMode}
                setMdFocusMode={setMdFocusMode}
                onOpenHtmlInNewTab={() => {
                  openHtmlInNewTab(getContent(active.id));
                  setStatus("已在新标签页打开");
                }}
                htmlInspectEnabled={htmlInspectEnabled}
                onToggleHtmlInspect={toggleHtmlInspectEnabled}
                setHtmlImmersive={setHtmlImmersive}
                tabletUp={tabletUp}
                splitSourceFirst={splitSourceFirst}
                toggleSplitSourceFirst={toggleSplitSourceFirst}
                syncScrollOn={syncScrollOn}
                onToggleSyncScroll={() => toggleSyncScroll(active.id)}
              />

              <ReadingPopover
                open={reading.open}
                onToggle={reading.toggle}
                buttonRef={reading.buttonRef}
                panelRef={reading.panelRef}
                viewMode={viewMode}
                setViewMode={setViewMode}
                tabletUp={tabletUp}
                isHtml={isHtml}
                htmlPrefs={htmlPrefs}
                activeId={active.id}
                content={getContent(active.id)}
                readingPrefs={readingPrefs}
                setReadingPrefs={setReadingPrefs}
                mdFocusMode={mdFocusMode}
                setMdFocusMode={setMdFocusMode}
                setHtmlImmersive={setHtmlImmersive}
                htmlInspectEnabled={htmlInspectEnabled}
                onToggleHtmlInspect={toggleHtmlInspectEnabled}
                setHtmlPreviewPrefs={setHtmlPreviewPrefs}
                bumpHtmlReload={bumpHtmlReload}
                splitSourceFirst={splitSourceFirst}
                toggleSplitSourceFirst={toggleSplitSourceFirst}
                syncScrollOn={syncScrollOn}
                toggleSyncScroll={toggleSyncScroll}
                setStatus={setStatus}
                touchIcon={touchIcon}
                openHtmlInNewTab={openHtmlInNewTab}
                onClose={() => reading.setOpen(false)}
              />

              {dirty && (
                <Button
                  variant="accent"
                  size="sm"
                  className="shrink-0"
                  onClick={() => saveDoc(active.id)}
                  aria-label="保存"
                >
                  <Save className="h-3.5 w-3.5" />
                  保存
                </Button>
              )}

              {isHtml && (
                <TagsPopover
                  open={tags.open}
                  onToggle={tags.toggle}
                  buttonRef={tags.buttonRef}
                  panelRef={tags.panelRef}
                  tags={docTags}
                  onSetTags={(next) => setDocTags(active.id, next)}
                  input={tagInput}
                  onInputChange={setTagInput}
                />
              )}

              <DocActions
                showTocButton={showTocButton}
                tocOpen={toc.open}
                onToggleToc={toc.toggle}
                tocBtnRef={toc.buttonRef}
                showRailToggle={showRailToggle}
                outlineRailOpen={outlineRailOpen}
                toggleOutlineRail={toggleOutlineRail}
                starred={!!active.starred}
                onToggleStar={() => toggleStar(active.id)}
              />
            </>
          )}

          <AppModeSwitch />

          <MoreMenu
            active={active}
            viewMode={viewMode}
            setViewMode={setViewMode}
            tabletUp={tabletUp}
            isHtml={isHtml}
            wide={wide}
            asideAvailable={asideAvailable}
            outlineRailOpen={outlineRailOpen}
            mdFocusMode={mdFocusMode}
            setMdFocusMode={setMdFocusMode}
            setHtmlImmersive={setHtmlImmersive}
            htmlInspectEnabled={htmlInspectEnabled}
            onToggleHtmlInspect={toggleHtmlInspectEnabled}
            splitSourceFirst={splitSourceFirst}
            toggleSplitSourceFirst={toggleSplitSourceFirst}
            syncScrollOn={syncScrollOn}
            toggleSyncScroll={toggleSyncScroll}
            toggleStar={toggleStar}
            toggleOutlineRail={toggleOutlineRail}
            setTocOpen={setTocOpen}
            setOutlineRailOpen={setOutlineRailOpen}
            setRenameVal={setRenameVal}
            setRenameOpen={setRenameOpen}
            setExportDialogOpen={setExportDialogOpen}
            exportDoc={exportDoc}
            copySource={copySource}
            setSettingsDialogOpen={setSettingsDialogOpen}
            setPropsDialogOpen={setPropsDialogOpen}
            setGraphDialogOpen={setGraphDialogOpen}
            setVersionDialogOpen={setVersionDialogOpen}
            discardDraft={discardDraft}
            dirty={dirty}
            setDeleteOpen={setDeleteOpen}
            setStatus={setStatus}
            touchIcon={touchIcon}
            onUploadImage={
              active && active.type === "md"
                ? () => {
                    const docId = active.id;
                    void runLibraryImageUpload({
                      docId,
                      insertAt: getContent(docId).length,
                      style: "block",
                    });
                  }
                : undefined
            }
          />

          <Button
            variant="ghost"
            size="icon"
            className={touchIcon}
            aria-label={active ? "文件内查找" : "搜索"}
            title={active ? "文件内查找 (⌘/Ctrl+F)" : "搜索"}
            onClick={() => (active ? setFindInFileOpen(true) : setCommandOpen(true))}
          >
            <Search className="h-4 w-4" />
          </Button>

          {active && toc.open && (
            <TocPopover
              open={toc.open}
              panelRef={toc.panelRef}
              doc={active}
              outline={outline}
              backlinks={backlinks}
              activeHeading={activeHeading}
              onNavigateHeading={setActiveHeading}
            />
          )}
        </div>
      </header>

      <RenameDialog
        open={renameOpen}
        value={renameVal}
        onChange={setRenameVal}
        onClose={() => setRenameOpen(false)}
        onConfirm={() => {
          if (active && renameVal.trim()) {
            renameDoc(active.id, renameVal.trim());
            setRenameOpen(false);
          }
        }}
      />

      <DeleteDialog
        open={deleteOpen}
        doc={active}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (active) {
            deleteDoc(active.id);
            setDeleteOpen(false);
          }
        }}
      />
    </>
  );
}
