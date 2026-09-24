'use strict';

const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { parse } = require('./syntax.js');
const { compile, assemble } = require('./wiring.js');

const start = async (syntax = 'js') => {
  if (!['js', 'lisp'].includes(syntax)) {
    throw new Error('Expected syntax: js or lisp');
  }
  const root = path.resolve(__dirname, '..');
  const source = await readFile(
    path.join(root, `architecture.${syntax}`), 'utf8',
  );
  const model = parse(source, syntax);
  const catalog = JSON.parse(await readFile(
    path.join(root, 'platform/catalog.generated.json'), 'utf8',
  ));
  const graph = compile(model, catalog);
  const load = (name, layer) =>
    require(path.join(root, 'src', layer, name));
  return assemble(graph, load);
};

module.exports = { start };
