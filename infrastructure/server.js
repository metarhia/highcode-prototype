'use strict';

const http = require('node:http');
const { once } = require('node:events');
const { receiveBody } = require('metautil');
const { Channel } = require('../highscript/channel.js');

const STATUS_CODES = {
  ok: 200,
  badRequest: 400,
  notFound: 404,
  serverFailure: 500,
};

const CONTENT_TYPES = {
  json: 'application/json',
  text: 'text/plain',
};

const reply = (response, status, body) => {
  if (response.destroyed || response.writableEnded) return;
  const type =
    status === STATUS_CODES.ok ? CONTENT_TYPES.json : CONTENT_TYPES.text;
  response.writeHead(status, { 'content-type': type });
  response.end(body);
};

const handleCall = async (channel, request, response) => {
  const method = request.url.split('?')[0].slice(1);
  if (request.method !== 'POST' || method === '') {
    reply(response, STATUS_CODES.notFound, 'Unknown command');
    return;
  }
  const body = await receiveBody(request);
  let result;
  try {
    const parameters = body.length ? JSON.parse(body.toString('utf8')) : null;
    result = await channel.emit('call', { method, parameters });
  } catch (error) {
    reply(response, STATUS_CODES.badRequest, error.message);
    return;
  }
  if (result.missing) {
    reply(response, STATUS_CODES.notFound, 'Unknown command');
    return;
  }
  reply(response, STATUS_CODES.ok, JSON.stringify(result.outcome));
};

class Server {
  #channel = new Channel();
  #connection;
  #options;
  #console;
  #opening = null;
  #closing = null;

  constructor({ console, options }) {
    const { host, port } = options;
    if (
      typeof host !== 'string' ||
      !Number.isInteger(port) ||
      port < 0 ||
      port > 65535
    ) {
      throw new Error('Expected host and port');
    }
    this.#options = { host, port };
    this.#console = console;
    this.#connection = http.createServer((request, response) => {
      handleCall(this.#channel, request, response).catch((error) => {
        reply(response, STATUS_CODES.serverFailure, 'Server failure');
        Promise.resolve(this.#console.error(error.message)).catch(() => {});
      });
    });
  }

  on(event, handler) {
    return this.#channel.on(event, handler);
  }

  listen() {
    if (this.#closing) return Promise.reject(new Error('Server is closed'));
    this.#opening ??= this.#listen();
    return this.#opening;
  }

  async #listen() {
    const server = this.#connection;
    const ready = once(server, 'listening');
    server.listen(this.#options);
    await ready;
    const address = server.address();
    await this.#console.log(`listening ${address.address}:${address.port}`);
    return address;
  }

  close() {
    this.#closing ??= this.#close();
    return this.#closing;
  }

  async #close() {
    if (this.#opening) await this.#opening.catch(() => {});
    const server = this.#connection;
    this.#channel.close();
    if (!server.listening) return;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
}

const open = ({ console, options }) => new Server({ console, options });

module.exports = { open };
