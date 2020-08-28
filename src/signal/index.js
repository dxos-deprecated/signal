const { PeerMap } = require('./peer-map');
const { SignalServer } = require('./signal-server');

function addContext (context) {
  const { keyPair } = context;
  context.peerMap = new PeerMap(keyPair.publicKey);
}

module.exports = { addContext, PeerMap, SignalServer };
