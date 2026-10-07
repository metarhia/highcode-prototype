'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { scaffold } = require('../highscript/scaffold.js');
const { parse } = require('../highscript/syntax.js');
const { format } = require('../highscript/format.js');
const { compile } = require('../highscript/wiring.js');
const { capabilityPorts } = require('../highscript/model.js');

const execute = promisify(execFile);

const QUOTE = String.fromCharCode(39);

const project = path.resolve(__dirname, '..');

const linkRuntime = async (root) => {
  const modules = path.join(root, 'node_modules');
  await fs.symlink(path.join(project, 'node_modules'), modules);
};

const encode = (model) => format(model, 'js');
const original = () => fs.readFile(path.join(project, 'project.js'), 'utf8');
const setup = async (context) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'ddd-scaffold-'));
  context.after(() => fs.rm(parent, { recursive: true, force: true }));
  return { parent, root: path.join(parent, 'project') };
};
const apply = (root, source) => scaffold({ source, root, syntax: 'js' });
const contents = (root, file) => fs.readFile(path.join(root, file), 'utf8');
const exists = async (file) => {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

test('scaffolding keeps every named capability', async (context) => {
  const { root } = await setup(context);
  const model = { presentation: { terminal: { run: {}, stop: {} } } };
  await apply(root, encode(model));
  const implementation = require(path.join(root, 'presentation/terminal.js'));
  assert.deepEqual(Object.keys(implementation), ['run', 'stop']);
  const cache = JSON.parse(await contents(root, 'architecture.cache.json'));
  assert.deepEqual(cache.js.catalog['presentation/terminal.js'].exports, {
    run: [],
    stop: [],
  });
});

test('standalone Markdown and synchronization', async (context) => {
  const { parent, root } = await setup(context);
  const markdown = path.join(parent, 'markdown');
  await execute(process.execPath, [
    path.join(project, 'scaffold.js'),
    '--init',
    markdown,
    'md',
  ]);
  const initialized = parse(await contents(markdown, 'project.md'), 'md');
  assert.deepEqual(initialized.presentation, { terminal: {} });
  await apply(root, await original());
  await linkRuntime(root);
  await execute(process.execPath, ['sync.js'], { cwd: root });
  const md = await contents(root, 'project.md');
  await fs.writeFile(
    path.join(root, 'project.md'),
    md.replace('orderAggregate', 'differentAggregate'),
  );
  await assert.rejects(
    execute(process.execPath, ['sync.js', '--check'], { cwd: root }),
    (error) => /differs from project.js/.test(error.stderr),
  );
  await execute(process.execPath, ['sync.js'], { cwd: root });
  await execute(process.execPath, ['sync.js', '--check'], { cwd: root });
});
const addSummary = (model) => {
  const application = {
    ...model.application,
    summary: { aggregate: 'domain.orderAggregate' },
  };
  return { ...model, application };
};

const BOOTSTRAP_FILES = [
  'package.json',
  'main.js',
  'scaffold.js',
  'highscript/scaffold.js',
  'architecture.cache.json',
  'domain/orderAggregate.js',
  'application/purchase.js',
];

const checkBootstrap = async (parent, syntax) => {
  const source = await fs.readFile(
    path.join(project, `project.${syntax}`),
    'utf8',
  );
  const root = path.join(parent, syntax);
  const report = await scaffold({ source, root, syntax });
  assert.equal(report.warnings.length, 0);
  for (const file of BOOTSTRAP_FILES) {
    assert.equal(await exists(path.join(root, file)), true, file);
  }
  const purchaseFile = 'application/purchase.js';
  const contract = path.join(root, `${purchaseFile}.contract.json`);
  assert.equal(await exists(contract), false);
  const purchase = await contents(root, purchaseFile);
  assert.match(
    purchase,
    /const placeOrder = \(\{ catalog, order, orders \}\) =>/,
  );
  assert.match(purchase, /module\.exports = \{ placeOrder \};/);
  assert.doesNotMatch(purchase, /@param|\/\*\*/);
  const stored = JSON.parse(await contents(root, 'architecture.cache.json'));
  const ports =
    stored[syntax].catalog['application/purchase.js'].exports.placeOrder;
  assert.deepEqual(ports, ['catalog', 'order', 'orders']);
  await linkRuntime(root);
  const second = await execute(
    process.execPath,
    ['scaffold.js', `project.${syntax}`, '--json'],
    { cwd: root },
  );
  assert.deepEqual(JSON.parse(second.stdout).created, []);
  await assert.rejects(
    execute(process.execPath, ['main.js', syntax, 'ORDER-001', 'book:1'], {
      cwd: root,
    }),
    (error) => /Not implemented/.test(error.stderr),
  );
};

// eslint-disable-next-line max-len
test('all syntaxes bootstrap projects without implementations', async (context) => {
  const { parent } = await setup(context);
  for (const syntax of ['js', 'lisp', 'md']) {
    await checkBootstrap(parent, syntax);
  }
});

// eslint-disable-next-line max-len
test('init starts from no architecture and creates empty DDD layers', async (context) => {
  const { root } = await setup(context);
  await execute(process.execPath, [
    path.join(project, 'scaffold.js'),
    '--init',
    root,
    'lisp',
  ]);
  assert.equal(await exists(path.join(root, 'project.lisp')), true);
  for (const layer of [
    'domain',
    'application',
    'infrastructure',
    'presentation',
  ]) {
    assert.equal((await fs.stat(path.join(root, layer))).isDirectory(), true);
  }
  await linkRuntime(root);
  const output = await execute(
    process.execPath,
    ['scaffold.js', 'project.lisp', '--json'],
    { cwd: root },
  );
  assert.deepEqual(JSON.parse(output.stdout).updated, []);
});

// eslint-disable-next-line max-len
test('repeated runs preserve filled code and package files', async (context) => {
  const { root } = await setup(context);
  const source = await original();
  await apply(root, source);
  const file = 'domain/orderAggregate.js';
  const code = [
    `${QUOTE}use strict${QUOTE};`,
    'const create = () => ({ ready: true });',
    'module.exports = { create };',
    '',
  ].join('\n');
  await fs.writeFile(path.join(root, file), code);
  const packageFile = path.join(root, 'package.json');
  await fs.writeFile(packageFile, '{"private":true,"custom":"keep"}');
  const before = await fs.stat(path.join(root, file));
  const report = await apply(root, source);
  assert.deepEqual(report.created, []);
  assert.deepEqual(report.updated, []);
  assert.equal(await contents(root, file), code);
  assert.equal(
    await fs.readFile(packageFile, 'utf8'),
    '{"private":true,"custom":"keep"}',
  );
  const after = await fs.stat(path.join(root, file));
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test('an unreachable component file is generated', async (context) => {
  const { root } = await setup(context);
  const source = await original();
  await apply(root, source);
  const model = addSummary(parse(source, 'js'));
  const report = await apply(root, encode(model));
  assert.ok(report.created.includes('application/summary.js'));
  assert.ok(
    report.warnings.some(
      (warning) =>
        warning.code === 'UNREACHABLE_COMPONENT' &&
        warning.component === 'application.summary',
    ),
  );
  const summaryFile = 'application/summary.js';
  const renderer = await contents(root, summaryFile);
  assert.match(renderer, /const summary = \(\{ aggregate \}\) =>/);
  assert.match(renderer, /module\.exports = \{ summary \};/);
  assert.doesNotMatch(renderer, /@param|\/\*\*/);
  assert.equal(
    await exists(path.join(root, `${summaryFile}.contract.json`)),
    false,
  );
  const catalog = JSON.parse(await contents(root, 'architecture.cache.json')).js
    .catalog;
  assert.doesNotThrow(() => compile(model, catalog));
});

// eslint-disable-next-line max-len
test('removal warns about component, layer and orphan code without deletion', async (context) => {
  const { root } = await setup(context);
  const source = await original();
  await apply(root, encode(addSummary(parse(source, 'js'))));
  const file = 'application/summary.js';
  const body = `() => async () => ${QUOTE}user implementation${QUOTE}`;
  const code = `module.exports = ${body};\n`;
  await fs.writeFile(path.join(root, file), code);
  const report = await apply(root, source);
  const codes = ['COMPONENT_REMOVED', 'MODULE_REMOVED'];
  for (const code of codes) {
    assert.ok(report.warnings.some((warning) => warning.code === code));
  }
  assert.equal(await contents(root, file), code);
  const again = await apply(root, source);
  assert.ok(again.warnings.some((item) => item.code === 'MODULE_REMOVED'));
});

// eslint-disable-next-line max-len
test('a new component creates its file and keeps existing modules', async (context) => {
  const { root } = await setup(context);
  const source = await original();
  await apply(root, source);
  const model = parse(source, 'js');
  model.infrastructure.remoteCatalog = {};
  const report = await apply(root, encode(model));
  const created = 'infrastructure/remoteCatalog.js';
  assert.ok(report.created.includes(created));
  assert.equal(await exists(path.join(root, 'application/products.js')), true);
});

// eslint-disable-next-line max-len
test('changed input roles warn without overwriting the existing factory', async (context) => {
  const { root } = await setup(context);
  const source = await original();
  await apply(root, source);
  const file = 'application/purchase.js';
  const old = await contents(root, file);
  const model = parse(source, 'js');
  const purchase = model.application.purchase.placeOrder;
  purchase.audit = 'domain.orderAggregate.create';
  const report = await apply(root, encode(model));
  assert.ok(report.warnings.some((item) => item.code === 'CONTRACT_CHANGED'));
  assert.equal(await contents(root, file), old);
  await fs.writeFile(
    path.join(root, file),
    old.replace(
      '({ catalog, order, orders })',
      '({ audit, catalog, order, orders })',
    ),
  );
  const updated = await apply(root, encode(model));
  assert.ok(!updated.warnings.some((item) => item.code === 'CONTRACT_CHANGED'));
  const catalog = JSON.parse(await contents(root, 'architecture.cache.json')).js
    .catalog;
  assert.doesNotThrow(() => compile(model, catalog));
});

// eslint-disable-next-line max-len
test('same filenames in different layers have separate physical modules', async (context) => {
  const { root } = await setup(context);
  const model = parse(await original(), 'js');
  model.domain = { ...model.domain, products: {} };
  await apply(root, encode(model));
  const catalog = JSON.parse(await contents(root, 'architecture.cache.json')).js
    .catalog;
  assert.ok(catalog['domain/products.js']);
  assert.ok(catalog['application/products.js']);
});

test('bad references and cycles create no project', async (context) => {
  const { root } = await setup(context);
  const model = parse(await original(), 'js');
  model.application.purchase.placeOrder.order = 'domain.absent';
  await assert.rejects(apply(root, encode(model)), /Unknown reference/);
  assert.equal(await exists(root), false);
  model.application.purchase.placeOrder.order = 'application.purchase';
  await assert.rejects(apply(root, encode(model)), /Dependency cycle/);
  assert.equal(await exists(root), false);
});

// eslint-disable-next-line max-len
test('external source does not overwrite separately edited architecture', async (context) => {
  const { root } = await setup(context);
  const source = await original();
  await apply(root, source);
  const target = path.join(root, 'project.js');
  const edited = `${source}\n`;
  await fs.writeFile(target, edited);
  const updated = encode(addSummary(parse(source, 'js')));
  await assert.rejects(apply(root, updated), /Architecture conflict/);
  assert.equal(await fs.readFile(target, 'utf8'), edited);
});

// eslint-disable-next-line max-len
test('concurrent writers and symlink directories are rejected', async (context) => {
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
  await fs.symlink(outside, path.join(root, 'application'));
  await assert.rejects(apply(root, source), /Expected directory/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('Lisp and Markdown normalize to the same layers', () => {
  const lisp = '(layer presentation\n  (terminal))\n(layer domain)\n';
  const md = '- presentation\n  - terminal\n- domain\n';
  const model = parse(lisp, 'lisp');
  assert.deepEqual(parse(encode(model), 'js'), model);
  assert.deepEqual(parse(md, 'md'), model);
  assert.deepEqual(Object.keys(model).sort(), ['domain', 'presentation']);
});

// eslint-disable-next-line max-len
test('removing a referenced component warns and leaves the project intact', async (context) => {
  const { root } = await setup(context);
  const source = await original();
  await apply(root, source);
  const before = await contents(root, 'architecture.cache.json');
  const model = parse(source, 'js');
  delete model.domain.orderAggregate;
  await assert.rejects(apply(root, encode(model)), (error) => {
    assert.match(error.message, /Unknown reference/);
    assert.ok(
      error.warnings.some(
        (item) =>
          item.code === 'COMPONENT_REMOVED' &&
          item.component === 'domain.orderAggregate',
      ),
    );
    return true;
  });
  const catalog = await contents(root, 'architecture.cache.json');
  assert.equal(catalog, before);
  assert.equal(await contents(root, 'project.js'), source);
  assert.equal(await exists(path.join(root, 'domain/orderAggregate.js')), true);
});

test('factory signatures expose capability names', () => {
  const purchase = ({ order, catalog, orders }) => {
    const place = async (command) => {
      const ready = command && order && catalog && orders;
      return ready;
    };
    return place;
  };
  assert.deepEqual(capabilityPorts(purchase), ['order', 'catalog', 'orders']);
  assert.deepEqual(
    capabilityPorts(() => ({ ready: true })),
    [],
  );
  assert.deepEqual(
    capabilityPorts(async ({ checkout }) => checkout),
    ['checkout'],
  );
  assert.deepEqual(
    capabilityPorts(() => {}),
    [],
  );
  assert.throws(
    () => capabilityPorts((capabilities) => capabilities),
    /Invalid capability signature/,
  );
});

// eslint-disable-next-line max-len
test('the same component name in another layer is a separate module', async (context) => {
  const { root } = await setup(context);
  const source = await original();
  await apply(root, source);
  const model = parse(source, 'js');
  model.domain = {
    ...model.domain,
    products: { source: 'domain.orderAggregate' },
  };
  const report = await apply(root, encode(model));
  assert.ok(report.created.includes('domain/products.js'));
  assert.equal(await exists(path.join(root, 'application/products.js')), true);
});
