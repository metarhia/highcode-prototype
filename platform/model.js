'use strict';

const identifier = /^[A-Za-z][A-Za-z0-9]*$/;
const filename = /^[A-Za-z][A-Za-z0-9]*\.js$/;
const isRecord = (value) => value !== null &&
  typeof value === 'object' && !Array.isArray(value);

const fields = (value, allowed) => {
  if (!isRecord(value) ||
      Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error('Unexpected model fields');
  }
};

const inspect = (model) => {
  fields(model, ['layers', 'entry', 'allow']);
  if (!isRecord(model.layers)) throw new Error('Expected layers');
  const layers = Object.keys(model.layers);
  const nodes = [];
  for (const [layer, components] of Object.entries(model.layers)) {
    if (!identifier.test(layer) || !isRecord(components)) {
      throw new Error('Invalid layer');
    }
    for (const [name, specification] of Object.entries(components)) {
      if (!identifier.test(name)) throw new Error('Invalid component name');
      fields(specification, ['use', 'bind']);
      const { use, bind = {} } = specification;
      if (typeof use !== 'string' || !filename.test(use)) {
        throw new Error(`Invalid implementation filename: ${use}`);
      }
      if (!isRecord(bind) || Object.entries(bind).some(([role, reference]) =>
        !identifier.test(role) || typeof reference !== 'string')) {
        throw new Error('Invalid bindings');
      }
      nodes.push(Object.freeze({
        id: `${layer}.${name}`,
        layer,
        use,
        implementation: `${layer}/${use}`,
        bindings: Object.freeze({ ...bind }),
      }));
    }
  }
  const allow = model.allow ?? {};
  if (!isRecord(allow)) throw new Error('Invalid allow rules');
  for (const [source, targets] of Object.entries(allow)) {
    if (!layers.includes(source) || !Array.isArray(targets) ||
        targets.some((target) => !layers.includes(target)) ||
        new Set(targets).size !== targets.length) {
      throw new Error('Invalid allow rule');
    }
  }
  if (typeof model.entry !== 'string') throw new Error('Expected entry');
  return { layers, nodes, allow };
};

const capabilityPorts = (factory) => {
  if (typeof factory !== 'function') throw new Error('Expected factory');
  const source = Function.prototype.toString.call(factory);
  let index = 0;
  const skip = () => {
    while (/\s/.test(source[index] ?? '')) index += 1;
  };
  const starts = (word) => source.startsWith(word, index) &&
    !/[A-Za-z0-9]/.test(source[index + word.length] ?? '');
  skip();
  if (starts('async')) { index += 5; skip(); }
  if (starts('function')) {
    index += 8;
    skip();
    if (/[A-Za-z]/.test(source[index] ?? '')) {
      index += 1;
      while (/[A-Za-z0-9]/.test(source[index] ?? '')) index += 1;
      skip();
    }
  }
  if (source[index] !== '(') throw new Error('Invalid capability signature');
  const start = index + 1;
  let depth = 1;
  index = start;
  while (index < source.length && depth > 0) {
    if (source[index] === '(') depth += 1;
    else if (source[index] === ')') depth -= 1;
    if (depth > 0) index += 1;
  }
  if (depth !== 0) throw new Error('Invalid capability signature');
  const parameters = source.slice(start, index).trim();
  if (parameters === '') return [];
  if (!parameters.startsWith('{') || !parameters.endsWith('}')) {
    throw new Error('Invalid capability signature');
  }
  const names = parameters.slice(1, -1).split(',')
    .map((name) => name.trim()).filter(Boolean);
  if (names.some((name) => !identifier.test(name)) ||
      new Set(names).size !== names.length) {
    throw new Error('Invalid capability signature');
  }
  return names;
};

module.exports = { inspect, capabilityPorts };
