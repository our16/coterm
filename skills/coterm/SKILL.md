---
name: coterm
description: >-
  Call CoTerm, the AI-native terminal session runtime, over its local HTTP API
  to run commands in real, shared terminal sessions. CoTerm owns long-lived PTY
  sessions (local PowerShell/cmd/bash, SSH, WSL, Docker). Use this skill to
  execute shell commands, read output, wait for command completion, inspect
  session state, and attach to sessions a human is sharing. This skill is a pure
  HTTP client — it does NOT start the daemon (a human starts it with `coterm`).
---

# CoTerm — HTTP client

CoTerm is a **shared terminal session runtime**. It owns real PTY sessions
(native shells). You call its local HTTP endpoint over **curl** — no MCP client
config needed. A human can share the same session, so you attach to an existing
session instead of starting a fresh shell (SSH logins, env, cwd persist).

- Not a terminal, SSH client, or shell — it's the session layer.
- **Human input always has priority** over your commands.

---

## Prerequisite: the daemon must be running

This skill **does not start or activate** CoTerm. If the daemon isn't running,
your HTTP calls fail with a connection error. In that case, tell the human:

> "CoTerm isn't running. Please run: `coterm` (or `coterm activate`), then I can continue."

---

## Discover the endpoint (read the port)

The daemon port is **not hardcoded** — read it from the user config first:

```bash
cat ~/.config/coterm/config.json
# -> { "mcp_server_port": 8377, "defaultShell": "..." }
```

- Endpoint = `http://127.0.0.1:<mcp_server_port>/cli`
- If the file or key is absent, default to port `8377`.
- You can also run `coterm config` (if `coterm` is on PATH) to see the effective endpoint.

Then use `$PORT` in every request below (replace `8377` with the discovered value).

### Request shape

```
POST http://127.0.0.1:<port>/cli
Content-Type: application/json
Body: { "tool": "<toolName>", "args": { ... } }
```

### Response format

```json
{ "ok": true, "text": "...", "isError": false }
```

- `ok: true` — the tool ran. Read `text`.
- `text` may be **plain text** (run/read output) or **JSON** (list/status/history/create/workspace).
  JSON-parse `text` when the tool returns structured data.
- `isError: true` — the tool returned an error message in `text`; report it and stop.

### curl template

```bash
PORT=$(node -e "const c=require('$HOME/.config/coterm/config.json');process.stdout.write(String(c.mcp_server_port||8377))" 2>/dev/null || echo 8377)

curl -s -X POST http://127.0.0.1:$PORT/cli \
  -H "Content-Type: application/json" \
  -d '{"tool":"terminal_list","args":{}}'
```

---

## Core workflow

Do **not** poll or sleep. Follow this pattern:

1. `terminal_list` — find an existing session (reuse it if suitable).
2. `terminal_create` — if you need a new session (connector: local | ssh | wsl | docker).
3. `terminal_attach` — register as a participant on a shared session (optional but polite).
4. `terminal_run` — write a command **and wait for the next shell prompt** (blocking; set `timeout`).
5. `terminal_read` — read output.
6. `terminal_status` — inspect cwd, toolchains, full-screen app, command graph before acting.
7. `terminal_close` — clean up when done.

### Example (curl)

```bash
# list sessions
curl -s -X POST http://127.0.0.1:$PORT/cli -H "Content-Type: application/json" \
  -d '{"tool":"terminal_list","args":{}}'

# create a new local session
curl -s -X POST http://127.0.0.1:$PORT/cli -H "Content-Type: application/json" \
  -d '{"tool":"terminal_create","args":{"name":"work"}}'
# -> {"ok":true,"text":"{\"sessionId\":\"<id>\"}"}

# run a command and wait for the prompt (blocking up to timeout ms)
curl -s -X POST http://127.0.0.1:$PORT/cli -H "Content-Type: application/json" \
  -d '{"tool":"terminal_run","args":{"sessionId":"<id>","command":"git status","timeout":30000}}'

# read the last 30 lines
curl -s -X POST http://127.0.0.1:$PORT/cli -H "Content-Type: application/json" \
  -d '{"tool":"terminal_read","args":{"sessionId":"<id>","lines":30}}'

# structured state (cwd, tools, full-screen app, last command, error)
curl -s -X POST http://127.0.0.1:$PORT/cli -H "Content-Type: application/json" \
  -d '{"tool":"terminal_status","args":{"sessionId":"<id>"}}'
```

---

## Tool reference (curl)

All follow the same `POST /cli` shape with `{"tool":"<name>","args":{...}}`.

### Sessions
| Tool | args | Notes |
|------|------|-------|
| `terminal_create` | `name`, `shell`, `cwd`, `cols/rows`, `connector:{type,host,user,port,identity,distro,container}` | returns `text` = `{"sessionId":"..."}` |
| `terminal_list` | — | returns JSON array in `text` |
| `terminal_status` | `sessionId` | returns JSON: `cwd`, `state`, `fullScreenApp`, `toolchains`, `commands`, `lastCommand`, `presence`, `participants`, `info` |
| `terminal_close` | `sessionId` | kills the session |

### I/O
| Tool | args | Notes |
|------|------|-------|
| `terminal_write` | `sessionId`, `data` | raw input (human wins on conflict) |
| `terminal_run` | `sessionId`, `command`, `timeout` | writes cmd+Enter, **blocks until prompt** (or `timeout` ms) |
| `terminal_wait_prompt` | `sessionId`, `timeout` | blocks until the current command finishes |
| `terminal_read` | `sessionId`, `lines` | last N lines, ANSI-stripped |
| `terminal_interrupt` | `sessionId` | sends Ctrl+C |
| `terminal_resize` | `sessionId`, `cols`, `rows` | resize PTY |

### Collaboration & recording
| Tool | args |
|------|------|
| `terminal_attach` / `terminal_detach` | `sessionId`, `agent` |
| `terminal_history` | `sessionId`, `limit` |
| `terminal_recording` | `sessionId`, `action` (start/stop) |
| `terminal_replay` | `sessionId`, `format` |
| `terminal_snapshot` / `terminal_restore` | `sessionId` / `snapshot` |

### Workspaces (group sessions)
`workspace_create` (`name`), `workspace_list`, `workspace_add`/`remove` (`workspaceId`, `sessionId`), `workspace_run` (`workspaceId`, `command`), `workspace_status` (`workspaceId`).

---

## Best practices

- **Reuse sessions, don't recreate.** If a session exists (e.g. an SSH/bastion
  session already logged in), attach to it — avoid passwords/MFA/re-init.
- **Wait, don't sleep.** `terminal_run`/`terminal_wait_prompt` block until the
  shell returns to a prompt. Never `sleep` between a command and reading output.
- **Set `timeout`** on `terminal_run` (e.g. 60s for builds). On timeout, read
  output to see partial progress, then decide.
- **Check state first.** `terminal_status` tells you cwd, available toolchains,
  whether a full-screen app (`vim`/`top`/`less`) is running, and last command's
  error. If `fullScreenApp` is true, **do not inject commands** — ask the human
  or `terminal_interrupt` first.
- **Respect the human.** A human sharing the session has input priority and can
  Ctrl+C your command.
- **SSH/WSL/Docker are connectors.** `terminal_create` with a `connector` lands
  you inside a remote host/container; the same tools apply afterward.
- **Output is ANSI-stripped** in `terminal_read` — don't parse escape codes.

---

## Troubleshooting

- **`Connection refused` / `Could not connect`** — daemon not running. Tell the
  human to run `coterm` (this skill never starts it).
- **`isError: true`** — read `text` for the message (e.g. "Session not found").
- **Session `closed`** — the shell exited; `terminal_create` a new one.
- **`terminal_run` timed out** — the command is still running (build, interactive
  program, full-screen app). `terminal_read` for partial output, or
  `terminal_interrupt`.
- **No running session** — `terminal_create` one (shell is auto-detected per
  platform: `pwsh`/`powershell`/`cmd` on Windows, `$SHELL` on POSIX).
