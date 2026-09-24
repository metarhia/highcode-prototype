'use strict';

const { start } = require('./platform/start.js');

const main = async () => {
  const [syntax = 'js', ...args] = process.argv.slice(2);
  const application = await start(syntax);
  const output = await application.run(args);
  process.stdout.write(`${output}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
