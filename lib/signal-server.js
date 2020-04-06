//
// Copyright 2020 DxOS.
//

const Server = require('simple-websocket/server');
const { SocketSignalServer } = require('socket-signal');

class SignalServer extends SocketSignalServer {
  constructor (server, broker, opts = {}) {
    super(opts);

    const { keyPair, peerMap } = broker.context;

    this._broker = broker;
    this._keyPair = keyPair;
    this._peerMap = peerMap;

    this._server = new Server({ server });
    this._server.setMaxListeners(Infinity);

    this.on('error', err => this._broker.logger.warn('signal-server', err));
    this.on('rpc-error', err => this._broker.logger.warn('rpc-signal-server', err));
  }

  _onSocket (socket) {
    this.addSocket(socket).catch(err => process.nextTick(() => this.emit('error', err)));
  }

  async _open () {
    this._server.on('connection', this._onSocket.bind(this));
  }

  async _close () {
    this._server.removeListener('connection', this._onSocket.bind(this));
    await super._close();
    return new Promise(resolve => this._server.close(() => resolve()));
  }

  async _onDisconnect (rpc) {
    const id = this._peerMap.findIdByRPC(rpc);
    if (id) {
      this._peerMap.topics.forEach(topicStr => {
        this._peerMap.delete(Buffer.from(topicStr, 'hex'), this._keyPair.publicKey, id);
      });

      this._broker.logger.info('peer-disconnected', { id: id.toString('hex') });
    }
    this._peerMap.deleteRPC(rpc);
  }

  async _onJoin (rpc, data) {
    this._peerMap.addRPC(rpc, data.id);
    this._peerMap.add(data.topic, this._keyPair.publicKey, data.id);
    this._broker.logger.info('peer-join', { topic: data.topic.toString('hex'), id: data.id.toString('hex') });
    return this._peerMap.toArrayFromTopic(data.topic);
  }

  async _onLeave (rpc, data) {
    this._broker.logger.info('peer-leave', { topic: data.topic.toString('hex'), id: data.id.toString('hex') });
    this._peerMap.delete(data.topic, this._keyPair.publicKey, data.id);
  }

  async _onOffer (rpc, data) {
    const remotePeer = this._peerMap.find(data.topic, data.remoteId);
    if (remotePeer.root.equals(this._keyPair.publicKey)) {
      const rpc = this._peerMap.findRPC(data.remoteId);
      return rpc.call('offer', data);
    }
    return this._broker.call('discovery.offer', data, { nodeID: remotePeer.root.toString('hex') });
  }

  async _onLookup (rpc, data) {
    return this._peerMap.toArrayFromTopic(data.topic);
  }

  async _onCandidates (rpc, data) {
    const remotePeer = this._peerMap.find(data.topic, data.remoteId);
    if (remotePeer.root.equals(this._keyPair.publicKey)) {
      const rpc = this._peerMap.findRPC(data.remoteId);
      return rpc.emit('candidates', data);
    }
    return this._broker.call('discovery.candidates', data, { nodeID: remotePeer.root.toString('hex') });
  }
}

exports.SignalServer = SignalServer;
