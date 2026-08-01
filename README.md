# CoTerm — AI Native Terminal Runtime

<div align="center">

**English** | [**中文**](README.zh-CN.md)

</div>

> **The runtime layer between AI and the terminal.**

> CoTerm isn't another terminal emulator. It's a **programmable shared terminal session runtime** for Humans, AI Agents, and MCP tools.

<div align="center">

| Shared Terminal Session | Human + AI Collaboration | SSH / PowerShell / WSL / Docker |
|---|---|---|
| MCP Native | Session API | Prompt Detection |
| Screen Buffer | Multi-Agent | Session Replay |

</div>

CoTerm is a headless runtime that manages PTY-backed shell sessions and exposes them to humans and AI through a unified **Session API** and **MCP (Model Context Protocol)** server. Any terminal, AI agent, or IDE plugs into the same shared session.

```
        Human (Tabby / WezTerm / VS Code)
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │          CoTerm Runtime             │
   │  Session ─ PTY ─ Prompt ─ Screen    │
   │  Intelligence ─ Recording ─ Workspace│
   │  Input Arbitration (Human > AI)     │
   └──────────┬──────────────┬───────────┘
              │              │
      Session API      MCP (stdio)
      (in-process)      (AI agents)
```

### What CoTerm IS

| | |
|---|---|
| **Shared Session** | One terminal session, safely shared by a Human, multiple AI agents, and MCP tools — not a new terminal per consumer |
| **Terminal Runtime** | Owns the PTY, screen buffer, prompt detection, and session lifecycle |
| **AI Native** | Agents operate a structured Session API / MCP, not raw keystrokes |
| **MCP Native** | 23 terminal + workspace tools over the standard Model Context Protocol |

### What CoTerm is NOT

| | |
|---|---|
| ❌ A terminal emulator | Rendering is delegated to Tabby / WezTerm / VS Code / Windows Terminal |
| ❌ An SSH client | SSH is just one connector — same as PowerShell, WSL, Docker |
| ❌ A shell | The shell runs inside CoTerm-managed sessions |
| ❌ An AI coding agent | CoTerm is the runtime agents plug into |

---

## Why CoTerm?

Every AI coding tool (Claude Code, OpenHands, Cline, Roo Code…) re-implements the same plumbing:

- PTY lifecycle management
- Output parsing and prompt detection
- Session state and Ctrl+C handling
- Timeouts and error handling

CoTerm solves this once. Any MCP-compatible agent connects and gets a **shared, long-lived terminal session** — it never re-logins, never re-initializes the environment, and never pollutes the human's terminal.

- **Windows ConPTY** built in — the platform most terminal-sharing tools ignore.
- **Enterprise SSH** flows (VPN → bastion → OTP → SSH) stay alive inside the session; AI attaches, it doesn't authenticate.
- **Human always wins** — priority-based input arbitration means the human can interrupt any AI command instantly.

---

## Features

### Session Management
- Full lifecycle: `created → starting → running → active → paused → closed`
- Create / attach / detach / close, ownership model (Human owns, AI collaborates)

### Connectors
| Connector | Target | Command |
|-----------|--------|---------|
| `local` | Local shell (PowerShell / CMD / bash) | `powershell.exe`, `cmd.exe`, `/bin/bash` |
| `ssh` | Remote host via SSH | `ssh -p <port> [-i <key>] <user>@<host>` |
| `wsl` | WSL distribution | `wsl -d <distro> --cd <dir>` |
| `docker` | Running container | `docker exec -it <container> <shell>` |

### Input Arbitration
- Human input always has priority; AI input is queued
- Human can interrupt any AI command with Ctrl+C (`session:interrupted`)
- Real-time lock/unlock state with events

### Session Intelligence (L3)
- **Current directory** tracking (error-aware, via `cd` parsing — no `pwd` probe)
- **Toolchain detection** (node / python / git / docker…) via PATH scan — no subprocess
- **Full-screen app detection** (`vim`, `top`, `less`) via ANSI alternate-screen sequences
- **Command graph** — every command with requester, duration, error heuristic, and output preview

### AI Runtime (L4)
- **Multi-AI attach** — several agents share one session with distinct identities
- **Session recording** — JSONL event log (output, prompts, commands, interrupts)
- **Snapshot / restore** — capture config + screen + history, recreate a session with continuity

### Workspace (L5)
- Group sessions into named workspaces (e.g. a deploy workspace of Linux / Redis / MySQL / K8s)
- Run commands across all members in parallel

### Integration
- **MCP server** over stdio — 23 terminal + workspace tools
- **Session API** — programmatic TypeScript interface for terminal renderers
- **CLI** — full session lifecycle and inspection commands
- **Windows standalone** — a single `coterm.exe`, no Node.js or bun required

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict) |
| Dev runtime | bun (bundler, test runner) |
| Production runtime | Node.js (via `tsx` dev / `pkg` exe) |
| PTY | `node-pty` (ConPTY on Windows, forkpty on POSIX) |
| AI protocol | `@modelcontextprotocol/sdk` |
| CLI | `commander` |
| Validation | `zod` |
| Logging | `pino` (to stderr, keeps MCP stdio clean) |

> **Note:** On Windows, `node-pty` ConPTY writes are unreliable under the bun *runtime*. CoTerm runs the PTY layer under Node (dev via `tsx`, distribution via `pkg`). The CLI warns when launched via bun.

---

## Quick Start

Requirements: [bun](https://bun.sh) (dev), Node.js 18+.

```bash
bun install

# Type-check and run tests
bun run typecheck
bun test
```

### Activate the environment (conda-activate style)

```bash
coterm            # starts the daemon (if not running) and activates the shared environment
coterm activate   # same, explicit

# Now every command acts on the shared environment's default session
coterm run --command "kubectl get pods"   # runs in the native shell session (no session id needed)
coterm status                             # cwd, toolchains, command graph
coterm list                               # all sessions
coterm env                                # environment status
coterm stop                               # deactivate (stops the daemon)
```

Commands pick the first running session when you omit a session id. To target a specific session, pass it: `coterm status <sessionId>`.

### Configuration (`~/.config/coterm.json`)

The daemon reads its MCP port/host and shell defaults from a config file. CLI flags always override it.

```bash
coterm config                        # show config path + effective MCP endpoint
coterm config-set mcp_server_port 9000   # change the MCP port
coterm config-set defaultShell cmd.exe
```

```json
{
  "mcp_server_port": 8377,
  "defaultShell": "powershell.exe",
  "defaultCwd": "C:\\work"
}
```

### Create sessions with connectors

```bash
coterm create --connector ssh --host jump.company.com --user admin --port 22
coterm create --connector wsl --distro Ubuntu
coterm create --connector docker --container web
```

---

## Connecting an AI Agent (MCP)

### Multiple agents sharing one daemon (recommended)

Run a single daemon, then any number of agents connect over HTTP and **share the same sessions**:

```json
{
  "mcpServers": {
    "coterm": {
      "type": "http",
      "url": "http://127.0.0.1:8377/mcp"
    }
  }
}
```

Agent A creates a session; Agent B sees and attaches to it — one process, one shared session registry.

### Single agent over stdio (ad-hoc)

```json
{
  "mcpServers": {
    "coterm": {
      "command": "coterm",
      "args": ["mcp"]
    }
  }
}
```

### Terminal tools

| Tool | Description |
|------|-------------|
| `terminal_create` | Create a session (local / ssh / wsl / docker) |
| `terminal_list` | List active sessions |
| `terminal_attach` | Attach an AI (with an optional agent id) |
| `terminal_detach` | Detach an AI |
| `terminal_read` | Read last N lines of output |
| `terminal_write` | Write raw input (arbitrated) |
| `terminal_run` | Run a command and wait for the next prompt |
| `terminal_wait_prompt` | Wait for command completion |
| `terminal_resize` | Resize the PTY |
| `terminal_interrupt` | Send Ctrl+C |
| `terminal_close` | Close a session |
| `terminal_status` | Structured session intelligence + presence |
| `terminal_history` | Recorded command graph |
| `terminal_recording` | Start / stop session recording |
| `terminal_replay` | Replay recorded events (JSONL) |
| `terminal_snapshot` | Capture a session snapshot |
| `terminal_restore` | Restore a session from a snapshot |

### Workspace tools

| Tool | Description |
|------|-------------|
| `workspace_create` | Create a named session group |
| `workspace_add` | Add a session to a workspace |
| `workspace_remove` | Remove a session from a workspace |
| `workspace_list` | List workspaces |
| `workspace_run` | Run a command across all members |
| `workspace_status` | Show member state / presence / cwd |

---

## Session API (for terminal renderers)

CoTerm exposes an in-process TypeScript API so terminal frontends (Tabby, WezTerm, VS Code) can embed the runtime:

```typescript
import { SessionAPI } from './src/api/session-api.js';

const api = new SessionAPI();

const sessionId = await api.createSession({ shell: 'powershell.exe' });
await api.runCommand(sessionId, 'git pull', 'ai');
await api.waitForPrompt(sessionId);
console.log(api.readText(sessionId));

const unsub = api.onPromptDetected(sessionId, (prompt) => {
  console.log('command finished at', prompt);
});

await api.close(sessionId);
```

---

## Standalone Executables (Windows / Linux / macOS)

Package self-contained binaries — no Node.js or bun needed on the target machine:

```bash
bun run package:windows   # -> coterm.exe
bun run package:linux     # -> coterm
bun run package:macos     # -> coterm
```

Pushing a `v*` tag runs the release workflow on all three platforms (`windows-latest` / `ubuntu-latest` / `macos-latest`) and publishes **one GitHub Release** with `coterm-windows-x64.exe`, `coterm-linux-x64`, and `coterm-macos-x64`. Each binary embeds the Node.js runtime, all code, and node-pty's native binaries (ConPTY on Windows, forkpty on POSIX).

### Shell integration (prompt prefix + shorthand commands)

After `coterm activate`, the shell prompt shows a `(coterm) ` prefix and shorthand commands
(`list`, `status`, `run`, `stop`, ...) work without the `coterm` prefix. It is **auto-installed
on first activation** — or manually:

| Platform | Command | Effect |
|----------|---------|--------|
| PowerShell (Windows) | `coterm install-powershell` | writes `~/.config/coterm/powershell.ps1`, sources it from `$PROFILE` |
| bash / zsh (Linux/macOS) | `coterm install-shell` | writes `~/.config/coterm/coterm.sh`, sources it from `~/.bashrc` / `~/.zshrc` |

```bash
# any platform
coterm            # auto-starts daemon (hidden) + activates; prompt gains "(coterm) "
list              # shorthand — no "coterm" prefix needed
run --command "echo hi"
status
stop              # deactivates; prompt reverts
```

> `read` and `history` shorthands are omitted on bash/zsh to avoid clashing with shell builtins (use `coterm read` / `coterm history`).

### Distribution

**Ship only the single binary** — it is fully self-contained. On each target machine just run it:
`coterm` activates (and auto-installs the shell integration on first use). Restart the shell
(or `source ~/.bashrc` / `. $PROFILE`) to see the `(coterm) ` prompt.

Optional per-user config lives at `~/.config/coterm/config.json` (`mcp_server_port`, `defaultShell`). Everything else is auto-generated at runtime.

---

## Project Structure

```
src/
├── index.ts              # CLI entry
├── main.ts               # Runtime bootstrap
├── api/session-api.ts    # Programmatic Session API
├── core/                 # types, event-bus, session, session-manager
├── pty/                  # PTY adapters (Windows / POSIX) + factory
├── connectors/           # local / ssh / wsl / docker
├── buffer/               # screen buffer, prompt detector
├── queue/                # command queue, input scheduler (arbitration)
├── intelligence/         # cwd, toolchains, screen mode, command graph
├── ai/                   # multi-AI, recorder, snapshot/restore
├── workspace/            # session groups
├── mcp/                  # MCP server + tools
└── cli/                  # CLI commands
```

---

## Roadmap

- [x] **L1** Session / PTY / Prompt detection / Connectors
- [x] **L2** Input arbitration + Presence
- [x] **L3** Session Intelligence (cwd, toolchains, command graph, full-screen detection)
- [x] **L4** AI Runtime (multi-AI, recording, snapshot)
- [x] **L5** Workspace (session groups, batch commands)
- [ ] Plugin ecosystem (recorder, metrics, notification)
- [ ] CI/CD cross-platform builds
- [ ] Desktop UI (Tauri + React) as a renderer frontend

---

## License

[MIT](LICENSE)
