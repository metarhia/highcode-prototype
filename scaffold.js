'use strict';

const path = require('node:path');
const { readFile } = require('node:fs/promises');

const { scaffold, starter } = require('./highscript/scaffold.js');
const { SYNTAXES } = require('./highscript/syntax.js');

const usage = 'Usage: scaffold.js FILE [DIR] | --init DIR [js|lisp|md]';

const writeWarnings = (error) => {
  const warnings = Array.isArray(error.warnings) ? error.warnings : [];
  for (const warning of warnings) {
    console.warn(`WARN ${JSON.stringify(warning)}`);
  }
};

const reportError = (error) => {
  writeWarnings(error);
  const message = error instanceof Error ? error.message : `${error}`;
  console.error(message);
  process.exitCode = 1;
};

const main = async () => {
  const input = process.argv.slice(2);
  const isMachine = input.includes('--json');
  const args = input.filter((arg) => arg !== '--json');
  const file = args[0];
  const dir = args[1];
  const kind = args[2];
  const isInitialize = file === '--init';
  const limit = isInitialize ? 3 : 2;
  if (!file || (isInitialize && !dir) || args.length > limit) {
    throw new Error(usage);
  }
  const extension = path.extname(file).slice(1);
  const syntax = isInitialize ? kind || 'js' : extension;
  if (!SYNTAXES.includes(syntax)) throw new Error('Expected js, lisp or md');
  const sourceFile = isInitialize ? null : path.resolve(file);
  const root = path.resolve(dir ?? path.dirname(sourceFile));
  const source = isInitialize
    ? starter(syntax)
    : await readFile(sourceFile, 'utf8');
  const report = await scaffold({ source, syntax, root });
  if (isMachine) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  for (const created of report.created) console.log(`CREATE ${created}`);
  for (const updated of report.updated) console.log(`UPDATE ${updated}`);
  for (const warning of report.warnings) {
    console.warn(`WARN ${JSON.stringify(warning)}`);
  }
  const createdCount = report.created.length;
  const warningCount = report.warnings.length;
  console.log(`DONE ${createdCount} created, ${warningCount} warnings`);
};

main().catch(reportError);
