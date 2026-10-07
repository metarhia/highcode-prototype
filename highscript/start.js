'use strict';

const path = require('node:path');
const { readFile } = require('node:fs/promises');

const { parse } = require('./syntax.js');
const { inspect } = require('./model.js');
const { compile, assemble, loadFactory, catalogOf } = require('./wiring.js');

const start = async (syntax = 'js') => {
  const root = path.resolve(__dirname, '..');
  if (!['js', 'lisp', 'md'].includes(syntax)) throw new Error('Unknown syntax');
  const source = await readFile(path.join(root, `project.${syntax}`), 'utf8');
  const model = parse(source, syntax);
  const load = (name, layer, capability) =>
    loadFactory(path.join(root, layer, name), capability);
  const catalog = catalogOf(inspect(model), load);
  return assemble(compile(model, catalog), load);
};

module.exports = { start };
