'use strict';

const record = (pairs) => {
  const names = pairs.map(([name]) => name);
  if (new Set(names).size !== names.length) {
    throw new Error('Duplicate declaration');
  }
  return Object.fromEntries(pairs);
};

const reader = (source) => {
  const pattern =
    /\s+|'[^'\\\r\n]*'|"[^"\\\r\n]*"|[A-Za-z][A-Za-z0-9.]*|[(){}\[\]:,;]/y;
  const tokens = [];
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new Error(`Unexpected character at ${offset}`);
    offset = pattern.lastIndex;
    if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
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

const javascript = (input) => {
  const value = () => {
    if (input.peek() === '[') {
      input.take('[');
      const items = [];
      while (input.peek() !== ']') {
        items.push(value());
        if (input.peek() !== ',') break;
        input.take(',');
      }
      input.take(']');
      return items;
    }
    if (input.peek() === '{') {
      input.take('{');
      const pairs = [];
      while (input.peek() !== '}') {
        const key = input.take();
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) {
          throw new Error('Expected object key');
        }
        input.take(':');
        pairs.push([key, value()]);
        if (input.peek() !== ',') break;
        input.take(',');
      }
      input.take('}');
      return record(pairs);
    }
    const token = input.take();
    if (!/^('[^']*'|"[^"]*")$/.test(token)) {
      throw new Error('Expected string literal');
    }
    return token.slice(1, -1);
  };
  input.take('(');
  const model = value();
  input.take(')');
  input.take(';');
  return model;
};

const lisp = (input) => {
  const expression = () => {
    if (input.peek() !== '(') {
      const symbol = input.take();
      if (/^('[^']*'|"[^"]*")$/.test(symbol)) return symbol.slice(1, -1);
      if (!/^[A-Za-z][A-Za-z0-9.]*$/.test(symbol)) {
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
  const [head, ...forms] = expression();
  if (head !== 'architecture') throw new Error('Expected architecture');
  const layers = [];
  const permissions = [];
  let entry;
  for (const form of forms) {
    if (!Array.isArray(form)) throw new Error('Expected form');
    const [operator, name, ...children] = form;
    if (operator === 'entry' && entry === undefined && !children.length) {
      entry = name;
      continue;
    }
    if (operator === 'allow') {
      permissions.push([name, children]);
      continue;
    }
    if (operator !== 'layer') throw new Error('Expected layer, allow or entry');
    const components = children.map((component) => {
      if (!Array.isArray(component)) throw new Error('Expected component');
      const [kind, id, use, ...bindings] = component;
      if (kind !== 'component') throw new Error('Expected component');
      const pairs = bindings.map((binding) => {
        if (!Array.isArray(binding) || binding.length !== 3 ||
            binding[0] !== 'bind') throw new Error('Expected bind');
        return [binding[1], binding[2]];
      });
      const specification = { use };
      if (pairs.length) specification.bind = record(pairs);
      return [id, specification];
    });
    layers.push([name, record(components)]);
  }
  const model = { layers: record(layers), entry };
  if (permissions.length) model.allow = record(permissions);
  return model;
};

const parse = (source, syntax) => {
  const input = reader(source);
  if (!['js', 'lisp'].includes(syntax)) throw new Error('Unknown syntax');
  const model = syntax === 'js' ? javascript(input) : lisp(input);
  input.end();
  return model;
};

module.exports = { parse };
