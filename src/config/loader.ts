import * as fs from 'fs';
import * as path from 'path';
import { Config, CliOptions, DEFAULT_CONFIG } from './types.js';

export function loadConfig(options: CliOptions = {}): Config {
  let fileConfig: Partial<Config> = {};

  // Try to load config file
  const configPath = options.configFile || './mock-sp.config.json';
  if (fs.existsSync(configPath)) {
    const content = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(content);
  }

  // Merge: defaults < file < CLI options
  const config: Config = {
    port: options.port ?? fileConfig.port ?? DEFAULT_CONFIG.port,
    root: options.root ?? fileConfig.root ?? DEFAULT_CONFIG.root,
    auth: {
      mode: options.auth ?? fileConfig.auth?.mode ?? DEFAULT_CONFIG.auth.mode,
      tokens: fileConfig.auth?.tokens ?? DEFAULT_CONFIG.auth.tokens
    },
    database: options.database ?? fileConfig.database ?? DEFAULT_CONFIG.database,
    logging: options.logging ?? fileConfig.logging ?? DEFAULT_CONFIG.logging
  };

  return config;
}
