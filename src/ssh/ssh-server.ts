import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { Server as SshServer } from 'ssh2';
import type { PtyAdapter } from '../pty/pty-adapter.js';
import { createPtyAdapter } from '../pty/factory.js';
import { getConfigDir, DEFAULT_MCP_HOST } from '../config.js';
import { logger } from '../utils/logger.js';

export interface SshTerminalOptions {
  port?: number;
  host?: string;
  // Which shell to spawn for a connection (cwd/shell).
  resolveShell?: () => { shell: string; args: string[]; cwd: string };
}

function getHostKeyPath(): string {
  return path.join(getConfigDir(), 'hostkey.pem');
}

function loadOrCreateHostKey(): Buffer {
  const p = getHostKeyPath();
  if (fs.existsSync(p)) {
    return fs.readFileSync(p);
  }
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
  fs.mkdirSync(getConfigDir(), { recursive: true });
  fs.writeFileSync(p, pem);
  return Buffer.from(pem);
}

export interface SshTerminalHandle {
  server: SshServer;
  port: number;
  stop(): Promise<void>;
}

export async function startSshTerminal(options: SshTerminalOptions = {}): Promise<SshTerminalHandle> {
  const port = options.port ?? 8378;
  const host = options.host ?? DEFAULT_MCP_HOST;
  const resolveShell =
    options.resolveShell ??
    (() => ({
      shell: process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'),
      args: [],
      cwd: process.cwd(),
    }));

  const hostKey = loadOrCreateHostKey();
  const server = new SshServer({ hostKeys: [hostKey] });

  server.on('connection', (client) => {
    client.on('authentication', (ctx) => ctx.accept());

    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.once('shell', (accept2) => {
          const channel = accept2();
          const { shell, args, cwd } = resolveShell();
          const pty: PtyAdapter = createPtyAdapter();
          let ptyReady = false;

          pty.spawn(shell, args, cwd, { TERM: 'xterm-256color' }).catch((e) => {
            channel.stderr.write(`Failed to spawn shell: ${(e as Error).message}\r\n`);
            channel.exit(1);
            channel.end();
          });

          pty.onOutput((data) => {
            if (channel.writable) channel.write(data);
          });
          pty.onExit((code) => {
            try {
              channel.exit(code);
              channel.end();
            } catch {
              // channel already closed
            }
          });

          channel.on('data', (data: Buffer) => {
            if (ptyReady) pty.write(data.toString('utf8')).catch(() => {});
          });
          channel.on('resize', (info: { cols: number; rows: number }) => {
            pty.resize(info.cols, info.rows);
          });
          channel.on('close', () => {
            pty.destroy().catch(() => {});
          });

          // Give spawn a moment to be ready before forwarding input.
          setTimeout(() => {
            ptyReady = true;
          }, 100);
        });

        session.once('exec', (accept2) => {
          const exec = accept2();
          exec.on('data', () => {});
          exec.stderr.write('Use an interactive shell: `coterm ssh <sessionId>`\r\n');
          exec.exit(1);
          exec.end();
        });
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const actualPort = (server.address() as net.AddressInfo).port;
  logger.info({ port: actualPort }, 'CoTerm SSH terminal server ready');

  return {
    server,
    port: actualPort,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
