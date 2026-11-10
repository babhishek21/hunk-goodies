# Hunk Goodies

**Useful little things for Hunk.**

A collection of practical enhancements for [Hunk](https://www.hunk.dev), filling the gaps in everyday review workflows.

Mark files as viewed, fold away diffs, stage individual hunks, and more. Small, focused additions that make Hunk a little more capable without getting in your way.

## Installation

```sh
hunk extension install babhishek21/hunk-goodies
```

Run `hunk extension update hunk-goodies` to update to the latest version.

## Features

### Review tracking

Keep track of where you are, even across sessions.

- **Mark as viewed:** Press `V` to mark the selected file as viewed or unviewed.
- **Automatic folding:** Viewed files collapse into a single summary row, keeping unfinished reviews in focus.
- **Persistent marks:** Viewed status is restored across Hunk sessions.
- **Patch-aware tracking:** SHA-256 fingerprints detect changes to previously reviewed patches and automatically invalidate stale marks.
- **Bulk folding:** `Ctrl+G` toggles folding for all viewed files without changing their marks.
- **Remote reviews:** Viewed-files sync with your GitHub pull requests via `hunk gh pr`.

### Git operations

Make staging decisions as part of your review, without switching tools.

- **Stage files:** Press `S` to stage the selected file.
- **Stage hunks:** Press `T` to stage the selected hunk.
- **Unstage files:** Press `U` to unstage a selected file when reviewing staged changes.
- **Unstage hunks:** Press `H` to unstage the selected hunk.
- **Staged-file picker:** From a working-tree review, `U` opens a picker to select staged files.

### Review interface

A familiar Hunk experience, with a little more context.

- **Enhanced files pane:** Retains Hunk's tree and compact layouts, status icons, selection stripe and diff statistics.
- **Viewed indicators:** A `✓` identifies viewed files, including marks restored from disk.
- **Review progress:** The statusline displays viewed-file progress.
- **Git statistics:** Staged file and hunk counts are displayed alongside review progress, including changes staged before opening Hunk.
- **Extensions menu:** Commands are available through Hunk's Extensions menu and can be remapped in the `[keybindings]` table of your Hunk user `config.toml`.

## Keyboard shortcuts

| Key | Action | `config.toml` keybinding |
|---|---|---|
| `V` | Toggle viewed status | `"hunk-goodies.toggleViewed" = "V"` |
| `S` | Stage selected file | `"hunk-goodies.stageFile" = "S"` |
| `T` | Stage selected hunk | `"hunk-goodies.stageHunk" = "T"` |
| `U` | Unstage selected file / open staged-file picker | `"hunk-goodies.unstageFile" = "U"` |
| `H` | Unstage selected hunk | `"hunk-goodies.unstageHunk" = "H"` |
| `Ctrl+G` | Toggle folding for all viewed files | `"hunk-goodies.toggleViewedFolding" = "ctrl+g"` |

Add these entries under `[keybindings]` in your [Hunk `config.toml`](https://www.hunk.dev/docs/configure/configuration/#change-keyboard-shortcuts):

```toml
[keybindings]
"hunk-goodies.toggleViewed" = "V"
"hunk-goodies.stageFile" = "S"
"hunk-goodies.stageHunk" = "T"
"hunk-goodies.unstageFile" = "U"
"hunk-goodies.unstageHunk" = "H"
"hunk-goodies.toggleViewedFolding" = "ctrl+g"
```

The extension id is the name of the extension folder, so replace `hunk-goodies` if you installed it under a different name. `[keybindings]` is read from the user config only, not a repository's `.hunk/config.toml`.

## Gotchas, limitations and implementation notes

### Staging
- Staging works only in an unstaged working-tree review, including binary files. Likewise, unstaging works only on staged files.
- Staging commands remain available in the Extensions menu even when unsupported by the current review context, due to limitations in Hunk's extension API.
- File staging uses `git add -- <path>`.
- Hunk staging applies the exact patch supplied by Hunk, with Git validating it against the index.
- Unstage operations validate the selected file or hunk against the current staged diff.
- On staging a file, it will be removed from the viewer. This is by design, as the file is no longer part of the working-tree review (`hunk diff`). The staged file can be reviewed in a separate staged review (`hunk diff --staged`). A convenient picker is provided for unstaging files from a working-tree review.

### Marking files as viewed
- Marking files as viewed works in both local reviews and GitHub pull requests.
- Previously viewed files are not automatically folded when re-opening a review, due to limitations in Hunk's extension API. Press Ctrl+G to fold all viewed files, or take any viewed/unviewed action to fold the remaining viewed files automatically.
- Viewed files are identified by a `✓` in the files pane, and are dimmed.
- Viewed-file marks are stored locally, per repository.

    | Property | Value |
    |---|---|
    | Storage | `$XDG_STATE_HOME/hunk/viewed.json` |
    | Default | `~/.local/state/hunk/viewed.json` |
    | Windows | `%LOCALAPPDATA%\hunk\viewed.json` |
    | Change detection | SHA-256 patch fingerprints |
    | Expiry | 30 days |

    Changed patches automatically invalidate their corresponding viewed marks, preventing review progress from carrying over to a different set of changes.

## Why?

This started as a handful of things I wanted Hunk to do.

The goal is simple: make the everyday review experience more complete without turning it into another kitchen-sink extension. Each addition should solve a genuine gap, complement Hunk's existing functionality, and work naturally alongside the rest.

More useful tools. Less friction.

## Try locally

```sh
bun install                 # optional
hunk --extension . diff
hunk --extension . gh pr
```

## Development

The extension is TypeScript source loaded directly by Hunk; React, OpenTUI, and `hunkdiff/extension` are development-only dependencies. No bundling is needed. Run `bun run typecheck` after `bun install` to check the extension API types. Run `hunk skill show extensions` to understand Hunk's extension API.

---

Built for [Hunk](https://www.hunk.dev).
