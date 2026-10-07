'use strict';

const { start } = require('./highscript/start.js');

const reportError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

const main = async () => {
  const input = process.argv.slice(2);
  const isHttp = input.includes('--http');
  const [syntax = 'js', ...args] = input.filter((arg) => arg !== '--http');
  const application = await start(syntax);
  if (isHttp) {
    await application.listen();
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      application.close().catch(reportError);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  try {
    const output = await application.run(args);
    process.stdout.write(`${output}\n`);
  } finally {
    await application.close();
  }
};

main().catch(reportError);
