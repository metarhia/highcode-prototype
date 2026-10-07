'use strict';

const { isHashObject } = require('metautil');

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;
const REFERENCE = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*){1,3}$/;
const LAYERS = ['domain', 'infrastructure', 'application', 'presentation'];

const isLiteral = (value) => {
  const keys = isHashObject(value) ? Object.keys(value) : [];
  const single = keys.length === 1;
  return single && typeof value.literal === 'string';
};

const validValue = (value) => {
  if (typeof value === 'string' && REFERENCE.test(value)) return true;
  if (isLiteral(value)) return true;
  if (!isHashObject(value)) return false;
  const named = (entry) => IDENTIFIER.test(entry[0]);
  const valid = (entry) => named(entry) && validValue(entry[1]);
  return Object.entries(value).every(valid);
};

const componentId = (value) => {
  const parts = value.split('.');
  const layer = parts[0];
  const name = parts[1];
  return `${layer}.${name}`;
};

const validBindings = (bindings) => {
  if (!isHashObject(bindings)) return false;
  const named = (binding) => IDENTIFIER.test(binding[0]);
  const valid = (binding) => named(binding) && validValue(binding[1]);
  return Object.entries(bindings).every(valid);
};

const knownReference = (value) => {
  const textual = typeof value === 'string' && REFERENCE.test(value);
  if (!textual) return false;
  const layer = value.split('.')[0];
  return LAYERS.includes(layer);
};

const methodMap = (value) => {
  if (!isHashObject(value) || isLiteral(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  const named = (entry) => IDENTIFIER.test(entry[0]);
  const known = (entry) => named(entry) && knownReference(entry[1]);
  return entries.every(known);
};

const handlers = (value) => knownReference(value) || methodMap(value);

const subscription = (value) => {
  if (!isHashObject(value) || !isHashObject(value.subscribe)) return false;
  const item = value.subscribe;
  const source = knownReference(item.source);
  const event = isLiteral(item.event);
  return source && event && handlers(item.handler);
};

const pipeStep = (value) => {
  if (value === 'process.argv') return true;
  if (knownReference(value)) return true;
  if (subscription(value)) return true;
  return methodMap(value);
};

const pipeNode = (layer, name, steps) => {
  const id = `${layer}.${name}`;
  const pipe = Object.freeze(steps);
  const bindings = Object.freeze({});
  return Object.freeze({ id, layer, name, pipe, bindings });
};

const isExportTable = (entries) => {
  if (entries.length === 0) return false;
  const isExport = (entry) => {
    const record = isHashObject(entry[1]) && !isLiteral(entry[1]);
    return IDENTIFIER.test(entry[0]) && record && validBindings(entry[1]);
  };
  return entries.every(isExport);
};

const exportNode = (base, entries) => {
  const single = entries.length === 1 ? entries[0] : null;
  const hasBindings = (entry) => Object.keys(entry[1]).length > 0;
  const populated = entries.filter(hasBindings);
  const onlyPopulated = populated.length === 1 ? populated[0] : null;
  const selected = single || onlyPopulated;
  const exportName = selected ? selected[0] : undefined;
  const freezeEntry = (entry) => [entry[0], Object.freeze({ ...entry[1] })];
  const copied = entries.map(freezeEntry);
  const exports = Object.freeze(Object.fromEntries(copied));
  const selectedBindings = selected ? { ...selected[1] } : {};
  const bindings = Object.freeze(selectedBindings);
  return Object.freeze({ ...base, exportName, exports, bindings });
};

const componentNode = (layer, name, value) => {
  const id = `${layer}.${name}`;
  const use = `${name}.js`;
  const implementation = `${layer}/${name}.js`;
  const base = { id, layer, name, use, implementation };
  if (subscription(value)) return pipeNode(layer, name, [value]);
  if (Array.isArray(value)) {
    const isValid = value.length >= 1 && value.every(pipeStep);
    if (!isValid) throw new Error('Invalid bindings');
    return pipeNode(layer, name, [...value]);
  }
  if (!isHashObject(value)) throw new Error('Invalid bindings');
  const entries = Object.entries(value);
  if (isExportTable(entries)) return exportNode(base, entries);
  if (!validBindings(value)) throw new Error('Invalid bindings');
  const bindings = Object.freeze({ ...value });
  return Object.freeze({ ...base, bindings });
};

const inspect = (model) => {
  if (!isHashObject(model)) throw new Error('Expected architecture');
  const layers = Object.keys(model);
  const nodes = [];
  for (const layer of layers) {
    if (!LAYERS.includes(layer)) throw new Error('Unknown layer');
    const components = model[layer];
    if (!IDENTIFIER.test(layer) || !isHashObject(components)) {
      throw new Error('Invalid layer');
    }
    for (const entry of Object.entries(components)) {
      const name = entry[0];
      if (!IDENTIFIER.test(name)) throw new Error('Invalid component name');
      nodes.push(componentNode(layer, name, entry[1]));
    }
  }
  const presented = (node) => node.layer === 'presentation';
  const presentation = nodes.filter(presented);
  const entries = presentation.map((node) => node.id);
  if (entries.length === 0) throw new Error('Expected entry');
  return { layers, nodes, entries };
};

const skipSpace = (source, index) => {
  let cursor = index;
  while (/\s/.test(source[cursor] ?? '')) cursor += 1;
  return cursor;
};

const startsAt = (source, index, word) => {
  const next = source[index + word.length];
  const boundary = next === undefined || !/[A-Za-z0-9]/.test(next);
  return source.startsWith(word, index) && boundary;
};

const signatureOpen = (source) => {
  let index = skipSpace(source, 0);
  if (startsAt(source, index, 'class')) {
    const constructorAt = source.search(/\bconstructor\s*\(/);
    if (constructorAt === -1) return null;
    const after = constructorAt + 'constructor'.length;
    index = skipSpace(source, after);
  }
  if (startsAt(source, index, 'async')) {
    index = skipSpace(source, index + 'async'.length);
  }
  if (startsAt(source, index, 'function')) {
    index = skipSpace(source, index + 'function'.length);
    if (/[A-Za-z]/.test(source[index] ?? '')) {
      index += 1;
      while (/[A-Za-z0-9]/.test(source[index] ?? '')) index += 1;
      index = skipSpace(source, index);
    }
  }
  return index;
};

const parameterText = (source, open) => {
  if (source[open] !== '(') throw new Error('Invalid capability signature');
  let depth = 1;
  let index = open + 1;
  while (index < source.length && depth > 0) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')') depth -= 1;
    if (depth > 0) index += 1;
  }
  if (depth !== 0) throw new Error('Invalid capability signature');
  return source.slice(open + 1, index).trim();
};

const portNames = (parameters) => {
  if (parameters === '') return [];
  const braced = parameters.startsWith('{') && parameters.endsWith('}');
  if (!braced) throw new Error('Invalid capability signature');
  const names = parameters
    .slice(1, -1)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const named = names.every((name) => IDENTIFIER.test(name));
  const unique = new Set(names).size === names.length;
  if (!named || !unique) throw new Error('Invalid capability signature');
  return names;
};

const capabilityPorts = (factory) => {
  if (typeof factory !== 'function') throw new Error('Expected factory');
  const source = Function.prototype.toString.call(factory);
  const open = signatureOpen(source);
  if (open === null) return [];
  return portNames(parameterText(source, open));
};

const cited = (value) => {
  if (typeof value === 'string') {
    if (!knownReference(value)) return [];
    return [value];
  }
  if (Array.isArray(value)) return value.flatMap(cited);
  if (!isHashObject(value) || isLiteral(value)) return [];
  return Object.values(value).flatMap(cited);
};

module.exports = {
  LAYERS,
  inspect,
  capabilityPorts,
  componentId,
  cited,
  isLiteral,
};
