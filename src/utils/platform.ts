import * as fs from 'node:fs';
import * as path from 'node:path';

export function getPlatform(): 'windows' | 'linux' | 'darwin' {
  const platform = process.platform;
  if (platform === 'win32') return 'windows';
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'darwin';
  return 'linux';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}

export function isDarwin(): boolean {
  return process.platform === 'darwin';
}

export function getTempDir(): string {
  return process.env.TMPDIR ?? process.env.TMP ?? process.env.TEMP ?? '/tmp';
}

function isInPath(tool: string): boolean {
  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  const extensions = isWindows() ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      try {
        if (fs.existsSync(path.join(dir, tool + ext))) return true;
      } catch {
        // ignore invalid path entries
      }
    }
  }
  return false;
}

export function detectDefaultShell(): string {
  const shell = process.env.SHELL;
  if (shell) return shell;
  if (isWindows()) {
    if (process.env.COTERM_SHELL) return process.env.COTERM_SHELL;
    // Prefer PowerShell Core, then Windows PowerShell, then cmd.
    if (isInPath('pwsh')) return 'pwsh';
    if (isInPath('powershell')) return 'powershell.exe';
    return 'cmd.exe';
  }
  return '/bin/bash';
}