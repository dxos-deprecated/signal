//
// Copyright 2020 DxOS.
//

const { Nanomessage } = require('nanomessage');
const eos = require('end-of-stream');
const varint = require('varint');
const { NanoresourcePromise } = require('nanoresource-promise/emitter');

const { Broadcast } = require('@dxos/broadcast');

const ATTR_DIRECT = 1;
const ATTR_BROADCAST = 1 << 2;

const binaryCodec = {
  encode (obj, buf, offset) {
    obj.copy(buf, offset);
    return obj;
  },
  decode (buf, start, end) {
    return buf.slice(start, end);
  },
  encodingLength (obj) {
    return obj.length;
  }
};

const packetCodec = {
  encode (obj) {
    const length = Buffer.byteLength(obj.topic, 'utf8');
    const buf = Buffer.allocUnsafe(varint.encodingLength(length) + length + obj.data.length);
    varint.encode(length, buf);
    buf.write(obj.topic, varint.encode.bytes, length, 'utf8');
    obj.data.copy(buf, varint.encode.bytes + length);
    return buf;
  },
  decode (buf) {
    const length = varint.decode(buf);
    const topic = buf.slice(varint.decode.bytes, varint.decode.bytes + length);
    const data = buf.slice(varint.decode.bytes + length);
    return { topic: topic.toString(), data };
  }
};

class Peer extends Nanomessage {
  constructor (socket, onRequest) {
    super({ valueEncoding: binaryCodec });

    this._socket = socket;
    // initialized after handshake
    this._publicKey = null;
    this._onRequest = onRequest;
  }

  get id () {
    return this._publicKey;
  }

  get publicKey () {
    return this._publicKey;
  }

  setPublicKey (publicKey) {
    this._publicKey = publicKey;
    this.emit('handshake');
  }

  request (payload, broadcast = false) {
    return super.request(this._buildMessage(payload, broadcast));
  }

  send (payload, broadcast = false) {
    return super.send(this._buildMessage(payload, broadcast));
  }

  _open () {
    if (this._socket.destroyed) throw new Error('socket destroyed');
    return super._open();
  }

  _subscribe (next) {
    const onData = data => next(data);

    this._socket.on('data', onData);
    return () => this._socket.off('data', onData);
  }

  _send (buf) {
    if (this._socket.destroyed) return;
    this._socket.write(buf);
  }

  _buildMessage (payload, broadcast) {
    if (!Buffer.isBuffer(payload)) {
      payload = packetCodec.encode(payload);
    }
    const header = Buffer.from(varint.encode(broadcast ? ATTR_BROADCAST : ATTR_DIRECT));
    return Buffer.concat([header, payload], header.length + payload.length);
  }

  _onMessage (buf, info) {
    const header = varint.decode(buf);
    const payload = buf.slice(varint.decode.bytes);
    const broadcast = header & ATTR_BROADCAST;

    if (info.ephemeral) {
      this.emit('message', { broadcast, payload });
    }

    return this._onRequest(packetCodec.decode(payload));
  }
}

class Messenger extends NanoresourcePromise {
  constructor (keyPair) {
    super();

    this._keyPair = keyPair;
    this._maxAge = 30 * 1000;
    this._broadcast = new Broadcast(this._middleware(), {
      id: this.publicKey,
      maxAge: this._maxAge,
      maxSize: 10000000
    });
    this._peers = new Set();
  }

  get publicKey () {
    return this._keyPair.publicKey;
  }

  get peers () {
    return Array.from(this._peers.values());
  }

  async addPeer (socket) {
    const peer = new Peer(socket, message => {
      if (message.topic === 'handshake') {
        peer.setPublicKey(message.data);
        return this.publicKey;
      }
    });

    peer.on('handshake', () => {
      if (socket.destroyed) return;
      this._peers.add(peer);
      this._broadcast.updatePeers(this.peers);
    });

    const onBroadcast = message => this.emit('peer-message', message);
    peer.on('message', onBroadcast);

    eos(socket, () => {
      this._peers.delete(peer);
      this._broadcast.updatePeers(this.peers);
      peer.off('message', onBroadcast);
      peer.close().catch(() => {});
    });

    await peer.open();

    return peer;
  }

  broadcast (message, options) {
    return this._broadcast.publish(packetCodec.encode(message), options);
  }

  async _open () {
    await this._broadcast.open();

    this._pruneCacheInterval = setInterval(() => {
      this._broadcast.pruneCache();
    }, this._maxAge);
  }

  async _close () {
    await this._broadcast.close();
    clearInterval(this._pruneCacheInterval);
  }

  _middleware () {
    return {
      send: (packet, node) => node.send(packet, true),
      subscribe: (onData) => {
        const onMessage = message => {
          const { broadcast, payload } = message;
          if (!broadcast) {
            this.emit('message', packetCodec.decode(payload));
            return;
          }

          const { data } = onData(payload);
          this.emit('message', packetCodec.decode(data));
        };

        this.on('peer-message', onMessage);
        return () => {
          this.off('peer-message', onMessage);
        };
      }
    };
  }
}

exports.Messenger = Messenger;
