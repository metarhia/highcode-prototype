'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, SYNTAXES } = require('../highscript/syntax.js');
const { format } = require('../highscript/format.js');
const { inspect } = require('../highscript/model.js');

test('all syntaxes preserve values and bindings', () => {
  const model = {
    application: {
      settings: {
        read: {
          options: {
            enabled: true,
            fallback: null,
            retries: 2,
            factor: -0.5,
            labels: [{ literal: 'two words' }, { literal: 'say "yes"\nnext' }],
            nested: [{ valid: false }, null, [1, { literal: 'a.b' }]],
          },
        },
      },
      flat: { source: 'application.settings.read' },
    },
    presentation: {
      terminal: {
        open: { source: 'application.flat', empty: [] },
      },
    },
  };
  for (const syntax of SYNTAXES) {
    const parsed = parse(format(model, syntax), syntax);
    assert.deepEqual(parsed, model, syntax);
    assert.doesNotThrow(() => inspect(parsed));
  }
});

test('pipelines and both subscription handler forms stay synchronized', () => {
  const source = 'infrastructure.cli';
  const event = { literal: 'call' };
  const handler = 'application.purchase.placeOrder';
  const model = {
    presentation: {
      direct: { subscribe: { source, event, handler } },
      mapped: { subscribe: { source, event, handler: { order: handler } } },
      pipe: ['process.argv', { order: handler }, handler],
    },
  };
  for (const syntax of SYNTAXES) {
    assert.deepEqual(parse(format(model, syntax), syntax), model, syntax);
  }
});

test('JS requires commas and rejects executable expressions', () => {
  const invalid = [
    '({ presentation: {} domain: {} });',
    '({ presentation: { terminal: [application.a application.b] } });',
    '({ presentation: { terminal: () => process.exit() } });',
    '({ presentation: { terminal: infrastructure.cli.on("call") } });',
    '({ presentation: {} }); process.exit();',
  ];
  for (const source of invalid) assert.throws(() => parse(source, 'js'));
});

test('readers reject duplicate declarations and invalid indentation', () => {
  assert.throws(
    () => parse('(layer domain) (layer domain)', 'lisp'),
    /Duplicate/,
  );
  assert.throws(() => parse('- domain\n- domain\n', 'md'), /Duplicate/);
  assert.throws(() => parse('- domain\n    - order\n', 'md'), /indentation/);
  assert.throws(() => parse('- domain\n   - order\n', 'md'), /list item/);
});

test('JS comments and escaped quotes are data, not execution', () => {
  const source = String.raw`({
    // The quoted path stays a literal.
    presentation: { terminal: { open: {
      text: 'it\'s "data"\\path',
      enabled: true,
    } } },
  });`;
  const model = parse(source, 'js');
  assert.equal(
    model.presentation.terminal.open.text.literal,
    String.raw`it's "data"\path`,
  );
});
