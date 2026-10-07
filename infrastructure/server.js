'use strict';

const http = require('node:http');

const { isHashObject, receiveBody } = require('metautil');

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

const listeners = new Map();
const sockets = new Set();
let connection = null;
let abortController = null;

const reply = (response, status, body) => {
  const isJson = status === STATUS_CODES.ok;
  const type = isJson ? CONTENT_TYPES.json : CONTENT_TYPES.text;
  response.statusCode = status;
  response.setHeader('content-type', type);
  response.end(body);
};

const fail = (response, error) => {
  if (response.writableEnded) return;
  console.error(error);
  reply(response, STATUS_CODES.serverFailure, 'Server failure');
};

const send = async (response, respond) => {
  try {
    const outcome = await respond();
    if (!outcome || response.writableEnded) return;
    reply(response, outcome.status, outcome.body);
  } catch (error) {
    fail(response, error);
  }
};

const readBody = async (request, response) => {
  try {
    const body = await receiveBody(request);
    const raw = body.toString('utf8');
    if (raw === '') return null;
    return JSON.parse(raw);
  } catch (error) {
    if (response.writableEnded) return null;
    if (error instanceof SyntaxError) {
      reply(response, STATUS_CODES.badRequest, error.message);
      return null;
    }
    fail(response, error);
    return null;
  }
};

const deliver = async (handlers, command) => {
  const method = command?.method;
  const parameters = command?.parameters;
  const handler = handlers[method];
  if (typeof handler !== 'function') return { missing: true };
  try {
    const outcome = await handler(parameters);
    return { outcome };
  } catch (error) {
    return { error: error.message };
  }
};

const on = (event) => {
  const isNamed = typeof event === 'string' && event !== '';
  if (!isNamed) throw new Error('Unknown event');
  return (handlers) => {
    if (!isHashObject(handlers)) throw new Error('Expected handlers');
    const listener = (command) => deliver(handlers, command);
    const group = listeners.get(event);
    if (group) {
      group.push(listener);
      return;
    }
    listeners.set(event, [listener]);
  };
};

const emit = async (event, command) => {
  const group = listeners.get(event);
  if (!group) return null;
  let result = { missing: true };
  for (const listener of group) {
    result = await listener(command);
    if (!result.missing) return result;
  }
  return result;
};

const close = () => {
  if (!connection) return;
  const server = connection;
  connection = null;
  if (abortController) abortController.abort();
  abortController = null;
  server.close();
  for (const socket of sockets) socket.destroy();
  sockets.clear();
};

const commandResult = (result) => {
  if (!result) {
    return { status: STATUS_CODES.serverFailure, body: 'Expected api' };
  }
  if (result.missing) {
    return { status: STATUS_CODES.notFound, body: 'Unknown command' };
  }
  if (result.error) {
    return { status: STATUS_CODES.badRequest, body: result.error };
  }
  const payload = JSON.stringify(result.outcome);
  return { status: STATUS_CODES.ok, body: payload };
};

const handleCall = async (request, response) => {
  const path = request.url.split('?')[0];
  const method = path.replace(/^\//, '');
  const isPost = request.method === 'POST';
  const isNamed = method !== '';
  if (!isPost || !isNamed) {
    return { status: STATUS_CODES.notFound, body: 'Unknown command' };
  }
  const parameters = await readBody(request, response);
  if (response.writableEnded) return null;
  const result = await emit('call', { method, parameters });
  return commandResult(result);
};

const listen = (host, port, console) => {
  abortController = new AbortController();
  const { signal } = abortController;
  connection = http.createServer((request, response) => {
    send(response, () => handleCall(request, response));
  });
  connection.on(
    'connection',
    (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket), { signal });
    },
    { signal },
  );
  connection.on(
    'error',
    (error) => {
      console.error(error.message);
    },
    { signal },
  );
  connection.listen(port, host);
  connection.unref();
  console.log(`listening ${host}:${port}`);
};

const retain = () => {
  if (!connection) throw new Error('Expected server');
  connection.ref();
};

const open = ({ console, options }) => {
  const host = options.host;
  const port = options.port;
  const isValidTarget = typeof host === 'string' && Number.isSafeInteger(port);
  if (!isValidTarget) throw new Error('Expected host and port');
  listen(host, port, console);
  return { host, port };
};

module.exports = { open, close, on, retain };
