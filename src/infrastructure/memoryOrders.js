'use strict';

const memoryOrders = () => {
  const records = new Map();
  const save = async (order) => {
    if (records.has(order.id)) throw new Error('Order already exists');
    records.set(order.id, structuredClone(order));
  };
  const get = async (id) => {
    const order = records.get(id);
    if (!order) return null;
    const snapshot = structuredClone(order);
    return snapshot;
  };
  return { save, get };
};

module.exports = memoryOrders;
