'use strict';

const { Channel } = require('../highscript/channel.js');

const ITEM_PATTERN = /^([a-z][a-z0-9-]*):([1-9][0-9]*)$/;

const parseLine = (token) => {
  const match = ITEM_PATTERN.exec(token);
  if (!match) throw new Error(`Invalid item: ${token}`);
  const [, sku, count] = match;
  return { sku, quantity: Number(count) };
};

const open = () => {
  const channel = new Channel();
  const run = async (args) => {
    const [id, ...tokens] = args;
    if (!id || tokens.length === 0) {
      throw new Error('Usage: ORDER-ID sku:quantity [sku:quantity ...]');
    }
    const parameters = { id, lines: tokens.map(parseLine) };
    const result = await channel.emit('call', { method: 'order', parameters });
    if (result.missing) throw new Error('Unknown command');
    return JSON.stringify(result.outcome, null, 2);
  };
  return {
    on: channel.on.bind(channel),
    close: channel.close.bind(channel),
    run,
  };
};

module.exports = { open };
