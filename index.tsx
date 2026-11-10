import { useSyncExternalStore } from "react";
import type { ExtensionCommandContext, ExtensionDiffFile, ExtensionEventContext, ExtensionPaneProps, HunkExtensionAPI } from "hunkdiff/extension";
import { findGitRoot, isStagedFileReview, readGitStatus, stageFile, stageHunk, unstageFile, unstageHunk } from "./src/git";
import { ViewedFilesPane as HunkFilesPane } from "./src/sidebar/ViewedFilesPane";
import { loadViewed, saveViewed } from "./src/viewed";

const FOLDED_VIEW = "viewed";
type Store = {
  repo: string | null;
  viewed: Set<string>;
  status: ReturnType<typeof readGitStatus>;
  reviewPaths: string[];
  reviewFiles: Array<{ id: string; path: string }>;
  selectedFileId: string | null;
  showFoldHint: boolean;
};
let store: Store = {
  repo: null,
  viewed: new Set(),
  status: { available: false, stagedFiles: [], stagedHunks: 0 },
  reviewPaths: [],
  reviewFiles: [],
  selectedFileId: null,
  showFoldHint: false,
};
let activeReview: ExtensionPaneProps["review"] = null;
const storeListeners = new Set<() => void>();

function updateStore(next: Store) {
  store = next;
  for (const listener of storeListeners) listener();
}

function useStore() {
  return useSyncExternalStore(
    (listener) => {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
    () => store,
  );
}

function markViewed(file: ExtensionDiffFile, viewed: boolean) {
  const next = new Set(store.viewed);
  if (viewed) next.add(file.path);
  else next.delete(file.path);
  updateStore({ ...store, viewed: next });
  if (store.repo) saveViewed(store.repo, file.path, file.patch, viewed);
}

function progressText(current: Store) {
  const viewedCount = current.reviewPaths.filter((path) => current.viewed.has(path)).length;
  const stagedCounts = [
    current.status.stagedHunks > 0 ? `${current.status.stagedHunks}h` : "",
    current.status.stagedFiles.length > 0 ? `${current.status.stagedFiles.length}f` : "",
  ].filter(Boolean);
  const progress = [`viewed ${viewedCount}/${current.reviewPaths.length}`];
  if (stagedCounts.length > 0) progress.push(`staged ${stagedCounts.join("/")}`);
  if (current.showFoldHint) {
    progress.push("Ctrl+G: toggle viewed folds");
  }
  return progress.join(" · ");
}

function setProgressStatusline(statusLine: ExtensionCommandContext["statusLine"] | ExtensionEventContext["statusLine"]) {
  if (store.reviewPaths.length === 0) {
    statusLine.clear("progress");
    return;
  }
  statusLine.set({
    id: "progress",
    spans: [{ text: progressText(store) }],
  });
}

function ViewedFilesPane(props: ExtensionPaneProps) {
  const current = useStore();
  return <HunkFilesPane {...props} viewedPaths={current.viewed} />;
}

function isViewed(file: ExtensionDiffFile) {
  return store.viewed.has(file.path);
}

function foldedLayout(file: ExtensionDiffFile) {
  const additions = file.stats.additions;
  const deletions = file.stats.deletions;
  const row = {
    id: "review-flow:viewed",
    spans: [
      { text: "✓ Viewed  ", tone: "accent" as const, attributes: ["bold" as const] },
      { text: file.path, attributes: ["bold" as const] },
      { text: `   +${additions}  -${deletions}`, tone: "muted" as const },
    ],
  };
  return {
    rows: [row],
    hunkRows: (file.hunks ?? []).map(() => ({ startRow: 0, endRow: 0 })),
  };
}

async function waitFor(check: () => boolean, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  return false;
}

function clearFoldHint() {
  if (store.showFoldHint) updateStore({ ...store, showFoldHint: false });
}

async function foldViewedFiles(ctx: ExtensionCommandContext, seedFileId: string, returnFileId: string | null) {
  const seed = store.reviewFiles.find((file) => file.id === seedFileId);
  if (!seed || !store.viewed.has(seed.path)) return false;

  if (store.selectedFileId !== seedFileId) {
    ctx.navigation.selectFile(seedFileId);
    if (!(await waitFor(() => store.selectedFileId === seedFileId))) {
      return false;
    }
  }

  ctx.fileViews.select(FOLDED_VIEW);
  const commandId = "hunk.view.applyFilePresentationToAllMatching";
  const ready = await waitFor(() => ctx.commands.isEnabled(commandId));
  const applied = ready && ctx.commands.execute(commandId);

  if (returnFileId && returnFileId !== seedFileId) ctx.navigation.selectFile(returnFileId);
  return applied;
}

export default function (hunk: HunkExtensionAPI) {
  let loadedReview = false;

  function refreshStatus(cwd: string) {
    const repo = findGitRoot(cwd);
    const status = readGitStatus(cwd);
    updateStore(repo !== store.repo
      ? { ...store, repo, viewed: new Set(), status }
      : { ...store, status });
  }

  hunk.on("startup", ({ cwd }) => {
    refreshStatus(cwd);
  });
  hunk.on("changeset_loaded", ({ changeset }, ctx) => {
    refreshStatus(ctx.cwd);
    const viewed = store.repo ? loadViewed(store.repo, changeset.files) : new Set<string>();
    const showFoldHint = loadedReview ? store.showFoldHint : viewed.size > 0;
    loadedReview = true;
    updateStore({
      ...store,
      viewed,
      reviewPaths: changeset.files.map((file) => file.path),
      reviewFiles: changeset.files.map(({ id, path }) => ({ id, path })),
      showFoldHint,
    });
    setProgressStatusline(ctx.statusLine);
  });
  hunk.on("session_reload", ({ changeset }, ctx) => {
    refreshStatus(ctx.cwd);
    const viewed = store.repo ? loadViewed(store.repo, changeset.files) : new Set<string>();
    updateStore({
      ...store,
      viewed,
      reviewPaths: changeset.files.map((file) => file.path),
      reviewFiles: changeset.files.map(({ id, path }) => ({ id, path })),
      showFoldHint: store.showFoldHint,
    });
    setProgressStatusline(ctx.statusLine);
  });
  hunk.on("selection_changed", ({ fileId }) => {
    if (store.selectedFileId !== fileId) updateStore({ ...store, selectedFileId: fileId });
  });

  hunk.registerPane({
    id: "files",
    title: "Files (viewed marks)",
    placement: "left",
    replaces: "hunk:files",
    width: { preferred: 34, min: 22 },
    available: ({ review }) => {
      activeReview = review;
      return true;
    },
    component: ViewedFilesPane,
  });

  hunk.registerFileView({
    id: FOLDED_VIEW,
    title: "Viewed",
    matches: isViewed,
    layout: ({ file }) => (isViewed(file) ? foldedLayout(file) : null),
  });

  hunk.registerCommand({ id: "toggleViewed", title: "Toggle file viewed status", key: "V" }, async (ctx) => {
    const file = ctx.selection.file;
    if (!file) return ctx.notify("No file selected", "info");
    const nextViewed = !isViewed(file);
    markViewed(file, nextViewed);
    setProgressStatusline(ctx.statusLine);
    ctx.fileViews.select(nextViewed ? FOLDED_VIEW : null);
    if (store.showFoldHint) {
      clearFoldHint();
      setProgressStatusline(ctx.statusLine);
      const seed = nextViewed
        ? file.id
        : store.reviewFiles.find((candidate) => candidate.id !== file.id && store.viewed.has(candidate.path))?.id;
      if (!seed) {
        ctx.notify(`Unmarked ${file.path}; no viewed files remain`, "info");
        return;
      }
      const applied = await foldViewedFiles(ctx, seed, file.id);
      if (!applied) {
        ctx.notify("Could not fold every viewed file", "warning");
      } else {
        const remaining = store.viewed.size;
        ctx.notify(
          nextViewed
            ? `Marked ${file.path}; folded ${remaining} viewed files`
            : `Unmarked ${file.path}; folded ${remaining} remaining viewed files`,
          "info",
        );
      }
    }
  });

  hunk.registerCommand({ id: "foldViewed", title: "Toggle folding for viewed files", key: "ctrl+g" }, async (ctx) => {
    const selected = ctx.selection.file;
    const viewedFiles = store.reviewFiles.filter((file) => store.viewed.has(file.path));
    const seed = viewedFiles[0];
    if (!seed) return ctx.notify("There are no viewed files", "info");

    let allFolded = true;
    for (const file of viewedFiles) {
      if (store.selectedFileId !== file.id) {
        ctx.navigation.selectFile(file.id);
        if (!(await waitFor(() => store.selectedFileId === file.id))) {
          return ctx.notify("Could not inspect every viewed file", "warning");
        }
      }
      if (!ctx.fileViews.isActive(FOLDED_VIEW)) allFolded = false;
    }

    clearFoldHint();
    setProgressStatusline(ctx.statusLine);
    if (allFolded) {
      for (const file of viewedFiles) {
        if (store.selectedFileId !== file.id) {
          ctx.navigation.selectFile(file.id);
          if (!(await waitFor(() => store.selectedFileId === file.id))) {
            return ctx.notify("Could not unfold every viewed file", "warning");
          }
        }
        ctx.fileViews.select(null);
      }
      if (selected) ctx.navigation.selectFile(selected.id);
      ctx.notify(`Unfolded ${viewedFiles.length} viewed files`, "info");
      return;
    }

    const applied = await foldViewedFiles(ctx, seed.id, selected?.id ?? null);
    if (!applied) ctx.notify("Could not fold every viewed file", "warning");
    else ctx.notify(`Folded ${viewedFiles.length} viewed files`, "info");
  });

  hunk.registerCommand({ id: "stageFile", title: "Stage selected file", key: "S" }, (ctx) => {
    const file = ctx.selection.file;
    if (!file) return ctx.notify("No file selected", "info");
    if (!ctx.workspace.canWriteDocument(file.id)) {
      return ctx.notify("File staging is available only in an unstaged working-tree review", "warning");
    }
    const result = stageFile(ctx.cwd, file.path);
    if (!result.ok) return ctx.notify(result.error, "warning");
    refreshStatus(ctx.cwd);
    clearFoldHint();
    setProgressStatusline(ctx.statusLine);
    ctx.notify(`Staged ${file.path}`, "info");
    ctx.commands.execute("hunk.app.refresh");
  });

  hunk.registerCommand({ id: "stageHunk", title: "Stage selected hunk", key: "T" }, (ctx) => {
    const file = ctx.selection.file;
    const hunkIndex = ctx.selection.hunkIndex;
    if (!file || hunkIndex === null) return ctx.notify("Select a hunk to stage", "info");
    if (!ctx.workspace.canWriteDocument(file.id)) {
      return ctx.notify("Hunk staging is available only in an unstaged working-tree review", "warning");
    }
    const result = stageHunk(ctx.cwd, file.patch, hunkIndex);
    if (!result.ok) return ctx.notify(result.error, "warning");
    refreshStatus(ctx.cwd);
    clearFoldHint();
    setProgressStatusline(ctx.statusLine);
    ctx.notify(`Staged hunk ${hunkIndex + 1} in ${file.path}`, "info");
    ctx.commands.execute("hunk.app.refresh");
  });

  hunk.registerCommand({ id: "unstageFile", title: "Unstage selected file", key: "U" }, async (ctx) => {
    const selected = ctx.selection.file;
    if (selected && isStagedFileReview(ctx.cwd, selected.path, selected.patch)) {
      const stagedFile = store.status.stagedFiles.find((file) => file.path === selected.path);
      if (!stagedFile) return ctx.notify("The selected file is no longer staged", "warning");
      const result = unstageFile(ctx.cwd, stagedFile.paths);
      if (!result.ok) return ctx.notify(result.error, "warning");
      refreshStatus(ctx.cwd);
      clearFoldHint();
      setProgressStatusline(ctx.statusLine);
      ctx.notify(`Unstaged ${stagedFile.path}`, "info");
      ctx.commands.execute("hunk.app.refresh");
      return;
    }

    if (!selected || !ctx.workspace.canWriteDocument(selected.id)) {
      return ctx.notify("Select a staged file or open an unstaged working-tree diff", "info");
    }
    const files = store.status.stagedFiles;
    if (files.length === 0) return ctx.notify("There are no staged files", "info");
    const picked = await ctx.dialogs.select({ title: "Unstage which file?", options: files.map((file) => file.path) });
    if (picked === null) return;
    const staged = store.status.stagedFiles.find((file) => file.path === picked);
    if (!staged) return ctx.notify("The staged file list changed; try again", "warning");
    const result = unstageFile(ctx.cwd, staged.paths);
    if (!result.ok) return ctx.notify(result.error, "warning");
    refreshStatus(ctx.cwd);
    clearFoldHint();
    setProgressStatusline(ctx.statusLine);
    ctx.notify(`Unstaged ${staged.path}`, "info");
    ctx.commands.execute("hunk.app.refresh");
  });

  hunk.registerCommand({ id: "unstageHunk", title: "Unstage selected hunk", key: "H" }, (ctx) => {
    const file = ctx.selection.file;
    const hunkIndex = ctx.selection.hunkIndex;
    if (!file || hunkIndex === null) return ctx.notify("Select a staged hunk to unstage", "info");
    if (!isStagedFileReview(ctx.cwd, file.path, file.patch)) {
      return ctx.notify("Open a staged/cached diff to unstage a hunk", "info");
    }
    const result = unstageHunk(ctx.cwd, file.path, file.patch, hunkIndex);
    if (!result.ok) return ctx.notify(result.error, "warning");
    refreshStatus(ctx.cwd);
    clearFoldHint();
    setProgressStatusline(ctx.statusLine);
    ctx.notify(`Unstaged hunk ${hunkIndex + 1} in ${file.path}`, "info");
    ctx.commands.execute("hunk.app.refresh");
  });

}
