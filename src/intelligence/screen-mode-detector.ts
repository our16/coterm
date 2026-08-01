const ALT_SCREEN_ENTER = [
  '\x1b[?1049h',
  '\x1b[?1047h',
  '\x1b[?47h',
  '\x1b[?1049;',
  '\x1b[?1047;',
];

const ALT_SCREEN_EXIT = [
  '\x1b[?1049l',
  '\x1b[?1047l',
  '\x1b[?47l',
  '\x1b[?1049;',
  '\x1b[?1047;',
];

export class ScreenModeDetector {
  private altScreen = false;

  feed(data: string): void {
    for (const seq of ALT_SCREEN_ENTER) {
      if (data.includes(seq)) {
        this.altScreen = true;
        return;
      }
    }
    for (const seq of ALT_SCREEN_EXIT) {
      if (data.includes(seq)) {
        this.altScreen = false;
        return;
      }
    }
  }

  isFullScreenApp(): boolean {
    return this.altScreen;
  }

  reset(): void {
    this.altScreen = false;
  }
}

export default ScreenModeDetector;
