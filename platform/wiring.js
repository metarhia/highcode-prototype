'use strict';

const { inspect } = require('./model.js');

const compile = (model, catalog) => {
  const directions = {
    domain: [],
    infrastructure: ['domain'],
    application: ['domain', 'infrastructure'],
    presentation: ['application'],
  };
  const description = inspect(model);
  const nodes = new Map(description.nodes.map((node) => [node.id, node]));
  for (const node of nodes.values()) {
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
  }
  if (!nodes.has(model.entry)) throw new Error('Unknown entry');
  for (const node of nodes.values()) {
    const defaults = Object.hasOwn(directions, node.layer)
      ? directions[node.layer] : [];
    const extra = Object.hasOwn(description.allow, node.layer)
      ? description.allow[node.layer] : [];
    for (const reference of Object.values(node.bindings)) {
      const target = nodes.get(reference);
      if (!target) throw new Error(`Unknown reference: ${reference}`);
      if (target.layer !== node.layer &&
          !defaults.includes(target.layer) && !extra.includes(target.layer)) {
        throw new Error(`Forbidden binding: ${node.id} -> ${reference}`);
      }
    }
  }
  const order = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`Dependency cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of Object.values(nodes.get(id).bindings)) visit(target);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  visit(model.entry);
  const reachable = new Set(visited);
  for (const id of nodes.keys()) visit(id);
  const components = order.filter((id) => reachable.has(id))
    .map((id) => nodes.get(id));
  return Object.freeze({
    entry: model.entry,
    components: Object.freeze(components),
    unreachable: Object.freeze(order.filter((id) => !reachable.has(id))),
  });
};

const assemble = (graph, load) => {
  const instances = new Map();
  for (const node of graph.components) {
    const capabilities = Object.freeze(Object.fromEntries(
      Object.entries(node.bindings).map(([role, target]) =>
        [role, instances.get(target)]),
    ));
    const create = load(node.use, node.layer);
    if (typeof create !== 'function') throw new Error('Expected factory');
    const instance = create(capabilities);
    if (instance === undefined || instance?.then) {
      throw new Error('Expected synchronous factory result');
    }
    instances.set(node.id, instance);
  }
  const run = instances.get(graph.entry);
  if (typeof run !== 'function') throw new Error('Expected callable entry');
  return Object.freeze({ run });
};

module.exports = { compile, assemble };
