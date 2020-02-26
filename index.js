//
// Copyright 2020 DxOS
//

const server = require('http').createServer();
const io = require('socket.io')(server);

require('./server')({ io });

const port = process.env.PORT || 4000;

server.listen(port, () => {
  console.log('discovery-signal-webrtc running on %s', port);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});
