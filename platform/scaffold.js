'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const { parse } = require('./syntax.js');
const { inspect, capabilityPorts } = require('./model.js');
const { compile } = require('./wiring.js');

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const roles = (value) => JSON.stringify(Object.keys(value).sort());
const listed = (names) => JSON.stringify([...names].sort());

const stat = async (file) => {
  try { return await fs.lstat(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

const read = async (file) => {
  const info = await stat(file);
  if (!info) return null;
  if (!info.isFile()) throw new Error(`Expected regular file: ${file}`);
  return fs.readFile(file, 'utf8');
};

const directory = async (root, relative, report) => {
  let current = root;
  for (const segment of relative.split('/').filter(Boolean)) {
    current = path.join(current, segment);
    const info = await stat(current);
    if (info && !info.isDirectory()) {
      throw new Error(`Expected directory: ${current}`);
    }
    if (!info) {
      await fs.mkdir(current);
      report.created.push(`${path.relative(root, current)}/`);
    }
  }
};

const create = async (root, relative, content, report) => {
  await directory(root, path.dirname(relative), report);
  const target = path.join(root, relative);
  if (await read(target) !== null) {
    report.preserved.push(relative);
    return;
  }
  await fs.writeFile(target, content, { flag: 'wx' });
  report.created.push(relative);
};

const generated = async (root, relative, content, report) => {
  await directory(root, path.dirname(relative), report);
  const target = path.join(root, relative);
  const previous = await read(target);
  if (previous === content) return;
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  (previous === null ? report.created : report.updated).push(relative);
};

const template = (node) => {
  const names = Object.keys(node.bindings).sort();
  const parameters = names.length === 0 ? '()' : `({ ${names.join(', ')} })`;
  const factory = node.use.slice(0, -'.js'.length);
  return [
    "'use strict';", '',
    `const ${factory} = ${parameters} => {`,
    '  const execute = async (input) => {',
    `    throw new Error('Not implemented: ${node.implementation}');`,
    '  };', '  return execute;', '};', '',
    `module.exports = ${factory};`, '',
  ].join('\n');
};

const loadPorts = (file) => {
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  return capabilityPorts(require(resolved));
};

const starter = (syntax) => syntax === 'lisp' ? [
  '(architecture', '  (layer domain)', '  (layer infrastructure)',
  '  (layer application)', '  (layer presentation',
  '    (component terminal "commandLine.js"))',
  '  (entry presentation.terminal))', '',
].join('\n') : [
  '({', '  layers: {', '    domain: {},', '    infrastructure: {},',
  '    application: {},', '    presentation: {',
  "      terminal: { use: 'commandLine.js' },", '    },', '  },',
  "  entry: 'presentation.terminal',", '});', '',
].join('\n');

const scanOrphans = async (root, layers, modules, warnings) => {
  const source = path.join(root, 'src');
  const info = await stat(source);
  if (!info) return;
  if (!info.isDirectory()) throw new Error('Expected src directory');
  for (const layer of await fs.readdir(source, { withFileTypes: true })) {
    if (!layer.isDirectory()) continue;
    if (!layers.includes(layer.name)) {
      warnings.push({ code: 'LAYER_REMOVED', path: `src/${layer.name}` });
    }
    const folder = path.join(source, layer.name);
    for (const file of await fs.readdir(folder, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.js')) continue;
      const implementation = `${layer.name}/${file.name}`;
      if (!modules.has(implementation)) {
        warnings.push({
          code: 'MODULE_REMOVED', path: `src/${implementation}`,
        });
      }
    }
  }
};

const scaffold = async ({ source, syntax, root: destination }) => {
  const root = path.resolve(destination);
  const model = parse(source, syntax);
  const description = inspect(model);
  const modules = new Map();
  for (const node of description.nodes) {
    const existing = modules.get(node.implementation);
    if (existing && roles(existing.bindings) !== roles(node.bindings)) {
      throw new Error(`Conflicting module contracts: ${node.implementation}`);
    }
    modules.set(node.implementation, node);
  }
  const declarations = Object.fromEntries(description.nodes.map((node) => [
    node.implementation, {
      layer: node.layer, ports: Object.keys(node.bindings),
    },
  ]));
  let graph;
  try {
    graph = compile(model, declarations);
  } catch (error) {
    const stored = await read(path.join(root, 'platform/scaffold-state.json'));
    const previous = stored === null ? null : JSON.parse(stored);
    const current = new Set(description.nodes.map((node) => node.id));
    const warnings = Object.keys(previous?.components ?? {})
      .filter((id) => !current.has(id))
      .map((component) => ({ code: 'COMPONENT_REMOVED', component }));
    await scanOrphans(root, description.layers, modules, warnings);
    error.warnings = warnings;
    throw error;
  }
  const report = { created: [], updated: [], preserved: [], warnings: [] };
  const info = await stat(root);
  if (info && !info.isDirectory()) throw new Error('Invalid project directory');
  await fs.mkdir(root, { recursive: true });
  const lockPath = path.join(root, '.scaffold.lock');
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Scaffolding already running');
    throw error;
  }
  try {
    await directory(root, 'platform', report);
    await directory(root, 'src', report);
    const statePath = 'platform/scaffold-state.json';
    const stateText = await read(path.join(root, statePath));
    const previous = stateText === null ? null : JSON.parse(stateText);
    if (previous && (previous.version !== 1 ||
        typeof previous.components !== 'object' || !previous.components)) {
      throw new Error('Invalid scaffold state');
    }
    const architecture = `architecture.${syntax}`;
    const currentSource = await read(path.join(root, architecture));
    if (currentSource !== null && currentSource !== source &&
        (previous?.architecture?.path !== architecture ||
         previous.architecture.hash !== hash(currentSource))) {
      throw new Error(`Architecture conflict: ${architecture}`);
    }
    const ports = new Map();
    for (const [implementation, node] of modules) {
      const relative = `src/${implementation}`;
      const stored = await read(path.join(root, relative));
      let declared;
      try {
        declared = stored === null
          ? Object.keys(node.bindings).sort()
          : loadPorts(path.join(root, relative));
      } catch (error) {
        throw new Error(`${relative}: ${error.message}`);
      }
      ports.set(implementation, declared);
      if (listed(declared) !== listed(Object.keys(node.bindings))) {
        report.warnings.push({
          code: 'CONTRACT_CHANGED', path: relative,
          expected: Object.keys(node.bindings).sort(),
          actual: [...declared].sort(),
        });
      }
    }
    const components = Object.fromEntries(description.nodes.map((node) =>
      [node.id, node.implementation]));
    for (const id of Object.keys(previous?.components ?? {})) {
      if (!Object.hasOwn(components, id)) {
        report.warnings.push({ code: 'COMPONENT_REMOVED', component: id });
      }
    }
    for (const component of graph.unreachable) {
      report.warnings.push({ code: 'UNREACHABLE_COMPONENT', component });
    }
    await scanOrphans(root, description.layers, modules, report.warnings);
    for (const layer of description.layers) {
      await directory(root, `src/${layer}`, report);
    }
    const catalog = {};
    for (const [implementation, node] of modules) {
      await create(root, `src/${implementation}`, template(node), report);
      Object.defineProperty(catalog, implementation, {
        value: {
          layer: node.layer,
          ports: [...ports.get(implementation)].sort(),
        },
        enumerable: true,
      });
    }
    const tooling = path.resolve(__dirname, '..');
    const files = [
      'main.js', 'scaffold.js', 'platform/start.js',
      'platform/syntax.js', 'platform/model.js', 'platform/wiring.js',
      'platform/scaffold.js', 'platform/catalog.js',
    ];
    for (const file of files) {
      const content = await fs.readFile(path.join(tooling, file), 'utf8');
      await create(root, file, content, report);
    }
    await create(root, 'package.json', json({
      name: 'architecture-project', version: '1.0.0', private: true,
      scripts: {
        start: `node main.js ${syntax}`,
        scaffold: `node scaffold.js architecture.${syntax}`,
        watch: `node scaffold.js architecture.${syntax} --watch`,
      },
    }), report);
    await create(root, 'README.md', [
      '# Generated project', '',
      `Edit architecture.${syntax}, then run npm run scaffold.`,
      'Use npm run watch to scaffold after architecture changes.',
      'Implement the factories in src.',
      'Capability names come from the factory signature.',
      'Templates throw Not implemented until you fill them in.',
      'Existing implementation files are preserved.',
      'Review WARN messages before running npm start.', '',
    ].join('\n'), report);
    await generated(root, architecture, source, report);
    await generated(root, 'platform/catalog.generated.json',
      json(catalog), report);
    await generated(root, statePath, json({
      version: 1, components,
      architecture: { path: architecture, hash: hash(source) },
    }), report);
    return report;
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
};

module.exports = { scaffold, starter };
