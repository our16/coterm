import type { Connector, ConnectorConfig, ResolvedConnector } from '../core/types.js';
import { LocalConnector } from './local-connector.js';
import { SshConnector } from './ssh-connector.js';
import { WslConnector } from './wsl-connector.js';
import { DockerConnector } from './docker-connector.js';

export class ConnectorManager {
  private connectors = new Map<Connector['type'], Connector>();

  constructor() {
    this.register(new LocalConnector());
    this.register(new SshConnector());
    this.register(new WslConnector());
    this.register(new DockerConnector());
  }

  register(connector: Connector): void {
    this.connectors.set(connector.type, connector);
  }

  get(type: Connector['type']): Connector | undefined {
    return this.connectors.get(type);
  }

  resolve(config: ConnectorConfig): ResolvedConnector {
    const connector = this.connectors.get(config.type);
    if (!connector) {
      throw new Error(`Unknown connector type: ${config.type}`);
    }
    return connector.resolve(config);
  }

  list(): Connector['type'][] {
    return [...this.connectors.keys()];
  }
}

export const connectorManager = new ConnectorManager();
export default ConnectorManager;
