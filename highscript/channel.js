'use strict';

const { isHashObject } = require('metautil');

class Channel {
  #listeners = new Map();

  on(event, handler) {
    if (typeof event !== 'string' || event === '') {
      throw new Error('Expected event name');
    }
    const direct = typeof handler === 'function';
    const mapped =
      isHashObject(handler) &&
      Object.values(handler).every((value) => typeof value === 'function');
    if (!direct && !mapped) throw new Error('Expected handler or method map');
    const listener = direct ? handler : Object.freeze({ ...handler });
    const group = this.#listeners.get(event) ?? new Set();
    group.add(listener);
    this.#listeners.set(event, group);
    return () => {
      group.delete(listener);
      if (group.size === 0 && this.#listeners.get(event) === group) {
        this.#listeners.delete(event);
      }
    };
  }

  async emit(event, command) {
    const group = this.#listeners.get(event);
    if (!group) return { missing: true };
    for (const listener of [...group]) {
      if (typeof listener === 'function') {
        return { outcome: await listener(command) };
      }
      if (Object.hasOwn(listener, command?.method)) {
        return { outcome: await listener[command.method](command.parameters) };
      }
    }
    return { missing: true };
  }

  close() {
    this.#listeners.clear();
  }
}

module.exports = { Channel };
