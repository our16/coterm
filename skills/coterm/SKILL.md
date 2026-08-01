---
name: coterm
description: >-
  Use CoTerm, the AI-native terminal session runtime, to run commands in real,
  shared terminal sessions. CoTerm owns long-lived PTY sessions (local
  PowerShell/cmd/bash, SSH, WSL, Docker). Connect over MCP (HTTP or stdio) to
  create/attach sessions, run commands, wait for prompt, read output, inspect
  session state, and coordinate with a human. Use when you need to execute shell
  commands, inspect terminal output, share an SSH/bastion session, or act on an
  existing terminal session without re-login.
---

# CoTerm — AI-native Terminal Session Runtime

CoTerm is a **shared terminal session runtime**. It spawns and owns real PTY
sessions (native shells) and exposes them to you over MCP. A human can share the
same session — you attach to an existing session instead of starting a fresh
shell every time, so state (SSH logins, env, cwd, installed tools) persists.

- Not a terminal emulator, not an SSH client, not a shell. It is the session
  layer between you and the shell.
- **Human input always has priority** over your input.

---

## 1. Connect

CoTerm exposes an MCP server. Prefer the **HTTP daemon** (shared, long-lived) so
sessions survive across your tool invocations.

### HTTP daemon (recommended — sessions persist across calls)

A human (or you) starts it once:

```bash
coterm            # starts the daemon + activates; logs show the endpoint
```

Then configure your MCP client:

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

### stdio (single-shot, ad-hoc)

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

Check the endpoint/port: `coterm config` (config lives at
`~/.config/coterm/config.json`; port is `mcp_server_port`).

---

## 2. Core workflow

For almost any task, follow this pattern — do **not** poll or sleep:

1. **List or create** a session:
   - `terminal_list` — see existing sessions and attach to them.
   - `terminal_create` — new session (`connector`: local | ssh | wsl | docker).
2. **Attach** (if needed): `terminal_attach { sessionId, agent }` to register as
   a participant on the shared session.
3. **Run** a command: `terminal_run { sessionId, command, timeout }` — writes the
   command + Enter **and waits for the next shell prompt** (no sleeping).
4. **Read** output: `terminal_read { sessionId, lines }`.
5. **Inspect** state: `terminal_status { sessionId }` → cwd, toolchains, whether a
   full-screen app is running, command graph, participants.
6. **Clean up**: `terminal_close` when done.

### Example sequence

```
terminal_list                         # find an existing session
terminal_create { connector: { type: "ssh", host: "jump.company.com", user: "admin" } }
terminal_run    { sessionId, command: "cd /var/www && git status", timeout: 30000 }
terminal_read   { sessionId, lines: 30 }
terminal_status { sessionId }        # cwd, tools, last command, error status
terminal_close  { sessionId }
```

> If a full-screen app (`vim`, `top`, `less`) is running (`terminal_status` →
> `fullScreenApp: true`), **do not** inject commands — the app owns the screen.
> Ask the human or interrupt first.

---

## 3. Tool reference

### Sessions
| Tool | Purpose | Key args |
|------|---------|----------|
| `terminal_create` | Spawn a session | `connector{type,host,user,port,identity,distro,container}`, `shell`, `cwd`, `cols/rows` |
| `terminal_list` | List sessions | — |
| `terminal_status` | Structured state (cwd, toolchains, full-screen app, command graph, presence) | `sessionId` |
| `terminal_close` | Kill the session | `sessionId` |

### I/O
| Tool | Purpose | Key args |
|------|---------|----------|
| `terminal_write` | Raw input (arbitrated; human wins) | `sessionId`, `data` |
| `terminal_run` | Write command + wait for prompt | `sessionId`, `command`, `timeout` |
| `terminal_wait_prompt` | Block until command finishes | `sessionId`, `timeout` |
| `terminal_read` | Last N lines of output | `sessionId`, `lines` |
| `terminal_interrupt` | Send Ctrl+C | `sessionId` |
| `terminal_resize` | Resize PTY | `sessionId`, `cols`, `rows` |

### Collaboration
| Tool | Purpose | Key args |
|------|---------|----------|
| `terminal_attach` | Join a shared session as a participant | `sessionId`, `agent` |
| `terminal_detach` | Leave a shared session | `sessionId`, `agent` |
| `terminal_history` | Recorded command graph | `sessionId`, `limit` |

### Recording & state
| Tool | Purpose | Key args |
|------|---------|----------|
| `terminal_recording` | Start/stop JSONL recording | `sessionId`, `action` |
| `terminal_replay` | Read recorded events | `sessionId`, `format` |
| `terminal_snapshot` | Capture config+screen+history | `sessionId` |
| `terminal_restore` | Recreate a session from a snapshot | `snapshot` |

### Workspaces (group several sessions)
| Tool | Purpose |
|------|---------|
| `workspace_create` / `workspace_list` | Group sessions |
| `workspace_add` / `workspace_remove` | Membership |
| `workspace_run` | Run a command across all members |
| `workspace_status` | State/presence/cwd of members |

---

## 4. Best practices

- **Reuse sessions, don't recreate.** If `terminal_list` shows a suitable session
  (e.g. an SSH/bastion session that already logged in), attach to it — you avoid
  passwords, MFA, and re-initializing the environment.
- **Wait, don't sleep.** `terminal_run` / `terminal_wait_prompt` block until the
  shell returns to a prompt. Never `sleep` between a command and reading output.
- **Check state before acting.** `terminal_status` tells you cwd, available
  toolchains, whether a full-screen app is running, and the last command's error
  status. Use it instead of blind `pwd` / `which` / `sleep`.
- **Respect the human.** A human sharing the session always has input priority;
  they can Ctrl+C your command (`terminal_interrupt` on your side, or their own).
- **SSH/WSL/Docker are just connectors.** `terminal_create` with a `connector`
  gives you a session inside a remote host / container — same tools afterward.
- **Output is ANSI-stripped.** `terminal_read` returns readable text; don't try
  to parse escape codes.
- **Long commands:** pick a `timeout` long enough (e.g. 60s for builds); if it
  times out, `terminal_read` to see partial output, then decide.

---

## 5. Troubleshooting

- **"environment is not active"** — the daemon isn't running. Ask the human to
  run `coterm` (or `coterm activate`).
- **Session shows `closed`** — the shell exited; create a new one.
- **Prompt wait timed out** — the command is still running (e.g. an interactive
  program, a build, or a full-screen app). Read output; `terminal_interrupt` if
  needed.
- **No running session found** — `terminal_create` a new one (default shell is
  auto-detected per platform: `pwsh`/`powershell`/`cmd` on Windows, `$SHELL` on
  POSIX).
