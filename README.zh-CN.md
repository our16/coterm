# CoTerm — AI 原生终端会话运行时

> **AI 与终端之间的运行时层。**

CoTerm 是一个无头（headless）终端会话运行时：统一管理基于 PTY 的 shell 会话，并通过统一的 **Session API** 和 **MCP（Model Context Protocol）** 服务，把会话开放给人类与 AI。它**不是**又一个终端模拟器——而是任何终端、AI Agent、IDE 都可以接入的共享会话层。

```
        Human（Tabby / WezTerm / VS Code）
                    │
                    ▼
   ┌─────────────────────────────────────┐
   │          CoTerm 运行时              │
   │  Session ─ PTY ─ Prompt ─ Screen    │
   │  Intelligence ─ Recording ─ Workspace│
   │  输入仲裁（Human > AI）             │
   └──────────┬──────────────┬───────────┘
              │              │
      Session API      MCP (stdio)
      （进程内）         （AI Agent）
```

---

## 为什么需要 CoTerm？

几乎每个 AI 编程工具（Claude Code、OpenHands、Cline、Roo Code…）都在重复造轮子：

- PTY 生命周期管理
- 输出解析与 Prompt 检测
- 会话状态与 Ctrl+C 处理
- 超时与错误处理

CoTerm 把这件事一次性解决。任何兼容 MCP 的 Agent 接入后，就能获得一个**共享的、长期存活的终端会话**——无需重新登录、无需重新初始化环境、也不会污染人类的终端。

- 原生支持 **Windows ConPTY**——多数终端共享方案忽略的平台。
- **企业 SSH 场景**（VPN → 堡垒机 → OTP → SSH）在会话内保持存活；AI 是"接入"会话，而不是"重新认证"。
- **人类永远优先**——基于优先级的输入仲裁，人类可以随时打断 AI 正在执行的命令。

---

## 核心特性

### 会话管理
- 完整生命周期：`created → starting → running → active → paused → closed`
- 创建 / 接入 / 分离 / 关闭，所有权模型（人类拥有，AI 协作）

### 连接器（Connectors）
| 类型 | 目标 | 命令 |
|------|------|------|
| `local` | 本地 Shell（PowerShell / CMD / bash） | `powershell.exe`、`cmd.exe`、`/bin/bash` |
| `ssh` | 远程主机（SSH） | `ssh -p <port> [-i <key>] <user>@<host>` |
| `wsl` | WSL 发行版 | `wsl -d <distro> --cd <dir>` |
| `docker` | 运行中的容器 | `docker exec -it <container> <shell>` |

### 输入仲裁（Input Arbitration）
- 人类输入永远优先，AI 输入排队等待
- 人类可随时用 Ctrl+C 打断 AI 命令（`session:interrupted` 事件）
- 实时加锁 / 解锁状态与事件

### 会话智能（L3）
- **当前目录追踪**（错误感知，通过 `cd` 解析，无需 `pwd` 探测）
- **工具链检测**（node / python / git / docker…），基于 PATH 扫描，不启动子进程
- **全屏应用检测**（`vim`、`top`、`less`），通过 ANSI 备用屏序列识别
- **命令图（Command Graph）**——每条命令的记录者、耗时、错误启发式、输出摘要

### AI 运行时（L4）
- **多 AI 接入**——多个 Agent 以独立身份共享一个会话
- **会话录制**——JSONL 事件日志（输出、Prompt、命令、中断）
- **快照 / 恢复**——捕获配置 + 屏幕 + 历史，重建带连续性的会话

### 工作区（L5）
- 把多个会话分组为命名工作区（例如 Linux / Redis / MySQL / K8s 的部署工作区）
- 并行在所有成员中执行命令

### 集成
- **MCP 服务器**（stdio 传输）——23 个终端 + 工作区工具
- **Session API**——面向终端渲染器的进程内 TypeScript 接口
- **CLI**——完整的会话生命周期与检查命令
- **Windows 独立可执行文件**——单个 `coterm.exe`，无需安装 Node.js 或 bun

---

## 技术栈

| 层 | 选型 |
|----|------|
| 语言 | TypeScript（严格模式） |
| 开发运行时 | bun（打包、测试） |
| 生产运行时 | Node.js（`tsx` 开发 / `pkg` 分发） |
| PTY | `node-pty`（Windows 用 ConPTY，POSIX 用 forkpty） |
| AI 协议 | `@modelcontextprotocol/sdk` |
| CLI | `commander` |
| 校验 | `zod` |
| 日志 | `pino`（输出到 stderr，保持 MCP stdio 干净） |

> **注意**：在 Windows 上，`node-pty` 的 ConPTY 写入在 bun *运行时* 下不可靠。CoTerm 的 PTY 层运行在 Node 下（开发用 `tsx`，分发用 `pkg`）。通过 bun 启动时 CLI 会给出警告。

---

## 快速开始

环境要求：[bun](https://bun.sh)（开发）、Node.js 18+。

```bash
bun install

# 类型检查与测试
bun run typecheck
bun test

# 通过 stdio 启动 MCP 服务器（供 AI Agent / Claude / OpenHands 等接入）
bun run dev -- mcp
# 或
tsx src/index.ts mcp
```

### 创建会话并执行命令（CLI）

```bash
# 启动一个带默认会话 + stdio MCP 服务器的运行时
tsx src/index.ts start --shell powershell.exe

# 在另一个终端管理会话
tsx src/index.ts list
tsx src/index.ts status <sessionId>     # cwd、工具链、全屏应用、命令图
tsx src/index.ts history <sessionId>    # 命令图
tsx src/index.ts write <sessionId> --command "kubectl get pods"
tsx src/index.ts wait <sessionId> --timeout 30000
```

### 连接 SSH / WSL / Docker 会话

```bash
tsx src/index.ts start --connector ssh --host jump.company.com --user admin --port 22
tsx src/index.ts start --connector wsl --distro Ubuntu
tsx src/index.ts start --connector docker --container web
```

---

## 接入 AI Agent（MCP）

任何兼容 MCP 的客户端，通过 spawn 服务器即可接入：

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

### 终端工具

| 工具 | 说明 |
|------|------|
| `terminal_create` | 创建会话（local / ssh / wsl / docker） |
| `terminal_list` | 列出活跃会话 |
| `terminal_attach` | AI 接入（可指定 agent 标识） |
| `terminal_detach` | AI 分离 |
| `terminal_read` | 读取最后 N 行输出 |
| `terminal_write` | 写入原始输入（经仲裁） |
| `terminal_run` | 执行命令并等待下一个 Prompt |
| `terminal_wait_prompt` | 等待命令完成 |
| `terminal_resize` | 调整 PTY 尺寸 |
| `terminal_interrupt` | 发送 Ctrl+C |
| `terminal_close` | 关闭会话 |
| `terminal_status` | 结构化会话智能 + Presence |
| `terminal_history` | 已录制的命令图 |
| `terminal_recording` | 开始 / 停止录制 |
| `terminal_replay` | 回放录制事件（JSONL） |
| `terminal_snapshot` | 捕获会话快照 |
| `terminal_restore` | 从快照恢复会话 |

### 工作区工具

| 工具 | 说明 |
|------|------|
| `workspace_create` | 创建命名的会话分组 |
| `workspace_add` | 向工作区添加会话 |
| `workspace_remove` | 从工作区移除会话 |
| `workspace_list` | 列出工作区 |
| `workspace_run` | 在所有成员中执行命令 |
| `workspace_status` | 查看成员状态 / Presence / cwd |

---

## Session API（面向终端渲染器）

CoTerm 提供进程内的 TypeScript API，方便终端前端（Tabby、WezTerm、VS Code）内嵌运行时：

```typescript
import { SessionAPI } from './src/api/session-api.js';

const api = new SessionAPI();

const sessionId = await api.createSession({ shell: 'powershell.exe' });
await api.runCommand(sessionId, 'git pull', 'ai');
await api.waitForPrompt(sessionId);
console.log(api.readText(sessionId));

const unsub = api.onPromptDetected(sessionId, (prompt) => {
  console.log('命令已完成，Prompt：', prompt);
});

await api.close(sessionId);
```

---

## Windows 独立可执行文件

打包一个自包含的 `coterm.exe`（无需 Node.js 或 bun）：

```bash
bun run package:windows
```

构建流程：源码打包为 CJS（`node-pty` 保持外部以保留其 ConPTY 原生二进制），再通过 `pkg` 封装。产物已端到端验证：MCP stdio 连接、真实 ConPTY 会话创建、命令执行、读取、录制、快照与工作区。

---

## 项目结构

```
src/
├── index.ts              # CLI 入口
├── main.ts               # 运行时引导
├── api/session-api.ts    # 程序化 Session API
├── core/                 # types、event-bus、session、session-manager
├── pty/                  # PTY 适配器（Windows / POSIX）+ 工厂
├── connectors/           # local / ssh / wsl / docker
├── buffer/               # 屏幕缓冲、Prompt 检测
├── queue/                # 命令队列、输入调度（仲裁）
├── intelligence/         # cwd、工具链、屏幕模式、命令图
├── ai/                   # 多 AI、录制、快照 / 恢复
├── workspace/            # 会话分组
├── mcp/                  # MCP 服务器 + 工具
└── cli/                  # CLI 命令
```

---

## 路线图

- [x] **L1** 会话 / PTY / Prompt 检测 / 连接器
- [x] **L2** 输入仲裁 + Presence
- [x] **L3** 会话智能（cwd、工具链、命令图、全屏检测）
- [x] **L4** AI 运行时（多 AI、录制、快照）
- [x] **L5** 工作区（会话分组、批量命令）
- [ ] 插件生态（录制、指标、通知）
- [ ] CI/CD 跨平台构建
- [ ] 桌面 UI（Tauri + React）作为渲染前端

---

## 许可证

[MIT](LICENSE)
