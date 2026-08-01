import { describe, test, expect } from 'bun:test';
import { checkShellSpawnable, detectDefaultShell } from '../src/utils/platform.js';

describe('shell resolution (Windows)', () => {
  test('cmd.exe always resolves as spawnable', () => {
    const check = checkShellSpawnable('cmd.exe');
    expect(check.ok).toBe(true);
  });

  test('default shell detection returns a spawnable shell', () => {
    const shell = detectDefaultShell();
    const check = checkShellSpawnable(shell);
    expect(check.ok).toBe(true);
  });

  test('an unresolvable shell yields a helpful reason', () => {
    // A WindowsApps alias stub without a resolvable Store install would fail;
    // but we must never return ok:true for something we can't spawn. Use a
    // clearly bogus value to exercise the failure branch.
    const check = checkShellSpawnable('totally-missing-shell-xyz.exe');
    if (process.platform === 'win32') {
      expect(check.ok).toBe(false);
      expect(check.reason).toBeTruthy();
    }
  });
});
