'use strict';

const path = require('node:path');

const { isHashObject } = require('metautil');

const { inspect, componentId, cited, isLiteral } = require('./model.js');

const loadedModules = new WeakMap();

const FACTORY_NAMES = ['init', 'create', 'open'];

const selectFactory = (exported, file, exportName) => {
  const isNamed = typeof exportName === 'string';
  const named = isNamed && typeof exported[exportName] === 'function';
  if (named) return exported[exportName];
  const isFactory = (name) => typeof exported[name] === 'function';
  const factoryName = FACTORY_NAMES.find(isFactory);
  if (factoryName) return exported[factoryName];
  const isFunction = (value) => typeof value === 'function';
  const functions = Object.values(exported).filter(isFunction);
  if (functions.length === 1) return functions[0];
  const base = path.basename(file, '.js');
  if (typeof exported[base] === 'function') return exported[base];
  throw new Error('Expected factory');
};

const loadFactory = (file, exportName) => {
  const resolved = require.resolve(file);
  // A cache slot left in place keeps the module loaded.
  delete require.cache[resolved];
  const exported = require(resolved);
  if (!isHashObject(exported)) throw new Error('Expected exports');
  Object.seal(exported);
  const factory = selectFactory(exported, file, exportName);
  loadedModules.set(factory, exported);
  return factory;
};

const links = (node) => {
  const found = [];
  const exported = node.exports || { bindings: node.bindings };
  const values = node.pipe ? [node.pipe] : Object.values(exported);
  for (const value of values) {
    for (const link of cited(value)) found.push(link);
  }
  return found;
};

const checkContract = (node, catalog) => {
  if (!node.implementation) return;
  if (!Object.hasOwn(catalog, node.implementation)) {
    throw new Error(`Unknown implementation: ${node.implementation}`);
  }
  const contract = catalog[node.implementation];
  if (contract.layer !== node.layer) throw new Error('Wrong component layer');
  const roles = Object.keys(node.bindings).sort();
  const ports = [...contract.ports].sort();
  if (JSON.stringify(roles) !== JSON.stringify(ports)) {
    throw new Error(`Missing bindings or extra roles: ${node.id}`);
  }
};

const checkLink = (nodes, link) => {
  const target = nodes.get(componentId(link));
  if (!target) throw new Error(`Unknown reference: ${link}`);
  const exportName = link.split('.')[2];
  if (typeof exportName !== 'string') return;
  const table = target.exports;
  if (table) {
    if (!Object.hasOwn(table, exportName)) {
      throw new Error(`Unknown reference: ${link}`);
    }
    return;
  }
  const isNamed = typeof target.exportName === 'string';
  if (isNamed && exportName !== target.exportName) {
    throw new Error(`Unknown reference: ${link}`);
  }
};

const orderGraph = (description, nodes) => {
  const order = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`Dependency cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const link of links(nodes.get(id))) visit(componentId(link));
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of description.entries) visit(id);
  const reachable = new Set(visited);
  for (const id of nodes.keys()) visit(id);
  const listed = order.filter((id) => reachable.has(id));
  const entries = Object.freeze(description.entries);
  const components = Object.freeze(listed.map((id) => nodes.get(id)));
  const unreachable = Object.freeze(order.filter((id) => !reachable.has(id)));
  return Object.freeze({ entries, components, unreachable });
};

const compile = (model, catalog) => {
  const description = inspect(model);
  const nodes = new Map(description.nodes.map((node) => [node.id, node]));
  for (const node of nodes.values()) checkContract(node, catalog);
  for (const node of nodes.values()) {
    for (const link of links(node)) checkLink(nodes, link);
  }
  return orderGraph(description, nodes);
};

const instanceField = (instances, target) => {
  const instance = instances.get(componentId(target));
  const field = target.split('.')[3];
  if (field === undefined) return instance;
  return instance[field];
};

const resolveValue = (instances, value) => {
  if (typeof value === 'string') return instanceField(instances, value);
  if (isLiteral(value)) return value.literal;
  if (!isHashObject(value)) return value;
  const fields = {};
  for (const entry of Object.entries(value)) {
    fields[entry[0]] = resolveValue(instances, entry[1]);
  }
  return Object.freeze(fields);
};

const channelOf = (transport) => {
  if (typeof transport.on === 'function') return transport;
  if (!isHashObject(transport)) return null;
  return loadedModules.get(transport) ?? null;
};

const connectSubscription = (instances, source) => {
  const item = source.subscribe;
  const transport = resolveValue(instances, item.source);
  const owner = channelOf(transport);
  const isCallable = typeof transport === 'function';
  if (!owner || typeof owner.on !== 'function') {
    if (isCallable) return transport;
    return null;
  }
  const subscribe = owner.on(item.event.literal);
  if (typeof subscribe !== 'function') throw new Error('Expected subscription');
  subscribe(resolveValue(instances, item.handler));
  if (typeof transport.run === 'function') return transport.run;
  return null;
};

const connectArgv = (instances, load, node) => {
  const target = node.pipe[node.pipe.length - 1];
  const checkout = resolveValue(instances, target);
  const file = `${node.name}.js`;
  let factory = null;
  try {
    factory = load(file, node.layer);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  const passthrough = async (input) => checkout(input);
  if (typeof factory !== 'function') return passthrough;
  const adapted = factory({ checkout });
  if (typeof adapted === 'function') return adapted;
  return passthrough;
};

const connectEntry = (instances, load, node) => {
  const source = node.pipe[0];
  if (isHashObject(source) && source.subscribe) {
    return connectSubscription(instances, source);
  }
  if (source === 'process.argv') return connectArgv(instances, load, node);
  throw new Error('Expected subscription');
};

const instantiate = async (instances, load, node) => {
  const pair = (binding) => [binding[0], resolveValue(instances, binding[1])];
  const pairs = Object.entries(node.bindings).map(pair);
  const capabilities = Object.freeze(Object.fromEntries(pairs));
  const create = load(node.use, node.layer, node.exportName);
  if (typeof create !== 'function') throw new Error('Expected factory');
  const source = Function.prototype.toString.call(create);
  const isClass = source.startsWith('class ');
  const Class = create;
  const created = isClass ? new Class(capabilities) : create(capabilities);
  const instance = await created;
  if (instance === undefined) throw new Error('Expected factory result');
  const exported = loadedModules.get(create);
  if (exported && isHashObject(instance)) loadedModules.set(instance, exported);
  instances.set(node.id, instance);
};

const assemble = async (graph, load) => {
  const instances = new Map();
  let run = null;
  for (const node of graph.components) {
    if (node.pipe) {
      const entry = connectEntry(instances, load, node);
      if (typeof entry === 'function') run = entry;
      continue;
    }
    await instantiate(instances, load, node);
  }
  if (typeof run !== 'function') throw new Error('Expected callable entry');
  return Object.freeze({ run });
};

module.exports = { compile, assemble, loadFactory };
