# An architectural DSL example

A small order application whose assembly is described as data in a restricted
JavaScript syntax. JS is the primary representation. Lisp and Markdown express
the same model and are generated from it.

The runtime combines procedural parsing, validation and composition with
stateful repositories, a request channel and an HTTP server. Application and
domain code receive capabilities through factories.

## Run

Tested with Node.js 24.19.0.

```sh
npm ci
npm test
npm run lint
node main.js js ORDER-001 book:2 pen:3
node main.js lisp ORDER-001 book:2 pen:3
node main.js md ORDER-001 book:2 pen:3
```

Every example returns a placed order worth 3600 USD cents. Repeated calls within
one assembly share a store. Different assemblies have separate stores and
transports.

CLI execution does not bind an HTTP port. Start HTTP explicitly:

```sh
npm run start:http
curl -X POST http://127.0.0.1:3000/order \
  -H 'content-type: application/json' \
  -d '{"id":"ORDER-002","lines":[{"sku":"book","quantity":2}]}'
```

The server accepts POST commands at `/<method>`. Successful responses use
`application/json`; errors use `text/plain`. Both content types are retained.
Settings stay in [configuration.json](configuration.json). Relative
configuration and log paths resolve from the project directory.

## Architecture and implementations

[project.js](project.js) contains the working graph. Its four layers are
`domain`, `infrastructure`, `application` and `presentation`.
A component normally maps to `<layer>/<component>.js`.

```js
application: {
  purchase: {
    placeOrder: {
      order: domain.orderAggregate.create,
      catalog: application.products.ProductRepository,
      orders: application.orders.OrderRepository,
    },
  },
},
```

`placeOrder` selects an actual module export. Its properties describe the
ports supplied to that factory:

```js
const placeOrder = ({ order, catalog, orders }) => {
  const execute = async (command) => {
    // Use the supplied capabilities.
  };
  return execute;
};

module.exports = { placeOrder };
```

Arrow factories may return values or promises. Class exports are constructed
with `new`. Every declared capability in a reachable component is constructed
once per assembly. Two named capabilities are independent factory results;
one is never silently substituted for another.

A factory signature uses no parameters or one destructured object containing
plain port names. Renaming, defaults and nested parameter patterns are outside
the current signature reader. Classes without an explicit constructor have no
inferred ports. Domain and application modules do not import their peers.
Infrastructure may import the shared platform channel.

| Reference                             | Resolution                             |
| ------------------------------------- | -------------------------------------- |
| `application.purchase.placeOrder`     | Result of the named factory            |
| `infrastructure.config.read.server`   | Field of the configuration result      |
| `infrastructure.cli`                  | The component's sole capability result |
| A component with several capabilities | Object keyed by capability name        |

References may continue through nested fields. Method references retain their
receiver, including class methods using private fields. Missing capabilities
fail explicitly. Component dependency cycles are rejected, including references
between factories inside the same component.

An empty component or a flat port map also remains supported. For those forms,
the loader selects `init`, `create`, `open`, the module basename, or the sole
function export. Named capabilities are preferable when the choice matters.

## Requests and subscriptions

The implemented event notation is:

```js
presentation: {
  terminal: infrastructure.cli.on('call', {
    order: application.purchase.placeOrder,
  }),
  api: infrastructure.server.on('call', {
    order: application.purchase.placeOrder,
  }),
},
```

This is parsed data, not a JavaScript method call executed while loading the
declaration. At assembly time the runtime connects the transport and handlers.

The shared `Channel` implements request routing. A method map receives
`{ method, parameters }` and invokes the matching own-property handler with
`parameters`. A direct handler receives the whole event payload:

```js
terminal: infrastructure.cli.on('call', application.dispatch.execute),
```

Handlers can return promises. The first matching registration supplies the
result; this is not broadcast delivery. Errors propagate to the caller.
Subscriptions return an unsubscribe callback. The assembly owns its callbacks
and releases them during cleanup.

The CLI and HTTP routes above share the same `placeOrder` result and repository.
No presentation implementation files are necessary.

## Sequential composition

A component can be an array of callable references:

```js
presentation: {
  terminal: [
    process.argv,
    application.arguments.parse,
    application.purchase.placeOrder,
    application.output.format,
  ],
},
```

This illustrative pipeline requires those additional modules. Each step awaits
the previous result and receives it as its sole argument. An error stops the
sequence. The optional `process.argv` marker identifies input supplied to
`application.run(args)`; it does not read global process state. Method maps can
also dispatch a pipeline input. A subscription is a standalone component or a
single-element array, not a pipeline mixed with further steps.

The working order example uses the CLI adapter to parse arguments. Parallel
composition is a proposal, not an implemented operator.

## Syntax and synchronization

The JS file is one parenthesized object followed by a semicolon. Bare names are
references. Quoted strings are literal values, even when they contain dots.

All three representations support objects, arrays, strings with JSON escapes,
finite numbers, booleans and null. JS additionally accepts comments and trailing
commas. Only the two-argument `.on(event, handler)` call form is interpreted.
Imports, arbitrary expressions and executable callbacks are not supported.

Lisp uses `(layer ...)` forms. Nested port values use `(object ...)` and
`(array ...)`; pipelines use `(pipe ...)`. Markdown uses the corresponding
two-space nested lists. See [project.lisp](project.lisp) and
[project.md](project.md).

```sh
npm run sync
npm run sync:check
```

Edit `project.js`, then run `sync` to regenerate the two representations.
`sync:check` compares parsed models, ignoring formatting differences.
`npm test` runs this check before the tests. The generator verifies that each
representation round-trips to the JS model.

Standalone projects can instead choose Lisp or Markdown as their source and
run that frontend directly. The JS synchronization command should only be used
when JS is the chosen source.

## Lifetime

```js
const { start } = require('./highscript/start.js');

const main = async () => {
  const application = await start('js');
  try {
    const result = await application.run(['ORDER-001', 'book:1']);
    process.stdout.write(result);
  } finally {
    await application.close();
  }
};

main().catch(console.error);
```

Assembly creates and connects components. `listen()` starts presentation
transports that expose a listening operation and returns their addresses.
Binding errors reject startup. `close()` releases subscriptions and resources
in reverse acquisition order and is idempotent. Cleanup continues after a
disposal failure and reports an `AggregateError`.

Failed assembly or startup cleans up resources already acquired. A factory
that fails before returning a resource must clean up its own partial work.
The HTTP adapter closes active connections; request draining is not implemented.
The command-line entry handles SIGINT and SIGTERM in HTTP mode.

The logger writes through its injected instance, serializes file appends and
flushes them on close. It does not replace global console methods.
Normal assembly uses the CommonJS cache; factories own instance state.

## Scaffolding

```sh
node scaffold.js --init ./new-project js
node scaffold.js --init ./new-project-md md
node scaffold.js project.js ./new-project
node scaffold.js project.js
```

JS, Lisp and Markdown are supported, including initialization from an empty
project. The generated project contains its own runtime and scaffolder.
Install its dependencies before running it.

Scaffolding creates missing layer folders and implementation files, including
unreachable components. Each named capability gets a factory stub that throws
`Not implemented`. Existing implementations and project files are preserved.

| Change                | Result                                            |
| --------------------- | ------------------------------------------------- |
| Changed port names    | `CONTRACT_CHANGED` with expected and actual names |
| Removed component     | `COMPONENT_REMOVED`                               |
| Orphan implementation | `MODULE_REMOVED`; file is kept                    |
| Removed layer         | `LAYER_REMOVED`; folder is kept                   |
| Unreachable component | `UNREACHABLE_COMPONENT`; stub is still created    |

Unknown references and cycles stop generation. Independently edited target
architecture files are not overwritten. A lock prevents simultaneous writers;
generated files are replaced individually, not as a project-wide transaction.
Existing runtime files are not upgraded automatically.

`architecture.cache.json` records the last successful scaffold and per-export
contracts. Version 1 state can be migrated by scaffolding. Startup does not
depend on this cache: it checks the current declarations against the current
factories. Factory inspection loads trusted implementation modules; the DSL
parser itself does not evaluate JavaScript.

## Scope and review

The current DSL handles component wiring, named factories, request routing,
sequential pipelines and state owned by each assembly. Layer names and module
paths follow conventions. Modular architecture files, explicit entry selection,
schema validation, parallel execution and worker placement are not implemented.

[changes.md](changes.md) records the refactoring and verification.
[proposals.md](proposals.md) compares four alternative event constructions and
proposes further architectural features. Proposed syntax is not accepted by
the current runtime.
