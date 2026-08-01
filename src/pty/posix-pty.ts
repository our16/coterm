import type { PtyAdapter } from './pty-adapter.js';
import { NodePtyAdapter } from './node-pty-adapter.js';

export { NodePtyAdapter } from './node-pty-adapter.js';

export class PosixPtyAdapter extends NodePtyAdapter implements PtyAdapter {}

export default PosixPtyAdapter;
