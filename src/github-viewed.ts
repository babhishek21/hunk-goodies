import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import type { ExtensionReviewDescriptor } from "hunkdiff/extension";

type GraphQLResponse = { data?: Record<string, unknown>; errors?: Array<{ message?: string }> };

async function githubGraphQL<T>(query: string, variables: Record<string, string | number>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, error: "Set GH_TOKEN or GITHUB_TOKEN to sync viewed files with GitHub" };
  let response: Response;
  try {
    response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "hunk-review-flow",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    return { ok: false, error: `GitHub request failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  let payload: GraphQLResponse;
  try {
    payload = await response.json() as GraphQLResponse;
  } catch {
    return { ok: false, error: `GitHub returned an invalid response (HTTP ${response.status})` };
  }
  if (!response.ok) {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
    return { ok: false, error: message || `GitHub request failed (HTTP ${response.status})` };
  }
  try {
    const message = payload.errors?.map((error) => error.message).filter(Boolean).join("; ");
    if (message) return { ok: false, error: message };
    return { ok: true, data: (payload.data ?? {}) as T };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function pullRequestParts(review: ExtensionReviewDescriptor | null) {
  if (!review || review.kind !== "change-request" || review.provider.toLowerCase() !== "github") return null;
  const match = review.id.match(/^#?(\d+)$/);
  const [owner, name, extra] = (review.repository ?? "").split("/");
  if (!match || !owner || !name || extra) return null;
  return { owner, name, number: match[1] };
}

export function inferGitHubPullRequestReview(sourceLabel: string, cwd: string): ExtensionReviewDescriptor | null {
  const patchName = basename(sourceLabel);
  const patchMatch = patchName.match(/^(.+)-pr-(\d+)\.diff$/i);
  if (!patchMatch) return null;
  const remote = spawnSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (remote.error || remote.status !== 0) return null;
  const value = remote.stdout.trim();
  const httpsValue = value.startsWith("git@github.com:")
    ? `https://github.com/${value.slice("git@github.com:".length)}`
    : value;
  try {
    const url = new URL(httpsValue);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repoWithSuffix, ...rest] = url.pathname.split("/").filter(Boolean);
    const repo = repoWithSuffix?.replace(/\.git$/i, "");
    if (!owner || !repo || rest.length > 0 || repo.toLowerCase() !== patchMatch[1].toLowerCase()) return null;
    return {
      kind: "change-request",
      provider: "GitHub",
      title: `Pull request #${patchMatch[2]}`,
      id: `#${patchMatch[2]}`,
      repository: `${owner}/${repo}`,
    };
  } catch {
    return null;
  }
}

export async function syncGitHubViewed(review: ExtensionReviewDescriptor | null, path: string, viewed: boolean) {
  const pr = pullRequestParts(review);
  if (!pr) return { ok: true as const, skipped: true };

  const lookup = await githubGraphQL<{ repository?: { pullRequest?: { id?: string } | null } }>(
    "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { id } } }",
    { owner: pr.owner, name: pr.name, number: Number(pr.number) },
  );
  if (!lookup.ok) return lookup;
  const nodeId = lookup.data.repository?.pullRequest?.id;
  if (!nodeId) return { ok: false as const, error: "Could not find the GitHub pull request" };

  const mutation = viewed
    ? "mutation($pullRequestId: ID!, $path: String!) { markFileAsViewed(input: {pullRequestId: $pullRequestId, path: $path}) { clientMutationId } }"
    : "mutation($pullRequestId: ID!, $path: String!) { unmarkFileAsViewed(input: {pullRequestId: $pullRequestId, path: $path}) { clientMutationId } }";
  const result = await githubGraphQL<Record<string, unknown>>(mutation, { pullRequestId: nodeId, path });
  return result.ok ? { ok: true as const, skipped: false } : result;
}

export async function fetchGitHubViewed(review: ExtensionReviewDescriptor | null) {
  const pr = pullRequestParts(review);
  if (!pr) return { ok: true as const, skipped: true, viewedPaths: new Set<string>() };

  const viewedPaths = new Set<string>();
  let cursor: string | undefined;
  while (true) {
    const query = "query($owner: String!, $name: String!, $number: Int!, $cursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { files(first: 100, after: $cursor) { nodes { path viewerViewedState } pageInfo { hasNextPage endCursor } } } } }";
    const variables: Record<string, string | number> = { owner: pr.owner, name: pr.name, number: Number(pr.number) };
    if (cursor) variables.cursor = cursor;
    const result = await githubGraphQL<{
      repository?: { pullRequest?: { files?: {
        nodes?: Array<{ path: string; viewerViewedState: string }>;
        pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
      } } | null };
    }>(query, variables);
    if (!result.ok) return result;
    const files = result.data.repository?.pullRequest?.files;
    if (!files) return { ok: false as const, error: "Could not read viewed files for the GitHub pull request" };
    for (const file of files.nodes ?? []) {
      if (file.viewerViewedState === "VIEWED") viewedPaths.add(file.path);
    }
    if (!files.pageInfo?.hasNextPage) break;
    if (!files.pageInfo.endCursor || files.pageInfo.endCursor === cursor) {
      return { ok: false as const, error: "GitHub returned an invalid file pagination cursor" };
    }
    cursor = files.pageInfo.endCursor;
  }
  return { ok: true as const, skipped: false, viewedPaths };
}
