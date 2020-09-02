//
// Copyright 2020 DxOS.
//

const { EventEmitter } = require('events');

const pLimit = require('p-limit');
const Graph = require('graphology');
const timestamp = require('monotonic-timestamp');
const lru = require('tiny-lru');
const debounce = require('lodash.debounce');

const MAX_WAIT = 1000;

class Network extends EventEmitter {
  constructor (owner, publish) {
    super();

    this._owner = owner;
    this._graph = new Graph({ multi: true, type: 'undirected' });
    this._graph.addNode(owner);
    this._limit = pLimit(1);
    this._lastUpdate = lru(1000);

    this._publish = publish;

    this.publish = debounce(() => {
      this._limit.clearQueue();
      return this._publish({ timestamp: timestamp(), connections: this.connections });
    }, MAX_WAIT);
    const onChange = debounce(() => this.emit('change', this._graph), MAX_WAIT);
    ['nodeAdded', 'edgeAdded', 'nodeDropped', 'edgeDropped'].forEach(ev => this._graph.on(ev, onChange));
  }

  get graph () {
    return this._graph;
  }

  get connections () {
    const edges = [];
    try {
      this._graph.forEachEdge(this._owner, (key, attr, source) => {
        if (source === this._owner) {
          edges.push(this._graph.exportEdge(key));
        }
      });
    } catch (err) {}
    return edges;
  }

  update (id, timestamp, connections = []) {
    // ignore old messages
    const lastTimestamp = this._lastUpdate.get(id) || 0;
    if (lastTimestamp > timestamp) return;

    this._lastUpdate.set(id, timestamp);

    if (!this._graph.hasNode(id)) {
      this._graph.addNode(id);
    }

    this._graph.forEachEdge(id, (key, attr, source) => {
      if (source === id) {
        this._graph.dropEdge(key);
      }
    });

    this._graph.import({ edges: connections });
  }

  addPeer (id) {
    if (!this._graph.hasNode(id)) {
      this._graph.addNode(id);
    }
  }

  deletePeer (id) {
    if (this._graph.hasNode(id)) {
      this._graph.dropNode(id);
    }
  }

  addConnection (initiator, peerId) {
    if (!this._graph.hasNode(peerId)) {
      this._graph.addNode(peerId);
    }

    if (initiator) {
      this._graph.addEdge(this._owner, peerId);
    } else {
      this._graph.addEdge(peerId, this._owner);
    }

    this.publish();
  }

  deleteConnection (initiator, peerId) {
    if (!this._graph.hasNode(peerId)) return;

    this._graph.forEachEdge(peerId, (key, attr, source) => {
      if (initiator && source === this._owner) {
        this._graph.dropEdge(key);
      } else if (!initiator && source === peerId) {
        this._graph.dropEdge(key);
      }
    });

    this.publish();
  }
}

exports.PresenceService = {
  name: 'presence',
  events: {
    '$node.disconnected' (ctx) {
      const { node } = ctx.params;
      this._network.deletePeer(node.id);
    },
    '$node.connected' (ctx) {
      const { node } = ctx.params;
      this._network.addPeer(node.id);
      this._network.publish();
    },
    'presence.update' (ctx) {
      if (ctx.nodeID === this.broker.nodeID) return;

      const { timestamp, connections } = ctx.params;
      return this._network.update(ctx.nodeID, timestamp, connections);
    }
  },
  created () {
    const { transporter } = this.broker.options;

    this._network = new Network(this.broker.nodeID, data => {
      return this.broker.broadcast('presence.update', data);
    });

    this._network.on('change', (graph) => {
      this.broker.broadcastLocal('$presence.update', graph);
    });

    transporter.peers.forEach(peer => {
      try {
        this._network.addConnection(peer.initiator, peer.id.toString('hex'));
      } catch (err) {
        this.logger.error(err);
      }
    });

    transporter.on('peer-added', ({ initiator, peerId }) => {
      try {
        this._network.addConnection(initiator, peerId.toString('hex'));
      } catch (err) {
        this.logger.error(err);
      }
    });

    transporter.on('peer-deleted', ({ initiator, peerId }) => {
      try {
        this._network.deleteConnection(initiator, peerId.toString('hex'));
      } catch (err) {
        this.logger.error(err);
      }
    });
  },
  started () {
    this._network.publish();
  }
};
