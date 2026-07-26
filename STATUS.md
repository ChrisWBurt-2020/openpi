# OpenPi — Current Status

Surface state of the desktop workbench as of the latest release. Not a rule surface; for project rules see `AGENTS.md`. For direction and phases see `ROADMAP.md`.

## Mission

OpenPi is a **human-enabling workbench** for [Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`): make sessions **visible** and **steerable**, keep the **MIT agent core** in Pi (not a second runtime), and treat the user as the **quality gate** — aligned with Pi’s minimal harness and inspectability goals. See **Philosophy** in `ROADMAP.md`.

## Beta (v0.2.4 + unreleased)

### Shipped

- Secure Electron main/preload boundary (Zod IPC, sandboxed renderer, main-owned FS/PTY/Git).
- Pi session host: streaming conversation, model controls, steer/follow-up queues, abort, fork, rename.
- Concurrent session host: up to three isolated live Pi workers, per-thread renderer snapshots, safe capacity refusal, and retained background progress across chat switches.
- Workspace/session sidebar: search/sort/group, pin/archive, token/cost badges, Git branch metadata.
- Persistent Projects → Chats sidebar with all-project visibility, per-chat running indicators, and hover metadata cards.
- Customizations: Extensions, Skills, Prompts, Themes, Packages, Settings, General, Keybindings.
- Command palette (`⇧⌘P`): commands, `fff` files, sessions.
- Git panel, file tree/search, CM6 file viewer, split diff viewer (main-owned Git).
- Terminal/output panel: multi-tab PTY, renameable tabs, exit indicators.
- **Trust (Phase 6):** workspace trust, extension/package install confirms, protected paths, high-risk shell/Git mutation prompts, secret redaction, diagnostics export bundle, SQLite hardening.
- **Pi-task delegation:** `@heyhuynhgiabuu/pi-task` `task` tool; `.pi/artifacts/TASKS.md` tray + live task widget; click a `task` tool row to navigate to the sub-session; install via Pi packages (`pi install npm:@heyhuynhgiabuu/pi-task`).
 - Conversation polish: live token counter (streaming), code line numbers, tool cards.
- Pi Signals: mentor-mode, evidence-backed inline cards with confidence/basis labels, a session digest, and an explicit project notebook.
- Themes: bundled dark-only **Heron Flight** (celestial indigo/cyan) and **Natural Focus** (forest/gold), with Pi-compatible definitions, renderer atmosphere, reduced-motion and forced-colors fallbacks, and live terminal/editor palette refresh.
- **Remote projects:** Add Project distinguishes **SSH Workspace** (local Pi/model catalog, remote tools) from **Persistent Remote Runner** (VPS Pi/runtime). New projects default to SSH Workspace; existing projects remain runners. The project rail and top bar identify the active execution source.
- **Workspace stabilization (unreleased):** local non-Git folders retain their filesystem tree without Git metadata; Pi event/statistics failures are isolated from the conversation; SSH Workspace transport has validated requests, bounded deadlines, SFTP reuse for structured operations, fixed-shell file discovery, cancellation, correlated lifecycle logs, and direct-result envelope handling.
 - Agent review: unified Review tab now has a source dropdown for `Git changes` vs `Last turn changes`; last-turn mode uses agent snapshots, file accordions, proper diff rendering, Keep/Revert/Revert all, coalesces repeated edits per file, and supports diff line comments with hover `+`, content-row multi-select, saved annotations, composer chips, and structured `<file_comment>` prompt context.
 - CI: PR/main checks; tag-triggered beta releases (macOS/Windows/Linux). **Signing/notarization not configured.**

### Next (Phase 7 — see ROADMAP)

- **P0:** `npm test` coverage for critical paths, hunk-level/pre-apply diff polish, **live token/cost per turn** while streaming.

- **P1:** Session tree map v2, subagent card polish.
- **P2:** Auto-updater release validation after signing.

## Known constraints

- macOS primary; other platforms less tested.
- Packaging via `electron-builder`; in-app updates are wired but unsigned release channels remain unsuitable for broad rollout.
- Single-user, local-only, no cloud sync.
- Remote workbench routing remains partially staged. SSH Workspace Pi tools and file-tree/file-read paths use the main-owned SSH transport without local fallback; end-to-end remote Git, terminal, formatting, and watcher coverage is still required before calling the full workbench verified.
- Diagnostic export includes a bounded, redacted lifecycle journal, worker snapshot, and Run snapshot. It excludes prompts, file contents, provider headers, credentials, and full shell commands.
- Pi defaults to **YOLO**; OpenPi adds **optional** desktop policy rails — users can still install Pi [example extensions](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions) for TUI-style gates.

## References

- Pi posts: [coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/), [slow down](https://mariozechner.at/posts/2026-03-25-thoughts-on-slowing-the-fuck-down/), [Earendil](https://mariozechner.at/posts/2026-04-08-ive-sold-out/)
- Upstream: [earendil-works/pi](https://github.com/earendil-works/pi), [pi.dev](https://pi.dev)
