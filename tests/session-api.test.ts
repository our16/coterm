import { describe, expect, test } from 'bun:test';
import { SessionAPI } from '../src/api/session-api.js';
import { SessionManager } from '../src/core/session-manager.js';
import { MockPty } from './helpers/mock-pty.js';

function makeApi() {
  return new SessionAPI({
    manager: new SessionManager(),
    defaultShell: 'powershell.exe',
    defaultCwd: 'C:\\proj',
    adapterFactory: () => new MockPty(),
  });
}

describe('SessionAPI', () => {
  test('createSession returns id and registers session', async () => {
    const api = makeApi();
    const id = await api.createSession({ name: 'test' });
    expect(api.listSessions()).toHaveLength(1);
    expect(api.getSession(id).name).toBe('test');
    expect(api.getSession(id).state).toBe('running');
  });

  test('duplicate manager rejects same id', async () => {
    const api = makeApi();
    await api.createSession({ id: 'dup' });
    await expect(api.createSession({ id: 'dup' })).rejects.toThrow('already exists');
  });

  test('runCommand writes command with newline', async () => {
    const api = makeApi();
    const id = await api.createSession();
    await api.runCommand(id, 'git status');
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;
    expect(pty.written.at(-1)).toBe('git status\r');
  });

  test('human write preempts while AI pending waits', async () => {
    const api = makeApi();
    const id = await api.createSession();
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    const humanWrite = api.write(id, 'human-cmd\r', 'human');
    await humanWrite;
    expect(pty.written).toContain('human-cmd\r');
  });

  test('readText returns captured output', async () => {
    const api = makeApi();
    const id = await api.createSession();
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;
    pty.emitOutput('line1\nline2\n');
    expect(api.readText(id, 10)).toContain('line1');
    expect(api.read(id, 10).map((l) => l.text)).toEqual(['line1', 'line2']);
  });

  test('resize and interrupt forward to PTY', async () => {
    const api = makeApi();
    const id = await api.createSession();
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;
    api.resize(id, 90, 40);
    expect(pty.resized).toEqual([{ cols: 90, rows: 40 }]);
    api.interrupt(id, 'ai');
    expect(pty.written).toContain('\x03');
  });

  test('onOutput and onPromptDetected subscriptions fire', async () => {
    const api = makeApi();
    const id = await api.createSession();
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;

    const outputs: string[] = [];
    const prompts: string[] = [];
    const unsub1 = api.onOutput(id, (d) => outputs.push(d));
    const unsub2 = api.onPromptDetected(id, (p) => prompts.push(p));

    pty.emitOutput('PS C:\\proj>');
    expect(outputs).toContain('PS C:\\proj>');
    expect(prompts).toContain('PS C:\\proj>');

    unsub1();
    unsub2();
    pty.emitOutput('more');
    expect(outputs.filter((o) => o === 'more')).toHaveLength(0);
  });

  test('waitForPrompt resolves via API', async () => {
    const api = makeApi();
    const id = await api.createSession();
    const session = api.getSessionManager().getSession(id);
    const pty = session?.pty as MockPty;
    const wait = api.waitForPrompt(id, 1000);
    pty.emitOutput('PS C:\\proj>');
    await expect(wait).resolves.toBe('PS C:\\proj>');
  });

  test('destroySession closes and removes', async () => {
    const api = makeApi();
    const id = await api.createSession();
    await api.destroySession(id);
    expect(api.listSessions()).toHaveLength(0);
  });

  test('attach/detach flips owner', async () => {
    const api = makeApi();
    const id = await api.createSession();
    expect(api.getSession(id).owner).toBe('human');
    api.attach(id);
    expect(api.getSession(id).owner).toBe('ai');
    api.detach(id);
    expect(api.getSession(id).owner).toBe('human');
  });

  test('operations on missing session throw', async () => {
    const api = makeApi();
    expect(() => api.readText('nope')).toThrow('not found');
    await expect(api.write('nope', 'x')).rejects.toThrow('not found');
  });
});
