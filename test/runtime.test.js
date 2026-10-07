'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Channel } = require('../highscript/channel.js');
const { inspect } = require('../highscript/model.js');
const {
  compile,
  assemble,
  loadFactory,
  catalogOf,
} = require('../highscript/wiring.js');

const build = (model, load) =>
  assemble(compile(model, catalogOf(inspect(model), load)), load);

test('channel isolation, failures, and unsubscribe', async () => {
  const first = new Channel();
  const second = new Channel();
  const failure = new Error('Rejected order');
  const handlers = {
    order: async (value) => value + 1,
    fail: async () => {
      throw failure;
    },
  };
  const release = first.on('call', handlers);
  handlers.order = () => 99;
  assert.deepEqual(
    await first.emit('call', {
      method: 'order',
      parameters: 2,
    }),
    { outcome: 3 },
  );
  assert.deepEqual(await second.emit('call', { method: 'order' }), {
    missing: true,
  });
  assert.deepEqual(await first.emit('call', { method: 'constructor' }), {
    missing: true,
  });
  await assert.rejects(
    first.emit('call', { method: 'fail' }),
    (error) => error === failure,
  );
  release();
  release();
  assert.deepEqual(await first.emit('call', { method: 'order' }), {
    missing: true,
  });
  first.on('change', async (value) => value.id);
  assert.deepEqual(await first.emit('change', { id: 7 }), { outcome: 7 });
  first.close();
});

test('old unsubscribe does not remove a new event group', async () => {
  const channel = new Channel();
  const old = channel.on('call', () => 1);
  channel.close();
  channel.on('call', () => 2);
  old();
  assert.deepEqual(await channel.emit('call', {}), { outcome: 2 });
});

test('named capabilities and complete pipelines', async (context) => {
  const created = [];
  const factories = {
    add: () => {
      created.push('add');
      return async (value) => value + 1;
    },
    double: () => {
      created.push('double');
      return (value) => value * 2;
    },
  };
  const load = (file, layer, name) => factories[name];
  const model = {
    application: { math: { add: {}, double: {} } },
    presentation: {
      terminal: [
        'process.argv',
        'application.math.add',
        'application.math.double',
      ],
    },
  };
  const application = await build(model, load);
  context.after(() => application.close());
  assert.equal(await application.run(3), 8);
  assert.equal(await application.run(4), 10);
  assert.deepEqual(created, ['add', 'double']);
});

test('class methods used as steps retain their receiver', async (context) => {
  class Calculator {
    #offset = 3;
    add(value) {
      return value + this.#offset;
    }
  }
  const model = {
    application: { calculator: { Calculator: {} } },
    presentation: { terminal: ['application.calculator.Calculator.add'] },
  };
  const application = await build(model, () => Calculator);
  context.after(() => application.close());
  assert.equal(await application.run(4), 7);
});

test('explicit missing capabilities never fall back to another export', () => {
  const file = path.join(__dirname, '../domain/orderAggregate.js');
  assert.throws(() => loadFactory(file, 'missing'), /Unknown capability/);
  assert.equal(loadFactory(file, 'create'), loadFactory(file, 'create'));
});

test('a failed pipeline does not invoke later steps', async (context) => {
  let called = false;
  const factories = {
    reject: () => async () => {
      throw new Error('stop');
    },
    after: () => () => {
      called = true;
    },
  };
  const model = {
    application: { steps: { reject: {}, after: {} } },
    presentation: {
      terminal: ['application.steps.reject', 'application.steps.after'],
    },
  };
  const application = await build(
    model,
    (file, layer, name) => factories[name],
  );
  context.after(() => application.close());
  await assert.rejects(application.run(null), /stop/);
  assert.equal(called, false);
});

test('failed construction releases previously created resources', async () => {
  const released = [];
  const failure = new Error('Cannot construct');
  const factories = {
    resource: () => ({ close: () => released.push('resource') }),
    broken: ({ resource }) => {
      assert.equal(typeof resource.close, 'function');
      throw failure;
    },
  };
  const model = {
    infrastructure: { resource: {} },
    presentation: { broken: { resource: 'infrastructure.resource' } },
  };
  await assert.rejects(
    build(model, (file) => factories[path.basename(file, '.js')]),
    (error) => error === failure,
  );
  assert.deepEqual(released, ['resource']);
});

test('cleanup continues after failure and is idempotent', async () => {
  const released = [];
  const factories = {
    first: () => ({ close: () => released.push('first') }),
    second: ({ first }) => ({
      first,
      close: () => {
        released.push('second');
        throw new Error('close failed');
      },
    }),
    terminal:
      ({ second }) =>
      () =>
        second,
  };
  const model = {
    infrastructure: { first: {}, second: { first: 'infrastructure.first' } },
    presentation: { terminal: { second: 'infrastructure.second' } },
  };
  const application = await build(
    model,
    (file) => factories[path.basename(file, '.js')],
  );
  const closing = application.close();
  assert.equal(application.close(), closing);
  await assert.rejects(closing, AggregateError);
  assert.deepEqual(released, ['second', 'first']);
  await assert.rejects(application.run(null), /closed/);
});
