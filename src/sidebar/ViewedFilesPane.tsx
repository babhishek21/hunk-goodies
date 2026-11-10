import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionPaneProps } from "hunkdiff/extension";
import {
  buildFlatSidebarEntries,
  buildTreeSidebarEntries,
  collapseTreeSidebarEntries,
  expandCollapsedDirectoryPaths,
  resolveFileSidebarMode,
  sidebarDirectoryPaths,
  sidebarEntryStatsWidth,
  toggleCollapsedDirectoryPath,
} from "./entries";
import { DirectoryRow, FileRow, GroupHeader, fileRowId } from "./rows";

type Props = ExtensionPaneProps & { viewedPaths: ReadonlySet<string> };

/** Hunk's compact, grouped files list with viewed marks and row dimming. */
export function ViewedFilesPane({ files, selectedFileId, theme, width, height, actions, viewedPaths }: Props) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const previousSelectedFileIdRef = useRef(selectedFileId);
  const [collapsedDirectoryPaths, setCollapsedDirectoryPaths] = useState<ReadonlySet<string>>(() => new Set());
  const textWidth = Math.max(8, width - 2);
  const mode = resolveFileSidebarMode(textWidth);
  const entries = useMemo(() => mode === "tree"
    ? collapseTreeSidebarEntries(buildTreeSidebarEntries(files), collapsedDirectoryPaths)
    : buildFlatSidebarEntries(files), [collapsedDirectoryPaths, files, mode]);
  const viewedByFileId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const file of files) map.set(file.id, viewedPaths.has(file.path));
    return map;
  }, [files, viewedPaths]);
  const statsWidth = Math.max(0, ...entries.map((entry) => entry.kind === "file" ? sidebarEntryStatsWidth(entry) : 0));

  const toggleDirectory = (path: string) => {
    setCollapsedDirectoryPaths((current) => toggleCollapsedDirectoryPath(current, path));
  };

  useEffect(() => {
    const previousSelectedFileId = previousSelectedFileIdRef.current;
    previousSelectedFileIdRef.current = selectedFileId;
    if (!selectedFileId || selectedFileId === previousSelectedFileId) return;
    const selectedFile = files.find((file) => file.id === selectedFileId);
    if (selectedFile) {
      setCollapsedDirectoryPaths((current) => expandCollapsedDirectoryPaths(current, sidebarDirectoryPaths(selectedFile.path)));
    }
  }, [files, selectedFileId]);

  useEffect(() => {
    if (selectedFileId) scrollRef.current?.scrollChildIntoView(fileRowId(selectedFileId));
  }, [entries, selectedFileId]);

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column", backgroundColor: theme.panel }}>
      <box style={{ width: "100%", height: 1, backgroundColor: theme.panel }}>
        <text fg={theme.border}>{"─".repeat(width)}</text>
      </box>
      <scrollbox
        ref={scrollRef}
        width="100%"
        flexGrow={1}
        height={Math.max(1, height - 1)}
        paddingTop={1}
        focused={false}
        scrollY={true}
        viewportCulling={true}
        rootOptions={{ backgroundColor: theme.panel }}
        wrapperOptions={{ backgroundColor: theme.panel }}
        viewportOptions={{ backgroundColor: theme.panel }}
        contentOptions={{ backgroundColor: theme.panel }}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <box style={{ width: "100%", flexDirection: "column" }}>
          {entries.map((entry) => entry.kind === "group" ? (
            <GroupHeader key={entry.id} entry={entry} textWidth={textWidth} theme={theme} />
          ) : entry.kind === "directory" ? (
            <DirectoryRow
              key={entry.id}
              entry={entry}
              collapsed={collapsedDirectoryPaths.has(entry.path)}
              onToggleDirectory={toggleDirectory}
              statsWidth={statsWidth}
              textWidth={textWidth}
              theme={theme}
            />
          ) : (
            <FileRow
              key={entry.id}
              entry={entry}
              viewed={viewedByFileId.get(entry.id) ?? false}
              selected={entry.id === selectedFileId}
              statsWidth={statsWidth}
              textWidth={textWidth}
              theme={theme}
              onSelectFile={actions.selectFile}
            />
          ))}
        </box>
      </scrollbox>
    </box>
  );
}
