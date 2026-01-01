import { describe, it, expect, vi } from 'vitest';
import { createLogger, LogLevel } from '../../src/utils/logger.js';

describe('createLogger', () => {
  it('logs info messages at info level', () => {
    const output: string[] = [];
    const logger = createLogger('info', (msg) => output.push(msg));
    logger.info('test message');
    expect(output.length).toBe(1);
    expect(output[0]).toContain('INFO');
    expect(output[0]).toContain('test message');
  });

  it('does not log debug at info level', () => {
    const output: string[] = [];
    const logger = createLogger('info', (msg) => output.push(msg));
    logger.debug('debug message');
    expect(output.length).toBe(0);
  });

  it('logs debug at debug level', () => {
    const output: string[] = [];
    const logger = createLogger('debug', (msg) => output.push(msg));
    logger.debug('debug message');
    expect(output.length).toBe(1);
  });
});
