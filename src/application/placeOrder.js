'use strict';

const placeOrder = ({ order, catalog, orders }) => async (command) => {
  const lines = command ? command.lines : undefined;
  const hasLines = Array.isArray(lines) && lines.length > 0;
  if (!hasLines) throw new Error('Expected order lines');
  const readLine = async (line) => {
    const sku = line ? line.sku : undefined;
    const validSku = typeof sku === 'string';
    if (!validSku) throw new Error('Expected SKU');
    const product = await catalog.find(sku);
    if (!product) throw new Error(`Unknown SKU: ${sku}`);
    const item = {
      sku,
      quantity: line.quantity,
      priceCents: product.priceCents,
    };
    return item;
  };
  const items = await Promise.all(lines.map(readLine));
  const draft = { id: command.id, items };
  const placed = order.place(draft);
  await orders.save(placed);
  return placed;
};

module.exports = placeOrder;
