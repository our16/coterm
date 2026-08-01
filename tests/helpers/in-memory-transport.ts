import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export class InMemoryTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private other?: InMemoryTransport;

  static createLinkedPair(): [InMemoryTransport, InMemoryTransport] {
    const a = new InMemoryTransport();
    const b = new InMemoryTransport();
    a.other = b;
    b.other = a;
    return [a, b];
  }

  async start(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    setImmediate(() => {
      this.other?.onmessage?.(message);
    });
  }
}

export default InMemoryTransport;
