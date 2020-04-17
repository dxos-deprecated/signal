//
// Copyright 2020 DxOS.
//

const crypto = require('crypto');
const assert = require('assert');
const { EventEmitter } = require('events');
const { Transporters: { Base: BaseTransporter } } = require('moleculer');
const hyperswarm = require('hyperswarm');
const dht = require('@hyperswarm/dht');
const pump = require('pump');
const pEvent = require('p-event');
const { discoveryKey } = require('hypercore-crypto');

const { Protocol, Extension } = require('@dxos/protocol');
const { Messenger } = require('@dxos/protocol-plugin-messenger');

class ProtocolTransporter extends BaseTransporter {
  constructor (opts) {
    const { key, hyperswarm = {}, validate = () => true, asBootstrap = false } = opts;

    assert(Buffer.isBuffer(key), 'key is required and must be a buffer of 32 bytes');

    super(opts);

    this._key = key;
    this._topic = discoveryKey(key);
    this._hyperswarmOptions = hyperswarm;
    this._validate = validate;
    this._asBootstrap = asBootstrap;

    this._peers = new Map();
    this._ee = new EventEmitter();
    this._id = null;
    this._messenger = null;
    this._swarm = null;
    this._bootstrapNode = null;

    this.onPeerConnection = this.onPeerConnection.bind(this);
  }

  get dht () {
    return this._swarm && this._swarm.network.discovery && this._swarm.network.discovery.dht;
  }

  get onlyLocal () {
    return this._peers.size === 0;
  }

  waitForConnected () {
    if (this.connected) return;
    return pEvent(this, 'connected');
  }

  async connect () {
    this._id = crypto.createHash('sha256')
      .update(this.broker.nodeID)
      .digest();

    const opts = {
      ...this._hyperswarmOptions
    };

    if (this._asBootstrap) {
      const address = await this._createBootstrapNode(opts);
      if (!opts.bootstrap) {
        opts.bootstrap = [];
      }

      opts.bootstrap.push(`${address.address}:${address.port}`);
    }

    this._swarm = hyperswarm(opts);

    this._messenger = new Messenger(this._id, (protocol, { type, payload }) => {
      this._ee.emit(type, payload);
    });

    this._swarm.on('connection', this.onPeerConnection);

    this._swarm.once('close', () => {
      if (this.connected) {
        this.connected = false;
      }

      this._swarm.removeListener('connection', this.onPeerConnection);
      this.logger.warn('ProtocolTransporter disconnected');
    });

    return new this.broker.Promise((resolve, reject) => {
      const onError = (err) => {
        this.logger.error('ProtocolTransporter error', err.message);
        reject(err);
      };

      this._swarm.once('error', onError);

      this._swarm.join(this._topic, {
        lookup: true,
        announce: true
      }, () => {
        this.logger.info('ProtocolTransporter connected');
        this._swarm.removeListener('error', onError);
        this._ee.emit('connected');
        this.onConnected().then(resolve);
      });
    });
  }

  disconnect () {
    if (this._swarm) {
      this._swarm.destroy();

      this._peers.forEach((info, protocol) => {
        protocol.stream.destroy();
      });
    }

    if (this._bootstrapNode) {
      this._bootstrapNode.destroy();
    }
  }

  subscribe (cmd, nodeID) {
    const t = this.getTopicName(cmd, nodeID);

    this._ee.on(t, msg => this.receive(cmd, msg));

    return this.broker.Promise.resolve();
  }

  /**
   * Send data buffer.
   *
   * @param {String} topic
   * @param {Buffer} data
   * @param {Object} meta
   *
   * @returns {Promise}
   */
  send (topic, data) {
    if (!this._swarm) return this.broker.Promise.resolve();

    return new this.broker.Promise((resolve, reject) => {
      this._messenger.broadcastMessage(topic, data).then(resolve).catch(reject);
    });
  }

  onPeerConnection (socket, info) {
    const protocol = new Protocol({
      streamOptions: { live: true },
      discoveryToPublicKey: (dk) => {
        if (dk.equals(this._topic)) {
          return this._key;
        }
        protocol.stream.destroy(new Error('invalid peer'));
      }
    })
      .setSession({ peerId: this._id })
      .setExtensions([
        new Extension('validate-peer-id')
          .setInitHandler(async (protocol) => {
            const session = protocol.getSession();
            if (!session.peerId) throw new Error('peerId missing');
            if (info.deduplicate(this._id, session.peerId)) {
              throw new Error('peer duplicated');
            }
            if (!await this._validate(protocol)) {
              throw new Error('peer invalid');
            }
          }),
        this._messenger.createExtension()
      ])
      .setHandshakeHandler(async () => {
        const { peerId } = protocol.getSession();
        this.logger.debug('connection added', peerId.toString('hex').slice(0, 6));
        this._peers.set(protocol, info);
      })
      .init(this._topic);

    protocol.on('error', err => {
      this.logger.debug('protocol error', err);
    });

    pump(socket, protocol.stream, socket, err => {
      this.logger.debug('connection error', err, info.peer);

      if (this._peers.delete(protocol)) {
        this.logger.debug('connection deleted', info.peer);
      }
    });
  }

  async _createBootstrapNode () {
    this._bootstrapNode = dht({ bootstrap: [] });

    this._bootstrapNode.on('announce', (target, peer) => {
      this.logger.debug('BOOTSTRAP_NODE: received announce', target, peer);
    });

    this._bootstrapNode.on('unannounce', (target, peer) => {
      this.logger.debug('BOOTSTRAP_NODE: received unannounce', target, peer);
    });

    this._bootstrapNode.on('lookup', (target, peer) => {
      this.logger.debug('BOOTSTRAP_NODE: received lookup', target, peer);
    });

    // runs the bootstrap UDP node in a specific port
    if (typeof this._asBootstrap === 'number') {
      this._bootstrapNode.listen(this._asBootstrap);
    }

    await pEvent(this._bootstrapNode, 'ready');

    this._bootstrapNode.once('close', async () => {
      if (!this.connected) {
        return;
      }

      this.logger.warn('BOOTSTRAP_NODE: closed. Reconnecting...');
      try {
        await this._createBootstrapNode();
      } catch (err) {
        this.logger.error('BOOTSTRAP_NODE: error during reconnection', err);
      }
    });

    const address = this._bootstrapNode.socket.address();

    this.logger.info('BOOTSTRAP_NODE: running on', {
      id: this._bootstrapNode.id.toString('hex'),
      address
    });

    return address;
  }
}

module.exports = { ProtocolTransporter };
