import type { PromptPattern } from '../core/types.js';

const DEFAULT_PATTERNS: Record<string, RegExp> = {
  powershell: /PS [^>]*>\s*$/,
  cmd: />\s*$/,
  bash: /\$\s*$/,
  zsh: /%\s*$/,
  fish: /❯\s*$/,
  python: />>>\s*$/,
  mysql: /mysql>\s*$/,
  redis: /redis>\s*$/,
  sqlite: /sqlite>\s*$/,
};

export class PromptDetector {
  private patterns: Map<string, RegExp>;
  private lastPrompt: string | null = null;

  constructor(shell: string, customPatterns?: PromptPattern[]) {
    this.patterns = new Map();
    this.patterns.set(shell, DEFAULT_PATTERNS[shell] || /\$\s*$/);

    if (customPatterns) {
      for (const p of customPatterns) {
        this.patterns.set(p.shell, p.pattern);
      }
    }
  }

  detect(output: string): string | null {
    const pattern = this.patterns.get('default') ?? this.patterns.values().next().value;
    if (!pattern) return null;

    const match = output.match(pattern);
    if (match) {
      this.lastPrompt = match[0];
      return match[0];
    }
    return null;
  }

  getLastPrompt(): string | null {
    return this.lastPrompt;
  }

  addPattern(shell: string, pattern: RegExp): void {
    this.patterns.set(shell, pattern);
  }
}