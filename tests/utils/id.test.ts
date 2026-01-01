import { describe, it, expect } from 'vitest';
import { generateId, pathToId } from '../../src/utils/id.js';

describe('generateId', () => {
  it('generates consistent ID for same input', () => {
    const id1 = generateId('sites/contoso');
    const id2 = generateId('sites/contoso');
    expect(id1).toBe(id2);
  });

  it('generates different IDs for different inputs', () => {
    const id1 = generateId('sites/contoso');
    const id2 = generateId('sites/fabrikam');
    expect(id1).not.toBe(id2);
  });

  it('generates valid GUID format', () => {
    const id = generateId('sites/contoso');
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(id).toMatch(guidRegex);
  });
});

describe('pathToId', () => {
  it('normalizes path separators', () => {
    const id1 = pathToId('contoso/main/Documents');
    const id2 = pathToId('contoso\\main\\Documents');
    expect(id1).toBe(id2);
  });
});
