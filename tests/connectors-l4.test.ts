import { describe, expect, test } from 'bun:test';
import { LocalConnector } from '../src/connectors/local-connector.js';
import { SshConnector } from '../src/connectors/ssh-connector.js';
import { WslConnector } from '../src/connectors/wsl-connector.js';
import { DockerConnector } from '../src/connectors/docker-connector.js';
import { ConnectorManager } from '../src/connectors/connector-manager.js';
import { SessionAPI } from '../src/api/session-api.js';
import { SessionManager } from '../src/core/session-manager.js';
import { WorkspaceManager } from '../src/workspace/workspace-manager.js';
import { PosixPtyAdapter } from '../src/pty/posix-pty.js';
import { WindowsPtyAdapter } from '../src/pty/windows-pty.js';
import { SessionRecorder } from '../src/ai/session-recorder.js';
import { Session } from '../src/core/session.js';
import { MockPty } from './helpers/mock-pty.js';
import { createSnapshot, applySnapshot } from '../src/ai/snapshot.js';

describe('LocalConnector', () => {
  test('resolves to configured shell', () => {
    const c = new LocalConnector();
    const r = c.resolve({ type: 'local', shell: 'cmd.exe', shellArgs: ['/k'] });
    expect(r.shell).toBe('cmd.exe');
    expect(r.shellArgs).toEqual(['/k']);
  });

  test('defaults shell when not provided', () => {
    const c = new LocalConnector();
    const r = c.resolve({ type: 'local' });
    expect(r.shell).toBeTruthy();
  });
});

describe('SshConnector', () => {
  test('builds ssh command with user and port', () => {
    const c = new SshConnector();
    const r = c.resolve({ type: 'ssh', host: 'jump.example.com', user: 'admin', port: 2222 });
    expect(r.shell).toBe('ssh');
    expect(r.shellArgs).toEqual(['-p', '2222', 'admin@jump.example.com']);
  });

  test('adds identity file', () => {
    const c = new SshConnector();
    const r = c.resolve({ type: 'ssh', host: 'h', identity: '~/.ssh/id_rsa' });
    expect(r.shellArgs).toEqual(['-i', '~/.ssh/id_rsa', 'h']);
  });

  test('appends remote command args', () => {
    const c = new SshConnector();
    const r = c.resolve({ type: 'ssh', host: 'h', shellArgs: ['kubectl', 'get', 'pods'] });
    expect(r.shellArgs).toEqual(['h', 'kubectl', 'get', 'pods']);
  });

  test('throws without host', () => {
    const c = new SshConnector();
    expect(() => c.resolve({ type: 'ssh' })).toThrow('requires a host');
  });
});

describe('WslConnector', () => {
  test('targets a distribution', () => {
    const c = new WslConnector();
    const r = c.resolve({ type: 'wsl', distro: 'Ubuntu' });
    expect(r.shellArgs).toContain('-d');
    expect(r.shellArgs).toContain('Ubuntu');
  });

  test('includes cwd when provided', () => {
    const c = new WslConnector();
    const r = c.resolve({ type: 'wsl', cwd: '/home/user' });
    expect(r.shellArgs).toContain('--cd');
    expect(r.shellArgs).toContain('/home/user');
  });
});

describe('DockerConnector', () => {
  test('builds docker exec with default shell', () => {
    const c = new DockerConnector();
    const r = c.resolve({ type: 'docker', container: 'web' });
    expect(r.shellArgs).toEqual(['exec', '-it', 'web', '/bin/bash']);
  });

  test('respects custom shell', () => {
    const c = new DockerConnector();
    const r = c.resolve({ type: 'docker', container: 'db', shell: 'sh' });
    expect(r.shellArgs).toEqual(['exec', '-it', 'db', 'sh']);
  });

  test('throws without container', () => {
    const c = new DockerConnector();
    expect(() => c.resolve({ type: 'docker' })).toThrow('requires a container');
  });
});

describe('ConnectorManager', () => {
  test('registers all built-in connectors', () => {
    const m = new ConnectorManager();
    expect(m.list().sort()).toEqual(['docker', 'local', 'ssh', 'wsl']);
  });

  test('resolve dispatches by type', () => {
    const m = new ConnectorManager();
    const r = m.resolve({ type: 'ssh', host: 'h' });
    expect(r.shell).toBe('ssh');
  });

  test('unknown type throws', () => {
    const m = new ConnectorManager();
    expect(() => m.resolve({ type: 'kubernetes' })).toThrow('Unknown connector type');
  });
});

describe('SessionRecorder', () => {
  test('records only while active', () => {
    const r = new SessionRecorder();
    r.record({ type: 'session:output', sessionId: 's1', data: 'a' });
    expect(r.getEvents()).toHaveLength(0);
    r.start();
    r.record({ type: 'session:output', sessionId: 's1', data: 'a' });
    r.record({ type: 'session:promptDetected', sessionId: 's1', prompt: 'PS>' });
    expect(r.getEvents()).toHaveLength(2);
    r.stop();
    r.record({ type: 'session:output', sessionId: 's1', data: 'b' });
    expect(r.getEvents()).toHaveLength(2);
  });

  test('produces JSONL', () => {
    const r = new SessionRecorder();
    r.start();
    r.record({ type: 'session:output', sessionId: 's1', data: 'x' });
    const jsonl = r.toJsonl();
    const lines = jsonl.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('session:output');
    expect(parsed.sessionId).toBe('s1');
    expect(parsed.data.data).toBe('x');
    expect(parsed.timestamp).toBeTypeOf('number');
  });

  test('clear empties', () => {
    const r = new SessionRecorder();
    r.start();
    r.record({ type: 'session:output', sessionId: 's1', data: 'x' });
    r.clear();
    expect(r.getEvents()).toHaveLength(0);
  });
});

describe('Session recording integration', () => {
  test('session records output when recording enabled', async () => {
    const session = new Session({
      id: 'rec1',
      name: 'rec1',
      shell: 'powershell.exe',
      shellArgs: [],
      cwd: 'C:\\proj',
      cols: 120,
      rows: 30,
      env: {},
    });
    const pty = new MockPty();
    await session.start(pty);

    expect(session.isRecording()).toBe(false);
    session.startRecording();
    expect(session.isRecording()).toBe(true);

    pty.emitOutput('hello\n');
    const events = session.getRecordingEvents();
    expect(events.filter((e) => e.type === 'session:output')).toHaveLength(1);
    expect(session.getRecordingJsonl()).toContain('"hello');

    session.stopRecording();
    expect(session.isRecording()).toBe(false);
  });
});

describe('Session presence', () => {
  test('tracks presence transitions', async () => {
    const session = new Session({
      id: 'pres1',
      name: 'pres1',
      shell: 'powershell.exe',
      shellArgs: [],
      cwd: 'C:\\proj',
      cols: 120,
      rows: 30,
      env: {},
    });
    const pty = new MockPty();
    await session.start(pty);

    expect(session.getPresence()).toBe('idle');
    await session.write('git status\r', 'human');
    expect(session.getPresence()).toBe('human-typing');

    await session.write('pytest\r', 'ai');
    expect(session.getPresence()).toBe('ai-running');

    pty.emitOutput('2 passed\r\nPS C:\\proj>');
    expect(session.getPresence()).toBe('idle');

    session.attachAgent('deploy-agent');
    expect(session.getPresence()).toBe('ai-thinking');

    session.interrupt();
    expect(session.getPresence()).toBe('idle');
  });

  test('emits session:presence events', async () => {
    const session = new Session({
      id: 'pres2',
      name: 'pres2',
      shell: 'powershell.exe',
      shellArgs: [],
      cwd: 'C:\\proj',
      cols: 120,
      rows: 30,
      env: {},
    });
    const pty = new MockPty();
    await session.start(pty);

    const states: string[] = [];
    const { eventBus } = await import('../src/core/event-bus.js');
    const unsub = eventBus.on('session:presence', (e) => {
      if (e.type === 'session:presence' && e.sessionId === session.id) states.push(e.presence);
    });
    await session.write('ls\r', 'ai');
    expect(states).toContain('ai-running');
    unsub();
  });

  test('presence appears in session info', async () => {
    const session = new Session({
      id: 'pres3',
      name: 'pres3',
      shell: 'powershell.exe',
      shellArgs: [],
      cwd: 'C:\\proj',
      cols: 120,
      rows: 30,
      env: {},
    });
    const pty = new MockPty();
    await session.start(pty);
    expect(session.getInfo().presence).toBe('idle');
  });
});

describe('Workspace', () => {
  test('create, add sessions, and list', () => {
    const wm = new WorkspaceManager();
    const wsId = wm.createWorkspace('deploy').id;
    wm.addToWorkspace(wsId, 's1');
    wm.addToWorkspace(wsId, 's2');
    wm.addToWorkspace(wsId, 's1');

    const info = wm.getWorkspace(wsId)?.getInfo();
    expect(info?.sessionIds).toEqual(['s1', 's2']);
    expect(wm.listWorkspaces()).toHaveLength(1);
  });

  test('remove session and remove workspace', () => {
    const wm = new WorkspaceManager();
    const wsId = wm.createWorkspace('deploy').id;
    wm.addToWorkspace(wsId, 's1');
    wm.addToWorkspace(wsId, 's2');
    wm.removeFromWorkspace(wsId, 's1');
    expect(wm.getWorkspace(wsId)?.getSessionIds()).toEqual(['s2']);
    wm.removeWorkspace(wsId);
    expect(wm.listWorkspaces()).toHaveLength(0);
  });

  test('unknown workspace throws', () => {
    const wm = new WorkspaceManager();
    expect(() => wm.addToWorkspace('nope', 's1')).toThrow('not found');
  });
});

describe('Workspace via SessionAPI', () => {
  function makeApi() {
    return new SessionAPI({
      manager: new SessionManager(),
      workspaces: new WorkspaceManager(),
      adapterFactory: () => new MockPty(),
    });
  }

  test('runInWorkspace executes in all members', async () => {
    const api = makeApi();
    const id1 = await api.createSession({ id: 'w1' });
    const id2 = await api.createSession({ id: 'w2' });
    const wsId = api.createWorkspace('deploy');
    api.addToWorkspace(wsId, id1);
    api.addToWorkspace(wsId, id2);

    const results = await api.runInWorkspace(wsId, 'echo hi', 'human');
    expect(results).toEqual({ w1: 'ok', w2: 'ok' });

    const s1 = api.getSessionManager().getSession('w1');
    const pty1 = s1?.pty as MockPty;
    const s2 = api.getSessionManager().getSession('w2');
    const pty2 = s2?.pty as MockPty;
    expect(pty1.written).toContain('echo hi\r');
    expect(pty2.written).toContain('echo hi\r');
  });

  test('getWorkspaceStatus aggregates member state', async () => {
    const api = makeApi();
    const id1 = await api.createSession({ id: 'w3' });
    const id2 = await api.createSession({ id: 'w4' });
    const wsId = api.createWorkspace('deploy');
    api.addToWorkspace(wsId, id1);
    api.addToWorkspace(wsId, id2);

    const status = api.getWorkspaceStatus(wsId);
    expect(status).toHaveLength(2);
    expect(status.every((s) => s.state === 'running')).toBe(true);
  });
});

describe('PTY adapters', () => {
  test('PosixPtyAdapter and WindowsPtyAdapter share the NodePtyAdapter contract', () => {
    const posix = new PosixPtyAdapter();
    const windows = new WindowsPtyAdapter();
    for (const adapter of [posix, windows]) {
      expect(typeof adapter.spawn).toBe('function');
      expect(typeof adapter.write).toBe('function');
      expect(typeof adapter.resize).toBe('function');
      expect(typeof adapter.onOutput).toBe('function');
      expect(typeof adapter.onExit).toBe('function');
      expect(typeof adapter.destroy).toBe('function');
    }
  });

  test('adapter types reflect platform naming', () => {
    expect(new PosixPtyAdapter()).toBeInstanceOf(PosixPtyAdapter);
    expect(new WindowsPtyAdapter()).toBeInstanceOf(WindowsPtyAdapter);
  });
});

describe('Snapshot', () => {
  test('snapshot captures and restore recreates state', async () => {
    const session = new Session({
      id: 'snap1',
      name: 'snap1',
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
    pty.emitOutput('On branch main\r\n');
    pty.emitOutput('PS C:\\proj>');

    const snapshot = createSnapshot(session);
    expect(snapshot.intelligence.commands).toHaveLength(1);
    expect(snapshot.intelligence.lastCommand?.command).toBe('git status');
    expect(snapshot.prompt).toBeTruthy();

    const restored = new Session({
      id: 'snap2',
      name: 'snap2',
      shell: 'powershell.exe',
      shellArgs: [],
      cwd: 'C:\\other',
      cols: 120,
      rows: 30,
      env: {},
    });
    const restoredPty = new MockPty();
    await restored.start(restoredPty);
    applySnapshot(restored, snapshot);

    const st = restored.getIntelligenceState();
    expect(st.cwd).toBe('C:\\proj');
    expect(st.commands).toHaveLength(1);
    expect(st.lastCommand?.command).toBe('git status');
    expect(restored.getLastOutput(10)).toContain('On branch main');
  });
});
