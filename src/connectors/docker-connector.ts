import type { Connector, ConnectorConfig, ResolvedConnector } from '../core/types.js';

export class DockerConnector implements Connector {
  readonly name = 'docker';
  readonly type = 'docker' as const;

  resolve(config: ConnectorConfig): ResolvedConnector {
    if (!config.container) {
      throw new Error('Docker connector requires a container name or id');
    }
    const args = ['exec', '-it', config.container];
    args.push(config.shell ?? '/bin/bash');
    if (config.shellArgs?.length) args.push(...config.shellArgs);

    return {
      shell: 'docker',
      shellArgs: args,
      cwd: config.cwd,
      env: config.env,
    };
  }
}

export default DockerConnector;
