'use strict';

const path = require('node:path');
const { isHashObject } = require('metautil');
const {
  inspect,
  capabilities,
  capabilityPorts,
  componentId,
  cited,
  isLiteral,
} = require('./model.js');

const selectFactory = (exported, file, name) => {
  if (name !== undefined) {
    if (Object.hasOwn(exported, name) && typeof exported[name] === 'function') {
      return exported[name];
    }
    throw new Error(`Unknown capability: ${file}#${name}`);
  }
  const names = ['init', 'create', 'open', path.basename(file, '.js')];
  for (const key of names) {
    if (typeof exported[key] === 'function') return exported[key];
  }
  const functions = Object.values(exported).filter(
    (value) => typeof value === 'function',
  );
  if (functions.length === 1) return functions[0];
  throw new Error(`Expected one factory: ${file}`);
};

const loadFactory = (file, name, fresh = false) => {
  const resolved = require.resolve(file);
  if (fresh) delete require.cache[resolved];
  const exported = require(resolved);
  if (!isHashObject(exported)) throw new Error(`Expected exports: ${file}`);
  return selectFactory(exported, file, name);
};

const contractOf = (node, ports) =>
  node.exports
    ? { layer: node.layer, exports: Object.fromEntries(ports) }
    : { layer: node.layer, ports: ports[0][1] };

const catalogOf = (description, load) =>
  Object.fromEntries(
    description.nodes
      .filter((node) => node.implementation)
      .map((node) => {
        const ports = capabilities(node).map(([name]) => [
          name,
          capabilityPorts(load(node.use, node.layer, name)),
        ]);
        return [node.implementation, contractOf(node, ports)];
      }),
  );

const links = (node) => cited(node.pipe ?? node.exports ?? node.bindings);
const namesEqual = (left, right) =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

const checkContract = (node, catalog) => {
  if (!node.implementation) return;
  const contract = catalog[node.implementation];
  if (!contract) {
    throw new Error(`Unknown implementation: ${node.implementation}`);
  }
  if (contract.layer !== node.layer) throw new Error('Wrong component layer');
  for (const [name, bindings] of capabilities(node)) {
    const ports =
      name === undefined ? contract.ports : contract.exports?.[name];
    if (!ports || !namesEqual(Object.keys(bindings), ports)) {
      throw new Error(
        `Missing bindings or extra roles: ${node.id}${name ? `.${name}` : ''}`,
      );
    }
  }
};

const checkLink = (nodes, link) => {
  const target = nodes.get(componentId(link));
  if (!target) throw new Error(`Unknown reference: ${link}`);
  const [, , name, ...members] = link.split('.');
  if (
    [name, ...members].some((part) =>
      ['constructor', 'prototype', '__proto__'].includes(part),
    )
  ) {
    throw new Error(`Invalid reference: ${link}`);
  }
  if (name && target.exports && !Object.hasOwn(target.exports, name)) {
    throw new Error(`Unknown reference: ${link}`);
  }
};

const orderGraph = ({ entries }, nodes) => {
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
  for (const id of entries) visit(id);
  const reachable = new Set(visited);
  for (const id of nodes.keys()) visit(id);
  return {
    entries,
    components: order
      .filter((id) => reachable.has(id))
      .map((id) => nodes.get(id)),
    unreachable: order.filter((id) => !reachable.has(id)),
  };
};

const compile = (model, catalog) => {
  const description = inspect(model);
  const nodes = new Map(description.nodes.map((node) => [node.id, node]));
  for (const node of nodes.values()) {
    checkContract(node, catalog);
    for (const link of links(node)) checkLink(nodes, link);
  }
  return orderGraph(description, nodes);
};

const fieldOf = (value, keys, reference) => {
  let owner;
  let key;
  for (key of keys) {
    owner = value;
    if (owner === null || owner === undefined || !(key in Object(owner))) {
      throw new Error(`Unknown reference: ${reference}`);
    }
    value = owner[key];
  }
  return keys.length && typeof value === 'function' ? value.bind(owner) : value;
};

const resolveValue = (instances, value) => {
  if (typeof value === 'string') {
    const record = instances.get(componentId(value));
    if (!record) throw new Error(`Unknown reference: ${value}`);
    const keys = value.split('.').slice(2);
    const root = keys.length && record.exports ? record.exports : record.value;
    return fieldOf(root, keys, value);
  }
  if (isLiteral(value)) return value.literal;
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(instances, item));
  }
  if (!isHashObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([name, binding]) => [
      name,
      resolveValue(instances, binding),
    ]),
  );
};

const callable = (value) => {
  if (typeof value === 'function') return value;
  if (typeof value?.run === 'function') return value.run.bind(value);
  throw new Error('Expected callable pipeline step');
};

const connect = (instances, node, releases) => {
  const [source] = node.pipe;
  if (source?.subscribe) {
    const { source: target, event, handler } = source.subscribe;
    const transport = resolveValue(instances, target);
    if (typeof transport?.on !== 'function') {
      throw new Error('Expected channel');
    }
    const release = transport.on(
      event.literal,
      resolveValue(instances, handler),
    );
    if (typeof release !== 'function') throw new Error('Expected unsubscribe');
    releases.push(release);
    return transport;
  }
  const steps = node.pipe
    .filter((step) => step !== 'process.argv')
    .map((step) => {
      const value = resolveValue(instances, step);
      if (!isHashObject(step) || isLiteral(step)) return callable(value);
      return (command) => {
        if (!Object.hasOwn(value, command?.method)) {
          throw new Error('Unknown command');
        }
        return callable(value[command.method])(command.parameters);
      };
    });
  return async (input) => {
    let result = input;
    for (const step of steps) result = await step(result);
    return result;
  };
};

const instantiate = async (instances, load, node, releases) => {
  const exports = {};
  for (const [name, bindings] of capabilities(node)) {
    const ports = Object.freeze(resolveValue(instances, bindings));
    const create = load(node.use, node.layer, name);
    const isClass = Function.prototype.toString
      .call(create)
      .startsWith('class ');
    const Class = create;
    const value = await (isClass ? new Class(ports) : create(ports));
    if (value === undefined) {
      throw new Error(`Expected factory result: ${node.id}`);
    }
    if (typeof value?.close === 'function') releases.push(() => value.close());
    exports[name ?? 'default'] = value;
  }
  const values = Object.values(exports);
  const value = values.length === 1 ? values[0] : exports;
  instances.set(node.id, { value, exports: node.exports ? exports : null });
};

const assemble = async (graph, load) => {
  const instances = new Map();
  const releases = [];
  let closing = null;
  const close = () => {
    closing ??= (async () => {
      const errors = [];
      for (const release of [...releases].reverse()) {
        try {
          await release();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) {
        throw new AggregateError(errors, 'Assembly cleanup failed');
      }
    })();
    return closing;
  };
  try {
    for (const node of graph.components) {
      if (node.pipe) {
        const value = connect(instances, node, releases);
        instances.set(node.id, { value });
      } else {
        await instantiate(instances, load, node, releases);
      }
    }
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Assembly failed', {
        cause: error,
      });
    }
    throw error;
  }
  const entries = [
    ...new Set(graph.entries.map((id) => instances.get(id).value)),
  ];
  const active = () => {
    if (closing) throw new Error('Assembly is closed');
  };
  const run = async (input) => {
    active();
    const runners = entries.filter(
      (entry) =>
        typeof entry === 'function' || typeof entry?.run === 'function',
    );
    if (runners.length !== 1) throw new Error('Expected one callable entry');
    return callable(runners[0])(input);
  };
  const listen = async () => {
    active();
    const servers = entries.filter(
      (entry) => typeof entry?.listen === 'function',
    );
    if (servers.length === 0) throw new Error('Expected listening entry');
    const addresses = [];
    try {
      for (const server of servers) {
        addresses.push(await server.listen());
      }
    } catch (error) {
      try {
        await close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], 'Startup failed', {
          cause: error,
        });
      }
      throw error;
    }
    return addresses;
  };
  return Object.freeze({ run, listen, close });
};

module.exports = { compile, assemble, loadFactory, catalogOf, contractOf };
