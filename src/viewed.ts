import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
type Mark = { patchHash: string; viewedAt: number };
type State = { version: 1; repos: Record<string, Record<string, Mark>> };

function statePath() {
  if (platform() === "win32") {
    const local = process.env.LOCALAPPDATA;
    return join(local || join(homedir(), "AppData", "Local"), "hunk", "viewed.json");
  }
  return join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "hunk", "viewed.json");
}

function emptyState(): State {
  return { version: 1, repos: {} };
}

function readState(): State {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyState();
    const value = parsed as Partial<State>;
    if (value.version !== 1 || !value.repos || typeof value.repos !== "object") return emptyState();
    return value as State;
  } catch {
    return emptyState();
  }
}

function writeState(state: State) {
  const path = statePath();
  const temp = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  renameSync(temp, path);
}

function hashPatch(patch: string) {
  return createHash("sha256").update(patch).digest("hex");
}

function clean(state: State, now: number) {
  for (const [repo, marks] of Object.entries(state.repos)) {
    for (const [path, mark] of Object.entries(marks)) {
      if (!mark || typeof mark.viewedAt !== "number" || now - mark.viewedAt > MAX_AGE_MS) delete marks[path];
    }
    if (Object.keys(marks).length === 0) delete state.repos[repo];
  }
}

export function loadViewed(repo: string, files: Array<{ path: string; patch: string }>): Set<string> {
  const state = readState();
  const now = Date.now();
  clean(state, now);
  const marks = state.repos[repo] ?? {};
  const viewed = new Set<string>();
  for (const file of files) {
    const mark = marks[file.path];
    if (mark?.patchHash === hashPatch(file.patch)) viewed.add(file.path);
    else if (mark) delete marks[file.path];
  }
  writeState(state);
  return viewed;
}

export function saveViewed(repo: string, path: string, patch: string, viewed: boolean) {
  const state = readState();
  const now = Date.now();
  clean(state, now);
  const marks = (state.repos[repo] ??= {});
  if (viewed) marks[path] = { patchHash: hashPatch(patch), viewedAt: now };
  else delete marks[path];
  clean(state, now);
  writeState(state);
}
