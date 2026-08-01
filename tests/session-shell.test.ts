import { describe, expect, test } from 'bun:test';
import { buildSessionShellIntegration } from '../src/session/session-shell.js';

describe('session shell integration', () => {
  test('pwsh gets a profile script and session env vars', () => {
    const it = buildSessionShellIntegration('sess-1', 'pwsh', [], 8377);
    expect(it.env.COTERM_SESSION).toBe('sess-1');
    expect(it.env.COTERM_DAEMON).toContain('8377');
    expect(it.shellArgs).toContain('-NoLogo');
    expect(it.shellArgs.some((a) => a.includes('session-sess-1.ps1'))).toBe(true);
  });

  test('pwsh.exe (Store path) is normalized the same way', () => {
    const it = buildSessionShellIntegration('sess-2', 'C:\\Program Files\\WindowsApps\\Microsoft.PowerShell_7.6.4.0_x64__8wekyb3d8bbwe\\pwsh.exe', [], 8377);
    expect(it.shellArgs.some((a) => a.includes('session-sess-2.ps1'))).toBe(true);
  });

  test('cmd keeps shell args and gets env vars only', () => {
    const it = buildSessionShellIntegration('sess-3', 'cmd.exe', [], 8377);
    expect(it.env.COTERM_SESSION).toBe('sess-3');
    expect(it.shellArgs).toEqual([]);
  });

  test('bash/wsl gets an rcfile and interactive flag', () => {
    const it = buildSessionShellIntegration('sess-4', 'bash', [], 8377);
    expect(it.shellArgs).toContain('-i');
    expect(it.shellArgs.some((a) => a.includes('session-sess-4.sh'))).toBe(true);
  });
});
