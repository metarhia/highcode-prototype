'use strict';

const commandLine = ({ checkout }) => async (args) => {
  const id = args[0];
  const tokens = args.slice(1);
  const hasItems = Boolean(id) && tokens.length > 0;
  if (!hasItems) {
    throw new Error('Usage: ORDER-ID sku:quantity [sku:quantity ...]');
  }
  const itemPattern = /^([a-z][a-z0-9-]*):([1-9][0-9]*)$/;
  const lines = tokens.map((token) => {
    const match = itemPattern.exec(token);
    if (!match) throw new Error(`Invalid item: ${token}`);
    const sku = match[1];
    const quantity = Number(match[2]);
    const line = { sku, quantity };
    return line;
  });
  const command = { id, lines };
  const result = await checkout(command);
  const text = JSON.stringify(result, null, 2);
  return text;
};

module.exports = commandLine;
