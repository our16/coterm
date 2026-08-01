import { describe, expect, test } from 'bun:test';
import { Session } from '../src/core/session.js';
import { SessionManager } from '../src/core/session-manager.js';
import { MockPty } from './helpers/mock-pty.js';

function makeConfig(id = 's1') {
  return {
    id,
    name: id,
    shell: 'powershell.exe',
    shellArgs: [],
    cwd: 'C:\\proj',
    cols: 120,
    rows: 30,
    env: {},
  };
}

describe('Session', () => {
  test('starts and transitions to running', async () => {
    const session = new Session(makeConfig());
    const pty = new MockPty();
    await session.start(pty);
    expect(session.getState()).toBe('running');
    expect(pty.spawned).toBe(true);
    expect(session.screenBuffer).not.toBeNull();
    expect(session.inputScheduler).not.toBeNull();
    expect(session.commandQueue).not.toBeNull();
  });

  test('cannot start twice', async () => {
    const session = new Session(makeConfig());
    const pty = new MockPty();
    await session.start(pty);
    await expect(session.start(new MockPty())).rejects.toThrow('Cannot start session in state running');
  });

  test('write forwards to PTY', async () => {
    const session = new Session(makeConfig());
    const pty = new MockPty();
    await session.start(pty);
    await session.write('ls\r');
    expect(pty.written).toEqual(['ls\r']);
  });

  test('resize forwards dimensions', async () => {
    const session = new Session(makeConfig());
    const pty = new MockPty();
    await session.start(pty);
    session.resize(100, 40);
    expect(pty.resized).toEqual([{ cols: 100, rows: 40 }]);
  });

  test('output is captured into screen buffer and emits event', async () => {
    const session = new Session(makeConfig());
    const pty = new MockPty();
    await session.start(pty);
    const events: string[] = [];
    const { eventBus } = await import('../src/core/event-bus.js');
    const unsub = eventBus.on('session:output', (e) => {
      if (e.type === 'session:output' && e.sessionId === session.id) events.push(e.data);
    });
    pty.emitOutput('hello\n');
    expect(session.getLastOutput(10)).toContain('hello');
    expect(events).toContain('hello\n');
    unsub();
  });

  test('prompt detection emits promptDetected', async () => {
    const session = new Session(makeConfig('s2'));
    const pty = new MockPty();
    await session.start(pty);
    const { eventBus } = await import('../src/core/event-bus.js');
    const prompts: string[] = [];
    const unsub = eventBus.on('session:promptDetected', (e) => {
      if (e.type === 'session:promptDetected' && e.sessionId === session.id) prompts.push(e.prompt);
    });
    pty.emitOutput('PS C:\\proj>');
    expect(prompts).toContain('PS C:\\proj>');
    unsub();
  });

  test('waitForPrompt resolves on next prompt', async () => {
    const session = new Session(makeConfig('s3'));
    const pty = new MockPty();
    await session.start(pty);
    const waitPromise = session.waitForPrompt(1000);
    pty.emitOutput('PS C:\\proj>');
    await expect(waitPromise).resolves.toBe('PS C:\\proj>');
  });

  test('waitForPrompt rejects on timeout', async () => {
    const session = new Session(makeConfig('s4'));
    const pty = new MockPty();
    await session.start(pty);
    await expect(session.waitForPrompt(50)).rejects.toThrow('Timed out');
  });

  test('close destroys PTY and sets state closed', async () => {
    const session = new Session(makeConfig());
    const pty = new MockPty();
    await session.start(pty);
    await session.close();
    expect(session.getState()).toBe('closed');
    expect(pty.destroyed).toBe(true);
  });

  test('handleExit sets state closed and emits commandComplete', async () => {
    const session = new Session(makeConfig('s5'));
    const pty = new MockPty();
    await session.start(pty);
    const { eventBus } = await import('../src/core/event-bus.js');
    let exitCode: number | null = null;
    const unsub = eventBus.on('session:commandComplete', (e) => {
      if (e.type === 'session:commandComplete' && e.sessionId === session.id) exitCode = e.exitCode;
    });
    pty.emitExit(0);
    expect(session.getState()).toBe('closed');
    expect(exitCode).toBe(0);
    unsub();
  });
});

describe('SessionManager', () => {
  test('creates and lists sessions', () => {
    const m = new SessionManager();
    const session = m.createSession(makeConfig('sm1'));
    expect(m.listSessions()).toHaveLength(1);
    expect(m.getSession('sm1')).toBe(session);
  });

  test('duplicate id throws', () => {
    const m = new SessionManager();
    m.createSession(makeConfig('sm2'));
    expect(() => m.createSession(makeConfig('sm2'))).toThrow('already exists');
  });

  test('destroy removes session', async () => {
    const m = new SessionManager();
    m.createSession(makeConfig('sm3'));
    await m.destroySession('sm3');
    expect(m.getSession('sm3')).toBeUndefined();
    expect(m.listSessions()).toHaveLength(0);
  });

  test('attach and detach AI updates owner', async () => {
    const m = new SessionManager();
    const session = m.createSession(makeConfig('sm4'));
    const pty = new MockPty();
    await session.start(pty);
    await m.attachAI('sm4');
    expect(m.getSession('sm4')?.owner).toBe('ai');
    await m.detachAI('sm4');
    expect(m.getSession('sm4')?.owner).toBe('human');
  });

  test('write lock arbitration through manager', async () => {
    const m = new SessionManager();
    const session = m.createSession(makeConfig('sm5'));
    const pty = new MockPty();
    await session.start(pty);
    expect(m.acquireWriteLock('sm5', 'human')).toBe(true);
    expect(m.acquireWriteLock('sm5', 'ai')).toBe(false);
    m.releaseWriteLock('sm5');
    expect(m.acquireWriteLock('sm5', 'ai')).toBe(true);
  });
});
