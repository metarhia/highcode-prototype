(architecture
  (layer domain
    (component aggregate "orderAggregate.js"))
  (layer infrastructure
    (component products "memoryCatalog.js")
    (component orderStore "memoryOrders.js"))
  (layer application
    (component purchase "placeOrder.js"
      (bind order domain.aggregate)
      (bind catalog infrastructure.products)
      (bind orders infrastructure.orderStore)))
  (layer presentation
    (component terminal "commandLine.js"
      (bind checkout application.purchase)))
  (entry presentation.terminal))
