/**
 * Build the row model for Hunk's compact, directory-grouped files list. Ported from
 * `src/ui/lib/files.ts` (MIT, Modem Labs Inc.) with `path` retained for viewed-mark lookup.
 */
import { basename, dirname } from "node:path/posix";
import { formatTerminalPath } from "./text";

export type SidebarChangeType = "change" | "rename-pure" | "rename-changed" | "new" | "deleted";

export interface SidebarFileSource {
  id: string;
  path: string;
  previousPath?: string;
  stats: { additions: number; deletions: number };
  statsTruncated?: boolean;
  isUntracked?: boolean;
  agent?: { annotations: readonly unknown[] } | null;
  changeType?: SidebarChangeType;
}

export interface FileListEntry {
  kind: "file";
  id: string;
  path: string;
  name: string;
  depth: number;
  agentCommentsText: string | null;
  additionsText: string | null;
  deletionsText: string | null;
  changeType: SidebarChangeType;
  isUntracked: boolean;
}

export interface FileGroupEntry {
  kind: "group";
  id: string;
  label: string;
}

export interface FileDirectoryEntry {
  kind: "directory";
  id: string;
  path: string;
  label: string;
  depth: number;
  descendantFileCount: number;
}

export type FileSidebarMode = "flat" | "tree";
export type SidebarEntry = FileListEntry | FileGroupEntry | FileDirectoryEntry;

export const TREE_FILE_SIDEBAR_MIN_CONTENT_WIDTH = 32;

export function resolveFileSidebarMode(contentWidth: number): FileSidebarMode {
  return contentWidth >= TREE_FILE_SIDEBAR_MIN_CONTENT_WIDTH ? "tree" : "flat";
}

export function normalizeDiffPath(path: string): string {
  return path.replace(/[\r\n]+$/u, "");
}

function sidebarFileName(file: SidebarFileSource): string {
  const path = formatTerminalPath(normalizeDiffPath(file.path));
  const previousPath = file.previousPath ? formatTerminalPath(normalizeDiffPath(file.previousPath)) : undefined;
  if (!previousPath || previousPath === path) return basename(path);
  const previousName = basename(previousPath);
  const nextName = basename(path);
  return previousName === nextName ? nextName : `${previousName} -> ${nextName}`;
}

function formatSidebarStat(prefix: "+" | "-", value: number, truncated = false): string | null {
  return value > 0 ? `${prefix}${value}${truncated ? "+" : ""}` : null;
}

export function sidebarEntryStats(
  entry: Pick<FileListEntry, "agentCommentsText" | "additionsText" | "deletionsText">,
): Array<{ kind: "agent-comment" | "addition" | "deletion"; text: string }> {
  const stats: Array<{ kind: "agent-comment" | "addition" | "deletion"; text: string }> = [];
  if (entry.agentCommentsText) stats.push({ kind: "agent-comment", text: entry.agentCommentsText });
  if (entry.additionsText) stats.push({ kind: "addition", text: entry.additionsText });
  if (entry.deletionsText) stats.push({ kind: "deletion", text: entry.deletionsText });
  return stats;
}

export function sidebarEntryStatsWidth(
  entry: Pick<FileListEntry, "agentCommentsText" | "additionsText" | "deletionsText">,
): number {
  return sidebarEntryStats(entry).reduce((width, stat, index) => width + stat.text.length + (index > 0 ? 1 : 0), 0);
}

function buildSidebarFileEntry(file: SidebarFileSource): FileListEntry {
  const agentCommentCount = file.agent?.annotations.length ?? 0;
  return {
    kind: "file",
    id: file.id,
    path: file.path,
    name: sidebarFileName(file),
    depth: 0,
    agentCommentsText: agentCommentCount > 0 ? `*${agentCommentCount}` : null,
    additionsText: formatSidebarStat("+", file.stats.additions, file.statsTruncated),
    deletionsText: formatSidebarStat("-", file.stats.deletions),
    changeType: file.changeType ?? "change",
    isUntracked: file.isUntracked ?? false,
  };
}

/** Build Hunk's compact directory groups in review order, including `./` for root files. */
export function buildFlatSidebarEntries(files: readonly SidebarFileSource[]): SidebarEntry[] {
  const entries: SidebarEntry[] = [];
  let activeGroup: string | undefined;
  files.forEach((file, index) => {
    const group = dirname(formatTerminalPath(normalizeDiffPath(file.path)));
    if (group !== activeGroup) {
      activeGroup = group;
      entries.push({ kind: "group", id: `group:${group}:${index}`, label: group === "." ? "./" : `${group}/` });
    }
    entries.push(buildSidebarFileEntry(file));
  });
  return entries;
}

function directorySegments(parent: string): string[] {
  if (parent === ".") return [];
  const root = parent.match(/^\/+/u)?.[0];
  const segments = parent.split("/").filter(Boolean);
  return root ? [root, ...segments] : segments;
}

function directoryPath(segments: readonly string[]): string {
  const [root, ...rest] = segments;
  return root?.startsWith("/") ? `${root}${rest.join("/")}` : segments.join("/");
}

function sharedDirectoryDepth(previous: readonly string[], next: readonly string[]): number {
  let depth = 0;
  const maxDepth = Math.min(previous.length, next.length);
  while (depth < maxDepth && previous[depth] === next[depth]) depth += 1;
  return depth;
}

/**
 * Turn Hunk's compact directory groups into the nested projection. Root groups remain group
 * headers, so `./` comes from the same ordinary grouping rule as the compact view.
 */
export function buildTreeSidebarEntries(files: readonly SidebarFileSource[]): SidebarEntry[] {
  const compactEntries = buildFlatSidebarEntries(files);
  const entries: SidebarEntry[] = [];
  let activeDirectories: string[] = [];
  let activeDirectoryEntries: FileDirectoryEntry[] = [];
  let cursor = 0;

  while (cursor < compactEntries.length) {
    const group = compactEntries[cursor];
    if (!group || group.kind !== "group") {
      cursor += 1;
      continue;
    }
    cursor += 1;
    const run: FileListEntry[] = [];
    while (cursor < compactEntries.length && compactEntries[cursor]?.kind === "file") {
      run.push(compactEntries[cursor] as FileListEntry);
      cursor += 1;
    }

    if (group.label === "./") {
      entries.push(group);
      activeDirectories = [];
      activeDirectoryEntries = [];
      for (const file of run) entries.push({ ...file, depth: 0 });
      continue;
    }

    const directories = directorySegments(group.label.slice(0, -1));
    const sharedDepth = sharedDirectoryDepth(activeDirectories, directories);
    activeDirectoryEntries = activeDirectoryEntries.slice(0, sharedDepth);
    for (let depth = sharedDepth; depth < directories.length; depth += 1) {
      const segment = directories[depth]!;
      const path = directoryPath(directories.slice(0, depth + 1));
      const directory: FileDirectoryEntry = {
        kind: "directory",
        id: `directory:${group.id}:${depth}:${path}`,
        path,
        label: segment.startsWith("/") ? segment : `${segment}/`,
        depth,
        descendantFileCount: 0,
      };
      entries.push(directory);
      activeDirectoryEntries.push(directory);
    }
    for (const file of run) {
      entries.push({ ...file, depth: directories.length });
      for (const directory of activeDirectoryEntries) directory.descendantFileCount += 1;
    }
    activeDirectories = directories;
  }

  return entries;
}

export function sidebarDirectoryPaths(path: string): string[] {
  const parent = dirname(formatTerminalPath(normalizeDiffPath(path)));
  const directories = directorySegments(parent);
  return directories.map((_, depth) => directoryPath(directories.slice(0, depth + 1)));
}

export function expandCollapsedDirectoryPaths(current: ReadonlySet<string>, paths: readonly string[]) {
  const next = new Set(current);
  let changed = false;
  for (const path of paths) {
    if (next.delete(path)) changed = true;
  }
  return changed ? next : current;
}

export function toggleCollapsedDirectoryPath(current: ReadonlySet<string>, path: string) {
  const next = new Set(current);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

export function collapseTreeSidebarEntries(entries: readonly SidebarEntry[], collapsedPaths: ReadonlySet<string>) {
  if (collapsedPaths.size === 0) return [...entries];
  const visible: SidebarEntry[] = [];
  let collapsedDepth: number | null = null;
  for (const entry of entries) {
    if (entry.kind === "group") {
      collapsedDepth = null;
      visible.push(entry);
      continue;
    }
    if (collapsedDepth !== null) {
      if (entry.depth > collapsedDepth) continue;
      collapsedDepth = null;
    }
    visible.push(entry);
    if (entry.kind === "directory" && collapsedPaths.has(entry.path)) collapsedDepth = entry.depth;
  }
  return visible;
}
