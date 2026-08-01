import { randomUUID } from 'node:crypto';

export function uuid(): string {
  return randomUUID();
}