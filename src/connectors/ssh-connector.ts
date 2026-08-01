import type { Connector, ConnectorConfig, ResolvedConnector } from '../core/types.js';

export class SshConnector implements Connector {
  readonly name = 'ssh';
  readonly type = 'ssh' as const;

  resolve(config: ConnectorConfig): ResolvedConnector {
    if (!config.host) {
      throw new Error('SSH connector requires a host');
    }
    const args: string[] = [];
    if (config.port) args.push('-p', String(config.port));
    if (config.identity) args.push('-i', config.identity);
    const target = config.user ? `${config.user}@${config.host}` : config.host;
    args.push(target);
    if (config.shellArgs?.length) args.push(...config.shellArgs);

    return {
      shell: 'ssh',
      shellArgs: args,
      cwd: config.cwd,
      env: config.env,
    };
  }
}

export default SshConnector;
