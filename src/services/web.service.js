//
// Copyright 2020 DxOS.
//

const WebService = require('moleculer-web');

const { SignalServer } = require('../signal');

exports.WebService = {
  name: 'web',
  mixins: [WebService],
  settings: {
    routes: [{
      mappingPolicy: 'restrict',
      aliases: {
        '/': 'web.status',
        '/status': 'web.status'
      }
    }]
  },
  actions: {
    status (ctx) {
      ctx.meta.$responseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Surrogate-Control': 'no-store',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      };

      const status = this.getStatus();

      return {
        updatedAt: status.updatedAt,
        nodes: Array.from(status.nodes.values()),
        version: this.broker.metadata.version
      };
    }
  },
  events: {
    '$metrics.snapshot' (ctx) {
      this.updateMetrics(ctx.nodeID, ctx.params);
    },
    '$node.connected' (ctx) {
      this._status.toUpdate = true;
    },
    '$node.disconnected' (ctx) {
      const { node } = ctx.params;
      this._status.nodes.delete(node.id);
      this._status.toUpdate = true;
    },
    '$presence.update' (ctx) {
      this._status.toUpdate = true;
    },
    '$discovery.update' (ctx) {
      this._status.toUpdate = true;
    }
  },
  methods: {
    getStatus () {
      const { network } = this.broker.shared;

      const nodes = this.broker.registry.getNodeList({ onlyAvailable: true, withServices: true });

      if (!this._status.toUpdate) {
        return this._status;
      }

      nodes.forEach(node => {
        const oldNode = this._status.nodes.get(node.id) || {};

        this._status.nodes.set(node.id, {
          id: node.id,
          connections: network.getConnections(node.id).map(conn => ({
            id: conn.key,
            target: conn.target
          })),
          metrics: oldNode.metrics || [],
          signal: {
            topics: this.getSignalPeers(node.id)
          }
        });
      });

      this._status.toUpdate = false;
      this._status.updatedAt = Date.now();

      return this._status;
    },
    updateMetrics (nodeID, metrics) {
      if (!this._status.nodes.has(nodeID)) return;

      const node = this._status.nodes.get(nodeID);
      node.metrics = metrics;
      this._status.updatedAt = Date.now();
    },
    getSignalPeers (peerId) {
      const { peerMap } = this.broker.shared;
      const peerIdBuf = Buffer.from(peerId, 'hex');
      const peersByTopic = new Map();

      peerMap.topics.forEach(topic => {
        const topicStr = topic.toString('hex');
        peerMap.getPeersByTopic(topic)
          .filter(peer => peer.owner.equals(peerIdBuf))
          .map(peerMap.encode)
          .forEach(peer => {
            let value;
            if (peersByTopic.has(topicStr)) {
              value = peersByTopic.get(topicStr);
            } else {
              value = { id: topicStr, peers: [] };
              peersByTopic.set(topicStr, value);
            }

            if (value.peers.includes(peer.id)) return;
            value.peers.push(peer.id);
          });
      });

      return Array.from(peersByTopic.values());
    }
  },
  created () {
    this.settings.port = this.broker.metadata.port || 4000;
    this._signal = new SignalServer(this.server, this.broker);
    this._sseRequests = new Set();
    this._status = {
      updatedAt: 0,
      toUpdate: true,
      nodes: new Map()
    };
  },
  async started () {
    return this._signal.open();
  },
  async stopped () {
    this._sseRequests.forEach(r => {
      r.destroy();
    });
    return this._signal.close();
  }
};
