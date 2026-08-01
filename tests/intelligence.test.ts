import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { EnvDetector } from '../src/intelligence/env-detector.js';
import { ScreenModeDetector } from '../src/intelligence/screen-mode-detector.js';
import { CommandTracker, hasErrorIndicator } from '../src/intelligence/command-tracker.js';
import { SessionIntelligence } from '../src/intelligence/session-intelligence.js';
import { Session } from '../src/core/session.js';
import { isWindows } from '../src/utils/platform.js';
import { MockPty } from './helpers/mock-pty.js';

describe('EnvDetector', () => {
  test('detects tools present in PATH', () => {
    const d = new EnvDetector({
      env: { PATH: 'C:\\tools\\bin;C:\\Windows' },
      tools: ['mytool'],
    });
    // no real executable — just verify structure is a map
    const result = d.detect();
    expect(result).toBeTypeOf('object');
  });

  test('caches detection result', () => {
    const d = new EnvDetector({ env: { PATH: process.env.PATH }, tools: ['node'] });
    const a = d.detect();
    const b = d.detect();
    expect(a).toBe(b);
  });

  test('has() reflects detection', () => {
    const d = new EnvDetector({ env: { PATH: '' }, tools: [] });
    expect(d.has('node')).toBe(false);
  });
});

describe('ScreenModeDetector', () => {
  test('detects alternate screen buffer entry', () => {
    const d = new ScreenModeDetector();
    expect(d.isFullScreenApp()).toBe(false);
    d.feed('normal output \x1b[?1049h');
    expect(d.isFullScreenApp()).toBe(true);
  });

  test('detects alternate screen buffer exit', () => {
    const d = new ScreenModeDetector();
    d.feed('\x1b[?1049h');
    d.feed('content');
    expect(d.isFullScreenApp()).toBe(true);
    d.feed('\x1b[?1049l');
    expect(d.isFullScreenApp()).toBe(false);
  });

  test('no ANSI sequence leaves it false', () => {
    const d = new ScreenModeDetector();
    d.feed('just text');
    expect(d.isFullScreenApp()).toBe(false);
  });

  test('supports older 1047/47 variants', () => {
    const d = new ScreenModeDetector();
    d.feed('\x1b[?1047h');
    expect(d.isFullScreenApp()).toBe(true);
    d.feed('\x1b[?1047l');
    expect(d.isFullScreenApp()).toBe(false);
  });
});

describe('CommandTracker', () => {
  test('records commands in sequence', () => {
    const t = new CommandTracker();
    t.record('git pull', 'ai');
    t.record('pytest', 'ai');
    const cmds = t.getCommands();
    expect(cmds).toHaveLength(2);
    expect(cmds[0].command).toBe('git pull');
    expect(cmds[0].requester).toBe('ai');
    expect(cmds[1].command).toBe('pytest');
  });

  test('new record finalizes pending one', async () => {
    const t = new CommandTracker();
    t.record('git pull', 'ai');
    await new Promise((r) => setTimeout(r, 5));
    t.record('pytest', 'ai');
    const first = t.getCommands()[0];
    expect(first.durationMs).toBeGreaterThan(0);
  });

  test('complete records error heuristic from accumulated output', () => {
    const t = new CommandTracker();
    t.record('npm install', 'ai');
    t.accumulate('npm ERR! code ENOENT\n');
    t.complete();
    const cmd = t.getLastCommand();
    expect(cmd?.error).toBe(true);
    expect(cmd?.outputPreview).toContain('ENOENT');
  });

  test('complete marks success when no error keywords', () => {
    const t = new CommandTracker();
    t.record('ls', 'ai');
    t.accumulate('file1  file2\n');
    t.complete();
    expect(t.getLastCommand()?.error).toBe(false);
  });

  test('accumulate caps buffer size', () => {
    const t = new CommandTracker({ maxOutputBuffer: 100 });
    t.record('cmd', 'human');
    t.accumulate('x'.repeat(500));
    expect(t.getAccumulatedOutput().length).toBeLessThanOrEqual(100);
  });

  test('exitCode is captured', () => {
    const t = new CommandTracker();
    t.record('cmd', 'human');
    t.complete(1);
    expect(t.getLastCommand()?.exitCode).toBe(1);
  });

  test('respects maxCommands', () => {
    const t = new CommandTracker({ maxCommands: 3 });
    t.record('a', 'human');
    t.record('b', 'human');
    t.record('c', 'human');
    t.record('d', 'human');
    expect(t.getCommands()).toHaveLength(3);
    expect(t.getCommands()[0].command).toBe('b');
  });
});

describe('hasErrorIndicator', () => {
  test('matches common error words', () => {
    expect(hasErrorIndicator('Error: cannot find module')).toBe(true);
    expect(hasErrorIndicator('Traceback (most recent call last)')).toBe(true);
    expect(hasErrorIndicator('fatal: not a git repository')).toBe(true);
    expect(hasErrorIndicator('command not found: foo')).toBe(true);
  });

  test('does not match clean output', () => {
    expect(hasErrorIndicator('all tests passed')).toBe(false);
    expect(hasErrorIndicator('File saved')).toBe(false);
  });
});

describe('SessionIntelligence', () => {
  const base = isWindows() ? 'C:\\proj' : '/proj';
  const src = path.resolve(base, 'src');

  test('tracks cd commands after successful completion', () => {
    const si = new SessionIntelligence(base);
    si.recordCommand('cd src', 'human');
    si.onOutput('>');
    si.onPromptDetected();
    expect(si.getCwd()).toBe(src);

    si.recordCommand('Set-Location ..', 'ai');
    si.onOutput('>');
    si.onPromptDetected();
    expect(si.getCwd()).toBe(path.resolve(src, '..'));
  });

  test('does not apply cwd on failed cd', () => {
    const si = new SessionIntelligence(base);
    si.recordCommand('cd missing-dir', 'human');
    si.onOutput('cannot find the path specified.\r\n>');
    si.onPromptDetected();
    expect(si.getCwd()).toBe(base);
  });

  test('tracks tilde to home', () => {
    const home = isWindows() ? 'C:\\Users\\Test' : '/home/test';
    const originalUser = process.env.USERPROFILE;
    const originalHome = process.env.HOME;
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    try {
      const si = new SessionIntelligence(base);
      si.recordCommand('cd ~/dev', 'human');
      si.onOutput('>');
      si.onPromptDetected();
      expect(si.getCwd()).toBe(path.resolve(home, 'dev'));
    } finally {
      if (originalUser === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUser;
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  test('getState aggregates all signals', () => {
    const si = new SessionIntelligence('C:\\proj');
    si.onOutput('\x1b[?1049h'); // enter vim
    si.recordCommand('git pull', 'ai');
    const state = si.getState('running');
    expect(state.cwd).toBe('C:\\proj');
    expect(state.state).toBe('running');
    expect(state.fullScreenApp).toBe(true);
    expect(state.commands).toHaveLength(1);
    expect(state.currentCommand?.command).toBe('git pull');
  });

  test('onPromptDetected finalizes current command', () => {
    const si = new SessionIntelligence('C:\\proj');
    si.recordCommand('git pull', 'ai');
    si.onOutput('Already up to date.');
    si.onPromptDetected();
    expect(si.commandTracker.getCurrentCommand()).toBeNull();
    expect(si.commandTracker.getLastCommand()?.error).toBe(false);
  });
});

describe('Session intelligence integration', () => {
  test('write with newline records command; prompt completes it', async () => {
    const session = new Session({
      id: 'int1',
      name: 'int1',
      shell: 'powershell.exe',
      shellArgs: [],
      cwd: 'C:\\proj',
      cols: 120,
      rows: 30,
      env: {},
    });
    const pty = new MockPty();
    await session.start(pty);

    await session.write('git status\r', 'ai');
    const pending = session.getIntelligenceState().currentCommand;
    expect(pending?.command).toBe('git status');
    expect(pending?.requester).toBe('ai');

    pty.emitOutput('On branch main\r\n');
    pty.emitOutput('PS C:\\proj>');
    const state = session.getIntelligenceState();
    expect(state.currentCommand).toBeNull();
    expect(state.lastCommand?.command).toBe('git status');
  });

  test('full-screen app flag reflects PTY output', async () => {
    const session = new Session({
      id: 'int2',
      name: 'int2',
      shell: 'powershell.exe',
      shellArgs: [],
      cwd: 'C:\\proj',
      cols: 120,
      rows: 30,
      env: {},
    });
    const pty = new MockPty();
    await session.start(pty);
    pty.emitOutput('\x1b[?1049h');
    expect(session.getIntelligenceState().fullScreenApp).toBe(true);
  });
});
