'use strict';

const { readFile } = require('node:fs/promises');
const path = require('node:path');

const { isHashObject } = require('metautil');

const readText = async (fileName) => {
  try {
    return await readFile(fileName, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const message = `Configuration file not found: ${fileName}`;
    throw new Error(message, { cause: error });
  }
};

const parseSettings = (raw) => {
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (error) {
    throw new Error('Invalid configuration', { cause: error });
  }
  if (!isHashObject(settings)) throw new Error('Invalid configuration');
  return settings;
};

const read = async ({ fileName }) => {
  const raw = await readText(path.resolve(__dirname, '..', fileName));
  return parseSettings(raw);
};

module.exports = { read };
