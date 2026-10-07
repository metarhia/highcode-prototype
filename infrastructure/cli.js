'use strict';

const { isHashObject } = require('metautil');

const ITEM_PATTERN = /^([a-z][a-z0-9-]*):([1-9][0-9]*)$/;

const listeners = new Map();

const deliver = async (handlers, command) => {
  const method = command?.method;
  const parameters = command?.parameters;
  const handler = handlers[method];
  if (typeof handler !== 'function') return { missing: true };
  try {
    const outcome = await handler(parameters);
    return { outcome };
  } catch (error) {
    return { error: error.message };
  }
};

const on = (event) => {
  const isNamed = typeof event === 'string' && event !== '';
  if (!isNamed) throw new Error('Unknown event');
  return (handlers) => {
    if (!isHashObject(handlers)) throw new Error('Expected handlers');
    const listener = (command) => deliver(handlers, command);
    const group = listeners.get(event);
    if (group) {
      group.push(listener);
      return;
    }
    listeners.set(event, [listener]);
  };
};

const emit = async (event, command) => {
  const group = listeners.get(event);
  if (!group) return null;
  let result = { missing: true };
  for (const listener of group) {
    result = await listener(command);
    if (!result.missing) return result;
  }
  return result;
};

const parseLine = (token) => {
  const match = ITEM_PATTERN.exec(token);
  if (!match) throw new Error(`Invalid item: ${token}`);
  const sku = match[1];
  const quantity = Number(match[2]);
  return { sku, quantity };
};

const open = () => {
  const run = async (args) => {
    const id = args[0];
    const tokens = args.slice(1);
    const hasItems = Boolean(id) && tokens.length > 0;
    if (!hasItems) {
      throw new Error('Usage: ORDER-ID sku:quantity [sku:quantity ...]');
    }
    const lines = tokens.map(parseLine);
    const parameters = { id, lines };
    const result = await emit('call', { method: 'order', parameters });
    if (!result || result.missing) throw new Error('Unknown command');
    if (result.error) throw new Error(result.error);
    return JSON.stringify(result.outcome, null, 2);
  };
  return { on, run };
};

module.exports = { open, on };
