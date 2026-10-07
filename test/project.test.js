'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { mkdtemp, readFile, rm } = require('node:fs/promises');

const { parse } = require('../highscript/syntax.js');
const { compile, assemble, loadFactory } = require('../highscript/wiring.js');
const { start } = require('../highscript/start.js');
const { capabilityPorts } = require('../highscript/model.js');
const { catalog } = require('../architecture.cache.json').js;
const aggregate = require('../domain/orderAggregate.js');
const { create: createOrder } = aggregate;
const { OrderRepository } = require('../application/orders.js');

const QUOTE = String.fromCharCode(39);

const model = async (syntax = 'js') => {
  const file = path.join(__dirname, '..', `project.${syntax}`);
  return parse(await readFile(file, 'utf8'), syntax);
};

test('all frontends produce the same model and result', async (context) => {
  const models = await Promise.all([model(), model('lisp'), model('md')]);
  const jsModel = models[0];
  const lispModel = models[1];
  const mdModel = models[2];
  assert.deepEqual(jsModel, lispModel);
  assert.deepEqual(jsModel, mdModel);
  const js = await start('js');
  const lisp = await start('lisp');
  const md = await start('md');
  context.after(() => Promise.all([js.close(), lisp.close(), md.close()]));
  const args = Object.freeze(['ORDER-001', 'book:2', 'pen:3']);
  const outputs = await Promise.all([
    js.run(args),
    lisp.run(args),
    md.run(args),
  ]);
  assert.equal(outputs[0], outputs[1]);
  assert.equal(outputs[0], outputs[2]);
  const placed = JSON.parse(outputs[0]);
  assert.equal(placed.totalCents, 3600);
  assert.equal(placed.status, 'placed');
  assert.deepEqual(
    placed.lines.map((line) => line.amountCents),
    [3000, 600],
  );
});

test('instances retain state and isolate assemblies', async (context) => {
  const first = await start();
  const second = await start();
  context.after(() => Promise.all([first.close(), second.close()]));
  await first.run(['ORDER-001', 'book:1']);
  await assert.rejects(first.run(['ORDER-001', 'pen:1']), /already exists/);
  await assert.doesNotReject(second.run(['ORDER-001', 'pen:1']));
});

test('invalid orders are not persisted', async (context) => {
  const application = await start();
  context.after(() => application.close());
  await assert.rejects(
    application.run(['ORDER-001', 'missing:1']),
    /Unknown SKU/,
  );
  await assert.rejects(
    application.run(['ORDER-001', 'book:1', 'book:2']),
    /duplicate SKU/,
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
    assert.throws(() =>
      order.place({
        id: 'ORDER-001',
        items: [{ sku: 'book', quantity, priceCents: 1500 }],
      }),
    );
  }
});

test('repository snapshots cannot mutate stored state', async () => {
  const orders = new OrderRepository();
  const placed = { id: 'ORDER-001', lines: [{ quantity: 1 }] };
  await orders.save(placed);
  placed.lines[0].quantity = 9;
  const snapshot = await orders.get(placed.id);
  assert.equal(snapshot.lines[0].quantity, 1);
  snapshot.lines[0].quantity = 5;
  assert.equal((await orders.get(placed.id)).lines[0].quantity, 1);
  const attempts = await Promise.allSettled([
    orders.save({ id: 'ORDER-002' }),
    orders.save({ id: 'ORDER-002' }),
  ]);
  const saved = attempts.filter((item) => item.status === 'fulfilled');
  assert.equal(saved.length, 1);
});

test('compiler rejects unknown, missing and cyclic bindings', async () => {
  const source = await model();
  const unknown = structuredClone(source);
  unknown.application.purchase.placeOrder.catalog = 'infrastructure.absent';
  assert.throws(() => compile(unknown, catalog), /Unknown reference/);
  const missing = structuredClone(source);
  delete missing.application.purchase.placeOrder.catalog;
  assert.throws(() => compile(missing, catalog), /Missing bindings/);
  const cycle = structuredClone(source);
  cycle.application.purchase.placeOrder.order = 'application.purchase';
  assert.throws(() => compile(cycle, catalog), /Dependency cycle/);
});

test('binding selects a different provider', async (context) => {
  const source = await model();
  const graph = compile(source, catalog);
  const load = (name, layer, capability) =>
    name === 'products.js'
      ? () => ({ find: async (sku) => ({ sku, priceCents: 100 }) })
      : loadFactory(path.join(__dirname, '..', layer, name), capability);
  const application = await assemble(graph, load);
  context.after(() => application.close());
  const output = JSON.parse(await application.run(['ORDER-001', 'book:2']));
  assert.equal(output.totalCents, 200);
});

test('DSL parsers reject executable JS, duplicates and trailing input', () => {
  assert.throws(() => parse('({ entry: process.exit() });', 'js'));
  const left = `${QUOTE}a${QUOTE}`;
  const right = `${QUOTE}b${QUOTE}`;
  const duplicated = `({ entry: ${left}, entry: ${right} });`;
  assert.throws(() => parse(duplicated, 'js'));
  assert.throws(() => parse('(entry a) (entry a)', 'lisp'));
  assert.throws(() => parse('(entry a) extra', 'lisp'));
});

test('reopening the logger does not nest timestamps', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'logger-'));
  try {
    const originalConsole = globalThis.console.log;
    const fileName = path.join(root, 'orders.log');
    const loggerFile = path.join(__dirname, '../infrastructure/logger.js');
    const first = loadFactory(loggerFile)({ fileName });
    const second = loadFactory(loggerFile)({ fileName });
    assert.equal(globalThis.console.log, originalConsole);
    await first.log('listening 127.0.0.1:3000');
    const message = 'listen EADDRINUSE: address already in use 127.0.0.1:3000';
    await second.error(message);
    const text = await readFile(fileName, 'utf8');
    const lines = text.trim().split('\n');
    const record =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (log|error) (.*)$/;
    const parsed = lines.map((line) => record.exec(line));
    assert.deepEqual(
      parsed.map((item) => item[2]),
      ['log', 'error'],
    );
    assert.deepEqual(
      parsed.map((item) => item[3]),
      ['listening 127.0.0.1:3000', message],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('domain and application have no peer imports', async () => {
  for (const [implementation, contract] of Object.entries(catalog)) {
    const file = path.join(__dirname, '..', implementation);
    const source = await readFile(file, 'utf8');
    if (!implementation.startsWith('infrastructure/')) {
      const linked = /\brequire\s*\(\s*['"](?!node:|metautil['"])/;
      assert.doesNotMatch(source, linked);
    }
    assert.doesNotMatch(source, /\bimport\b/);
    for (const [name, ports] of Object.entries(contract.exports)) {
      const factory = loadFactory(file, name);
      assert.equal(loadFactory(file, name), factory);
      assert.deepEqual([...capabilityPorts(factory)].sort(), [...ports].sort());
    }
  }
});
