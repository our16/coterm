import { describe, expect, test } from 'bun:test';
import { ScreenBuffer } from '../src/buffer/screen-buffer.js';

describe('ScreenBuffer', () => {
  test('appends and tracks lines', () => {
    const b = new ScreenBuffer();
    b.append('line one\nline two\n');
    expect(b.getLastLines(2).map((l) => l.text)).toEqual(['line one', 'line two']);
  });

  test('strips ANSI escape codes from text but keeps rawText', () => {
    const b = new ScreenBuffer();
    b.append('\x1b[32mgreen\x1b[0m\n');
    const line = b.getLastLines(1)[0];
    expect(line.text).toBe('green');
    expect(line.rawText).toBe('\x1b[32mgreen\x1b[0m');
  });

  test('enforces max lines (circular buffer)', () => {
    const b = new ScreenBuffer(3);
    b.append('a\nb\nc\nd\n');
    const lines = b.getScrollback().map((l) => l.text);
    expect(lines).toEqual(['b', 'c', 'd']);
  });

  test('getLastLines returns most recent n', () => {
    const b = new ScreenBuffer();
    b.append('a\nb\nc\n');
    expect(b.getLastLines(2).map((l) => l.text)).toEqual(['b', 'c']);
  });

  test('empty buffer returns empty', () => {
    const b = new ScreenBuffer();
    expect(b.getLastLines(5)).toHaveLength(0);
    expect(b.getScrollback()).toHaveLength(0);
  });

  test('tracks cursor position across appended lines', () => {
    const b = new ScreenBuffer();
    b.append('a\nb\n');
    const pos = b.getCursorPosition();
    expect(pos.row).toBeGreaterThan(0);
    expect(pos.col).toBe(0);
  });
});
