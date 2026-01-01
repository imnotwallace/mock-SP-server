#!/usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { VERSION } from '../index.js';
import { loadConfig } from '../config/loader.js';
import { createMockServer } from '../server.js';

/**
 * Initialize a sample SharePoint data structure
 */
function initCommand(directory: string): void {
  const baseDir = path.resolve(directory);

  // Create directory structure
  const sites = [
    'contoso/main/Documents',
    'contoso/main/Shared Documents',
    'contoso/marketing/Assets',
    'fabrikam/root/Documents'
  ];

  console.log(`Initializing Mock SharePoint structure in ${baseDir}...`);

  for (const sitePath of sites) {
    const fullPath = path.join(baseDir, sitePath);
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`Created: ${sitePath}`);
  }

  // Create _site.json metadata files
  const siteMetadata = [
    {
      path: 'contoso',
      data: {
        id: 'contoso.sharepoint.com,00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000001',
        name: 'Contoso',
        description: 'Contoso SharePoint Site',
        webUrl: 'https://contoso.sharepoint.com'
      }
    },
    {
      path: 'contoso/main',
      data: {
        id: 'contoso.sharepoint.com,00000000-0000-0000-0000-000000000002,00000000-0000-0000-0000-000000000002',
        name: 'Main',
        description: 'Main Site',
        webUrl: 'https://contoso.sharepoint.com/sites/main'
      }
    },
    {
      path: 'contoso/marketing',
      data: {
        id: 'contoso.sharepoint.com,00000000-0000-0000-0000-000000000003,00000000-0000-0000-0000-000000000003',
        name: 'Marketing',
        description: 'Marketing Site',
        webUrl: 'https://contoso.sharepoint.com/sites/marketing'
      }
    },
    {
      path: 'fabrikam',
      data: {
        id: 'fabrikam.sharepoint.com,00000000-0000-0000-0000-000000000004,00000000-0000-0000-0000-000000000004',
        name: 'Fabrikam',
        description: 'Fabrikam SharePoint Site',
        webUrl: 'https://fabrikam.sharepoint.com'
      }
    },
    {
      path: 'fabrikam/root',
      data: {
        id: 'fabrikam.sharepoint.com,00000000-0000-0000-0000-000000000005,00000000-0000-0000-0000-000000000005',
        name: 'Root',
        description: 'Root Site',
        webUrl: 'https://fabrikam.sharepoint.com/sites/root'
      }
    }
  ];

  for (const site of siteMetadata) {
    const metaPath = path.join(baseDir, site.path, '_site.json');
    fs.writeFileSync(metaPath, JSON.stringify(site.data, null, 2));
    console.log(`Created: ${site.path}/_site.json`);
  }

  // Create _library.json metadata files
  const libraryMetadata = [
    {
      path: 'contoso/main/Documents',
      data: {
        id: '00000000-0000-0000-0000-000000000010',
        name: 'Documents',
        description: 'Main document library',
        template: 'documentLibrary'
      }
    },
    {
      path: 'contoso/main/Shared Documents',
      data: {
        id: '00000000-0000-0000-0000-000000000011',
        name: 'Shared Documents',
        description: 'Shared document library',
        template: 'documentLibrary'
      }
    },
    {
      path: 'contoso/marketing/Assets',
      data: {
        id: '00000000-0000-0000-0000-000000000012',
        name: 'Assets',
        description: 'Marketing assets',
        template: 'documentLibrary'
      }
    },
    {
      path: 'fabrikam/root/Documents',
      data: {
        id: '00000000-0000-0000-0000-000000000013',
        name: 'Documents',
        description: 'Root document library',
        template: 'documentLibrary'
      }
    }
  ];

  for (const library of libraryMetadata) {
    const metaPath = path.join(baseDir, library.path, '_library.json');
    fs.writeFileSync(metaPath, JSON.stringify(library.data, null, 2));
    console.log(`Created: ${library.path}/_library.json`);
  }

  // Create sample Welcome.txt file
  const welcomeContent = `Welcome to Mock SharePoint Server!

This is a sample SharePoint data structure with the following sites:

- Contoso
  - Main (with Documents and Shared Documents libraries)
  - Marketing (with Assets library)

- Fabrikam
  - Root (with Documents library)

You can start the server by running:
  mock-sp-server --root ${directory}

Or configure the server by editing mock-sp.config.json
`;

  const welcomePath = path.join(baseDir, 'contoso/main/Documents/Welcome.txt');
  fs.writeFileSync(welcomePath, welcomeContent);
  console.log('Created: contoso/main/Documents/Welcome.txt');

  // Create mock-sp.config.json
  const configData = {
    port: 5001,
    root: directory,
    auth: {
      mode: 'none'
    },
    database: './mock-sp.db',
    logging: 'info'
  };

  const configPath = path.join(process.cwd(), 'mock-sp.config.json');
  fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
  console.log('Created: mock-sp.config.json');

  console.log('\nInitialization complete!');
  console.log(`\nTo start the server, run:`);
  console.log(`  mock-sp-server --root ${directory}`);
}

/**
 * Main CLI program
 */
program
  .name('mock-sp-server')
  .version(VERSION)
  .description('Mock SharePoint Server for development and testing')
  .option('-p, --port <number>', 'Server port', parseInt)
  .option('-r, --root <path>', 'Data root directory')
  .option('-a, --auth <mode>', 'Authentication mode (none|static|oauth)')
  .option('-d, --database <path>', 'Database file path')
  .option('-l, --logging <level>', 'Logging level (debug|info|warn|error)')
  .option('-c, --config <path>', 'Configuration file path')
  .action(async (options) => {
    try {
      const config = loadConfig({
        port: options.port,
        root: options.root,
        auth: options.auth,
        database: options.database,
        logging: options.logging,
        configFile: options.config
      });

      const server = createMockServer(config);
      await server.start();

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\nShutting down server...');
        await server.stop();
        process.exit(0);
      });

      process.on('SIGTERM', async () => {
        console.log('\nShutting down server...');
        await server.stop();
        process.exit(0);
      });
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  });

// Init command
program
  .command('init <directory>')
  .description('Initialize a sample SharePoint data structure')
  .action(initCommand);

program.parse();
