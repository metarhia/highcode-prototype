'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { open } = require('../infrastructure/server.js');
const { parse } = require('../highscript/syntax.js');
const { inspect } = require('../highscript/model.js');
const {
  compile,
  assemble,
  loadFactory,
  catalogOf,
} = require('../highscript/wiring.js');

const silent = { log: async () => {}, error: async () => {} };
const post = (url, body) =>
  fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

test('HTTP retains both response content types', async (context) => {
  const server = open({
    console: silent,
    options: { host: '127.0.0.1', port: 0 },
  });
  context.after(() => server.close());
  server.on('call', {
    order: async (input) => ({ id: input.id }),
    invalid: () => {
      throw new Error('Invalid order');
    },
    broken: () => 1n,
  });
  const { port } = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const success = await post(`${base}/order`, { id: 'A' });
  assert.equal(success.status, 200);
  assert.equal(success.headers.get('content-type'), 'application/json');
  assert.deepEqual(await success.json(), { id: 'A' });
  for (const [route, status] of [
    ['missing', 404],
    ['constructor', 404],
    ['invalid', 400],
    ['broken', 500],
  ]) {
    const response = await post(`${base}/${route}`, {});
    assert.equal(response.status, status);
    assert.equal(response.headers.get('content-type'), 'text/plain');
    await response.text();
  }
  const invalid = await fetch(`${base}/order`, { method: 'POST', body: '{' });
  assert.equal(invalid.status, 400);
  await invalid.text();
});

test('listen failures and released ports', async (context) => {
  const first = open({
    console: silent,
    options: { host: '127.0.0.1', port: 0 },
  });
  context.after(() => first.close());
  const address = await first.listen();
  const second = open({
    console: silent,
    options: {
      host: '127.0.0.1',
      port: address.port,
    },
  });
  context.after(() => second.close());
  await assert.rejects(second.listen(), { code: 'EADDRINUSE' });
  await first.close();
  await assert.rejects(first.listen(), /closed/);
  const third = open({
    console: silent,
    options: {
      host: '127.0.0.1',
      port: address.port,
    },
  });
  context.after(() => third.close());
  assert.equal((await third.listen()).port, address.port);
});

test('shared CLI/HTTP stores and isolated servers', async (context) => {
  const root = path.resolve(__dirname, '..');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'highcode-http-'));
  const configuration = path.join(temp, 'settings.json');
  await fs.writeFile(
    configuration,
    JSON.stringify({
      log: path.join(temp, 'orders.log'),
      server: { host: '127.0.0.1', port: 0 },
    }),
  );
  const source = await fs.readFile(path.join(root, 'project.js'), 'utf8');
  const model = parse(source, 'js');
  model.infrastructure.config.read.fileName = { literal: configuration };
  model.presentation.extraTerminal = model.presentation.terminal;
  const load = (file, layer, name) =>
    loadFactory(path.join(root, layer, file), name);
  const graph = compile(model, catalogOf(inspect(model), load));
  const first = await assemble(graph, load);
  const second = await assemble(graph, load);
  context.after(async () => {
    await Promise.all([first.close(), second.close()]);
    await fs.rm(temp, { recursive: true, force: true });
  });
  const [[left], [right]] = await Promise.all([
    first.listen(),
    second.listen(),
  ]);
  assert.notEqual(left.port, right.port);
  await first.run(['ORDER-HTTP', 'book:1']);
  const command = { id: 'ORDER-HTTP', lines: [{ sku: 'pen', quantity: 1 }] };
  const duplicate = await post(`http://127.0.0.1:${left.port}/order`, command);
  assert.equal(duplicate.status, 400);
  assert.match(await duplicate.text(), /already exists/);
  const isolated = await post(`http://127.0.0.1:${right.port}/order`, command);
  assert.equal(isolated.status, 200);
  assert.equal((await isolated.json()).totalCents, 200);
});
