export interface AuthConfig {
  mode: 'none' | 'static' | 'oauth';
  tokens?: string[];
}

export interface VersioningConfig {
  enabled: boolean;
  maxVersions: number;
}

export interface Config {
  port: number;
  root: string;
  auth: AuthConfig;
  database: string;
  logging: 'debug' | 'info' | 'warn' | 'error';
  versioning?: VersioningConfig;
}

export interface CliOptions {
  port?: number;
  root?: string;
  auth?: 'none' | 'static' | 'oauth';
  database?: string;
  logging?: 'debug' | 'info' | 'warn' | 'error';
  configFile?: string;
}

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 100,
  MAX_PAGE_SIZE: 200,
  SHAREPOINT_MAX_PAGE_SIZE: 5000  // For list items
};

export const DEFAULT_CONFIG: Config = {
  port: 5001,
  root: './data',
  auth: { mode: 'none' },
  database: './mock-sp.db',
  logging: 'info',
  versioning: {
    enabled: true,
    maxVersions: 500
  }
};
