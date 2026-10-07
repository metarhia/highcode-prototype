'use strict';

const ID_PATTERN = /^[A-Z0-9-]{1,64}$/;

const lineOf = (item) => {
  const { sku, quantity, priceCents } = item;
  const isValidSku = typeof sku === 'string' && sku !== '';
  if (!isValidSku) throw new Error('Invalid or duplicate SKU');
  const isValidQuantity = Number.isSafeInteger(quantity) && quantity >= 1;
  if (!isValidQuantity) {
    throw new Error('Quantity must be a positive integer');
  }
  const isValidPrice = Number.isSafeInteger(priceCents) && priceCents >= 0;
  if (!isValidPrice) throw new Error('Invalid price');
  const amountCents = quantity * priceCents;
  const isSafeAmount = Number.isSafeInteger(amountCents);
  if (!isSafeAmount) throw new Error('Line amount overflow');
  return { sku, quantity, priceCents, amountCents };
};

const create = () => {
  const place = ({ id, items }) => {
    const isValidId = typeof id === 'string' && ID_PATTERN.test(id);
    if (!isValidId) throw new Error('Invalid order id');
    const hasItems = Array.isArray(items) && items.length > 0;
    if (!hasItems) throw new Error('Order must contain items');
    const seen = new Set();
    const lines = [];
    let totalCents = 0;
    for (const item of items) {
      const line = lineOf(item);
      if (seen.has(line.sku)) throw new Error('Invalid or duplicate SKU');
      seen.add(line.sku);
      lines.push(line);
      totalCents += line.amountCents;
    }
    const isSafeTotal = Number.isSafeInteger(totalCents);
    if (!isSafeTotal) throw new Error('Order total overflow');
    return { id, status: 'placed', currency: 'USD', lines, totalCents };
  };
  return { place };
};

module.exports = { create };
