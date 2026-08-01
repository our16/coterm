# CoTerm — AI 原生终端运行时

<div align="center">

[**English**](README.md) | **中文**

</div>

> **AI 与终端之间的运行时层。**

> CoTerm 不是又一个终端模拟器，而是面向人类、AI Agent 和 MCP 工具的**可编程共享终端会话运行时**。

<div align="center">

| 共享终端会话 | 人类 + AI 协作 | SSH / PowerShell / WSL / Docker |
|---|---|---|
| MCP 原生 | Session API | Prompt 检测 |
| 屏幕缓冲 | 多 Agent | 会话回放 |

</div>

CoTerm 是一个无头（headless）运行时：统一管理基于 PTY 的 shell 会话，并通过统一的 **Session API** 和 **MCP（Model Context Protocol）** 服务，把会话开放给人类与 AI。任何终端、AI Agent、IDE 都接入同一个共享会话。

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

### CoTerm 是什么

| | |
|---|---|
| **共享会话（Shared Session）** | 一个终端会话被人类、多个 AI Agent、MCP 工具安全共享——而非每个使用者各开一个终端 |
| **终端运行时（Terminal Runtime）** | 拥有 PTY、屏幕缓冲、Prompt 检测与会话生命周期 |
| **AI 原生（AI Native）** | Agent 操作的是结构化的 Session API / MCP，而非原始按键流 |
| **MCP 原生** | 23 个终端 + 工作区工具，基于标准 Model Context Protocol |

### CoTerm 不是什么

| | |
|---|---|
| ❌ 终端模拟器 | 渲染交给 Tabby / WezTerm / VS Code / Windows Terminal |
| ❌ SSH 客户端 | SSH 只是众多连接器之一——与 PowerShell、WSL、Docker 同级 |
| ❌ Shell | Shell 运行在 CoTerm 管理的会话内部 |
| ❌ AI 编程 Agent | CoTerm 是 Agent 接入的运行时 |

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
```

### 激活环境（类似 conda activate）

```bash
coterm            # 若 daemon 未运行则自动启动，然后进入共享环境
coterm activate   # 同上，显式调用

# 之后所有命令都作用于共享环境的默认会话
coterm run --command "kubectl get pods"   # 在原生 shell 会话中执行（无需指定会话 id）
coterm status                             # cwd、工具链、命令图
coterm list                               # 所有会话
coterm env                                # 环境状态
coterm stop                               # 退出环境（停止 daemon）
```

省略会话 id 时，命令自动选择第一个运行中的会话；要指定某个会话：`coterm status <sessionId>`。

### 配置文件（`~/.config/coterm.json`）

daemon 从配置文件读取 MCP 端口/主机和 Shell 默认值。CLI 参数始终覆盖配置。

```bash
coterm config                        # 查看配置路径 + 生效的 MCP 端点
coterm config-set mcp_server_port 9000   # 修改 MCP 端口
coterm config-set defaultShell cmd.exe
```

```json
{
  "mcp_server_port": 8377,
  "defaultShell": "powershell.exe",
  "defaultCwd": "C:\\work"
}
```

### 创建带连接器的会话

```bash
coterm create --connector ssh --host jump.company.com --user admin --port 22
coterm create --connector wsl --distro Ubuntu
coterm create --connector docker --container web
```

---

## 接入 AI Agent（MCP）

### 多个 Agent 共享一个 daemon（推荐）

运行单个 daemon，任意多个 Agent 通过 HTTP 接入，**共享同一批会话**：

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

Agent A 创建会话，Agent B 能看到并 attach——一个进程、一个共享会话注册表。

### 单 Agent 的 stdio（临时使用）

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

## 独立可执行文件（Windows / Linux / macOS）

打包自包含的二进制——目标机器无需 Node.js 或 bun：

```bash
bun run package:windows   # -> coterm.exe
bun run package:linux     # -> coterm
bun run package:macos     # -> coterm
```

推送 `v*` tag 会在三个平台（`windows-latest` / `ubuntu-latest` / `macos-latest`）上并行构建，并在 **一个 GitHub Release** 中发布 `coterm-windows-x64.exe`、`coterm-linux-x64`、`coterm-macos-x64`。每个二进制内嵌 Node.js 运行时、全部代码和 node-pty 原生文件（Windows 用 ConPTY，POSIX 用 forkpty）。

### Shell 集成（提示符前缀 + 简写命令）

`coterm activate` 之后，shell 提示符会显示 `(coterm) ` 前缀，简写命令（`list`、`status`、`run`、`stop`...）无需 `coterm` 前缀即可使用。**首次激活会自动安装**，也可手动：

| 平台 | 命令 | 效果 |
|------|------|------|
| PowerShell（Windows） | `coterm install-powershell` | 生成 `~/.config/coterm/powershell.ps1`，并从 `$PROFILE` 加载 |
| bash / zsh（Linux/macOS） | `coterm install-shell` | 生成 `~/.config/coterm/coterm.sh`，并从 `~/.bashrc` / `~/.zshrc` 加载 |

```bash
# 任意平台
coterm            # 自动后台启动 daemon + 激活；提示符出现 "(coterm) "
list              # 简写命令——无需 "coterm" 前缀
run --command "echo hi"
status
stop              # 退出环境；提示符恢复
```

> bash/zsh 下省略了 `read`、`history` 简写，避免与 shell 内建命令冲突（用 `coterm read` / `coterm history`）。

### 分发部署

**只需分发单个二进制**——完全自包含。目标机器上直接运行 `coterm` 即可激活（首次会自动安装 shell 集成）；重启 shell（或 `source ~/.bashrc` / `. $PROFILE`）即可看到 `(coterm) ` 提示符。

可选的每用户配置在 `~/.config/coterm/config.json`（`mcp_server_port`、`defaultShell`）。其余文件全部运行时自动生成。

### Claude Skill

现成的 Claude skill 在 [`skills/coterm/SKILL.md`](skills/coterm/SKILL.md)——教会 Claude 如何连接并驱动 CoTerm。安装：复制到你的 agent skills 目录：

```bash
mkdir -p ~/.claude/skills && cp -r skills/coterm ~/.claude/skills/
```

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
