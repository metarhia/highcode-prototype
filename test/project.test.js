'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { parse } = require('../platform/syntax.js');
const { compile, assemble } = require('../platform/wiring.js');
const { start } = require('../platform/start.js');
const { capabilityPorts } = require('../platform/model.js');
const catalog = require('../platform/catalog.js');
const createOrder = require('../src/domain/orderAggregate.js');
const createOrders = require('../src/infrastructure/memoryOrders.js');

const model = async (syntax = 'js') => {
  const file = path.join(__dirname, '..', `architecture.${syntax}`);
  return parse(await readFile(file, 'utf8'), syntax);
};

test('both frontends produce the same model and result', async () => {
  const [jsModel, lispModel] = await Promise.all([model(), model('lisp')]);
  assert.deepEqual(jsModel, lispModel);
  const js = await start('js');
  const lisp = await start('lisp');
  const args = Object.freeze(['ORDER-001', 'book:2', 'pen:3']);
  const outputs = await Promise.all([js.run(args), lisp.run(args)]);
  assert.equal(outputs[0], outputs[1]);
  const placed = JSON.parse(outputs[0]);
  assert.equal(placed.totalCents, 3600);
  assert.equal(placed.status, 'placed');
  assert.deepEqual(placed.lines.map((line) => line.amountCents), [3000, 600]);
});

test('instances retain state inside one assembly and isolate assemblies',
  async () => {
    const first = await start();
    const second = await start();
    await first.run(['ORDER-001', 'book:1']);
    await assert.rejects(first.run(['ORDER-001', 'pen:1']), /already exists/);
    await assert.doesNotReject(second.run(['ORDER-001', 'pen:1']));
  });

test('invalid orders are not persisted', async () => {
  const application = await start();
  await assert.rejects(
    application.run(['ORDER-001', 'missing:1']), /Unknown SKU/,
  );
  await assert.rejects(
    application.run(['ORDER-001', 'book:1', 'book:2']), /duplicate SKU/,
  );
  await assert.doesNotReject(application.run(['ORDER-001', 'book:1']));
});

test('aggregate copies its lines and protects monetary invariants', () => {
  const order = createOrder();
  const items = [{ sku: 'book', quantity: 2, priceCents: 1500 }];
  const before = structuredClone(items);
  const placed = order.place({ id: 'ORDER-001', items });
  assert.deepEqual(items, before);
  items[0].quantity = 9;
  assert.equal(placed.lines[0].quantity, 2);
  assert.equal(placed.lines[0].amountCents, 3000);
  assert.equal(placed.totalCents, 3000);
  for (const quantity of [0, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => order.place({
      id: 'ORDER-001', items: [{ sku: 'book', quantity, priceCents: 1500 }],
    }));
  }
});

test('repository snapshots cannot mutate stored state', async () => {
  const orders = createOrders();
  const placed = { id: 'ORDER-001', lines: [{ quantity: 1 }] };
  await orders.save(placed);
  placed.lines[0].quantity = 9;
  const snapshot = await orders.get(placed.id);
  assert.equal(snapshot.lines[0].quantity, 1);
  snapshot.lines[0].quantity = 5;
  assert.equal((await orders.get(placed.id)).lines[0].quantity, 1);
  const attempts = await Promise.allSettled([
    orders.save({ id: 'ORDER-002' }), orders.save({ id: 'ORDER-002' }),
  ]);
  const saved = attempts.filter((item) => item.status === 'fulfilled');
  assert.equal(saved.length, 1);
});

test('compiler rejects unknown, missing and forbidden bindings', async () => {
  const source = await model();
  const unknown = structuredClone(source);
  unknown.layers.application.purchase.bind.catalog = 'infrastructure.absent';
  assert.throws(() => compile(unknown, catalog), /Unknown reference/);
  const missing = structuredClone(source);
  delete missing.layers.application.purchase.bind.catalog;
  assert.throws(() => compile(missing, catalog), /Missing bindings/);
  const forbidden = structuredClone(source);
  forbidden.layers.presentation.terminal.bind.checkout =
    'infrastructure.orderStore';
  assert.throws(() => compile(forbidden, catalog), /Forbidden binding/);
  const cycle = structuredClone(source);
  cycle.layers.application.purchase.bind.order = 'application.purchase';
  assert.throws(() => compile(cycle, catalog), /Dependency cycle/);
});

test('binding selects a different provider without changing application code',
  async () => {
    const source = await model();
    const variant = {
      ...source,
      layers: {
        ...source.layers,
        infrastructure: {
          ...source.layers.infrastructure,
          products: { use: 'testCatalog.js' },
        },
      },
    };
    const definitions = {
      ...catalog,
      'infrastructure/testCatalog.js': { layer: 'infrastructure', ports: [] },
    };
    const graph = compile(variant, definitions);
    const load = (name, layer) => name === 'testCatalog.js'
      ? () => ({ find: async (sku) => ({ sku, priceCents: 100 }) })
      : require(path.join(__dirname, '../src', layer, name));
    const application = assemble(graph, load);
    const output = JSON.parse(await application.run(['ORDER-001', 'book:2']));
    assert.equal(output.totalCents, 200);
  });

test('DSL parsers reject executable JS, duplicates and trailing input', () => {
  assert.throws(() => parse("({ entry: process.exit() });", 'js'));
  assert.throws(() => parse("({ entry: 'a', entry: 'b' });", 'js'));
  assert.throws(() => parse('(architecture (entry a) (entry b))', 'lisp'));
  assert.throws(() => parse('(architecture (entry a)) extra', 'lisp'));
});

test('business modules contain no module linking', async () => {
  for (const implementation of Object.keys(catalog)) {
    const file = path.join(__dirname, '../src', implementation);
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\brequire\s*\(|\bimport\b/);
    assert.deepEqual([...capabilityPorts(require(file))].sort(),
      [...catalog[implementation].ports].sort());
  }
});
