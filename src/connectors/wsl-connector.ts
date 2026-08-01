import type { Connector, ConnectorConfig, ResolvedConnector } from '../core/types.js';
import { isWindows } from '../utils/platform.js';

export class WslConnector implements Connector {
  readonly name = 'wsl';
  readonly type = 'wsl' as const;

  resolve(config: ConnectorConfig): ResolvedConnector {
    const args: string[] = [];
    if (config.distro) args.push('-d', config.distro);
    if (config.cwd) args.push('--cd', config.cwd);
    if (config.shellArgs?.length) args.push(...config.shellArgs);

    return {
      shell: isWindows() ? 'wsl.exe' : 'wsl',
      shellArgs: args,
      env: config.env,
    };
  }
}

export default WslConnector;
