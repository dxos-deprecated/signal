//
// Copyright 2020 DxOS.
//

const assert = require('assert');
const { ServiceBroker } = require('moleculer');
const { keyPair: createKeyPair } = require('hypercore-crypto');

const { PeerMap } = require('./lib/peer-map.js');
const { ProtocolTransporter } = require('./lib/protocol-transporter');
const { Serializer } = require('./lib/serializer');

// Services
const { SignalService } = require('./lib/signal.service');
const { DiscoveryService } = require('./lib/discovery.service');

function createBroker (topic, opts = {}) {
  assert(Buffer.isBuffer(topic) && topic.length === 32, 'topic is required and must be a buffer of 32 bytes');

  const { logLevel, repl = false, keyPair = createKeyPair(), hyperswarm, port = process.env.PORT || 4000 } = opts;

  const peerMap = new PeerMap();

  const broker = new ServiceBroker({
    nodeID: keyPair.publicKey.toString('hex'),
    logLevel,
    repl,
    transporter: new ProtocolTransporter({
      key: topic,
      hyperswarm
    }),
    serializer: new Serializer(),
    metadata: {
      port,
      version: require('./package.json').version
    },
    created (broker) {
      broker.context = {
        keyPair,
        peerMap
      };
    },
    started (broker) {
      if (repl) {
        return broker.repl();
      }
    },
    errorHandler (err, info) {
      // Handle the error
      this.logger.warn('Global error handled:', err);
    }
  });

  broker.createService(SignalService);
  broker.createService(DiscoveryService);

  return broker;
}

module.exports = { createBroker };
