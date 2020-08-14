//
// Copyright 2020 DxOS.
//

const assert = require('assert');
const { EventEmitter } = require('events');
const { Transporters: { Base: BaseTransporter } } = require('moleculer');
const hyperswarm = require('hyperswarm');
const pEvent = require('p-event');
const { discoveryKey } = require('hypercore-crypto');

const { Messenger } = require('./messenger');
const { BootstrapNode } = require('./bootstrap-node');

class ProtocolTransporter extends BaseTransporter {
  constructor (opts) {
    const { topic, keyPair, hyperswarm = {}, asBootstrap = false, bootstrapPort } = opts;

    assert(Buffer.isBuffer(topic), 'topic is required and must be a buffer of 32 bytes');
    assert(keyPair && Buffer.isBuffer(keyPair.publicKey) && Buffer.isBuffer(keyPair.secretKey), 'keyPair is required and must be an object of { publicKey: Buffer, secretKey: Buffer }');

    super(opts);

    this._topic = topic;
    this._keyPair = keyPair;
    this._discoveryKey = discoveryKey(topic);
    this._hyperswarmOptions = hyperswarm;
    this._messenger = new Messenger(this._keyPair);

    this._peers = new Map();
    this._ee = new EventEmitter();
    this._nanomessage = null;
    this._swarm = null;
    this._bootstrapNode = null;

    if (asBootstrap) {
      this._bootstrapNode = new BootstrapNode({ port: bootstrapPort });
    }

    this.onPeerConnection = this.onPeerConnection.bind(this);
    this._messenger.on('message', message => this._ee.emit(message.topic, message.data));
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
    const opts = {
      ...this._hyperswarmOptions
    };

    if (this._bootstrapNode) {
      await this._bootstrapNode.start(this.broker);

      if (!opts.bootstrap) {
        opts.bootstrap = [];
      }

      const address = await this._bootstrapNode.getAddress();
      opts.bootstrap.push(`${address.address}:${address.port}`);
    }

    if (opts.bootstrap) {
      opts.bootstrap = [...new Set(opts.bootstrap)];
    }

    this.logger.info('Bootstrap nodes', opts.bootstrap ? opts.bootstrap : 'default');

    this._swarm = hyperswarm(opts);
    this._swarm.on('connection', this.onPeerConnection);
    this._swarm.once('close', () => {
      if (this.connected) {
        this.connected = false;
      }

      this._swarm.removeListener('connection', this.onPeerConnection);
      this.logger.warn('ProtocolTransporter disconnected');
    });

    await this._messenger.open();

    return new this.broker.Promise((resolve, reject) => {
      const onError = (err) => {
        this.logger.error('ProtocolTransporter error', err.message);
        reject(err);
      };

      this._swarm.once('error', onError);

      this._swarm.join(this._discoveryKey, {
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
      this._bootstrapNode.stop();
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
    if (!this._swarm || this._messenger.peers.length === 0) return this.broker.Promise.resolve();

    return new this.broker.Promise((resolve, reject) => {
      this._messenger.broadcast({ topic, data }).then(resolve).catch(reject);
    });
  }

  async onPeerConnection (socket, info) {
    try {
      const peer = await this._messenger.addPeer(socket);
      peer.on('handshake', () => info.deduplicate(peer.publicKey, this._messenger.publicKey));
      if (!info.client) return;
      const remotePublicKey = await peer.request({ topic: 'handshake', data: this._messenger.publicKey });
      peer.setPublicKey(remotePublicKey);
    } catch (err) {
      this.logger.error('Peer error', err);
    }
  }
}

module.exports = { ProtocolTransporter };
