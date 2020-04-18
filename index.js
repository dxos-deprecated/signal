//
// Copyright 2020 DxOS.
//

const assert = require('assert');
const crypto = require('crypto');

const { ServiceBroker } = require('moleculer');
const { keyPair: createKeyPair } = require('hypercore-crypto');

const { PeerMap } = require('./lib/peer-map.js');
const { ProtocolTransporter } = require('./lib/protocol-transporter');
const { Serializer } = require('./lib/serializer');

// Services
const { SignalService } = require('./lib/signal.service');
const { DiscoveryService } = require('./lib/discovery.service');

const SIGNAL_PROTOCOL_VERSION = 2;

function createBroker (topic, opts = {}) {
  assert(Buffer.isBuffer(topic) && topic.length === 32, 'topic is required and must be a buffer of 32 bytes');

  topic = crypto.createHash('sha256')
    .update(topic.toString('hex') + SIGNAL_PROTOCOL_VERSION)
    .digest();

  const {
    port = process.env.PORT || 4000,
    keyPair = createKeyPair(),
    hyperswarm,
    asBootstrap = false,
    repl = false,
    logLevel,
    logFormat = 'full',
    logDir
  } = opts;

  const logger = {
    type: 'Console',
    options: {
      formatter: logFormat
    }
  };

  if (logDir) {
    logger.type = 'File';
    logger.options = {
      folder: logDir,
      filename: 'dxos-signal-{nodeID}-{date}.log',
      formatter: logFormat
    };
  }

  const peerMap = new PeerMap();

  const broker = new ServiceBroker({
    nodeID: keyPair.publicKey.toString('hex'),
    logger,
    logLevel,
    repl,
    transporter: new ProtocolTransporter({
      key: topic,
      hyperswarm,
      asBootstrap,
      bootstrapPort: port
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
      broker.logger.info('SIGNAL_PROTOCOL_VERSION:', SIGNAL_PROTOCOL_VERSION);
      broker.logger.info('SIGNAL_PROTOCOL_TOPIC:', topic.toString('hex'));

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

module.exports = { createBroker, SIGNAL_PROTOCOL_VERSION };
