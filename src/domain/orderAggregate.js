'use strict';

const orderAggregate = () => {
  const place = ({ id, items }) => {
    const idPattern = /^[A-Z0-9-]{1,64}$/;
    const validId = typeof id === 'string' && idPattern.test(id);
    if (!validId) throw new Error('Invalid order id');
    const hasItems = Array.isArray(items) && items.length > 0;
    if (!hasItems) throw new Error('Order must contain items');
    const seen = new Set();
    const lines = items.map(({ sku, quantity, priceCents }) => {
      const duplicate = seen.has(sku);
      const validSku = typeof sku === 'string' && sku !== '' && !duplicate;
      if (!validSku) throw new Error('Invalid or duplicate SKU');
      const validQuantity = Number.isSafeInteger(quantity) && quantity > 0;
      if (!validQuantity) throw new Error('Quantity must be a positive integer');
      const validPrice = Number.isSafeInteger(priceCents) && priceCents >= 0;
      if (!validPrice) throw new Error('Invalid price');
      seen.add(sku);
      const amountCents = quantity * priceCents;
      const safeAmount = Number.isSafeInteger(amountCents);
      if (!safeAmount) throw new Error('Line amount overflow');
      const line = { sku, quantity, priceCents, amountCents };
      return line;
    });
    let totalCents = 0;
    for (const line of lines) {
      const amountCents = line.amountCents;
      totalCents += amountCents;
    }
    const safeTotal = Number.isSafeInteger(totalCents);
    if (!safeTotal) throw new Error('Order total overflow');
    const order = {
      id,
      status: 'placed',
      currency: 'USD',
      lines,
      totalCents,
    };
    return order;
  };
  return { place };
};

module.exports = orderAggregate;
