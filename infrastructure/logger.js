'use strict';

const { appendFile } = require('node:fs/promises');

const LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
// Kept on the console so a reload still writes through the originals.
const NATIVE = Symbol.for('highcode.logger.native');

const methods = {};

const render = (value) => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value === null || value === undefined) return '';
  const text = JSON.stringify(value);
  if (text === undefined) return `${value}`;
  return text;
};

const nativeOf = (host) => {
  const stored = host[NATIVE];
  if (stored) return stored;
  const native = {};
  for (const level of LEVELS) native[level] = host[level];
  const saved = Object.freeze(native);
  Object.defineProperty(host, NATIVE, { value: saved });
  return saved;
};

const open = ({ fileName }) => {
  const isValidFile = typeof fileName === 'string' && fileName.length > 0;
  if (!isValidFile) throw new Error('Expected log file');
  const host = globalThis.console;
  const native = nativeOf(host);
  const emit = async (level, values) => {
    const timestamp = new Date().toISOString();
    const text = values.map(render).join(' ');
    const line = `${timestamp} ${level} ${text}`;
    const write = native[level];
    write.call(host, line);
    try {
      await appendFile(fileName, `${line}\n`);
    } catch (error) {
      const failure = new Error(`Log file is not writable: ${fileName}`, {
        cause: error,
      });
      native.error.call(host, failure.message);
    }
  };
  for (const level of LEVELS) {
    methods[level] = (...values) => emit(level, values);
    host[level] = methods[level];
  }
  for (const name of Object.keys(host)) {
    if (methods[name]) continue;
    const method = host[name];
    if (typeof method !== 'function') continue;
    methods[name] = (...values) => method.apply(host, values);
  }
  return methods;
};

module.exports = { open };
