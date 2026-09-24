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
    presentation: {
      terminal: {
        use: 'commandLine.js',
        bind: { checkout: 'application.purchase' },
      },
    },
  },
  entry: 'presentation.terminal',
});
