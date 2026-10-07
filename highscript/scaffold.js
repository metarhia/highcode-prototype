'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');

const { generateUUID, isHashObject } = require('metautil');

const { parse } = require('./syntax.js');
const {
  LAYERS,
  inspect,
  capabilities,
  capabilityPorts,
} = require('./model.js');
const { compile, loadFactory, contractOf } = require('./wiring.js');
const { format } = require('./format.js');

const CACHE_FILE = 'architecture.cache.json';
const TOOLING_FILES = [
  'main.js',
  'scaffold.js',
  'sync.js',
  'highscript/start.js',
  'highscript/syntax.js',
  'highscript/model.js',
  'highscript/wiring.js',
  'highscript/channel.js',
  'highscript/format.js',
  'highscript/scaffold.js',
  'highscript/generated-readme.md',
];

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const listed = (names) => JSON.stringify([...names].sort());

const stat = async (file) => {
  try {
    return await fs.lstat(file);
  } catch (error) {
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

const ensureDirectory = async (root, relative, report) => {
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
  await ensureDirectory(root, path.dirname(relative), report);
  const target = path.join(root, relative);
  const existing = await read(target);
  if (existing !== null) {
    report.preserved.push(relative);
    return;
  }
  await fs.writeFile(target, content, { flag: 'wx' });
  report.created.push(relative);
};

const writeGenerated = async (root, relative, content, report) => {
  await ensureDirectory(root, path.dirname(relative), report);
  const target = path.join(root, relative);
  const previous = await read(target);
  if (previous === content) return;
  const temporary = `${target}.${generateUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  if (previous === null) report.created.push(relative);
  else report.updated.push(relative);
};

const renderTemplate = (node) => {
  const factories = capabilities(node).map(([name, bindings]) => {
    const roles = Object.keys(bindings).sort();
    const parameters = roles.length ? `({ ${roles.join(', ')} })` : '()';
    const factory = name ?? node.name;
    const message = `Not implemented: ${node.implementation}#${factory}`;
    const source = `const ${factory} = ${parameters} => {
  throw new Error('${message}');
};`;
    return { name: factory, source };
  });
  const body = factories.map((factory) => factory.source).join('\n\n');
  const names = factories.map((factory) => factory.name).join(', ');
  return `'use strict';\n\n${body}\n\nmodule.exports = { ${names} };\n`;
};

const starter = (syntax) => {
  const model = Object.fromEntries(LAYERS.map((layer) => [layer, {}]));
  return format({ ...model, presentation: { terminal: {} } }, syntax);
};

const scanOrphans = async (root, layers, modules, warnings) => {
  for (const layer of LAYERS) {
    const folder = path.join(root, layer);
    const info = await stat(folder);
    if (!info) continue;
    if (!info.isDirectory()) throw new Error(`Expected directory: ${folder}`);
    if (!layers.includes(layer)) {
      warnings.push({ code: 'LAYER_REMOVED', path: `${layer}/` });
    }
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const file of entries) {
      if (!file.isFile() || !file.name.endsWith('.js')) continue;
      const implementation = `${layer}/${file.name}`;
      if (!modules.has(implementation)) {
        warnings.push({ code: 'MODULE_REMOVED', path: implementation });
      }
    }
  }
};

const loadCache = async (root) => {
  const stored = await read(path.join(root, CACHE_FILE));
  if (stored === null) return {};
  const cache = JSON.parse(stored);
  if (!isHashObject(cache)) throw new Error('Invalid scaffold state');
  return cache;
};

const moduleIndex = ({ nodes }) =>
  new Map(
    nodes
      .filter((node) => node.implementation)
      .map((node) => [node.implementation, node]),
  );

const declarationsOf = (description) => {
  const declared = [];
  for (const node of description.nodes) {
    if (!node.implementation) continue;
    const ports = capabilities(node).map(([name, bindings]) => [
      name,
      Object.keys(bindings),
    ]);
    declared.push([node.implementation, contractOf(node, ports)]);
  }
  return Object.fromEntries(declared);
};

const removalWarnings = async (root, syntax, description, modules) => {
  const cache = await loadCache(root);
  const previous = Object.hasOwn(cache, syntax) ? cache[syntax] : null;
  const current = new Set(description.nodes.map((node) => node.id));
  const stored = Object.keys(previous?.components ?? {});
  const warnings = stored
    .filter((id) => !current.has(id))
    .map((component) => ({ code: 'COMPONENT_REMOVED', component }));
  await scanOrphans(root, description.layers, modules, warnings);
  return warnings;
};

const compileModel = async (root, syntax, model, description, modules) => {
  try {
    return compile(model, declarationsOf(description));
  } catch (error) {
    error.warnings = await removalWarnings(root, syntax, description, modules);
    throw error;
  }
};

const prepareRoot = async (root) => {
  const info = await stat(root);
  if (info && !info.isDirectory()) throw new Error('Invalid project directory');
  await fs.mkdir(root, { recursive: true });
};

const openLock = async (lockPath) => {
  try {
    return await fs.open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Scaffolding already running');
    throw error;
  }
};

const previousState = (cache, syntax) => {
  const previous = Object.hasOwn(cache, syntax) ? cache[syntax] : null;
  const storedComponents = previous && previous.components;
  const validVersion = previous && [1, 2].includes(previous.version);
  const validComponents = isHashObject(storedComponents);
  if (previous && (!validVersion || !validComponents)) {
    throw new Error('Invalid scaffold state');
  }
  return previous;
};

const assertSource = async (root, syntax, source, previous) => {
  const sourceName = `project.${syntax}`;
  const currentSource = await read(path.join(root, sourceName));
  const recorded = previous && previous.architecture;
  const samePath = recorded && recorded.path === sourceName;
  const sameHash = samePath && recorded.hash === hash(currentSource);
  const different = currentSource !== null && currentSource !== source;
  if (different && !sameHash) {
    throw new Error(`Architecture conflict: ${sourceName}`);
  }
  return sourceName;
};

const measuredPorts = async (root, node) => {
  const implementation = node.implementation;
  const stored = await read(path.join(root, implementation));
  try {
    return capabilities(node).map(([name, bindings], index) => {
      const declared =
        stored === null
          ? Object.keys(bindings)
          : capabilityPorts(
              loadFactory(path.join(root, implementation), name, index === 0),
            );
      return [name, declared.sort()];
    });
  } catch (error) {
    throw new Error(`${implementation}: ${error.message}`, { cause: error });
  }
};

const collectPorts = async (root, modules, report) => {
  const ports = new Map();
  for (const [implementation, node] of modules) {
    const declared = await measuredPorts(root, node);
    ports.set(implementation, contractOf(node, declared));
    for (const [name, actual] of declared) {
      const bindings = name === undefined ? node.bindings : node.exports[name];
      const expected = Object.keys(bindings).sort();
      if (listed(actual) === listed(expected)) continue;
      report.warnings.push({
        code: 'CONTRACT_CHANGED',
        path: implementation,
        capability: name,
        expected,
        actual,
      });
    }
  }
  return ports;
};

const componentIndex = (description) => {
  const listedComponents = [];
  for (const node of description.nodes) {
    if (!node.implementation) continue;
    listedComponents.push([node.id, node.implementation]);
  }
  return Object.fromEntries(listedComponents);
};

const warnRemoved = (previous, components, report) => {
  for (const id of Object.keys(previous?.components ?? {})) {
    if (Object.hasOwn(components, id)) continue;
    report.warnings.push({ code: 'COMPONENT_REMOVED', component: id });
  }
};

const writeModules = async (root, modules, ports, report) => {
  const catalog = {};
  for (const [implementation, node] of modules) {
    await create(root, implementation, renderTemplate(node), report);
    catalog[implementation] = ports.get(implementation);
  }
  return catalog;
};

const copyTooling = async (root, report) => {
  const tooling = path.resolve(__dirname, '..');
  for (const file of TOOLING_FILES) {
    const content = await fs.readFile(path.join(tooling, file), 'utf8');
    await create(root, file, content, report);
  }
};

const writeManifests = async (root, syntax, report) => {
  const syncScripts =
    syntax === 'js'
      ? { sync: 'node sync.js', 'sync:check': 'node sync.js --check' }
      : {};
  const packageJson = json({
    name: 'architecture-project',
    version: '1.0.0',
    private: true,
    scripts: {
      start: `node main.js ${syntax}`,
      'start:http': `node main.js ${syntax} --http`,
      scaffold: `node scaffold.js project.${syntax}`,
      ...syncScripts,
    },
    dependencies: {
      metautil: '^5.5.2',
    },
  });
  await create(root, 'package.json', packageJson, report);
  const readmePath = path.join(__dirname, 'generated-readme.md');
  const readme = await fs.readFile(readmePath, 'utf8');
  const projectReadme = readme.replaceAll('{{syntax}}', syntax);
  await create(root, 'README.md', projectReadme, report);
};

const writeScaffold = async (job) => {
  const { root, syntax, source, description, modules, graph, report } = job;
  await ensureDirectory(root, 'highscript', report);
  const cache = await loadCache(root);
  const previous = previousState(cache, syntax);
  const sourceName = await assertSource(root, syntax, source, previous);
  const ports = await collectPorts(root, modules, report);
  const components = componentIndex(description);
  warnRemoved(previous, components, report);
  for (const component of graph.unreachable) {
    report.warnings.push({ code: 'UNREACHABLE_COMPONENT', component });
  }
  await scanOrphans(root, description.layers, modules, report.warnings);
  for (const layer of description.layers) {
    await ensureDirectory(root, layer, report);
  }
  const catalog = await writeModules(root, modules, ports, report);
  await copyTooling(root, report);
  await writeManifests(root, syntax, report);
  await writeGenerated(root, sourceName, source, report);
  cache[syntax] = {
    version: 2,
    components,
    catalog,
    architecture: { path: sourceName, hash: hash(source) },
  };
  await writeGenerated(root, CACHE_FILE, json(cache), report);
  return report;
};

const scaffold = async ({ source, syntax, root: destination }) => {
  const root = path.resolve(destination);
  const model = parse(source, syntax);
  const description = inspect(model);
  const modules = moduleIndex(description);
  const graph = await compileModel(root, syntax, model, description, modules);
  const report = { created: [], updated: [], preserved: [], warnings: [] };
  await prepareRoot(root);
  const lockPath = path.join(root, '.scaffold.lock');
  const lock = await openLock(lockPath);
  try {
    const job = { root, syntax, source, description, modules, graph, report };
    return await writeScaffold(job);
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
};

module.exports = { scaffold, starter };
