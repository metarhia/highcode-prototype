'use strict';

const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { watch } = require('node:fs');
const { scaffold, starter } = require('./platform/scaffold.js');

const main = async () => {
  const input = process.argv.slice(2);
  const watching = input.includes('--watch');
  const machine = input.includes('--json');
  const args = input.filter((arg) => !['--watch', '--json'].includes(arg));
  const initialize = args[0] === '--init';
  if (!args[0] || (initialize && (!args[1] || watching)) ||
      args.length > (initialize ? 3 : 2)) {
    throw new Error(
      'Usage: scaffold.js FILE [DIR] [--watch] | --init DIR [js|lisp]',
    );
  }
  const syntax = initialize ? args[2] ?? 'js'
    : path.extname(args[0]).slice(1);
  if (!['js', 'lisp'].includes(syntax)) throw new Error('Expected js or lisp');
  const sourceFile = initialize ? null : path.resolve(args[0]);
  const root = initialize ? path.resolve(args[1])
    : path.resolve(args[1] ?? path.dirname(sourceFile));
  const run = async () => {
    const source = initialize ? starter(syntax)
      : await readFile(sourceFile, 'utf8');
    const report = await scaffold({ source, syntax, root });
    if (machine) {
      process.stdout.write(`${JSON.stringify(report)}\n`);
    } else {
      for (const file of report.created) console.log(`CREATE ${file}`);
      for (const file of report.updated) console.log(`UPDATE ${file}`);
      for (const warning of report.warnings) {
        console.warn(`WARN ${JSON.stringify(warning)}`);
      }
      console.log(`DONE ${report.created.length} created, ` +
        `${report.warnings.length} warnings`);
    }
  };
  if (!watching) return run();
  let timer;
  let queue = Promise.resolve();
  const enqueue = () => {
    queue = queue.then(run).catch((error) => {
      for (const warning of error.warnings ?? []) {
        console.warn(`WARN ${JSON.stringify(warning)}`);
      }
      console.error(error.message);
    });
  };
  const watcher = watch(path.dirname(sourceFile), (event, name) => {
    if (name && name.toString() !== path.basename(sourceFile)) return;
    clearTimeout(timer);
    timer = setTimeout(enqueue, 150);
  });
  const stop = async () => {
    clearTimeout(timer);
    watcher.close();
    await queue;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  watcher.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  enqueue();
};

main().catch((error) => {
  for (const warning of error.warnings ?? []) {
    console.warn(`WARN ${JSON.stringify(warning)}`);
  }
  console.error(error.message);
  process.exitCode = 1;
});
