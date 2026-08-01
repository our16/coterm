import type { PromptPattern } from '../core/types.js';

const DEFAULT_PATTERNS: Record<string, RegExp> = {
  powershell: /PS [^>]*>\s*$/,
  pwsh: /PS [^>]*>\s*$/,
  cmd: />\s*$/,
  bash: /\$\s*$/,
  zsh: /%\s*$/,
  fish: /❯\s*$/,
  python: />>>\s*$/,
  mysql: /mysql>\s*$/,
  redis: /redis>\s*$/,
  sqlite: /sqlite>\s*$/,
};

export function normalizeShell(shell: string): string {
  const base = shell.split(/[\\/]/).pop() ?? shell;
  return base.toLowerCase().replace(/\.exe$/, '');
}

export class PromptDetector {
  private shellKey: string;
  private patterns: Map<string, RegExp>;
  private lastPrompt: string | null = null;

  constructor(shell: string, customPatterns?: PromptPattern[]) {
    this.shellKey = normalizeShell(shell);
    this.patterns = new Map();
    this.patterns.set(this.shellKey, DEFAULT_PATTERNS[this.shellKey] || /\$\s*$/);

    // wsl.exe / docker / ssh launch a POSIX shell inside — treat as bash.
    if (['wsl', 'wsl.exe', 'docker', 'docker.exe', 'ssh'].includes(this.shellKey)) {
      this.patterns.set(this.shellKey, DEFAULT_PATTERNS.bash);
    }

    if (customPatterns) {
      for (const p of customPatterns) {
        this.patterns.set(normalizeShell(p.shell), p.pattern);
      }
    }
  }

  detect(output: string): string | null {
    const pattern = this.patterns.get(this.shellKey) ?? this.patterns.get('default') ?? /\$\s*$/;
    if (!pattern) return null;

    const clean = this.stripAnsi(output);
    const match = clean.match(pattern);
    if (match) {
      this.lastPrompt = match[0];
      return match[0];
    }
    return null;
  }

  private stripAnsi(text: string): string {
    return text
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07?/g, '');
  }

  getLastPrompt(): string | null {
    return this.lastPrompt;
  }

  addPattern(shell: string, pattern: RegExp): void {
    this.patterns.set(normalizeShell(shell), pattern);
  }
}
