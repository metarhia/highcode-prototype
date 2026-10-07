'use strict';

const { isHashObject } = require('metautil');

const TOKEN_PATTERN =
  /\s+|'[^'\\\r\n]*'|"[^"\\\r\n]*"|[A-Za-z][A-Za-z0-9.]*|[(){}[\]:,;]/y;
const WHITESPACE_PATTERN = /^\s+$/;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;
const QUOTED_PATTERN = /^('[^']*'|"[^"]*")$/;
const SYMBOL_PATTERN = /^[A-Za-z][A-Za-z0-9.]*$/;
const LIST_PATTERN = /^( *)- (.*)$/;
const LITERALS = { true: true, false: false, null: null };

const createRecord = (pairs) => {
  const names = pairs.map((pair) => pair[0]);
  if (new Set(names).size !== names.length) {
    throw new Error('Duplicate declaration');
  }
  return Object.fromEntries(pairs);
};

const reader = (source) => {
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    TOKEN_PATTERN.lastIndex = offset;
    const match = TOKEN_PATTERN.exec(source);
    if (!match) throw new Error(`Unexpected character at ${offset}`);
    offset = TOKEN_PATTERN.lastIndex;
    if (!WHITESPACE_PATTERN.test(match[0])) tokens.push(match[0]);
  }
  let position = 0;
  const peek = () => tokens[position];
  const take = (expected) => {
    const token = tokens[position++];
    if (token === undefined || (expected && token !== expected)) {
      throw new Error(`Expected ${expected ?? 'token'}, got ${token}`);
    }
    return token;
  };
  const end = () => {
    if (peek() !== undefined) throw new Error('Unexpected trailing tokens');
  };
  return { peek, take, end };
};

const parseObject = (input, read) => {
  input.take('{');
  const output = {};
  while (input.peek() !== '}') {
    const key = input.take();
    if (!KEY_PATTERN.test(key)) throw new Error('Expected object key');
    if (Object.hasOwn(output, key)) throw new Error('Duplicate declaration');
    input.take(':');
    output[key] = read(input);
    if (input.peek() === ',') input.take(',');
  }
  input.take('}');
  return output;
};

const parseArray = (input, read) => {
  input.take('[');
  const items = [];
  while (input.peek() !== ']') {
    items.push(read(input));
    if (input.peek() === ',') input.take(',');
  }
  input.take(']');
  return items;
};

const parseCall = (input, token, read) => {
  input.take('(');
  const args = [];
  while (input.peek() !== ')') {
    args.push(read(input));
    if (input.peek() === ',') input.take(',');
  }
  input.take(')');
  const isSubscription = token.endsWith('.on') && args.length === 2;
  if (!isSubscription) throw new Error('Unexpected call');
  const source = token.slice(0, -'.on'.length);
  const event = args[0];
  const handler = args[1];
  return { subscribe: { source, event, handler } };
};

const parseValue = (input) => {
  const token = input.peek();
  if (token === '{') return parseObject(input, parseValue);
  if (token === '[') return parseArray(input, parseValue);
  if (QUOTED_PATTERN.test(token ?? '')) {
    input.take();
    return { literal: token.slice(1, -1) };
  }
  if (!SYMBOL_PATTERN.test(token ?? '')) throw new Error('Expected symbol');
  input.take();
  if (input.peek() === '(') return parseCall(input, token, parseValue);
  if (Object.hasOwn(LITERALS, token)) return LITERALS[token];
  return token;
};

const javascript = (source) => {
  const input = reader(source);
  input.take('(');
  const model = parseValue(input);
  input.take(')');
  input.take(';');
  input.end();
  if (!isHashObject(model)) throw new Error('Expected architecture');
  return model;
};

const bindingRecord = (pairs) => {
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error('Expected binding');
    }
  }
  return createRecord(pairs);
};

const asHandlers = (value) => {
  if (typeof value === 'string' || !Array.isArray(value)) return value;
  const pairs = Array.isArray(value[0]) ? value : [value];
  return bindingRecord(pairs);
};

const subscriptionForm = (binding) => {
  const isList = Array.isArray(binding) && binding.length === 3;
  const method = isList ? binding[0] : '';
  const isCall = typeof method === 'string' && method.endsWith('.on');
  if (!isCall) return null;
  const channel = method.slice(0, -'.on'.length);
  const event = binding[1];
  const handler = asHandlers(binding[2]);
  return { subscribe: { source: channel, event, handler } };
};

const pipeSteps = (bindings) => {
  const steps = [];
  for (const binding of bindings) {
    if (typeof binding === 'string') {
      steps.push(binding);
      continue;
    }
    const step = subscriptionForm(binding);
    if (step) {
      steps.push(step);
      continue;
    }
    if (!Array.isArray(binding)) throw new Error('Expected binding');
    const pairs = Array.isArray(binding[0]) ? binding : [binding];
    steps.push(bindingRecord(pairs));
  }
  return steps;
};

const exportFields = (bindings) => {
  const fields = [];
  for (const binding of bindings) {
    if (!Array.isArray(binding)) throw new Error('Expected export');
    const exportName = binding[0];
    const ports = [];
    for (const port of binding.slice(1)) {
      if (!Array.isArray(port) || port.length !== 2) {
        throw new Error('Expected binding');
      }
      ports.push([port[0], port[1]]);
    }
    fields.push([exportName, createRecord(ports)]);
  }
  return createRecord(fields);
};

const componentBinding = (component) => {
  if (!Array.isArray(component)) throw new Error('Expected component');
  const id = component[0];
  const bindings = component.slice(1);
  if (bindings.length === 0) return [id, {}];
  const subscribed = subscriptionForm(bindings[0]);
  if (bindings.length === 1 && subscribed) return [id, subscribed];
  const first = bindings[0];
  const isPipe = typeof first === 'string' || subscriptionForm(first) !== null;
  if (isPipe) return [id, pipeSteps(bindings)];
  return [id, exportFields(bindings)];
};

const lisp = (input) => {
  const expression = () => {
    if (input.peek() !== '(') {
      const symbol = input.take();
      if (QUOTED_PATTERN.test(symbol)) {
        return { literal: symbol.slice(1, -1) };
      }
      if (!SYMBOL_PATTERN.test(symbol)) {
        throw new Error('Expected symbol');
      }
      return symbol;
    }
    input.take('(');
    const items = [];
    while (input.peek() !== ')') items.push(expression());
    input.take(')');
    return items;
  };
  const forms = [];
  while (input.peek() !== undefined) forms.push(expression());
  const layers = [];
  for (const form of forms) {
    if (!Array.isArray(form)) throw new Error('Expected form');
    const operator = form[0];
    const rest = form.slice(1);
    if (operator !== 'layer') throw new Error('Expected layer');
    const name = rest[0];
    const components = rest.slice(1);
    const pairs = components.map(componentBinding);
    layers.push([name, createRecord(pairs)]);
  }
  return createRecord(layers);
};

const tokenValue = (token) => {
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    return { literal: token.slice(1, -1) };
  }
  return token;
};

const listRows = (source) =>
  source.split('\n').flatMap((line) => {
    if (line.trim() === '') return [];
    const matched = LIST_PATTERN.exec(line);
    const isEven = matched && matched[1].length % 2 === 0;
    if (!isEven) throw new Error('Expected list item');
    const depth = matched[1].length / 2;
    const text = matched[2].trim();
    return [{ depth, text }];
  });

const wordsOf = (text) => text.split(/\s+/);

const readPairs = (cursor, depth, required) => {
  const fields = {};
  while (cursor.rows[cursor.index]?.depth === depth) {
    const field = wordsOf(cursor.rows[cursor.index].text);
    if (field.length !== 2) {
      if (required) throw new Error('Expected binding');
      break;
    }
    if (Object.hasOwn(fields, field[0])) {
      throw new Error('Duplicate declaration');
    }
    fields[field[0]] = tokenValue(field[1]);
    cursor.index += 1;
  }
  return fields;
};

const readSubscription = (cursor) => {
  const row = cursor.rows[cursor.index];
  const opened = wordsOf(row?.text ?? '')[0] ?? '';
  const isCall = row?.depth === 2 && opened.endsWith('.on');
  if (!isCall) return null;
  const field = wordsOf(row.text);
  if (field.length !== 2 || !field[0].endsWith('.on')) {
    throw new Error('Expected subscription');
  }
  cursor.index += 1;
  const handler = readPairs(cursor, 3, true);
  const source = field[0].slice(0, -'.on'.length);
  const event = tokenValue(field[1]);
  return { subscribe: { source, event, handler } };
};

const readPipe = (cursor) => {
  const row = cursor.rows[cursor.index];
  const isStep = row?.depth === 2 && !row.text.includes(' ');
  if (!isStep || !row.text.includes('.')) return null;
  const steps = [];
  while (cursor.rows[cursor.index]?.depth === 2) {
    const parts = wordsOf(cursor.rows[cursor.index].text);
    if (parts.length === 1) {
      steps.push(tokenValue(parts[0]));
      cursor.index += 1;
      continue;
    }
    steps.push(readPairs(cursor, 2, false));
  }
  return steps;
};

const readBindings = (cursor) => {
  const bindings = {};
  while (cursor.rows[cursor.index]?.depth === 2) {
    const parts = wordsOf(cursor.rows[cursor.index].text);
    if (Object.hasOwn(bindings, parts[0])) {
      throw new Error('Duplicate declaration');
    }
    if (parts.length === 1) {
      const role = parts[0];
      cursor.index += 1;
      bindings[role] = readPairs(cursor, 3, true);
      continue;
    }
    if (parts.length !== 2) throw new Error('Expected binding');
    bindings[parts[0]] = tokenValue(parts[1]);
    cursor.index += 1;
  }
  return bindings;
};

const readComponent = (cursor) => {
  const subscribed = readSubscription(cursor);
  if (subscribed) return subscribed;
  const steps = readPipe(cursor);
  if (steps) return steps;
  return readBindings(cursor);
};

const markdown = (source) => {
  const cursor = { rows: listRows(source), index: 0 };
  const model = {};
  while (cursor.index < cursor.rows.length) {
    const row = cursor.rows[cursor.index];
    if (row.depth !== 0) throw new Error('Expected architecture item');
    const layer = row.text;
    if (!KEY_PATTERN.test(layer)) throw new Error('Invalid layer');
    if (Object.hasOwn(model, layer)) throw new Error('Duplicate declaration');
    cursor.index += 1;
    const components = {};
    while (cursor.rows[cursor.index]?.depth === 1) {
      const name = cursor.rows[cursor.index].text;
      if (!KEY_PATTERN.test(name)) throw new Error('Invalid component name');
      if (Object.hasOwn(components, name)) {
        throw new Error('Duplicate declaration');
      }
      cursor.index += 1;
      components[name] = readComponent(cursor);
    }
    model[layer] = components;
  }
  return model;
};

const parsers = {
  md: markdown,
  js: javascript,
  lisp: (source) => {
    const input = reader(source);
    const model = lisp(input);
    input.end();
    return model;
  },
};

const parse = (source, syntax) => {
  const parser = parsers[syntax];
  if (!parser) throw new Error('Unknown syntax');
  return parser(source);
};

module.exports = { parse };
