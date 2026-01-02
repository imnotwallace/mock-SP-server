import { describe, it, expect } from 'vitest';
import { encodeSkipToken, decodeSkipToken, generateNextLink } from '../../src/utils/skiptoken.js';

describe('skiptoken utilities', () => {
  describe('encodeSkipToken', () => {
    it('should encode a skiptoken payload to base64url', () => {
      const payload = { skip: 10, top: 20 };
      const token = encodeSkipToken(payload);

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      // base64url should not contain + or /
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
    });

    it('should encode payload with all optional fields', () => {
      const payload = {
        skip: 100,
        top: 50,
        orderBy: 'name asc',
        filter: "name eq 'test'",
        select: 'id,name',
        expand: 'fields'
      };
      const token = encodeSkipToken(payload);

      expect(token).toBeTruthy();
    });

    it('should encode minimal payload', () => {
      const payload = { skip: 0 };
      const token = encodeSkipToken(payload);

      expect(token).toBeTruthy();
    });
  });

  describe('decodeSkipToken', () => {
    it('should decode a valid skiptoken', () => {
      const originalPayload = { skip: 10, top: 20 };
      const token = encodeSkipToken(originalPayload);
      const decoded = decodeSkipToken(token);

      expect(decoded).toEqual(originalPayload);
    });

    it('should decode payload with all fields', () => {
      const originalPayload = {
        skip: 100,
        top: 50,
        orderBy: 'name asc',
        filter: "name eq 'test'",
        select: 'id,name',
        expand: 'fields'
      };
      const token = encodeSkipToken(originalPayload);
      const decoded = decodeSkipToken(token);

      expect(decoded).toEqual(originalPayload);
    });

    it('should return null for invalid token', () => {
      const decoded = decodeSkipToken('invalid-token');
      expect(decoded).toBeNull();
    });

    it('should return null for empty string', () => {
      const decoded = decodeSkipToken('');
      expect(decoded).toBeNull();
    });

    it('should return null for malformed base64', () => {
      const decoded = decodeSkipToken('!!!invalid!!!');
      expect(decoded).toBeNull();
    });
  });

  describe('generateNextLink', () => {
    it('should generate nextLink with skiptoken', () => {
      const nextLink = generateNextLink(
        'https://example.com',
        '/v1.0/drives/123/root/children',
        0,
        10,
        {}
      );

      expect(nextLink).toContain('https://example.com/v1.0/drives/123/root/children');
      expect(nextLink).toContain('$skiptoken=');
    });

    it('should increment skip value in nextLink', () => {
      const nextLink = generateNextLink(
        'https://example.com',
        '/v1.0/sites',
        10,
        10,
        {}
      );

      const tokenMatch = nextLink.match(/\$skiptoken=([^&]+)/);
      expect(tokenMatch).toBeTruthy();

      const token = tokenMatch![1];
      const decoded = decodeSkipToken(token);

      expect(decoded).toBeTruthy();
      expect(decoded!.skip).toBe(20); // 10 + 10
      expect(decoded!.top).toBe(10);
    });

    it('should preserve filter in skiptoken', () => {
      const nextLink = generateNextLink(
        'https://example.com',
        '/v1.0/sites',
        0,
        10,
        { filter: "name eq 'test'" }
      );

      const tokenMatch = nextLink.match(/\$skiptoken=([^&]+)/);
      const token = tokenMatch![1];
      const decoded = decodeSkipToken(token);

      expect(decoded!.filter).toBe("name eq 'test'");
    });

    it('should preserve orderBy in skiptoken', () => {
      const nextLink = generateNextLink(
        'https://example.com',
        '/v1.0/sites',
        0,
        10,
        { orderBy: 'name desc' }
      );

      const tokenMatch = nextLink.match(/\$skiptoken=([^&]+)/);
      const token = tokenMatch![1];
      const decoded = decodeSkipToken(token);

      expect(decoded!.orderBy).toBe('name desc');
    });

    it('should preserve select and expand in skiptoken', () => {
      const nextLink = generateNextLink(
        'https://example.com',
        '/v1.0/sites',
        0,
        10,
        { select: 'id,name', expand: 'fields' }
      );

      const tokenMatch = nextLink.match(/\$skiptoken=([^&]+)/);
      const token = tokenMatch![1];
      const decoded = decodeSkipToken(token);

      expect(decoded!.select).toBe('id,name');
      expect(decoded!.expand).toBe('fields');
    });

    it('should omit undefined query params from skiptoken', () => {
      const nextLink = generateNextLink(
        'https://example.com',
        '/v1.0/sites',
        0,
        10,
        { filter: undefined, orderBy: undefined }
      );

      const tokenMatch = nextLink.match(/\$skiptoken=([^&]+)/);
      const token = tokenMatch![1];
      const decoded = decodeSkipToken(token);

      expect(decoded!.filter).toBeUndefined();
      expect(decoded!.orderBy).toBeUndefined();
    });

    it('should handle large skip values', () => {
      const nextLink = generateNextLink(
        'https://example.com',
        '/v1.0/sites',
        1000,
        100,
        {}
      );

      const tokenMatch = nextLink.match(/\$skiptoken=([^&]+)/);
      const token = tokenMatch![1];
      const decoded = decodeSkipToken(token);

      expect(decoded!.skip).toBe(1100);
    });
  });

  describe('round-trip encoding/decoding', () => {
    it('should preserve data through encode/decode cycle', () => {
      const payloads = [
        { skip: 0 },
        { skip: 10, top: 20 },
        { skip: 100, top: 50, filter: "name eq 'test'" },
        { skip: 50, top: 25, orderBy: 'name asc', select: 'id,name' },
        { skip: 200, top: 100, filter: "id gt 5", orderBy: 'createdAt desc', select: 'id,name,createdAt', expand: 'fields' }
      ];

      for (const payload of payloads) {
        const encoded = encodeSkipToken(payload);
        const decoded = decodeSkipToken(encoded);
        expect(decoded).toEqual(payload);
      }
    });
  });
});
