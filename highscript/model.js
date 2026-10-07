'use strict';

const { isHashObject } = require('metautil');

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*$/;
const REFERENCE = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)+$/;
const LAYERS = ['domain', 'infrastructure', 'application', 'presentation'];

const isLiteral = (value) =>
  isHashObject(value) &&
  Object.keys(value).length === 1 &&
  typeof value.literal === 'string';

const knownReference = (value) =>
  typeof value === 'string' &&
  REFERENCE.test(value) &&
  LAYERS.includes(value.split('.')[0]);

const componentId = (reference) => reference.split('.').slice(0, 2).join('.');

const validValue = (value) => {
  if (isLiteral(value) || value === null || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return knownReference(value);
  if (Array.isArray(value)) return value.every(validValue);
  return (
    isHashObject(value) &&
    Object.entries(value).every(
      ([name, binding]) => IDENTIFIER.test(name) && validValue(binding),
    )
  );
};

const validBindings = (value) =>
  isHashObject(value) && !isLiteral(value) && validValue(value);

const methodMap = (value) =>
  isHashObject(value) &&
  Object.keys(value).length > 0 &&
  Object.entries(value).every(
    ([name, reference]) => IDENTIFIER.test(name) && knownReference(reference),
  );

const subscription = (value) => {
  if (!isHashObject(value) || Object.keys(value).length !== 1) return false;
  const item = value.subscribe;
  if (!isHashObject(item) || Object.keys(item).length !== 3) return false;
  return (
    knownReference(item.source) &&
    isLiteral(item.event) &&
    item.event.literal !== '' &&
    (knownReference(item.handler) || methodMap(item.handler))
  );
};

const pipeline = (steps) =>
  steps.length > 0 &&
  steps.every(
    (step, index) =>
      knownReference(step) ||
      methodMap(step) ||
      (index === 0 && step === 'process.argv'),
  );

const componentNode = (layer, name, value) => {
  const id = `${layer}.${name}`;
  if (subscription(value)) return { id, layer, name, pipe: [value] };
  if (Array.isArray(value)) {
    const single = value.length === 1 && subscription(value[0]);
    if (!single && !pipeline(value)) throw new Error(`Invalid pipeline: ${id}`);
    return { id, layer, name, pipe: [...value] };
  }
  if (!validBindings(value)) throw new Error(`Invalid bindings: ${id}`);
  const entries = Object.entries(value);
  const hasExports =
    entries.length > 0 &&
    entries.every(([, ports]) => isHashObject(ports) && !isLiteral(ports));
  const base = {
    id,
    layer,
    name,
    use: `${name}.js`,
    implementation: `${layer}/${name}.js`,
  };
  if (!hasExports) return { ...base, bindings: value };
  const [first] = entries;
  const single = entries.length === 1;
  return {
    ...base,
    exports: value,
    exportName: single ? first[0] : undefined,
    bindings: single ? first[1] : {},
  };
};

const inspect = (model) => {
  if (!isHashObject(model)) throw new Error('Expected architecture');
  const layers = Object.keys(model);
  const nodes = [];
  for (const [layer, components] of Object.entries(model)) {
    if (!LAYERS.includes(layer)) throw new Error(`Unknown layer: ${layer}`);
    if (!isHashObject(components)) throw new Error('Invalid layer');
    for (const [name, value] of Object.entries(components)) {
      if (!IDENTIFIER.test(name)) throw new Error('Invalid component name');
      nodes.push(componentNode(layer, name, value));
    }
  }
  const entries = nodes
    .filter((node) => node.layer === 'presentation')
    .map((node) => node.id);
  if (entries.length === 0) throw new Error('Expected entry');
  return { layers, nodes, entries };
};

const capabilities = (node) =>
  node.exports ? Object.entries(node.exports) : [[undefined, node.bindings]];

const capabilityPorts = (factory) => {
  if (typeof factory !== 'function') throw new Error('Expected factory');
  const source = Function.prototype.toString.call(factory).trim();
  const isClass = source.startsWith('class ');
  const pattern = isClass
    ? /\bconstructor\s*\(([^)]*)\)/
    : /^(?:async\s+)?(?:function(?:\s+\w+)?\s*)?\(([^)]*)\)/;
  const matched = pattern.exec(source);
  if (isClass && !matched) return [];
  if (!matched) throw new Error('Invalid capability signature');
  const parameters = matched[1].trim();
  if (parameters === '') return [];
  if (!parameters.startsWith('{') || !parameters.endsWith('}')) {
    throw new Error('Invalid capability signature');
  }
  const names = parameters
    .slice(1, -1)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (
    names.some((name) => !IDENTIFIER.test(name)) ||
    new Set(names).size !== names.length
  ) {
    throw new Error('Invalid capability signature');
  }
  return names;
};

const cited = (value) => {
  if (typeof value === 'string') return knownReference(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(cited);
  if (!isHashObject(value) || isLiteral(value)) return [];
  return Object.values(value).flatMap(cited);
};

module.exports = {
  LAYERS,
  inspect,
  capabilities,
  capabilityPorts,
  componentId,
  cited,
  isLiteral,
};
