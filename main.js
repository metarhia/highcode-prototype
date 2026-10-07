'use strict';

const { start } = require('./highscript/start.js');

const reportError = (error) => {
  const message = error instanceof Error ? error.message : `${error}`;
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

const main = async () => {
  const input = process.argv.slice(2);
  const isHttp = input.includes('--http');
  const positional = input.filter((arg) => arg !== '--http');
  const syntax = positional[0] ?? 'js';
  const args = positional.slice(1);
  const application = await start(syntax);
  if (isHttp) {
    // The loader replaces this module, so retain the instance open() started.
    const server = require('./infrastructure/server.js');
    server.retain();
    return;
  }
  const output = await application.run(args);
  process.stdout.write(`${output}\n`);
};

process.on('uncaughtException', (error) => {
  console.error('Uncaught:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

main().catch(reportError);
