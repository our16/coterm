import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectDefaultShell } from './utils/platform.js';

export interface CotermMcpConfig {
  host?: string;
  port?: number;
}

export interface CotermConfig {
  mcp?: CotermMcpConfig;
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
    mcp: { host: DEFAULT_MCP_HOST, port: DEFAULT_MCP_PORT },
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

export function writeActiveMarker(): void {
  try {
    fs.mkdirSync(path.dirname(getActiveMarkerPath()), { recursive: true });
    fs.writeFileSync(getActiveMarkerPath(), String(process.pid));
  } catch {
    // ignore
  }
}

export function removeActiveMarker(): void {
  try {
    fs.rmSync(getActiveMarkerPath(), { force: true });
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

export function getMcpHost(config: CotermConfig = loadConfig()): string {
  return config.mcp?.host ?? DEFAULT_MCP_HOST;
}

export function getMcpPort(config: CotermConfig = loadConfig()): number {
  return config.mcp?.port ?? DEFAULT_MCP_PORT;
}

export function setConfigValue(config: CotermConfig, key: string, value: string): CotermConfig {
  switch (key) {
    case 'mcp.host':
      config.mcp = { ...(config.mcp ?? {}), host: value };
      break;
    case 'mcp.port':
      config.mcp = { ...(config.mcp ?? {}), port: Number(value) };
      break;
    case 'defaultShell':
      config.defaultShell = value;
      break;
    case 'defaultCwd':
      config.defaultCwd = value;
      break;
    default:
      throw new Error(`Unknown config key: ${key} (supported: mcp.host, mcp.port, defaultShell, defaultCwd)`);
  }
  return config;
}
