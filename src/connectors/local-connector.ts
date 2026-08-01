import type { Connector, ConnectorConfig, ResolvedConnector } from '../core/types.js';
import { detectDefaultShell } from '../utils/platform.js';

export class LocalConnector implements Connector {
  readonly name = 'local';
  readonly type = 'local' as const;

  resolve(config: ConnectorConfig): ResolvedConnector {
    return {
      shell: config.shell ?? detectDefaultShell(),
      shellArgs: config.shellArgs ?? [],
      cwd: config.cwd,
      env: config.env,
    };
  }
}

export default LocalConnector;
