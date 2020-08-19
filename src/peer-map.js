//
// Copyright 2020 DxOS.
//

const { EventEmitter } = require('events');
const { errors: { ERR_PEER_NOT_FOUND } } = require('socket-signal');

class PeerMap extends EventEmitter {
  constructor (root) {
    super();

    this._root = root;
    this._rootsByTopic = new Map();
    this._peersByRPC = new Map();
  }

  get topics () {
    return Array.from(this._rootsByTopic.keys());
  }

  get peersByRPC () {
    return this._peersByRPC;
  }

  add (topic, root, id) {
    const topicStr = topic.toString('hex');
    const rootStr = root.toString('hex');
    const idStr = id.toString('hex');

    const roots = this._rootsByTopic.get(topicStr) || new Map();
    const peers = roots.get(rootStr) || new Set();

    peers.add(idStr);
    roots.set(rootStr, peers);
    this._rootsByTopic.set(topicStr, roots);
    if (this._root.equals(root)) {
      this.emit('peer-added', { topic, root, id });
    }
  }

  delete (topic, root, id) {
    const topicStr = topic.toString('hex');
    const rootStr = root.toString('hex');
    const idStr = id.toString('hex');

    if (this._rootsByTopic.has(topicStr)) {
      const peers = this._rootsByTopic.get(topicStr).get(rootStr);
      if (peers && peers.delete(idStr)) {
        if (peers.size === 0) {
          this._rootsByTopic.get(topicStr).delete(rootStr);
          if (this._rootsByTopic.get(topicStr).size === 0) {
            this._rootsByTopic.delete(topicStr);
          }
        }
        if (this._root.equals(root)) {
          this.emit('peer-deleted', { topic, root, id });
        }
        return true;
      }
    }

    return false;
  }

  deleteAllByRoot (root) {
    const rootStr = root.toString('hex');
    this._rootsByTopic.forEach((roots, topicStr) => {
      roots.delete(rootStr);
      if (roots.size === 0) {
        this._rootsByTopic.delete(topicStr);
      }
    });
  }

  find (topic, id) {
    const idStr = id.toString('hex');
    const roots = this._rootsByTopic.get(topic.toString('hex'));
    for (const [rootStr, peers] of roots) {
      if (peers.has(idStr)) {
        return {
          root: Buffer.from(rootStr, 'hex'),
          id: Buffer.from(idStr, 'hex'),
          topic
        };
      }
    }

    throw new ERR_PEER_NOT_FOUND(idStr);
  }

  getTopics () {
    return Array.from(this._rootsByTopic.keys()).map(topic => Buffer.from(topic, 'hex'));
  }

  getPeers (topic) {
    const result = [];
    const roots = this._rootsByTopic.get(topic.toString('hex'));
    roots.forEach(peers => {
      peers.forEach(idStr => {
        result.push(Buffer.from(idStr, 'hex'));
      });
    });
    return result;
  }

  toArray () {
    const result = [];
    this._rootsByTopic.forEach(roots => {
      roots.forEach(peers => {
        peers.forEach(idStr => {
          result.push(Buffer.from(idStr, 'hex'));
        });
      });
    });

    return result;
  }

  toArrayFromTopic (topic) {
    const topicStr = topic.toString('hex');
    if (!this._rootsByTopic.has(topicStr)) return [];
    const result = [];
    this._rootsByTopic.get(topicStr).forEach(peers => {
      peers.forEach(idStr => {
        result.push(Buffer.from(idStr, 'hex'));
      });
    });

    return result;
  }

  getRootPeers (root) {
    const rootStr = root.toString('hex');
    const topics = {};
    this._rootsByTopic.forEach((roots, topicStr) => {
      if (!roots.has(rootStr)) {
        return;
      }

      if (!topics[topicStr]) {
        topics[topicStr] = {
          topic: Buffer.from(topicStr, 'hex'),
          peers: []
        };
      }

      roots.get(rootStr).forEach(idStr => {
        topics[topicStr].peers.push(Buffer.from(idStr, 'hex'));
      });
    });

    return Object.values(topics);
  }

  updateRootPeers (root, peersByTopic) {
    this.deleteAllByRoot(root);

    peersByTopic.forEach(({ topic, peers }) => {
      peers.forEach(id => {
        this.add(topic, root, id);
      });
    });
  }

  addRPC (rpc, id) {
    this._peersByRPC.set(rpc, id);
  }

  deleteRPC (rpc) {
    this._peersByRPC.delete(rpc);
  }

  findRPC (id) {
    for (const [rpc, _id] of this._peersByRPC) {
      if (id.equals(_id)) return rpc;
    }
  }

  findIdByRPC (rpc) {
    return this._peersByRPC.get(rpc);
  }
}

module.exports = { PeerMap };
