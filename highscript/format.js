'use strict';

const { isHashObject } = require('metautil');
const { isLiteral } = require('./model.js');

const scalar = (value) =>
  isLiteral(value) ? JSON.stringify(value.literal) : String(value);

const javascript = (value, depth = 0) => {
  if (!Array.isArray(value) && (!isHashObject(value) || isLiteral(value))) {
    return scalar(value);
  }
  if (value.subscribe) {
    const { source, event, handler } = value.subscribe;
    return `${source}.on(${scalar(event)}, ${javascript(handler, depth)})`;
  }
  const pad = '  '.repeat(depth);
  const array = Array.isArray(value);
  const entries = array ? value : Object.entries(value);
  const [open, close] = array ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) return open + close;
  const lines = entries.map((entry) => {
    const text = array
      ? javascript(entry, depth + 1)
      : `${entry[0]}: ${javascript(entry[1], depth + 1)}`;
    return `${pad}  ${text}`;
  });
  return `${open}\n${lines.join(',\n')},\n${pad}${close}`;
};

const valueForm = (value) => {
  if (Array.isArray(value)) return ['array', ...value.map(valueForm)];
  if (isHashObject(value) && !isLiteral(value)) {
    return [
      'object',
      ...Object.entries(value).map(([name, binding]) => [
        name,
        valueForm(binding),
      ]),
    ];
  }
  return value;
};

const subscriptionForm = ({ subscribe }) => {
  const { source, event, handler } = subscribe;
  const target =
    typeof handler === 'string' ? handler : Object.entries(handler);
  return [`${source}.on`, event, target];
};

const componentForm = ([name, value]) => {
  if (value.subscribe) return [name, subscriptionForm(value)];
  if (Array.isArray(value)) {
    const steps = value.map((step) =>
      step?.subscribe ? subscriptionForm(step) : valueForm(step),
    );
    return [name, ['pipe', ...steps]];
  }
  const fields = Object.entries(value).map(([key, ports]) =>
    isHashObject(ports) && !isLiteral(ports)
      ? [
          key,
          ...Object.entries(ports).map(([role, binding]) => [
            role,
            valueForm(binding),
          ]),
        ]
      : [key, valueForm(ports)],
  );
  return [name, ...fields];
};

const forms = (model) =>
  Object.entries(model).map(([layer, components]) => [
    'layer',
    layer,
    ...Object.entries(components).map(componentForm),
  ]);

const lispForm = (value, depth = 0) => {
  if (!Array.isArray(value)) return scalar(value);
  const printed = value.map((item) => lispForm(item, depth + 1));
  const inline = `(${printed.join(' ')})`;
  if (!inline.includes('\n') && depth * 2 + inline.length <= 78) return inline;
  const index = value.findIndex(Array.isArray);
  const start = index < 0 ? value.length : index;
  const head = printed.slice(0, start).join(' ');
  const pad = '  '.repeat(depth + 1);
  return `(${head}\n${printed
    .slice(start)
    .map((line) => pad + line)
    .join('\n')})`;
};

const markdownForm = (value, depth) => {
  if (Array.isArray(value) && Array.isArray(value[0])) {
    return value.flatMap((item) => markdownForm(item, depth));
  }
  const items = Array.isArray(value) ? value : [value];
  const index = items.findIndex(Array.isArray);
  const boundary = index < 0 ? items.length : index;
  const split = items[0] === 'pipe' ? 1 : boundary;
  const head = items.slice(0, split).map(scalar).join(' ');
  const row = `${'  '.repeat(depth)}- ${head}`;
  return [
    row,
    ...items.slice(split).flatMap((item) => markdownForm(item, depth + 1)),
  ];
};

const format = (model, syntax) => {
  if (syntax === 'js') return `(${javascript(model)});\n`;
  if (syntax === 'lisp') {
    return `${forms(model)
      .map((form) => lispForm(form))
      .join('\n\n')}\n`;
  }
  if (syntax === 'md') {
    return `${forms(model)
      .flatMap(([, ...form]) => markdownForm(form, 0))
      .join('\n')}\n`;
  }
  throw new Error('Unknown syntax');
};

module.exports = { format };
