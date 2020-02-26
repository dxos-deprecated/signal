//
// Copyright 2020 DxOS
//

const debug = require('debug');
const server = require('http').createServer();
const io = require('socket.io')(server);

require('./server')({ io });

const port = process.env.PORT || 4000;

const log = debug('signal');
const error = debug('signal:error');

process.on('unhandledRejection', (err) => {
  error('Unhandled rejection:', err.message);
});

server.listen(port, () => {
  log('discovery-signal-webrtc running on %s', port);
});
