'use strict';

const path = require('node:path');
const { readFile } = require('node:fs/promises');

const { parse } = require('./syntax.js');
const { isLiteral } = require('./model.js');
const { compile, assemble, loadFactory } = require('./wiring.js');

const SYNTAXES = ['js', 'lisp', 'md'];

const readText = async (file) => {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`File not found: ${file}`, { cause: error });
  }
};

const start = async (syntax = 'js') => {
  if (!SYNTAXES.includes(syntax)) {
    throw new Error(`Expected syntaxes: ${SYNTAXES.join(', ')}`);
  }
  const root = path.resolve(__dirname, '..');
  const sourceFile = path.join(root, `project.${syntax}`);
  const source = await readText(sourceFile);
  const model = parse(source, syntax);
  const infrastructure = model.infrastructure;
  const config = infrastructure && infrastructure.config;
  const read = config && config.read;
  if (read && isLiteral(read.fileName)) {
    const literal = path.resolve(root, read.fileName.literal);
    read.fileName = { literal };
  }
  const cacheFile = path.join(root, 'architecture.cache.json');
  const cache = JSON.parse(await readText(cacheFile));
  const graph = compile(model, cache[syntax].catalog);
  const load = (name, layer) => loadFactory(path.join(root, layer, name));
  return assemble(graph, load);
};

module.exports = { start };
