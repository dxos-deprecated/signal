//
// Copyright 2020 DxOS.
//

const assert = require('assert');
const crypto = require('crypto');

const { ServiceBroker } = require('moleculer');

const { PeerMap } = require('./peer-map.js');
const { ProtocolTransporter } = require('./transporter');
const { Serializer } = require('./serializer');
const packageJSON = require('../package.json');

// Services
const { SignalService } = require('./services/signal.service');
const { DiscoveryService } = require('./services/discovery.service');

const SIGNAL_PROTOCOL_VERSION = 4;

function createBroker (topic, opts = {}) {
  assert(Buffer.isBuffer(topic) && topic.length === 32, 'topic is required and must be a buffer of 32 bytes');

  topic = crypto.createHash('sha256')
    .update(topic.toString('hex') + SIGNAL_PROTOCOL_VERSION)
    .digest();

  const {
    port = process.env.PORT || 4000,
    keyPair = ProtocolTransporter.keyPair(),
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

  const peerMap = new PeerMap(keyPair.publicKey);

  const broker = new ServiceBroker({
    nodeID: keyPair.publicKey.toString('hex'),
    logger,
    logLevel,
    repl,
    transporter: new ProtocolTransporter({
      topic,
      keyPair,
      hyperswarm,
      asBootstrap,
      bootstrapPort: port
    }),
    serializer: new Serializer(),
    metadata: {
      port,
      version: packageJSON.version
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
      if (err.code) {
        // ignore webrtc peer errors
        this.logger.debug('GLOBAL_ERROR:', err);
        return;
      }
      this.logger.warn('GLOBAL_ERROR:', err);
    }
  });

  broker.createService(SignalService);
  broker.createService(DiscoveryService);

  return broker;
}

module.exports = { createBroker, SIGNAL_PROTOCOL_VERSION, ProtocolTransporter };
