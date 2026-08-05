import { describe, expect, test } from 'bun:test';
import { createPasteDecoder } from '../src/cli/paste-bridge.js';

const utf8 = (s: string): Buffer => Buffer.from(s, 'utf8');

describe('paste decoder (transparent input bridge)', () => {
  test('passes plain keystrokes through', () => {
    const d = createPasteDecoder();
    const out = d.push(utf8('git status\r'));
    expect(out.keystrokes).toBe('git status\r');
    expect(out.pastes).toEqual([]);
  });

  test('strips bracketed-paste wrapper and emits inner text as one paste', () => {
    const d = createPasteDecoder();
    const out = d.push(utf8('\x1b[200~git status\x1b[201~'));
    expect(out.keystrokes).toBe('');
    expect(out.pastes).toEqual(['git status']);
  });

  test('paste content is never split even if it contains \\r', () => {
    const d = createPasteDecoder();
    const out = d.push(utf8('\x1b[200~line1\rline2\r\x1b[201~'));
    expect(out.keystrokes).toBe('');
    expect(out.pastes).toEqual(['line1\rline2\r']);
  });

  test('keystrokes before a paste are forwarded separately', () => {
    const d = createPasteDecoder();
    const out = d.push(utf8('abc\x1b[200~xyz\x1b[201~'));
    expect(out.keystrokes).toBe('abc');
    expect(out.pastes).toEqual(['xyz']);
  });

  test('multi-byte UTF-8 split across data events stays intact', () => {
    const d = createPasteDecoder();
    const src = '\x1b[200~中文，emoji 🚀 end\x1b[201~';
    const bytes = Buffer.from(src, 'utf8');
    const half = Math.floor(bytes.length / 2);
    const first = d.push(bytes.subarray(0, half));
    const second = d.push(bytes.subarray(half));
    // The paste can only be complete once the end marker arrived.
    const combined = [...first.pastes, ...second.pastes].join('');
    expect(combined).toBe('中文，emoji 🚀 end');
    expect(combined).not.toMatch(/\uFFFD/);
  });

  test('multi-byte UTF-8 split across plain keystroke chunks stays intact', () => {
    const d = createPasteDecoder();
    const src = '中文';
    const bytes = Buffer.from(src, 'utf8');
    const first = d.push(bytes.subarray(0, 1));
    const second = d.push(bytes.subarray(1));
    expect(first.keystrokes + second.keystrokes).toBe('中文');
  });

  test('start marker split across data events is held back, not forwarded', () => {
    const d = createPasteDecoder();
    const src = '\x1b[200~abc\x1b[201~';
    const bytes = Buffer.from(src, 'utf8');
    const first = d.push(bytes.subarray(0, 3)); // "\x1b[2"
    expect(first.keystrokes).toBe('');
    expect(first.pastes).toEqual([]);
    const second = d.push(bytes.subarray(3));
    expect(second.keystrokes).toBe('');
    expect(second.pastes).toEqual(['abc']);
  });

  test('arrow-key escapes are not mistaken for paste markers', () => {
    const d = createPasteDecoder();
    const out = d.push(utf8('\x1b[A\x1b[B'));
    expect(out.keystrokes).toBe('\x1b[A\x1b[B');
    expect(out.pastes).toEqual([]);
  });
});
