import { createHash } from 'crypto';

export function generateId(input: string): string {
  const hash = createHash('sha256').update(input).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32)
  ].join('-');
}

export function pathToId(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, '/').toLowerCase();
  return generateId(normalized);
}
