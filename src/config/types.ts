export interface AuthConfig {
  mode: 'none' | 'static' | 'oauth';
  tokens?: string[];
}

export interface Config {
  port: number;
  root: string;
  auth: AuthConfig;
  database: string;
  logging: 'debug' | 'info' | 'warn' | 'error';
}

export interface CliOptions {
  port?: number;
  root?: string;
  auth?: 'none' | 'static' | 'oauth';
  database?: string;
  logging?: 'debug' | 'info' | 'warn' | 'error';
  configFile?: string;
}

export const DEFAULT_CONFIG: Config = {
  port: 5001,
  root: './data',
  auth: { mode: 'none' },
  database: './mock-sp.db',
  logging: 'info'
};
