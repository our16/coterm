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
    // Preference order: PowerShell Core (pwsh) -> cmd -> Windows PowerShell 5.1.
    // pwsh is preferred because Windows PowerShell 5.1 (powershell.exe) has a
    // ConPTY interactive quirk that reorders native vs cmdlet output (e.g.
    // `pwd; whoami` prints whoami first); it is kept only as a last resort.
    if (isInPath('pwsh')) return 'pwsh';
    if (isInPath('cmd')) return 'cmd.exe';
    return 'powershell.exe';
  }
  return '/bin/bash';
}