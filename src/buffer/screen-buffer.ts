import type { ScreenLine } from '../core/types.js';

export class ScreenBuffer {
  private lines: ScreenLine[] = [];
  private maxLines: number;
  private cursorRow: number = 0;
  private cursorCol: number = 0;

  constructor(maxLines: number = 10000) {
    this.maxLines = maxLines;
  }

  append(text: string): void {
    let lines = text.split('\n');
    if (lines[lines.length - 1] === '') {
      lines = lines.slice(0, -1);
    }
    for (const line of lines) {
      this.lines.push({
        text: this.stripAnsi(line),
        rawText: line,
        cursorRow: this.cursorRow,
        cursorCol: this.cursorCol,
        timestamp: Date.now(),
      });
      this.cursorRow++;
      this.cursorCol = 0;
    }
    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(this.lines.length - this.maxLines);
    }
  }

  getLastLines(n: number): ScreenLine[] {
    return this.lines.slice(-n);
  }

  getScrollback(): ScreenLine[] {
    return [...this.lines];
  }

  getCursorPosition(): { row: number; col: number } {
    return { row: this.cursorRow, col: this.cursorCol };
  }

  private stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }
}