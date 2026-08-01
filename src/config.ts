import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectDefaultShell } from './utils/platform.js';

export interface CotermConfig {
  mcp_server_port?: number;
  defaultShell?: string;
  defaultCwd?: string;
}

export const DEFAULT_MCP_PORT = 8377;
export const DEFAULT_MCP_HOST = '127.0.0.1';

export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'coterm');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function getActiveMarkerPath(): string {
  return path.join(getConfigDir(), 'active');
}

export function getPowershellIntegrationPath(): string {
  return path.join(getConfigDir(), 'powershell.ps1');
}

export function getDefaultConfig(): CotermConfig {
  return {
    mcp_server_port: DEFAULT_MCP_PORT,
    defaultShell: detectDefaultShell(),
  };
}

export function ensureConfig(): CotermConfig {
  if (!fs.existsSync(getConfigPath())) {
    const defaults = getDefaultConfig();
    saveConfig(defaults);
    return defaults;
  }
  return loadConfig();
}

export interface ActiveState {
  sessionId?: string;
}

export function getWindowActivePath(pid: number): string {
  return path.join(getConfigDir(), `active-${pid}`);
}

// Per-window active state: each window writes its own file keyed by its shell
// PID, so one window activating never affects another window's prompt.
export function writeActiveState(pid: number, sessionId?: string): void {
  try {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getWindowActivePath(pid), JSON.stringify({ sessionId }));
  } catch {
    // ignore
  }
}

export function readActiveState(pid: number): ActiveState | null {
  try {
    const p = getWindowActivePath(pid);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as ActiveState;
  } catch {
    return null;
  }
}

export function removeActiveState(pid: number): void {
  try {
    fs.rmSync(getWindowActivePath(pid), { force: true });
  } catch {
    // ignore
  }
}

export function isActiveMarker(): boolean {
  return fs.existsSync(getActiveMarkerPath());
}

export function loadConfig(): CotermConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as CotermConfig;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function saveConfig(config: CotermConfig): void {
  const dir = path.dirname(getConfigPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}

export function getMcpHost(): string {
  // The MCP server always binds to the local machine.
  return DEFAULT_MCP_HOST;
}

export function getMcpPort(config: CotermConfig = loadConfig()): number {
  return config.mcp_server_port ?? DEFAULT_MCP_PORT;
}

export function setConfigValue(config: CotermConfig, key: string, value: string): CotermConfig {
  switch (key) {
    case 'mcp_server_port':
    case 'mcp.port':
      config.mcp_server_port = Number(value);
      break;
    case 'defaultShell':
      config.defaultShell = value;
      break;
    case 'defaultCwd':
      config.defaultCwd = value;
      break;
    default:
      throw new Error(`Unknown config key: ${key} (supported: mcp_server_port, defaultShell, defaultCwd)`);
  }
  return config;
}
