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
  (layer reporting
    (component summary "orderSummary.js"
      (bind aggregate domain.aggregate)))
  (layer presentation
    (component terminal "commandLine.js"
      (bind checkout application.purchase)))
  (allow reporting domain)
  (entry presentation.terminal))
