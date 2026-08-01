import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWindows } from '../utils/platform.js';

const DEFAULT_TOOLS = [
  'node',
  'npm',
  'npx',
  'bun',
  'pnpm',
  'yarn',
  'python',
  'python3',
  'pip',
  'pip3',
  'uv',
  'conda',
  'git',
  'docker',
  'kubectl',
  'helm',
  'go',
  'rustc',
  'cargo',
  'java',
  'mysql',
  'redis-cli',
  'sqlite3',
];

export interface EnvDetectorOptions {
  env?: Record<string, string | undefined>;
  tools?: string[];
}

export class EnvDetector {
  private tools: string[];
  private env: Record<string, string | undefined>;
  private cache: Record<string, string> | null = null;

  constructor(options: EnvDetectorOptions = {}) {
    this.tools = options.tools ?? DEFAULT_TOOLS;
    this.env = options.env ?? (process.env as Record<string, string | undefined>);
  }

  detect(): Record<string, string> {
    if (this.cache) return this.cache;
    const result: Record<string, string> = {};
    for (const tool of this.tools) {
      const found = this.findInPath(tool);
      if (found) result[tool] = found;
    }
    this.cache = result;
    return result;
  }

  private findInPath(tool: string): string | undefined {
    const pathEnv = this.env.PATH ?? this.env.Path ?? '';
    const extensions = isWindows() ? ['', '.exe', '.cmd', '.bat', '.ps1'] : [''];
    for (const dir of pathEnv.split(path.delimiter)) {
      if (!dir) continue;
      for (const ext of extensions) {
        const candidate = path.join(dir, tool + ext);
        try {
          if (fs.existsSync(candidate)) return candidate;
        } catch {
          // ignore invalid path entries
        }
      }
    }
    return undefined;
  }

  has(tool: string): boolean {
    return tool in this.detect();
  }
}

export const envDetector = new EnvDetector();
export default EnvDetector;
