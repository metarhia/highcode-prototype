'use strict';

const readLine = async (line, catalog) => {
  const sku = line?.sku;
  const isValidSku = typeof sku === 'string';
  if (!isValidSku) throw new Error('Expected SKU');
  const product = await catalog.find(sku);
  if (!product) throw new Error(`Unknown SKU: ${sku}`);
  const { quantity } = line;
  const { priceCents } = product;
  return { sku, quantity, priceCents };
};

const placeOrder = ({ order, catalog, orders }) => {
  const place = async (command) => {
    const lines = command?.lines;
    const hasLines = Array.isArray(lines) && lines.length > 0;
    if (!hasLines) throw new Error('Expected order lines');
    const items = await Promise.all(
      lines.map((line) => readLine(line, catalog)),
    );
    const draft = { id: command.id, items };
    const placed = order.place(draft);
    await orders.save(placed);
    return placed;
  };
  return place;
};

module.exports = { placeOrder };
