'use strict';

const INITIAL_PRODUCTS = new Map([
  ['book', { priceCents: 1500 }],
  ['pen', { priceCents: 200 }],
]);

class ProductRepository {
  #products = structuredClone(INITIAL_PRODUCTS);

  async find(sku) {
    const product = this.#products.get(sku);
    if (!product) return null;
    return { ...product };
  }

  add(product) {
    this.#products.set(product.sku, { ...product });
  }

  clear() {
    this.#products.clear();
  }
}

module.exports = { ProductRepository };
