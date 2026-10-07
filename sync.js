'use strict';

const path = require('node:path');
const { readFile, writeFile } = require('node:fs/promises');
const { isDeepStrictEqual } = require('node:util');
const { parse } = require('./highscript/syntax.js');
const { inspect } = require('./highscript/model.js');
const { format } = require('./highscript/format.js');

const main = async () => {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== '--check')) {
    throw new Error('Usage: node sync.js [--check]');
  }
  const check = args[0] === '--check';
  const source = await readFile(path.join(__dirname, 'project.js'), 'utf8');
  const model = parse(source, 'js');
  inspect(model);
  for (const syntax of ['lisp', 'md']) {
    const file = path.join(__dirname, `project.${syntax}`);
    const generated = format(model, syntax);
    if (!isDeepStrictEqual(parse(generated, syntax), model)) {
      throw new Error(`Cannot represent JS architecture in ${syntax}`);
    }
    if (check) {
      const current = await readFile(file, 'utf8');
      if (!isDeepStrictEqual(parse(current, syntax), model)) {
        throw new Error(
          `project.${syntax} differs from project.js; run npm run sync`,
        );
      }
    } else {
      await writeFile(file, generated);
    }
  }
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
