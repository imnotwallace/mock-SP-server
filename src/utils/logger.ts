export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export function createLogger(
  level: LogLevel,
  output: (message: string) => void = console.log
): Logger {
  const shouldLog = (msgLevel: LogLevel): boolean => {
    return LEVEL_PRIORITY[msgLevel] >= LEVEL_PRIORITY[level];
  };

  const formatMessage = (msgLevel: LogLevel, message: string): string => {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const levelStr = msgLevel.toUpperCase().padEnd(5);
    return `[${timestamp}] ${levelStr} ${message}`;
  };

  return {
    debug: (message: string) => {
      if (shouldLog('debug')) output(formatMessage('debug', message));
    },
    info: (message: string) => {
      if (shouldLog('info')) output(formatMessage('info', message));
    },
    warn: (message: string) => {
      if (shouldLog('warn')) output(formatMessage('warn', message));
    },
    error: (message: string) => {
      if (shouldLog('error')) output(formatMessage('error', message));
    }
  };
}
