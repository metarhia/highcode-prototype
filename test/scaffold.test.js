'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { scaffold } = require('../platform/scaffold.js');
const { parse } = require('../platform/syntax.js');
const { compile } = require('../platform/wiring.js');
const { capabilityPorts } = require('../platform/model.js');

const execute = promisify(execFile);
const project = path.resolve(__dirname, '..');
const encode = (model) => `(${JSON.stringify(model, null, 2)
  .replace(/"([A-Za-z][A-Za-z0-9]*)":/g, '$1:')});\n`;
const original = () =>
  fs.readFile(path.join(project, 'architecture.js'), 'utf8');
const setup = async (context) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ddd-scaffold-'));
  context.after(() => fs.rm(parent, { recursive: true, force: true }));
  return { parent, root: path.join(parent, 'project') };
};
const apply = (root, source) => scaffold({ source, root, syntax: 'js' });
const contents = (root, file) => fs.readFile(path.join(root, file), 'utf8');
const exists = async (file) => {
  try { await fs.access(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};
const addReporting = (model) => ({
  ...model,
  layers: {
    ...model.layers,
    reporting: {
      summary: {
        use: 'reportRenderer.js', bind: { aggregate: 'domain.aggregate' },
      },
    },
  },
  allow: { reporting: ['domain'] },
});

test('both DSLs bootstrap complete projects without implementations',
  async (context) => {
    const { parent } = await setup(context);
    for (const syntax of ['js', 'lisp']) {
      const source = await fs.readFile(
        path.join(project, `architecture.${syntax}`), 'utf8',
      );
      const root = path.join(parent, syntax);
      const report = await scaffold({ source, root, syntax });
      assert.equal(report.warnings.length, 0);
      for (const file of ['package.json', 'main.js', 'scaffold.js',
        'platform/scaffold.js', 'platform/catalog.generated.json',
        'src/domain/orderAggregate.js',
        'src/application/placeOrder.js']) {
        assert.equal(await exists(path.join(root, file)), true, file);
      }
      assert.equal(await exists(path.join(root,
        'src/application/placeOrder.js.contract.json')), false);
      const purchase = await contents(root, 'src/application/placeOrder.js');
      assert.match(purchase,
        /const placeOrder = \(\{ catalog, order, orders \}\) =>/);
      assert.match(purchase, /module\.exports = placeOrder;/);
      assert.doesNotMatch(purchase, /@param|\/\*\*/);
      const catalog = JSON.parse(await contents(root,
        'platform/catalog.generated.json'));
      assert.deepEqual(catalog['application/placeOrder.js'].ports,
        ['catalog', 'order', 'orders']);
      const second = await execute(process.execPath,
        ['scaffold.js', `architecture.${syntax}`, '--json'], { cwd: root });
      assert.deepEqual(JSON.parse(second.stdout).created, []);
      await assert.rejects(execute(process.execPath,
        ['main.js', syntax, 'ORDER-001', 'book:1'], { cwd: root }),
      (error) => /Not implemented/.test(error.stderr));
    }
  });

test('init starts from no architecture and creates empty DDD layers',
  async (context) => {
    const { root } = await setup(context);
    await execute(process.execPath,
      [path.join(project, 'scaffold.js'), '--init', root, 'lisp']);
    assert.equal(await exists(path.join(root, 'architecture.lisp')), true);
    for (const layer of ['domain', 'application',
      'infrastructure', 'presentation']) {
      assert.equal((await fs.stat(path.join(root, 'src', layer)))
        .isDirectory(), true);
    }
    const output = await execute(process.execPath,
      ['scaffold.js', 'architecture.lisp', '--json'], { cwd: root });
    assert.deepEqual(JSON.parse(output.stdout).updated, []);
  });

test('repeated runs preserve filled code and package files',
  async (context) => {
    const { root } = await setup(context);
    const source = await original();
    await apply(root, source);
    const file = 'src/domain/orderAggregate.js';
    const code = "'use strict';\nmodule.exports = () => ({ ready: true });\n";
    await fs.writeFile(path.join(root, file), code);
    const packageFile = path.join(root, 'package.json');
    await fs.writeFile(packageFile, '{"private":true,"custom":"keep"}');
    const before = await fs.stat(path.join(root, file));
    const report = await apply(root, source);
    assert.deepEqual(report.created, []);
    assert.deepEqual(report.updated, []);
    assert.equal(await contents(root, file), code);
    assert.equal(await fs.readFile(packageFile, 'utf8'),
      '{"private":true,"custom":"keep"}');
    const after = await fs.stat(path.join(root, file));
    assert.equal(after.mtimeMs, before.mtimeMs);
  });

test('new layer, component and file are generated with explicit permissions',
  async (context) => {
    const { root } = await setup(context);
    const source = await original();
    await apply(root, source);
    const model = addReporting(parse(source, 'js'));
    const report = await apply(root, encode(model));
    assert.ok(report.created.includes('src/reporting/'));
    assert.ok(report.created.includes('src/reporting/reportRenderer.js'));
    assert.ok(report.warnings.some((warning) =>
      warning.code === 'UNREACHABLE_COMPONENT' &&
      warning.component === 'reporting.summary'));
    const renderer = await contents(root,
      'src/reporting/reportRenderer.js');
    assert.match(renderer, /const reportRenderer = \(\{ aggregate \}\) =>/);
    assert.match(renderer, /module\.exports = reportRenderer;/);
    assert.doesNotMatch(renderer, /@param|\/\*\*/);
    assert.equal(await exists(path.join(root,
      'src/reporting/reportRenderer.js.contract.json')), false);
    const catalog = JSON.parse(await contents(root,
      'platform/catalog.generated.json'));
    assert.doesNotThrow(() => compile(model, catalog));
  });

test('removal warns about component, layer and orphan code without deletion',
  async (context) => {
    const { root } = await setup(context);
    const source = await original();
    await apply(root, encode(addReporting(parse(source, 'js'))));
    const file = 'src/reporting/reportRenderer.js';
    const code = "module.exports = () => async () => 'user implementation';\n";
    await fs.writeFile(path.join(root, file), code);
    const report = await apply(root, source);
    const codes = ['COMPONENT_REMOVED', 'LAYER_REMOVED', 'MODULE_REMOVED'];
    for (const code of codes) {
      assert.ok(report.warnings.some((warning) => warning.code === code));
    }
    assert.equal(await contents(root, file), code);
    const again = await apply(root, source);
    assert.ok(again.warnings.some((item) => item.code === 'MODULE_REMOVED'));
  });

test('changing use preserves old implementation and adds the new module',
  async (context) => {
    const { root } = await setup(context);
    const source = await original();
    await apply(root, source);
    const model = parse(source, 'js');
    model.layers.infrastructure.products.use = 'remoteCatalog.js';
    const report = await apply(root, encode(model));
    assert.ok(report.created.includes('src/infrastructure/remoteCatalog.js'));
    assert.ok(report.warnings.some((item) => item.code === 'MODULE_REMOVED'));
    assert.equal(await exists(path.join(root,
      'src/infrastructure/memoryCatalog.js')), true);
  });

test('changed input roles warn without overwriting the existing factory',
  async (context) => {
    const { root } = await setup(context);
    const source = await original();
    await apply(root, source);
    const file = 'src/presentation/commandLine.js';
    const old = await contents(root, file);
    const model = parse(source, 'js');
    model.layers.presentation.terminal.bind.audit = 'application.purchase';
    const report = await apply(root, encode(model));
    assert.ok(report.warnings.some((item) => item.code === 'CONTRACT_CHANGED'));
    assert.equal(await contents(root, file), old);
    await fs.writeFile(path.join(root, file),
      old.replace('({ checkout })', '({ audit, checkout })'));
    const updated = await apply(root, encode(model));
    assert.ok(!updated.warnings.some((item) =>
      item.code === 'CONTRACT_CHANGED'));
    const catalog = JSON.parse(await contents(root,
      'platform/catalog.generated.json'));
    assert.doesNotThrow(() => compile(model, catalog));
  });

test('same filenames in different layers have separate physical modules',
  async (context) => {
    const { root } = await setup(context);
    const model = parse(await original(), 'js');
    model.layers.reporting = { archive: { use: 'memoryCatalog.js' } };
    await apply(root, encode(model));
    const catalog = JSON.parse(await contents(root,
      'platform/catalog.generated.json'));
    assert.ok(catalog['reporting/memoryCatalog.js']);
    assert.ok(catalog['infrastructure/memoryCatalog.js']);
  });

test('bad references, cycles and path traversal create no project',
  async (context) => {
    const { root } = await setup(context);
    const model = parse(await original(), 'js');
    model.layers.domain.aggregate.use = '../escape.js';
    await assert.rejects(apply(root, encode(model)), /filename/);
    assert.equal(await exists(root), false);
    model.layers.domain.aggregate.use = 'orderAggregate.js';
    model.layers.application.purchase.bind.order = 'domain.absent';
    await assert.rejects(apply(root, encode(model)), /Unknown reference/);
    assert.equal(await exists(root), false);
    model.layers.application.purchase.bind.order = 'application.purchase';
    await assert.rejects(apply(root, encode(model)), /Dependency cycle/);
    assert.equal(await exists(root), false);
  });

test('external source does not overwrite separately edited architecture',
  async (context) => {
    const { root } = await setup(context);
    const source = await original();
    await apply(root, source);
    const target = path.join(root, 'architecture.js');
    const edited = `${source}\n`;
    await fs.writeFile(target, edited);
    const updated = encode(addReporting(parse(source, 'js')));
    await assert.rejects(apply(root, updated), /Architecture conflict/);
    assert.equal(await fs.readFile(target, 'utf8'), edited);
  });

test('concurrent writers and symlink directories are rejected',
  async (context) => {
    const { root, parent } = await setup(context);
    const source = await original();
    await fs.mkdir(root);
    const lock = path.join(root, '.scaffold.lock');
    await fs.writeFile(lock, 'held');
    await assert.rejects(apply(root, source), /already running/);
    assert.equal(await fs.readFile(lock, 'utf8'), 'held');
    await fs.unlink(lock);
    const outside = path.join(parent, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(root, 'src'));
    await assert.rejects(apply(root, source), /Expected directory/);
    assert.deepEqual(await fs.readdir(outside), []);
  });

test('Lisp allow and JS arrays normalize to the same policy', () => {
  const lisp = '(architecture (layer presentation ' +
    '(component terminal "commandLine.js")) (layer reporting) ' +
    '(allow presentation reporting) (entry presentation.terminal))';
  const model = parse(lisp, 'lisp');
  assert.deepEqual(parse(encode(model), 'js'), model);
  assert.deepEqual(model.allow, { presentation: ['reporting'] });
});

test('watch regenerates from edited source without overlapping writes',
  { timeout: 10000 }, async (context) => {
    const { root, parent } = await setup(context);
    const source = await original();
    const input = path.join(parent, 'input.js');
    await fs.writeFile(input, source);
    const child = spawn(process.execPath,
      [path.join(project, 'scaffold.js'), input, root, '--watch'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const waitFor = async (predicate) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (predicate()) return;
        await delay(30);
      }
      throw new Error(`Watch timed out: ${output}\n${errors}`);
    };
    try {
      await waitFor(() => output.includes('DONE'));
      await fs.writeFile(input, '({ layers:');
      await waitFor(() => errors.includes('Expected'));
      assert.equal(await contents(root, 'architecture.js'), source);
      await fs.writeFile(input, encode(addReporting(parse(source, 'js'))));
      await waitFor(() => output.includes('src/reporting/reportRenderer.js'));
      assert.equal(await exists(path.join(root,
        'src/reporting/reportRenderer.js')), true);
    } finally {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
  });

test('removing a referenced component warns and leaves the project intact',
  async (context) => {
    const { root } = await setup(context);
    const source = await original();
    await apply(root, source);
    const before = await contents(root, 'platform/catalog.generated.json');
    const model = parse(source, 'js');
    delete model.layers.domain.aggregate;
    await assert.rejects(apply(root, encode(model)), (error) => {
      assert.match(error.message, /Unknown reference/);
      assert.ok(error.warnings.some((item) =>
        item.code === 'COMPONENT_REMOVED' &&
        item.component === 'domain.aggregate'));
      return true;
    });
    const catalog = await contents(root, 'platform/catalog.generated.json');
    assert.equal(catalog, before);
    assert.equal(await contents(root, 'architecture.js'), source);
    assert.equal(await exists(path.join(root,
      'src/domain/orderAggregate.js')), true);
  });

test('factory signatures expose capability names', () => {
  const purchase = ({ order, catalog, orders }) => async (command) => command;
  assert.deepEqual(capabilityPorts(purchase), ['order', 'catalog', 'orders']);
  assert.deepEqual(capabilityPorts(() => ({ ready: true })), []);
  assert.deepEqual(
    capabilityPorts(async ({ checkout }) => checkout), ['checkout'],
  );
  assert.deepEqual(capabilityPorts(function aggregate() {}), []);
  assert.throws(() => capabilityPorts((capabilities) => capabilities),
    /Invalid capability signature/);
});

test('a new component can reuse a module with the same input roles',
  async (context) => {
    const { root } = await setup(context);
    const source = await original();
    await apply(root, source);
    const model = parse(source, 'js');
    model.layers.infrastructure.backup = { use: 'memoryCatalog.js' };
    const report = await apply(root, encode(model));
    assert.deepEqual(report.created, []);
    model.layers.infrastructure.backup.bind = { source: 'domain.aggregate' };
    await assert.rejects(apply(root, encode(model)), /Conflicting module/);
  });
