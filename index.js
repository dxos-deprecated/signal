//
// Copyright 2020 DxOS
//

const debug = require('debug');
const { createServer } = require('http');
const micro = require('micro');
const socketIO = require('socket.io');

const { SignalSwarmServer } = require('@geut/discovery-swarm-webrtc/server');

const { version } = require('./package.json');

const port = process.env.PORT || 4000;

const log = debug('signal');
const error = debug('signal:error');

let signal;

const server = createServer(micro(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  return {
    channels: Array.from(signal.channels.keys()).map(channel => ({
      channel,
      peers: Array.from(signal.channels.get(channel).values())
    })),
    version
  };
}));

signal = new SignalSwarmServer({ io: socketIO(server) });

process.on('unhandledRejection', (err) => {
  error(`Unhandled: ${err.message}`);
});

server.listen(port, () => {
  log(`discovery-signal-webrtc running on ${port}`);
});
