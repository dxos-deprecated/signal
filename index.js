//
// Copyright 2020 DxOS
//

const debug = require('debug');
const { createServer } = require('http');
const socketIO = require('socket.io');
const micro = require('micro')

const { SignalSwarmServer } = require('@geut/discovery-swarm-webrtc/server');

let signal
const server = createServer(micro(async (req, res) => {
  const result = {}
  signal.channels.forEach((peers, channel) => {
    result[channel] = Array.from(peers.values())
  })
  return result
}))

signal = new SignalSwarmServer({ io: socketIO(server) });

const port = process.env.PORT || 4000;

const log = debug('signal');
const error = debug('signal:error');

process.on('unhandledRejection', (err) => {
  error('Unhandled rejection:', err.message);
});

server.listen(port, () => {
  log('discovery-signal-webrtc running on %s', port);
});
