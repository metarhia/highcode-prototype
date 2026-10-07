'use strict';

class OrderRepository {
  #records = new Map();

  async save(order) {
    if (this.#records.has(order.id)) throw new Error('Order already exists');
    this.#records.set(order.id, structuredClone(order));
  }

  async get(id) {
    const order = this.#records.get(id);
    if (!order) return null;
    return structuredClone(order);
  }
}

module.exports = { OrderRepository };
