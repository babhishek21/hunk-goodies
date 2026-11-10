/**
 * Hunk's files sidebar rows, adapted from `src/ui/components/panes/FileListItem.tsx`
 * (MIT, Modem Labs Inc.). Viewed files add a mark and use muted row colors.
 */
import { MouseButton, type MouseEvent as TuiMouseEvent } from "@opentui/core";
import { memo } from "react";
import type { ExtensionPaneTheme } from "hunkdiff/extension";
import { fitText, padText } from "./text";
import { sidebarEntryStats, type FileDirectoryEntry, type FileGroupEntry, type FileListEntry } from "./entries";

export function fileRowId(fileId: string): string {
  return `file-row:${fileId}`;
}

function fileStateIcon(entry: FileListEntry, theme: ExtensionPaneTheme): { icon: string; color: string } {
  if (entry.isUntracked) return { icon: "?", color: theme.fileUntracked };
  switch (entry.changeType) {
    case "new": return { icon: "A", color: theme.fileNew };
    case "deleted": return { icon: "D", color: theme.fileDeleted };
    case "rename-pure":
    case "rename-changed": return { icon: "R", color: theme.fileRenamed };
    case "change": return { icon: "M", color: theme.fileModified };
    default: return { icon: "", color: theme.text };
  }
}

export function GroupHeader({
  entry,
  paddingLeft = 1,
  textWidth,
  theme,
}: {
  entry: FileGroupEntry;
  paddingLeft?: number;
  textWidth: number;
  theme: ExtensionPaneTheme;
}) {
  return (
    <box style={{ width: "100%", height: 1, paddingLeft, backgroundColor: theme.panel }}>
      <text fg={theme.muted}>{fitText(entry.label, Math.max(1, textWidth))}</text>
    </box>
  );
}

function indentWidth(depth: number, textWidth: number, reservedWidth: number): number {
  return Math.min(Math.max(0, depth) * 2, Math.max(0, textWidth - reservedWidth - 1));
}

export function DirectoryRow({
  entry,
  collapsed,
  onToggleDirectory,
  statsWidth,
  textWidth,
  theme,
}: {
  entry: FileDirectoryEntry;
  collapsed: boolean;
  onToggleDirectory: (path: string) => void;
  statsWidth: number;
  textWidth: number;
  theme: ExtensionPaneTheme;
}) {
  const countText = collapsed
    ? `${entry.descendantFileCount} ${entry.descendantFileCount === 1 ? "file" : "files"}`
    : null;
  const statsWidthWithGap = statsWidth > 0 ? statsWidth + 1 : 0;
  const trailingWidth = countText ? Math.max(statsWidthWithGap, countText.length + 1) : 0;
  const indent = indentWidth(entry.depth, textWidth, 3 + trailingWidth + 1);
  const labelWidth = Math.max(1, textWidth - 3 - trailingWidth - indent);

  return (
    <box
      style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: theme.panel }}
      onMouseUp={(event: TuiMouseEvent) => {
        if (event.button === MouseButton.LEFT) onToggleDirectory(entry.path);
      }}
    >
      <box style={{ width: 1, height: 1, backgroundColor: theme.panel }} />
      <box style={{ flexGrow: 1, height: 1, paddingLeft: indent, flexDirection: "row", backgroundColor: theme.panel }}>
        <text fg={theme.muted}>{collapsed ? "› " : "⌄ "}</text>
        <text fg={theme.muted}>{padText(fitText(entry.label, labelWidth), labelWidth)}</text>
        {countText && (
          <box style={{ width: trailingWidth, height: 1, flexDirection: "row", justifyContent: "flex-end", backgroundColor: theme.panel }}>
            <text fg={theme.muted}>{countText}</text>
          </box>
        )}
      </box>
    </box>
  );
}

const VIEWED_MARK_WIDTH = 2;

export const FileRow = memo(function FileRow({
  entry,
  viewed,
  selected,
  statsWidth,
  textWidth,
  theme,
  onSelectFile,
}: {
  entry: FileListEntry;
  viewed: boolean;
  selected: boolean;
  statsWidth: number;
  textWidth: number;
  theme: ExtensionPaneTheme;
  onSelectFile: (fileId: string) => void;
}) {
  const rowBackground = selected ? theme.panelAlt : theme.panel;
  const stats = sidebarEntryStats(entry);
  const { icon, color } = fileStateIcon(entry, theme);
  const statsSectionWidth = statsWidth > 0 ? statsWidth + 1 : 0;
  const indent = indentWidth(entry.depth, textWidth, VIEWED_MARK_WIDTH + (icon ? 2 : 0) + statsSectionWidth + 1);
  const nameWidth = Math.max(1, textWidth - 1 - VIEWED_MARK_WIDTH - (icon ? 2 : 0) - statsSectionWidth - indent);

  return (
    <box
      id={fileRowId(entry.id)}
      style={{ width: "100%", height: 1, backgroundColor: rowBackground, flexDirection: "row" }}
      onMouseUp={() => onSelectFile(entry.id)}
    >
      <text fg={selected ? theme.accent : rowBackground} bg={rowBackground}>{selected ? "▌" : " "}</text>
      <box style={{ flexGrow: 1, height: 1, paddingLeft: 1 + indent, flexDirection: "row", backgroundColor: rowBackground }}>
        <text fg={theme.badgeAdded}>{viewed ? "✓ " : "  "}</text>
        {icon && <text fg={viewed ? theme.muted : color}>{icon} </text>}
        <text fg={viewed ? theme.muted : theme.text}>{padText(fitText(entry.name, nameWidth, "…"), nameWidth)}</text>
        {statsSectionWidth > 0 && (
          <box style={{ width: statsSectionWidth, height: 1, flexDirection: "row", justifyContent: "flex-end", backgroundColor: rowBackground }}>
            {stats.map((stat, index) => (
              <box key={`${entry.id}:${stat.kind}`} style={{ height: 1, flexDirection: "row", backgroundColor: rowBackground }}>
                {index > 0 && <text fg={selected ? theme.text : theme.muted}> </text>}
                <text fg={viewed ? theme.muted : stat.kind === "agent-comment" ? theme.noteBorder : stat.kind === "addition" ? theme.badgeAdded : theme.badgeRemoved}>
                  {stat.text}
                </text>
              </box>
            ))}
          </box>
        )}
      </box>
    </box>
  );
});
