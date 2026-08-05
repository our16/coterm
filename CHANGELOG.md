# Changelog

All notable changes to CoTerm are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.3.2] - 2026-08-05

### Fixes

- Interactive attach (`coterm run`/`activate` view) no longer garbles pasted text.
  Replaced per-chunk `toString('utf8')` forwarding with a transparent byte bridge
  (`src/cli/paste-bridge.ts`): bracketed paste + `StringDecoder` keep multi-byte
  UTF-8 (Chinese/emoji) intact across chunk boundaries, and Ctrl+V now behaves
  identically to right-click paste. Rendering and paste are left to the real
  terminal (Windows Terminal), matching the design doc's "CoTerm is not a renderer"
  positioning.

## [0.3.0] - 2026-08-01

### conda-activate style environment

- `coterm` (bare) auto-starts the daemon (idempotent) and activates the shared environment.
- CLI commands now act on the running daemon via a plain JSON `/cli` endpoint (`node:http`, no undici) —
  `coterm list/status/run/read/...` manage the shared sessions, not an empty in-process registry.
- Session id is optional on commands — defaults to the first running session.
- `coterm create` to add local / ssh / wsl / docker sessions.

### PowerShell integration (auto-installed)

- On first activation, CoTerm installs `~/.config/coterm/powershell.ps1` automatically.
- The prompt shows `(coterm) ` (preserved alongside conda's `(base)`) while active, driven by a
  state-file marker (`~/.config/coterm/active`).
- Shorthand commands (`list`, `status`, `run`, `read`, `stop`, ...) work without the `coterm` prefix.
- `coterm install-powershell` for manual setup; prompt clears on `coterm stop`.

### Config & distribution

- `~/.config/coterm/config.json` auto-generated with defaults (`mcp_server_port`, `defaultShell`).
- `mcp_server_port` flat key (host is always local); `coterm config` / `config-set`.
- Environment-aware default shell detection (pwsh > powershell > cmd; `$SHELL`/bash on POSIX).
- `list`/`status`/`info` render human-readable output instead of raw JSON.
- Single self-contained `coterm.exe` for distribution (embedded Node runtime + ConPTY binaries).
- Fix: packaged exe self-spawn now passes the embedded entrypoint (daemon starts in ~2s, hidden).

## [0.2.0] - 2026-08-01

### Single-process daemon (shared sessions)

- `coterm start` now runs a **single-process MCP daemon** over HTTP (Streamable HTTP transport).
  Multiple agents and terminal renderers connect to the same process and share one session
  registry — Agent A's session is visible, attachable, and readable by Agent B.
- Default MCP endpoint: `http://127.0.0.1:8377/mcp` (was `8080`).
- `coterm mcp` retains the single-agent stdio mode for ad-hoc use.

### User configuration (`~/.config/coterm.json`)

- New config file with `mcp.host`, `mcp.port`, `defaultShell`, `defaultCwd`.
- New commands: `coterm config` (show) and `coterm config-set <key> <value>` (edit).
- CLI flags override config values.

### Release & security

- Release workflow now publishes release notes from this `CHANGELOG.md`.
- Pre-commit secret scanner, hardened `.gitignore`, and gitleaks CI in place.

## [0.1.0] - 2026-08-01

Initial release — the AI-native terminal session runtime.

### Session runtime (L1)

- PTY-backed sessions on Windows (ConPTY) and POSIX (forkpty), managed through `node-pty`.
- Full session lifecycle: `created → starting → running → active → paused → closed`.
- Ownership model (Human owns, AI collaborates) with attach/detach.
- Screen buffer (ANSI-aware) and multi-shell prompt detection (PowerShell, CMD, bash, zsh, fish...).

### Connectors (L1)

- `local` (PowerShell / CMD / bash), `ssh` (interactive, keeps bastion/OTP sessions alive),
  `wsl`, `docker exec`.

### Human + AI collaboration (L2)

- Priority-based **input arbitration**: human input always wins; AI input is queued;
  Ctrl+C interrupts AI commands.
- Presence states: `idle / human-typing / ai-thinking / ai-running`.

### Session intelligence (L3)

- Error-aware current-directory tracking (no `pwd` probe).
- Toolchain detection via PATH scan (node / python / git / docker...).
- Full-screen app detection (vim/top/less) via ANSI alternate-screen sequences.
- Command graph: command, requester, duration, error heuristic, output preview.

### AI runtime (L4)

- Multi-agent attach with distinct identities sharing one session.
- Session recording (JSONL) and replay.
- Session snapshot / restore with continuity.

### Workspace (L5)

- Named session groups with parallel `run` across members.

### Integration

- MCP server: 23 terminal + workspace tools (stdio, then HTTP daemon in 0.2.0).
- Session API (in-process TypeScript) for terminal renderers.
- Full CLI for lifecycle, inspection, recording, snapshots, and workspaces.
- Windows standalone `coterm.exe` via `bun build` + `pkg`.
