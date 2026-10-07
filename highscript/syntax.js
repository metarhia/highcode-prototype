'use strict';

const { isHashObject } = require('metautil');
const { isLiteral } = require('./model.js');

const TOKEN = [
  /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//,
  /'(?:[^'\\\r\n]|\\.)*'|"(?:[^"\\\r\n]|\\.)*"/,
  /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
  /[A-Za-z][A-Za-z0-9.]*|[(){}[\]:,;]/,
];
const KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const SYMBOL = /^[A-Za-z][A-Za-z0-9.]*$/;
const NUMBER = /^-?\d/;
const LITERALS = { true: true, false: false, null: null };
const SYNTAXES = ['js', 'lisp', 'md'];
const QUOTE = String.fromCharCode(39);

const record = (pairs) => {
  const names = pairs.map(([name]) => name);
  if (!names.every((name) => typeof name === 'string' && KEY.test(name))) {
    throw new Error('Expected declaration name');
  }
  if (new Set(names).size !== names.length) {
    throw new Error('Duplicate declaration');
  }
  return Object.fromEntries(pairs);
};

const reader = (source) => {
  const pattern = new RegExp(TOKEN.map((part) => part.source).join('|'), 'y');
  const tokens = [];
  while (pattern.lastIndex < source.length) {
    const offset = pattern.lastIndex;
    const matched = pattern.exec(source);
    if (!matched) throw new Error(`Unexpected character at ${offset}`);
    const token = matched[0];
    if (!/^(?:\s|\/\/|\/\*)/.test(token)) tokens.push(token);
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

const atom = (token) => {
  if (token.startsWith('"')) return { literal: JSON.parse(token) };
  if (token.startsWith(QUOTE)) {
    const inner = token.slice(1, -1).replace(/\\'|\\.|"/g, (part) => {
      if (part.endsWith(QUOTE)) return QUOTE;
      if (part === '"') return '\\"';
      return part;
    });
    return { literal: JSON.parse(`"${inner}"`) };
  }
  if (Object.hasOwn(LITERALS, token)) return LITERALS[token];
  if (NUMBER.test(token)) {
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    return value;
  }
  if (!SYMBOL.test(token)) throw new Error('Expected value');
  return token;
};

const delimited = (input, open, close, read) => {
  input.take(open);
  const values = [];
  while (input.peek() !== close) {
    values.push(read());
    if (input.peek() !== close) input.take(',');
  }
  input.take(close);
  return values;
};

const javascriptValue = (input) => {
  const token = input.peek();
  const read = () => javascriptValue(input);
  if (token === '{') {
    return record(
      delimited(input, '{', '}', () => {
        const name = input.take();
        input.take(':');
        return [name, read()];
      }),
    );
  }
  if (token === '[') return delimited(input, '[', ']', read);
  const value = atom(input.take());
  if (input.peek() !== '(') return value;
  const args = delimited(input, '(', ')', read);
  if (
    typeof value !== 'string' ||
    !value.endsWith('.on') ||
    args.length !== 2
  ) {
    throw new Error('Unexpected call');
  }
  return {
    subscribe: {
      source: value.slice(0, -3),
      event: args[0],
      handler: args[1],
    },
  };
};

const javascript = (source) => {
  const input = reader(source);
  input.take('(');
  const model = javascriptValue(input);
  input.take(')');
  input.take(';');
  input.end();
  return model;
};

const expression = (input) => {
  if (input.peek() !== '(') return atom(input.take());
  input.take('(');
  const items = [];
  while (input.peek() !== ')') items.push(expression(input));
  input.take(')');
  return items;
};

const valueOf = (value) => {
  if (!Array.isArray(value)) return value;
  const [kind, ...items] = value;
  if (kind === 'array') return items.map(valueOf);
  if (kind === 'object') {
    return record(
      items.map((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) {
          throw new Error('Expected binding');
        }
        return [pair[0], valueOf(pair[1])];
      }),
    );
  }
  throw new Error('Expected array or object value');
};

const bindings = (pairs) => valueOf(['object', ...pairs]);

const subscription = (form) => {
  if (
    !Array.isArray(form) ||
    typeof form[0] !== 'string' ||
    !form[0].endsWith('.on')
  ) {
    return null;
  }
  if (form.length !== 3) throw new Error('Expected subscription');
  const [method, event, target] = form;
  const handler = Array.isArray(target)
    ? bindings(Array.isArray(target[0]) ? target : [target])
    : target;
  return { subscribe: { source: method.slice(0, -3), event, handler } };
};

const pipeSteps = (forms) =>
  forms.map((form) => {
    const subscribed = subscription(form);
    if (subscribed) return subscribed;
    if (!Array.isArray(form)) return form;
    if (form[0] === 'object') return bindings(form.slice(1));
    return bindings(Array.isArray(form[0]) ? form : [form]);
  });

const component = (form) => {
  if (!Array.isArray(form)) throw new Error('Expected component');
  const [name, ...fields] = form;
  if (!fields.length) return [name, {}];
  const first = fields[0];
  const subscribed = subscription(first);
  if (fields.length === 1 && subscribed) return [name, subscribed];
  if (fields.length === 1 && Array.isArray(first) && first[0] === 'pipe') {
    return [name, pipeSteps(first.slice(1))];
  }
  if (typeof first === 'string' || subscribed) {
    return [name, pipeSteps(fields)];
  }
  const direct = fields.every(
    (field) =>
      Array.isArray(field) &&
      field.length === 2 &&
      (!Array.isArray(field[1]) || ['array', 'object'].includes(field[1][0])),
  );
  if (direct) return [name, bindings(fields)];
  return [
    name,
    record(
      fields.map((field) => {
        if (!Array.isArray(field)) throw new Error('Expected capability');
        const [capability, ...ports] = field;
        return [capability, bindings(ports)];
      }),
    ),
  ];
};

const architecture = (forms) =>
  record(
    forms.map((form) => {
      if (!Array.isArray(form) || form[0] !== 'layer') {
        throw new Error('Expected layer');
      }
      const [, name, ...components] = form;
      return [name, record(components.map(component))];
    }),
  );

const lisp = (source) => {
  const input = reader(source);
  const forms = [];
  while (input.peek() !== undefined) forms.push(expression(input));
  return architecture(forms);
};

const markdown = (source) => {
  const roots = [];
  const stack = [roots];
  for (const line of source.split('\n')) {
    if (!line.trim()) continue;
    const matched = /^( *)- (.+)$/.exec(line);
    if (!matched || matched[1].length % 2) {
      throw new Error('Expected list item');
    }
    const depth = matched[1].length / 2;
    if (depth >= stack.length) throw new Error('Invalid list indentation');
    const input = reader(matched[2]);
    const words = [];
    while (input.peek() !== undefined) words.push(expression(input));
    const node = { words, children: [] };
    stack[depth].push(node);
    stack.length = depth + 1;
    stack.push(node.children);
  }
  const formOf = ({ words, children }) => {
    const nested = children.map(formOf);
    const [head] = words;
    if (typeof head === 'string' && head.endsWith('.on') && nested.length) {
      return [...words, nested];
    }
    if (
      words.length === 1 &&
      !nested.length &&
      (typeof head !== 'string' || head.includes('.'))
    ) {
      return head;
    }
    return [...words, ...nested];
  };
  return architecture(roots.map((root) => ['layer', ...formOf(root)]));
};

const parsers = { js: javascript, lisp, md: markdown };

const parse = (source, syntax) => {
  if (!Object.hasOwn(parsers, syntax)) throw new Error('Unknown syntax');
  const model = parsers[syntax](source);
  if (!isHashObject(model) || isLiteral(model)) {
    throw new Error('Expected architecture');
  }
  return model;
};

module.exports = { parse, SYNTAXES };
