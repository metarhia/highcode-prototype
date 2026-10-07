(layer domain (orderAggregate (create)))

(layer infrastructure
  (config (read (fileName "configuration.json")))
  (logger (open (fileName infrastructure.config.read.log)))
  (cli (open))
  (server
    (open
      (console infrastructure.logger.open)
      (options infrastructure.config.read.server))))

(layer application
  (products (ProductRepository))
  (orders (OrderRepository))
  (purchase
    (placeOrder
      (order domain.orderAggregate.create)
      (catalog application.products.ProductRepository)
      (orders application.orders.OrderRepository))))

(layer presentation
  (terminal
    (infrastructure.cli.on "call" ((order application.purchase.placeOrder))))
  (api
    (infrastructure.server.on "call"
      ((order application.purchase.placeOrder)))))
