({
  layers: {
    domain: {
      aggregate: { use: 'orderAggregate.js' },
    },
    infrastructure: {
      products: { use: 'memoryCatalog.js' },
      orderStore: { use: 'memoryOrders.js' },
    },
    application: {
      purchase: {
        use: 'placeOrder.js',
        bind: {
          order: 'domain.aggregate',
          catalog: 'infrastructure.products',
          orders: 'infrastructure.orderStore',
        },
      },
    },
    reporting: {
      summary: {
        use: 'orderSummary.js',
        bind: { aggregate: 'domain.aggregate' },
      },
    },
    presentation: {
      terminal: {
        use: 'commandLine.js',
        bind: { checkout: 'application.purchase' },
      },
    },
  },
  allow: { reporting: ['domain'] },
  entry: 'presentation.terminal',
});
