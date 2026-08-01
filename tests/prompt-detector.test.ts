import { describe, expect, test } from 'bun:test';
import { PromptDetector } from '../src/buffer/prompt-detector.js';

describe('PromptDetector', () => {
  test('detects powershell prompt', () => {
    const d = new PromptDetector('powershell');
    expect(d.detect('PS C:\\Users\\test>')).toBeTruthy();
  });

  test('detects cmd prompt', () => {
    const d = new PromptDetector('cmd');
    expect(d.detect('C:\\Users\\test>')).toBeTruthy();
  });

  test('detects bash prompt', () => {
    const d = new PromptDetector('bash');
    expect(d.detect('user@host:~$ ')).toBeTruthy();
  });

  test('does not detect prompt mid-command output', () => {
    const d = new PromptDetector('bash');
    expect(d.detect('building files...')).toBeNull();
  });

  test('stores last detected prompt', () => {
    const d = new PromptDetector('powershell');
    d.detect('PS C:\\proj>');
    expect(d.getLastPrompt()).toBe('PS C:\\proj>');
  });

  test('supports custom patterns', () => {
    const d = new PromptDetector('custom-shell', [
      { shell: 'custom-shell', pattern: /custom#>$/ },
    ]);
    expect(d.detect('whatever custom#>')).toBeTruthy();
    expect(d.detect('no prompt here')).toBeNull();
  });
});
