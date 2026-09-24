'use strict';

const memoryCatalog = () => {
  const book = { sku: 'book', priceCents: 1500 };
  const pen = { sku: 'pen', priceCents: 200 };
  const products = new Map([
    [book.sku, book],
    [pen.sku, pen],
  ]);
  const find = async (sku) => {
    const product = products.get(sku);
    if (!product) return null;
    return product;
  };
  return { find };
};

module.exports = memoryCatalog;
