(layer domain
  (orderAggregate
    (create)))

(layer infrastructure
  (config
    (read
      (fileName "configuration.json"))
    (sections))
  (logger
    (open
      (fileName infrastructure.config.sections.log))
    (console))
  (cli
    (open))
  (server
    (open
      (console infrastructure.logger.console)
      (options infrastructure.config.sections.server))))

(layer application
  (products
    (ProductRepository))
  (orders
    (OrderRepository))
  (purchase
    (placeOrder
      (order domain.orderAggregate.create)
      (catalog application.products.ProductRepository)
      (orders application.orders.OrderRepository))))

(layer presentation
  (terminal
    (infrastructure.cli.on "call"
      ((order application.purchase.placeOrder))))
  (api
    (infrastructure.server.on "call"
      ((order application.purchase.placeOrder)))))
