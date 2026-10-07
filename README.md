# An architectural DSL example

A working order-placement example on Node.js with four layers.
The graph is written in JS, Lisp, or Markdown as `project.js`,
`project.lisp`, or `project.md`. `highscript` wires capabilities,
and the scaffolder creates the project structure and implementation stubs.

## Working example

```sh
node main.js js ORDER-001 book:2 pen:3
node main.js lisp ORDER-001 book:2 pen:3
node main.js md ORDER-001 book:2 pen:3
npm run start:http
node --test
```

Each of the three runs creates an order with status `placed` and a total of
3600 USD cents. Each assembly owns a separate in-memory store.
`npm run start:http` loads `project.js` and leaves the HTTP server listening.

## How to create a project from scratch

You can start without an architecture file:

```sh
node scaffold.js --init <path> lisp
```

This creates the four layer folders, an initial
`project.lisp`, an entry module, `package.json`, `main.js`, and a
standalone copy of `highscript`. Use `js` instead of `lisp`, or omit it and
the file is `project.js`. After generation the project does not depend on
this archive and contains its own `scaffold.js` command.

If the architecture is already written, pass it as the source:

```sh
node scaffold.js project.lisp <path>
node scaffold.js project.js <path>
node scaffold.js project.md <path>
```

Every component that has an implementation gets a template, including
components that cannot be reached from presentation. Business code from the
demonstration application is not copied: you fill in the new implementations
yourself. Templates throw `Not implemented` until the code is written.

## Extend an existing project

After changing the architecture, run the command next to it:

```sh
node scaffold.js project.lisp
```

For JS and Markdown, use the same command with `project.js` and
`project.md`.

A project uses one primary file. The three files in this repository exist so
the frontends can be compared; they are not synchronized automatically.

## What is created and what is kept

- **New layer.** Creates `<layer>/`, even when the layer is empty.
- **New component.** Creates `<layer>/<component>.js`.
- **Same component name in another layer.** Creates a separate file in that layer.
- **New bind roles on a filled-in module.** Emits `CONTRACT_CHANGED`; the code is kept.
- **Component removed.** Emits `COMPONENT_REMOVED`.
- **Implementation file no longer used.** Emits `MODULE_REMOVED`; the file is kept.
- **Layer removed.** Emits `LAYER_REMOVED`; the folder and its contents are kept.
- **Component unreachable from presentation.** Creates a stub and emits `UNREACHABLE_COMPONENT`.

A subscription such as `presentation.terminal` is wiring only, so it does not
create a file.

Each run updates only the generated catalog and the scaffolding state in
`highscript`. Existing implementations, runtime files, `README`, and
`package.json` are not overwritten. A repeated run with no changes does not
rewrite files. User code is never deleted, whatever the model change.

Invalid references, unknown layers, conflicting contracts of a shared module,
and cycles stop generation. Removing a component that is still referenced
prints removal warnings and a reference error; previously created code and
the catalog stay in place.

Removed components are compared with the last successful model. Leftover
files and folders are scanned separately, so warnings about them repeat until
you decide what to do with them.

## Architectural language

`project.js`, `project.lisp`, and `project.md` are three writings
of one graph. The layers are `domain`, `infrastructure`, `application`, and
`presentation`.

A component exports capabilities. A capability names the values it receives.
A value is another capability (`domain.orderAggregate.create`), a field of one
(`infrastructure.config.sections.log`), or a quoted literal
(`'configuration.json'`). An empty capability takes no ports.

References are bare identifiers. A quoted string is a literal, not a reference.
The text is data: comments, string escaping, computation, and arbitrary
execution are not part of the syntax. The JS form also accepts arrays,
`true`, `false`, and `null`. The only call is `source.on(event, handlers)`.

### JavaScript

The file is one parenthesized object and a semicolon. It is not executed.

```js
({
  infrastructure: {
    config: {
      read: { fileName: 'configuration.json' },
      sections: {},
    },
    logger: {
      open: { fileName: infrastructure.config.sections.log },
      console: {},
    },
  },
  application: {
    purchase: {
      placeOrder: {
        order: domain.orderAggregate.create,
        catalog: application.products.ProductRepository,
        orders: application.orders.OrderRepository,
      },
    },
  },
  presentation: {
    terminal: infrastructure.cli.on('call', {
      order: application.purchase.placeOrder,
    }),
  },
});
```

### Lisp

```lisp
(layer infrastructure
  (config
    (read
      (fileName "configuration.json"))
    (sections))
  (logger
    (open
      (fileName infrastructure.config.sections.log))
    (console)))

(layer application
  (purchase
    (placeOrder
      (order domain.orderAggregate.create)
      (catalog application.products.ProductRepository)
      (orders application.orders.OrderRepository))))

(layer presentation
  (terminal
    (infrastructure.cli.on "call"
      ((order application.purchase.placeOrder)))))
```

### Markdown

```md
- infrastructure
  - config
    - read
      - fileName "configuration.json"
    - sections
  - logger
    - open
      - fileName infrastructure.config.sections.log
    - console
- application
  - purchase
    - placeOrder
      - order domain.orderAggregate.create
      - catalog application.products.ProductRepository
      - orders application.orders.OrderRepository
- presentation
  - terminal
    - infrastructure.cli.on "call"
      - order application.purchase.placeOrder
```

`terminal` and `api` subscribe to the `call` event. `infrastructure.cli`
exposes `on` and `run`, and that `run` becomes the program entry. `api`
subscribes `infrastructure.server` the same way. Neither entry has an
implementation file. The complete graphs are `project.js`,
`project.lisp`, and `project.md`.

## A new component

Add a capability to an existing layer. In `project.lisp`:

```lisp
(layer application
  (summary
    (report
      (aggregate domain.orderAggregate.create))))
```

In JS the same component is a capability object:

```js
application: {
  summary: {
    report: { aggregate: domain.orderAggregate.create },
  },
},
```

In Markdown it is a nested list:

```md
- application
  - summary
    - report
      - aggregate domain.orderAggregate.create
```

Scaffolding then creates `application/summary.js`. The factory
template declares input roles in its signature:

```js
'use strict';

const report = ({ aggregate }) => {
  const execute = async (input) => {
    throw new Error('Not implemented: application/summary.js');
  };
  return execute;
};

module.exports = { report };
```

Nothing in presentation references `summary` yet, so `UNREACHABLE_COMPONENT`
is expected. To wire `report` in, add a direct reference from a consumer that
presentation reaches, then extend that factory's signature and its code. The
scaffolder deliberately does not invent a new use case for the capability.

## Signatures and the catalog

An implementation file is named after its component:
`<layer>/<component>.js`. The registry uses that path, such as
`application/products.js`, so the same component name may appear in different
layers and still be a different module.

The capability name in the architecture selects the export (`placeOrder`,
`create`, `open`, `read`, `ProductRepository`). A factory's input roles are
the names in the destructuring of its first argument. The scaffolder loads
the module and reads those names from the result of `toString`. A class
without a `constructor` takes no ports and is constructed with `new`. There
is no separate contract file. Empty parentheses mean no ports:

```js
const placeOrder =
  ({ order, catalog, orders }) =>
  async (command) => {};

module.exports = { placeOrder };
```

```js
class Catalog {}

module.exports = { Catalog };
```

Names in the signature must be short identifiers, with no renaming and no
default values. Ports in the demonstration example mean:

| Port     | Value shape                                          |
| -------- | ---------------------------------------------------- |
| order    | Object with `place(draft)`, which creates an Order   |
| catalog  | Object with asynchronous `find(sku)`                 |
| orders   | Object with asynchronous `save(order)` and `get(id)` |
| fileName | String path                                          |
| console  | Logger methods                                       |
| options  | Server host and port                                 |

The scaffolder does not overwrite an existing implementation. If the `bind`
set has changed, compare `expected` and `actual` in `CONTRACT_CHANGED`, extend
the factory signature, then run generation again. Until the roles match, the
runtime rejects the mismatch. Changing only the target of an existing role
does not require a signature edit.

The catalog and the state of the previous assembly live in
`architecture.cache.json` next to the `project.*` files. The file's keys
are `js`, `lisp`, and `md`. The scaffolder builds each record from the active
architecture and the names in signatures. You do not add implementations by
hand. Cache files belong to the generator; keep them with the sources, and do
not edit them.

## Runtime and layers

| Component             | Implementation                        |
| --------------------- | ------------------------------------- |
| domain.orderAggregate | domain/orderAggregate.js              |
| infrastructure.config | infrastructure/config.js              |
| infrastructure.logger | infrastructure/logger.js              |
| infrastructure.cli    | infrastructure/cli.js                 |
| infrastructure.server | infrastructure/server.js              |
| application.products  | application/products.js               |
| application.orders    | application/orders.js                 |
| application.purchase  | application/purchase.js               |
| presentation.terminal | subscription on infrastructure.cli    |
| presentation.api      | subscription on infrastructure.server |

Domain checks the invariants of the Order aggregate. Application coordinates
price lookup, order creation, and saving. Infrastructure reads
`configuration.json`, writes the log, parses CLI arguments, and serves HTTP.
Presentation only subscribes handlers to those channels.

The application's modules do not import one another. The runtime passes each
factory the declared capabilities; the DSL chooses the concrete providers.

A reference in the architecture is the dependency. There is no separate
allow-list. Cycles remain forbidden. Presentation components are entry
points: they are wired even when nothing references them, and they stay
alive.

Before startup the whole graph is checked, including unused components.
Components unreachable from presentation produce a warning. Each component
with an implementation has its own instance per assembly; two components that
share one implementation file still get two factory instances.

## Further notes

If the source lies outside the target folder, it is copied to
`project.<syntax>`. Later runs update that copy until it has been edited
on its own. A conflict prints `Architecture conflict` and does not overwrite
files. Editing the local file yourself is the normal workflow.

Factories are synchronous; capability operations may be asynchronous. The
demonstration store is in memory. User files are kept by creating only the
files that are missing; generated JSON is updated by replacing the whole
file. A run interrupted by a process crash can be repeated after the leftover
lock is removed. The project is not updated as one file transaction.

25 tests cover the order scenario, the three syntaxes, creation from scratch,
a repeated run, preservation of code, new layers and modules, removals,
changes to input roles, isolation of assemblies, and protection against
conflicting writes.
