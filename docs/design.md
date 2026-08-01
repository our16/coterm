# CoTerm Design Document — AI Session Runtime (bun + tsx)

> **CoTerm = AI Session Runtime**
> A backend layer that manages terminal sessions, exposes Session API + MCP, and provides input arbitration between Human and AI.
> Other terminals (Tabby, WezTerm, VS Code) handle rendering; CoTerm handles session logic.
> Phase 1: Windows standalone program.

---

## 1. Positioning Correction

### What CoTerm IS

- An **AI Session Runtime** — backend service that manages PTY-backed terminal sessions
- A **Session API provider** — programmatic access to sessions for any client
- An **MCP server** — AI agents connect via MCP to interact with sessions
- An **input arbitration layer** — mediates concurrent Human/AI input on shared PTY

### What CoTerm IS NOT

- ❌ A terminal emulator (not a replacement for Tabby, WezTerm, Kitty)
- ❌ A terminal renderer (no built-in UI, no screen rendering)
- ❌ An SSH client (no SSH implementation)
- ❌ A shell (no shell implementation)

### Target Consumers

| Consumer | How They Use CoTerm |
|----------|---------------------|
| **Tabby** | Connects to CoTerm session for AI-assisted terminal input |
| **WezTerm** | Uses CoTerm as a session backend for AI collaboration |
| **VS Code** | Integrates CoTerm session for AI terminal access |
| **AI Agents** | Connect via MCP to read/write sessions |
| **Human (CLI)** | Uses `coterm` CLI to manage sessions |

---

## 2. Architecture

### 2.1 High-Level

```
┌─────────────────────────────────────────────────────┐
│                CoTerm Runtime (bun + tsx)            │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Session Manager                     │ │
│  │  ┌─────────┐  ┌──────────┐  ┌────────────────┐ │ │
│  │  │ Session  │  │  PTY     │  │  Prompt        │ │ │
│  │  │ Registry │  │  Adapter │  │  Detector      │ │ │
│  │  └─────────┘  └──────────┘  └────────────────┘ │ │
│  │  ┌──────────────┐  ┌──────────────┐             │ │
│  │  │ Screen Buffer │  │ Input        │             │ │
│  │  │ (data model)  │  │ Scheduler    │             │ │
│  │  └──────────────┘  └──────────────┘             │ │
│  │  ┌──────────────┐  ┌──────────────┐             │ │
│  │  │ Event Bus     │  │ MCP Server   │             │ │
│  │  └──────────────┘  └──────────────┘             │ │
│  └─────────────────────────────────────────────────┘ │
│              │                │                       │
│     Session API    MCP (stdio / named pipe)          │
│     (programmatic)  (AI agents connect here)         │
└─────────────────────────────────────────────────────┘
              │
   ┌──────────┼──────────────┐
   │          │              │
Tabby      WezTerm        VS Code   ← External terminal renderers
(render)   (render)       (render)
   │          │              │
   └──────────┼──────────────┘
              │
         Human Input → CoTerm Session → Shell Process (ConPTY)
```

### 2.2 Data Flow

```
Human types in Tabby/WezTerm/VS Code
        │
        ▼
  Session API write ──▶ Command Queue ──▶ PTY Adapter ──▶ Shell Process
        │                                                      │
        │                                              Output stream
        │                                                      │
        ▼                                                      ▼
  Screen Buffer ←──── PTY Adapter output ←──── Shell Process
        │
        ▼
  Prompt Detector (on new output)
        │
        ▼
  Event Bus: promptDetected → AI Agent (via MCP) can now write command
        │
        ▼
  AI Agent writes via MCP: terminal_write → Command Queue → PTY Adapter
```

### 2.3 Input Arbitration

The core innovation: Human and AI share the same PTY. Only one can write at a time.

```
Human Input (from terminal renderer) ──┐
                                       │
                              ┌────────▼────────┐
                              │  Input Scheduler │
                              │  (mutex on PTY)  │
                              └────────┬────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                                       ▼
           Human writes command                      AI writes command
           (immediate, high priority)                (queued, waits for turn)
                    │                                       │
                    ▼                                       ▼
           PTY Adapter ──▶ Shell                    PTY Adapter ──▶ Shell
```

Rules:
1. Human input always has priority — AI commands are queued when Human is active
2. When Human presses Enter, AI is notified and can proceed
3. When AI is writing a command, Human can Ctrl+C to interrupt
4. On interrupt, AI receives `session:interrupted` event and stops

---

## 3. Project Structure

```
coterm/
├── package.json                    # bun project config, scripts
├── tsconfig.json                   # TypeScript configuration
├── bun.lockb                       # bun lockfile
├── src/
│   ├── index.ts                    # CLI entry point (coterm command)
│   ├── main.ts                     # Runtime bootstrap (starts session manager + MCP)
│   ├── cli/
│   │   ├── index.ts                # CLI argument parsing
│   │   └── commands.ts             # CLI commands (start, list, attach, etc.)
│   ├── core/
│   │   ├── types.ts                # Shared type definitions
│   │   ├── event-bus.ts            # Typed pub/sub event system
│   │   ├── session.ts              # Individual session state machine
│   │   └── session-manager.ts      # Session registry and lifecycle orchestration
│   ├── pty/
│   │   ├── pty-adapter.ts          # Abstract PTY interface
│   │   └── windows-pty.ts          # Windows ConPTY implementation via node-pty
│   ├── buffer/
│   │   ├── screen-buffer.ts        # Circular buffer + ANSI parsing (data model)
│   │   └── prompt-detector.ts      # Prompt pattern detection engine
│   ├── queue/
│   │   ├── command-queue.ts        # Ordered command execution queue
│   │   └── input-scheduler.ts      # Human/AI input arbitration
│   ├── mcp/
│   │   ├── server.ts               # MCP server (stdio transport for Phase 1)
│   │   └── tools.ts                # MCP tool definitions
│   ├── api/
│   │   └── session-api.ts          # Programmatic Session API (for terminal renderers)
│   ├── plugins/
│   │   ├── plugin-host.ts          # Plugin loading and lifecycle
│   │   └── connector.interface.ts  # Connector interface definition
│   └── utils/
│       ├── platform.ts             # Platform detection
│       └── logger.ts               # Structured logging
├── dist/                           # Compiled output (bun build)
├── tests/
│   ├── session.test.ts
│   ├── pty.test.ts
│   ├── prompt-detector.test.ts
│   ├── screen-buffer.test.ts
│   ├── command-queue.test.ts
│   └── input-scheduler.test.ts
├── docs/
│   └── design.md                   # This document
└── README.md
```

---

## 4. Technology Choices

### 4.1 Runtime & Tooling

| Tool | Purpose | Version |
|------|---------|---------|
| **bun** | Runtime, bundler, package manager | >= 1.1.x |
| **tsx** | TypeScript execution in dev mode | latest |
| **TypeScript** | Type safety | >= 5.4 |

### 4.2 Dependencies

| Package | Purpose | Notes |
|---------|---------|-------|
| `node-pty` | PTY abstraction (ConPTY on Windows, forkpty on POSIX) | Native addon; bun supports Node addons |
| `@modelcontextprotocol/sdk` | MCP server implementation | Official MCP SDK for TypeScript |
| `zod` | Runtime type validation | Session config, MCP input validation |
| `uuid` | Session ID generation | Unique session identifiers |
| `pino` | Structured logging | Low-overhead, JSON output |
| `commander` | CLI argument parsing | Command routing for `coterm` CLI |

### 4.3 Development Workflow

```bash
bun install          # Install dependencies
bun run dev          # Start in dev mode with tsx (hot-reload)
bun test             # Run tests with bun's built-in test runner
bun run build        # Bundle with bun build for production
bun run package:windows  # Build standalone .exe
```

### 4.4 Windows Standalone Packaging

**Approach**: `bun build` (CJS, node-pty external) + `pkg` → `coterm.exe`

**Verified recipe (M12 complete):**

1. `bun build src/index.ts --target=node --format=cjs --external=node-pty --outfile=dist/index.cjs` — bundle all source into a single CJS file; keep `node-pty` external so its native runtime files resolve from `node_modules`.
2. `pkg dist/index.cjs --target node18-win-x64 --output coterm.exe --compress GZip` — wrap with Node.js runtime into a single `.exe`.
3. `package.json` `pkg.assets` includes `node_modules/node-pty/build/Release/conpty/**` (ConPTY DLL + OpenConsole.exe) and `node_modules/node-pty/src/**` so node-pty's runtime file lookup works inside the snapshot.
4. Output: `coterm.exe` — single executable, no Node.js or bun installation required. Verified end-to-end: MCP stdio connect, `terminal_create` (real cmd.exe ConPTY), `terminal_run`, `terminal_read`.

**Why CJS over ESM for `pkg`:** `pkg`'s bytecode compiler rejects ESM output (`import.meta`). The CJS bundle avoids that. Only `node-pty` is kept external; the MCP SDK, zod, pino, and commander are all inlined so `pkg` never has to resolve SDK subpath exports.

**Why `pkg` over `bun build --compile`:** `bun build --compile` embeds the bun runtime. Under bun's JS runtime, `node-pty` ConPTY writes fail on Windows (`ERR_SOCKET_CLOSED`), so a bun-compiled exe would be broken. `pkg` uses the Node runtime where `node-pty` works correctly.

**Bun + node-pty caveat (confirmed):** Under the bun runtime, `node-pty` spawns a ConPTY shell and streams output, but writes to the ConPTY socket fail with `ERR_SOCKET_CLOSED`. Always run the PTY layer under Node (tsx / pkg exe), not bun. The CLI warns about this when launched via bun.

---

## 5. Core Module Design

### 5.1 Session (`core/session.ts`)

A Session owns one PTY process and all associated state.

```typescript
interface SessionConfig {
  id: string;
  name: string;
  shell: string;           // e.g., "powershell.exe", "cmd.exe"
  shellArgs: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: Record<string, string>;
}

type SessionState = 'created' | 'running' | 'active' | 'paused' | 'closed' | 'error';

interface Session {
  id: string;
  name: string;
  state: SessionState;
  pty: PtyAdapter;
  screenBuffer: ScreenBuffer;
  promptDetector: PromptDetector;
  commandQueue: CommandQueue;
  inputScheduler: InputScheduler;
  owner: 'human' | 'ai';
  createdAt: number;

  // Lifecycle
  start(): Promise<void>;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): void;
  interrupt(): void;
  close(): Promise<void>;

  // State queries
  getLastOutput(n: number): string;
  getCurrentPrompt(): string | null;
  getState(): SessionState;
}
```

**Session State Machine:**
```
CREATED → STARTING → RUNNING → ACTIVE → PAUSED → RESUMED → CLOSED
                                                  ↓
                                               ERROR
```

### 5.2 Session Manager (`core/session-manager.ts`)

Maintains the registry of all active sessions. The central orchestrator.

```typescript
interface SessionManager {
  createSession(config: SessionConfig): Session;
  getSession(id: string): Session | undefined;
  listSessions(): SessionInfo[];
  destroySession(id: string): Promise<void>;

  // Input arbitration
  acquireWriteLock(sessionId: string, requester: 'human' | 'ai'): boolean;
  releaseWriteLock(sessionId: string): void;
}
```

**Ownership Model:**
- Human is the session owner by default
- AI attaches as a collaborator (not an owner)
- Human can always interrupt AI's pending commands
- AI commands are queued and executed only when Human is idle

### 5.3 PTY Adapter (`pty/`)

**Abstract Interface (`pty/pty-adapter.ts`):**
```typescript
interface PtyAdapter {
  spawn(shell: string, args: string[], cwd: string, env: Record<string, string>): Promise<void>;
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): void;
  onOutput(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
  destroy(): Promise<void>;
}
```

**Windows Implementation (`pty/windows-pty.ts`):**
- Uses `node-pty` with ConPTY backend on Windows 10 Build 18309+
- Falls back to `winpty` backend on older Windows
- Spawns `powershell.exe` or `cmd.exe` as configured
- Enforces UTF-8 output encoding
- Strips Windows-specific ANSI codes for cross-platform compatibility

**Key Windows Considerations:**
- `node-pty` compiles native Windows bindings via `node-gyp` during install
- `pkg` bundles the compiled `.node` binary as an asset
- ConPTY requires Windows Terminal or a compatible terminal emulator on the host
- `node-pty` handles the ConPTY allocation internally

### 5.4 Screen Buffer (`buffer/screen-buffer.ts`)

A data model for AI consumption — NOT a display component.

```typescript
interface ScreenLine {
  text: string;          // Plain text (ANSI stripped)
  rawText: string;       // Original text with ANSI codes preserved
  cursorRow: number;
  cursorCol: number;
  timestamp: number;
}

class ScreenBuffer {
  private lines: ScreenLine[];
  private maxLines: number;  // default 10000

  append(text: string): void;        // Add output, parse ANSI
  getLastLines(n: number): ScreenLine[];  // For AI consumption
  getScrollback(): ScreenLine[];     // Full history
  getCursorPosition(): { row: number; col: number };
}
```

### 5.5 Prompt Detector (`buffer/prompt-detector.ts`)

Detects shell prompts to signal command completion to AI agents.

**Detection Strategy:**
1. On each new output appended to screen buffer, run regex matching
2. Match against the current shell type (set at session creation)
3. If match found, emit `promptDetected` event via Event Bus
4. AI agents use this event instead of polling/sleeping

**Default Prompt Patterns:**
```typescript
const PROMPT_PATTERNS: Record<string, RegExp> = {
  powershell: /PS [^>]*>\s*$/,
  cmd: />\s*$/,
  bash: /\$\s*$/,
  zsh: /%\s*$/,
  fish: /❯\s*$/,
  python: />>>\s*$/,
  mysql: /mysql>\s*$/,
  redis: /redis>\s*$/,
  sqlite: /sqlite>\s*$/,
};
```

Patterns are configurable per session.

### 5.6 Command Queue & Input Scheduler (`queue/`)

**Command Queue (`queue/command-queue.ts`):**
- Ordered queue of pending commands to write to PTY
- Enforces single-writer: only one command writes to PTY at a time
- Supports priority: Human commands execute immediately; AI commands queue

**Input Scheduler (`queue/input-scheduler.ts`):**
- Manages the mutex on PTY write operations
- Human input acquires the lock immediately (high priority)
- AI input waits for the lock (low priority, queued)
- On Ctrl+C from either side, the current command is interrupted and the lock is released
- Emits `inputArbiter:locked` and `inputArbiter:unlocked` events

### 5.7 Event Bus (`core/event-bus.ts`)

Typed pub/sub for all session events.

```typescript
type SessionEvent =
  | { type: 'session:output'; sessionId: string; data: string }
  | { type: 'session:promptDetected'; sessionId: string; prompt: string }
  | { type: 'session:commandComplete'; sessionId: string; exitCode: number }
  | { type: 'session:error'; sessionId: string; error: Error }
  | { type: 'session:closed'; sessionId: string }
  | { type: 'session:aiAttached'; sessionId: string }
  | { type: 'session:aiDetached'; sessionId: string }
  | { type: 'session:interrupted'; sessionId: string; by: 'human' | 'ai' }
  | { type: 'inputArbiter:locked'; sessionId: string; by: 'human' | 'ai' }
  | { type: 'inputArbiter:unlocked'; sessionId: string };
```

### 5.8 MCP Server (`mcp/server.ts`, `mcp/tools.ts`)

**Transport:** stdio for Phase 1 (MCP over stdio is the default transport for local tools).

**MCP Tools:**
| Tool | Description | Parameters |
|------|-------------|------------|
| `terminal_list` | List active sessions | none |
| `terminal_attach` | Attach to a session (gain write access) | `sessionId` |
| `terminal_detach` | Detach from a session | `sessionId` |
| `terminal_read` | Read last N lines of output | `sessionId`, `lines?` |
| `terminal_write` | Write a command to the session | `sessionId`, `command` |
| `terminal_wait_prompt` | Wait for next prompt (command completion) | `sessionId`, `timeout?` |
| `terminal_resize` | Resize terminal dimensions | `sessionId`, `cols`, `rows` |
| `terminal_interrupt` | Send Ctrl+C to interrupt | `sessionId` |
| `terminal_close` | Close the session | `sessionId` |

**MCP Server Lifecycle:**
- Started alongside CoTerm runtime (not a separate process)
- Uses stdio transport — AI agents connect via their MCP client
- The `coterm` CLI can also start the MCP server explicitly: `coterm mcp`

### 5.9 Session API (`api/session-api.ts`)

A programmatic API for terminal renderers (Tabby, WezTerm, VS Code) to interact with CoTerm sessions directly (without going through MCP).

```typescript
interface SessionAPI {
  // Session management
  createSession(config: SessionConfig): string;            // returns sessionId
  getSession(id: string): SessionInfo;
  listSessions(): SessionInfo[];
  destroySession(id: string): void;

  // I/O
  write(sessionId: string, data: string): Promise<void>;
  read(sessionId: string, lines?: number): ScreenLine[];
  resize(sessionId: string, cols: number, rows: number): void;
  interrupt(sessionId: string): void;
  close(sessionId: string): void;

  // Events
  onOutput(sessionId: string, callback: (data: string) => void): void;
  onPromptDetected(sessionId: string, callback: (prompt: string) => void): void;
  onSessionEvent(sessionId: string, callback: (event: SessionEvent) => void): void;
}
```

**How terminal renderers use it:**
- Tabby calls `sessionAPI.write()` when the user types in the terminal panel
- Tabby calls `sessionAPI.read()` to get output for rendering
- Tabby subscribes to `onOutput` to receive real-time output updates
- VS Code extension calls the same API

### 5.10 Plugin System (`plugins/`)

**Connector Interface:**
```typescript
interface Connector {
  name: string;
  type: 'local' | 'ssh' | 'wsl' | 'docker' | 'kubernetes' | 'serial';
  connect(config: ConnectorConfig): Promise<PtyAdapter>;
  disconnect(adapter: PtyAdapter): Promise<void>;
}
```

**Plugin Host:**
- Discovers connectors from `plugins/` directory or npm packages with `coterm-connector-` prefix
- Loads connectors dynamically via `import()`
- Registers connectors with Session Manager

**Phase 1 Connector:**
- `local` connector: spawns PowerShell or CMD on the local Windows machine using `node-pty`

---

## 6. CLI Interface

The `coterm` CLI is a management tool for session lifecycle — not a terminal renderer.

### 6.1 Commands

```bash
# Start CoTerm runtime (background service mode)
coterm start [--shell powershell|cmd] [--cwd <dir>]

# Start CoTerm runtime in foreground (for debugging)
coterm start --foreground

# Start MCP server explicitly
coterm mcp [--transport stdio]

# List active sessions
coterm list

# Get session info
coterm info <sessionId>

# Read last N lines from a session
coterm read <sessionId> [--lines 50]

# Write a command to a session
coterm write <sessionId> --command "kubectl get pods"

# Wait for prompt
coterm wait <sessionId> [--timeout 30000]

# Resize terminal
coterm resize <sessionId> --cols 120 --rows 30

# Interrupt running command
coterm interrupt <sessionId>

# Close a session
coterm close <sessionId>

# Stop the CoTerm runtime
coterm stop
```

### 6.2 Runtime Modes

| Mode | Command | Description |
|------|---------|-------------|
| **Runtime** | `coterm start` | Starts session manager + MCP server as a background process |
| **MCP only** | `coterm mcp` | Starts only the MCP server (for AI agent connection) |
| **Foreground** | `coterm start --foreground` | Runs in foreground with logs to stdout (development) |

---

## 7. Phase 1 Implementation Plan

### 7.1 Milestones

| # | Milestone | Description | Deliverable |
|---|-----------|-------------|-------------|
| M1 | Scaffold | `package.json`, `tsconfig.json`, `bun.lockb`, `src/` directory structure | Working `bun install` |
| M2 | Core types + Event Bus | `core/types.ts`, `core/event-bus.ts` | Typed event system with tests |
| M3 | Session + Session Manager | `core/session.ts`, `core/session-manager.ts` | Session lifecycle with state machine |
| M4 | Windows PTY Adapter | `pty/pty-adapter.ts`, `pty/windows-pty.ts` | Spawn PowerShell/CMD, read/write output |
| M5 | Screen Buffer + Prompt Detector | `buffer/screen-buffer.ts`, `buffer/prompt-detector.ts` | ANSI parsing, prompt detection |
| M6 | Command Queue + Input Scheduler | `queue/command-queue.ts`, `queue/input-scheduler.ts` | Input arbitration with priority |
| M7 | MCP Server + Tools | `mcp/server.ts`, `mcp/tools.ts` | MCP server with stdio transport, 8 tools |
| M8 | Session API | `api/session-api.ts` | Programmatic API for terminal renderers |
| M9 | CLI | `cli/index.ts`, `cli/commands.ts`, `src/index.ts` | All CLI commands working |
| M10 | Plugin Host + Local Connector | `plugins/plugin-host.ts`, `plugins/connector.interface.ts` | `local` connector for PowerShell/CMD |
| M11 | Integration Tests | `tests/` for all core modules | >80% coverage on core modules |
| M12 | Windows Packaging | `bun build` + `pkg` → `coterm.exe` | Standalone `.exe` runs on clean Windows |
| M13 | README + Usage Guide | Documentation | Installation, usage, and integration guide |

### 7.2 Dependencies Between Milestones

```
M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10 → M11 → M12 → M13
     └──────────────────────────────────────────────────────────────┘
                          (can be done in parallel with M4-M10)
```

M1-M3 are the foundation. M4-M10 can proceed in parallel once M3 is done. M11 requires all modules. M12 requires M11 passing.

### 7.3 Validation Steps

1. **M1**: `bun install` succeeds, `bun test` runs (even with zero tests)
2. **M2**: Event Bus correctly publishes and subscribes to all event types
3. **M3**: Session transitions through all states correctly; Session Manager creates/destroys sessions
4. **M4**: `node-pty` spawns PowerShell, output is captured, commands are written and executed
5. **M5**: Screen buffer tracks cursor position; prompt detector identifies `PS>` and `>` prompts
6. **M6**: Human input always preempts AI; Ctrl+C interrupts AI commands; AI commands queue behind Human
7. **M7**: MCP client can call all 9 tools and get correct responses
8. **M8**: External client can create sessions, write commands, and read output via Session API
9. **M9**: All CLI commands work end-to-end
10. **M11**: All unit tests pass with >80% coverage
11. **M12**: `coterm.exe` runs on a clean Windows machine (no Node.js/bun installed)

---

## 8. Cross-Platform Strategy (Future Phases)

### 8.1 Phase 2: Linux + macOS

- Add `pty/posix-pty.ts` using `node-pty`'s forkpty backend
- Platform detection in `utils/platform.ts` selects the correct adapter
- `bun run package:linux` and `bun run package:macos` for cross-platform builds

### 8.2 Phase 3: Desktop UI

- Tauri + React frontend that connects to CoTerm via Session API
- CoTerm runtime remains headless; the UI is just a renderer

### 8.3 Phase 4: Full Plugin Ecosystem

- SSH, Docker, Kubernetes, Serial connectors
- Third-party plugin marketplace
- Plugin SDK with TypeScript types

---

## 9. Key Design Decisions

### 9.1 CoTerm as Backend, Not Terminal

**Decision**: CoTerm is a headless session runtime. Rendering is delegated to external terminals (Tabby, WezTerm, VS Code).

**Rationale**: Competing with terminal emulators is a losing battle. Being the session layer that all terminals plug into is a defensible, differentiated position.

### 9.2 MCP over Custom Protocol for AI Integration

**Decision**: Use the Model Context Protocol (MCP) for AI agent integration.

**Rationale**: MCP is the emerging standard. Any MCP-compatible agent (Claude, OpenHands, OpenCode, RooCode, Kilo) can connect without a custom SDK.

### 9.3 Session API over HTTP for Terminal Renderer Integration

**Decision**: Provide a programmatic Session API (in-process, not HTTP) for terminal renderers.

**Rationale**: Terminal renderers like Tabby and VS Code extensions run in the same process as CoTerm (when embedded) or can connect via IPC. HTTP would add unnecessary overhead. The API is a TypeScript interface, not a network API.

### 9.4 stdio MCP Transport for Phase 1

**Decision**: MCP uses stdio transport in Phase 1.

**Rationale**: stdio is the simplest, most reliable transport for a local tool. No network ports, no authentication needed. AI agents connect via their MCP client which reads from stdin and writes to stdout.

### 9.5 node-pty for PTY Abstraction

**Decision**: Use `node-pty` as the PTY layer, abstracted behind our own `PtyAdapter` interface.

**Rationale**: `node-pty` handles ConPTY on Windows and forkpty on POSIX. We don't want to write platform-specific PTY code ourselves. The abstraction allows swapping implementations later.

### 9.6 bun + tsx over Rust

**Decision**: Use bun (runtime/bundler) + tsx (TypeScript execution) instead of Rust.

**Rationale**: TypeScript ecosystem is accessible, `node-pty` has mature Windows support, and `bun build` + `pkg` produces a standalone `.exe`. Rust would require writing ConPTY bindings from scratch.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `node-pty` native addon incompatibility with bun | High | **Confirmed during M12.** Under bun, ConPTY writes fail with `ERR_SOCKET_CLOSED`; node-pty works correctly under Node. PTY operations always run under Node (tsx dev, pkg exe). |
| `pkg` bundling `node-pty` native binaries | High | **Resolved.** Build CJS with `--external=node-pty`, add `pkg.assets` for `build/Release/conpty/**` and `src/**`. `coterm.exe` verified running ConPTY sessions end-to-end. |
| ConPTY not available on older Windows | Medium | `node-pty` falls back to `winpty` backend; document minimum Windows 10 Build 18309 |
| Input scheduling race conditions | High | Mutex on PTY write in Input Scheduler; single-writer guarantee in Command Queue |
| Prompt detection false positives | Medium | Configurable patterns per shell; default patterns cover common shells |
| Session API coupling with renderer | Medium | Session API is a TypeScript interface; renderers import it directly (no network boundary) |
| MCP stdio transport limitations | Low | stdio works for local agents; network transport (stdio → TCP) can be added in Phase 2 |

---

## 11. Open Questions

1. **How do terminal renderers (Tabby, WezTerm) discover and connect to CoTerm?** *Recommendation: CoTerm runtime exposes a local IPC endpoint (named pipe on Windows) that renderers connect to. The Session API is accessed through this IPC channel.*

2. **Should CoTerm runtime be a Windows service or a foreground process?** *Recommendation: Foreground process in Phase 1. Windows service support can be added in Phase 2.*

3. **How does `coterm start` manage the background process lifecycle?** *Recommendation: `coterm start` forks a child process that runs the runtime. `coterm stop` sends a signal to terminate it. Use a PID file for tracking.*

4. **What is the minimum Windows version for Phase 1?** *Recommendation: Windows 10 Build 18309+ (ConPTY support). Document as a hard requirement.*

5. **Should the Session API be accessible over a local socket in addition to in-process?** *Recommendation: In-process for Phase 1 (simplest). Local named pipe socket for Phase 2 when renderers need to connect across processes.*

6. **How does AI agent authentication work for MCP?** *Recommendation: No auth for Phase 1 — local-only MCP over stdio. Add auth in Phase 2 if remote MCP is needed.*

---

## 12. Validation Plan

1. **M1-M3**: Verify Session Manager creates/destroys sessions; Event Bus delivers events; state machine transitions correctly.
2. **M4**: Verify Windows PTY adapter spawns PowerShell, writes commands, and captures output.
3. **M5**: Verify Screen Buffer tracks cursor position and Prompt Detector identifies `PS>` and `>` prompts.
4. **M6**: Verify Input Scheduler: Human input preempts AI; Ctrl+C interrupts; AI commands queue correctly.
5. **M7**: Verify MCP client can call all 9 tools and get correct responses.
6. **M8**: Verify external client can create sessions, write commands, and read output via Session API.
7. **M9**: Verify all CLI commands work end-to-end.
8. **M11**: Run `bun test` — >80% coverage on core modules.
9. **M12**: Produce `coterm.exe` and verify it runs on a clean Windows machine without Node.js/bun installed.
