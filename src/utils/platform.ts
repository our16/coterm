import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

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

/**
 * Resolve a shell command (bare name or path) to a path that node-pty can
 * actually spawn. This is the crux of Store/MSIX PowerShell support: the
 * `WindowsApps\pwsh.exe` app-execution-alias stub works interactively but
 * cannot be launched by node-pty, while the real binary under
 * `C:\Program Files\WindowsApps\Microsoft.PowerShell_*\pwsh.exe` spawns fine.
 */
export function resolveShellPath(shell: string): string | null {
  const base = shell.replace(/"/g, '');
  if (!isWindows()) return base;
  if (/[\\/]/.test(base) || base.includes(':')) {
    return fs.existsSync(base) ? base : null;
  }

  // Bare name: search PATH for a real (non-zero-byte) executable.
  const found = findExecutableOnPath(base);
  if (found) return found;

  // Special-case Store/MSIX PowerShell: query InstallLocation via Get-AppxPackage.
  if (base.toLowerCase() === 'pwsh' || base.toLowerCase() === 'pwsh.exe') {
    return resolveStorePowerShell();
  }
  return null;
}

function findExecutableOnPath(name: string): string | null {
  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  const extensions = ['.exe', '.cmd', '.bat', ''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const full = path.join(dir, name + ext);
      try {
        if (fs.existsSync(full) && fs.statSync(full).size > 0) return full;
      } catch {
        // ignore invalid path entries
      }
    }
  }
  return null;
}

/**
 * Query the Store/MSIX PowerShell install location. The real pwsh.exe lives
 * under C:\Program Files\WindowsApps\<Package>\pwsh.exe which we cannot reach
 * by directory enumeration (EPERM), but Get-AppxPackage returns the path.
 */
function resolveStorePowerShell(): string | null {
  try {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command',
        "$p=Get-AppxPackage Microsoft.PowerShell; if($p){Write-Output ($p.InstallLocation+'\\pwsh.exe')}else{Write-Output ''}"],
      { encoding: 'utf8', timeout: 15000, windowsHide: true },
    );
    const loc = (r.stdout ?? '').trim();
    if (loc && fs.existsSync(loc)) return loc;
  } catch {
    // fall through
  }
  return null;
}

/** Whether a shell resolves to something node-pty can spawn. */
export function isShellSpawnable(shell: string): boolean {
  return resolveShellPath(shell) !== null;
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
    // Only pick pwsh if it actually resolves to a spawnable binary (a Store
    // alias stub is not usable by node-pty).
    if (resolveShellPath('pwsh')) return 'pwsh';
    if (resolveShellPath('cmd.exe')) return 'cmd.exe';
    return 'powershell.exe';
  }
  return '/bin/bash';
}

export interface ShellCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a shell can actually be spawned by node-pty. On Windows this rejects
 * 0-byte App Execution Aliases (Store/MSIX PowerShell installs live in
 * WindowsApps as reparse-point stubs that node-pty cannot launch) and other
 * unusable paths, with a human-readable reason.
 */
export function checkShellSpawnable(shell: string): ShellCheckResult {
  if (!isWindows()) return { ok: true };
  const resolved = resolveShellPath(shell);
  if (resolved) return { ok: true };

  const base = shell.replace(/"/g, '');
  const isBare = !/[\\/]/.test(base) && !base.includes(':');
  const target = isBare ? `${base} (as ${findExecutableOnPath(base) ?? 'resolved via PATH'})` : base;
  return {
    ok: false,
    reason: `Cannot spawn shell '${shell}' (${target}): it is a 0-byte Store/MSIX app-execution alias or missing. node-pty cannot launch WindowsApps aliases.\nFix: install a full PowerShell 7 build (winget install Microsoft.PowerShell), or use --shell cmd.exe / powershell.exe.`,
  };
}