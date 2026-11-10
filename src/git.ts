import { spawnSync } from "node:child_process";

export type GitStatus = {
  available: boolean;
  stagedFiles: Array<{ path: string; paths: string[] }>;
  stagedHunks: number;
  error?: string;
};

type GitResult = { ok: true; stdout: string } | { ok: false; error: string };

/** Match the diff-header shape Hunk normalizes its reviewed patches to. */
const GIT_DIFF_CONFIG = [
  "-c", "core.quotePath=true",
  "-c", "diff.noprefix=false",
  "-c", "diff.mnemonicPrefix=false",
  "-c", "diff.srcPrefix=a/",
  "-c", "diff.dstPrefix=b/",
];

function git(cwd: string, args: string[], input?: string): GitResult {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) {
    return { ok: false, error: result.stderr.trim() || `git exited with status ${result.status}` };
  }
  return { ok: true, stdout: result.stdout };
}

export function findGitRoot(cwd: string): string | null {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  return result.ok ? result.stdout.trim() : null;
}

export function readGitStatus(cwd: string): GitStatus {
  const root = findGitRoot(cwd);
  if (!root) return { available: false, stagedFiles: [], stagedHunks: 0 };

  const staged = git(root, ["diff", "--cached", "--no-ext-diff", "--no-color", "--unified=0"]);
  const names = git(root, ["diff", "--cached", "--name-status", "-z"]);
  if (!staged.ok || !names.ok) {
    return {
      available: false,
      stagedFiles: [],
      stagedHunks: 0,
      error: !staged.ok ? staged.error : !names.ok ? names.error : undefined,
    };
  }
  const stagedHunks = staged.stdout.split("\n").filter((line) => line.startsWith("@@ ")).length;
  const fields = names.stdout.split("\0").filter(Boolean);
  const stagedFiles: GitStatus["stagedFiles"] = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = fields[i++];
      const newPath = fields[i++];
      if (oldPath !== undefined && newPath !== undefined) stagedFiles.push({ path: newPath, paths: [oldPath, newPath] });
    } else {
      const path = fields[i++];
      if (path !== undefined) stagedFiles.push({ path, paths: [path] });
    }
  }
  return { available: true, stagedFiles, stagedHunks };
}

export function stageFile(cwd: string, path: string): GitResult {
  const root = findGitRoot(cwd);
  if (!root) return { ok: false, error: "This review is not inside a Git repository" };
  return git(root, ["--literal-pathspecs", "add", "--", path]);
}

export function unstageFile(cwd: string, paths: string[]): GitResult {
  const root = findGitRoot(cwd);
  if (!root) return { ok: false, error: "This review is not inside a Git repository" };
  const head = git(root, ["rev-parse", "--verify", "HEAD"]);
  if (!head.ok) {
    // In an unborn repository, there is no HEAD tree to restore from. These
    // staged paths are initial additions, so remove them from the index only.
    return git(root, ["--literal-pathspecs", "rm", "--cached", "--force", "--ignore-unmatch", "--", ...paths]);
  }
  return git(root, ["--literal-pathspecs", "restore", "--staged", "--", ...paths]);
}

function selectedHunkPatch(patch: string, hunkIndex: number): string | null {
  const lines = patch.split(/(?<=\n)/);
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("@@ ")) starts.push(i);
  }
  const start = starts[hunkIndex];
  if (start === undefined) return null;
  const end = starts[hunkIndex + 1] ?? lines.length;
  const headerEnd = starts[0];
  if (headerEnd === undefined) return null;
  return lines.slice(0, headerEnd).concat(lines.slice(start, end)).join("");
}

function hunkSignature(patch: string, hunkIndex: number): string | null {
  const selected = selectedHunkPatch(patch, hunkIndex);
  if (selected === null) return null;
  const lines = selected.split("\n");
  const hunkStart = lines.findIndex((line) => line.startsWith("@@ "));
  if (hunkStart === -1) return null;
  return JSON.stringify(lines.slice(hunkStart + 1).filter((line) => line.startsWith("+") || line.startsWith("-")));
}

function changedLines(patch: string): string[] {
  const changed: string[] = [];
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }
    if (line.startsWith("diff --git ")) inHunk = false;
    if (inHunk && (line.startsWith("+") || line.startsWith("-"))) changed.push(line);
  }
  return changed;
}

function patchMatchesReviewedChanges(patch: string, actual: string): boolean {
  const reviewedChanges = changedLines(patch);
  const actualChanges = changedLines(actual);
  if (reviewedChanges.length > 0 || actualChanges.length > 0) {
    return JSON.stringify(reviewedChanges) === JSON.stringify(actualChanges);
  }
  return patch.replaceAll("\r\n", "\n").trim() === actual.replaceAll("\r\n", "\n").trim();
}

function isUntrackedPath(root: string, path: string): boolean {
  const status = git(root, ["--literal-pathspecs", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", path]);
  if (!status.ok) return false;
  return status.stdout.split("\0").some((entry) => entry.startsWith("?? ") && entry.slice(3) === path);
}

/** Whether the displayed file patch represents this path's staged index diff. */
export function isStagedFileReview(cwd: string, path: string, patch: string): boolean {
  const root = findGitRoot(cwd);
  if (!root) return false;
  const staged = git(root, [...GIT_DIFF_CONFIG, "--literal-pathspecs", "diff", "--cached", "--no-ext-diff", "--no-color", "--find-renames", "--", path]);
  if (!staged.ok || staged.stdout === "") return false;
  return patchMatchesReviewedChanges(patch, staged.stdout);
}

/**
 * Whether the displayed file patch represents this path's unstaged working-tree diff.
 *
 * Binary files carry a "Binary files ... differ" patch instead of line changes, so this is the
 * review-context probe for files that `workspace.canWriteDocument` refuses as non-text.
 */
export function isUnstagedFileReview(cwd: string, path: string, patch: string, isUntracked = false): boolean {
  const root = findGitRoot(cwd);
  if (!root) return false;
  if (isUntracked) return isUntrackedPath(root, path);
  const unstaged = git(root, [...GIT_DIFF_CONFIG, "--literal-pathspecs", "diff", "--no-ext-diff", "--no-color", "--find-renames", "--", path]);
  if (!unstaged.ok || unstaged.stdout === "") return false;
  return patchMatchesReviewedChanges(patch, unstaged.stdout);
}

function stagedDiffContainsHunk(root: string, path: string, patch: string, hunkIndex: number): boolean {
  const staged = git(root, [...GIT_DIFF_CONFIG, "--literal-pathspecs", "diff", "--cached", "--no-ext-diff", "--no-color", "--find-renames", "--", path]);
  const wanted = hunkSignature(patch, hunkIndex);
  if (!staged.ok || wanted === null) return false;
  const lines = staged.stdout.split(/(?<=\n)/);
  let index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("@@ ")) continue;
    index += 1;
    if (hunkSignature(staged.stdout, index) === wanted) return true;
  }
  return false;
}

export function stageHunk(cwd: string, patch: string, hunkIndex: number): GitResult {
  const root = findGitRoot(cwd);
  if (!root) return { ok: false, error: "This review is not inside a Git repository" };
  const selected = selectedHunkPatch(patch, hunkIndex);
  if (!selected) return { ok: false, error: "Could not find that hunk in the reviewed patch" };

  const check = git(root, ["apply", "--cached", "--check", "--unidiff-zero", "-"], selected);
  if (!check.ok) return { ok: false, error: `The hunk no longer applies: ${check.error}` };
  return git(root, ["apply", "--cached", "--unidiff-zero", "-"], selected);
}

export function unstageHunk(cwd: string, path: string, patch: string, hunkIndex: number): GitResult {
  const root = findGitRoot(cwd);
  if (!root) return { ok: false, error: "This review is not inside a Git repository" };
  if (!stagedDiffContainsHunk(root, path, patch, hunkIndex)) {
    return { ok: false, error: "The selected hunk does not match a staged hunk for this file" };
  }
  const selected = selectedHunkPatch(patch, hunkIndex);
  if (!selected) return { ok: false, error: "Could not find that hunk in the reviewed patch" };

  const check = git(root, ["apply", "--cached", "--reverse", "--check", "--unidiff-zero", "-"], selected);
  if (!check.ok) return { ok: false, error: `The hunk is not present in the index: ${check.error}` };
  return git(root, ["apply", "--cached", "--reverse", "--unidiff-zero", "-"], selected);
}
