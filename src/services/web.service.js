//
// Copyright 2020 DxOS.
//

const WebService = require('moleculer-web');
const eos = require('end-of-stream');

const { SignalServer } = require('../signal');

exports.WebService = {
  name: 'web',
  mixins: [WebService],
  settings: {
    routes: [{
      mappingPolicy: 'restrict',
      aliases: {
        '/': 'web.status',
        'GET /live/status' (req, res) {
          this.network(req, res);
        }
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

      return {
        nodes: this.getInfo({ signal: true }),
        version: this.broker.metadata.version
      };
    }
  },
  events: {
    '$metrics.snapshot' (ctx) {
      this._metrics.set(ctx.nodeID, ctx.params);
    }
  },
  methods: {
    network (req, res) {
      const broker = this.broker;

      // SSE Setup
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });

      const watch = () => {
        let messageId = 0;

        const onUpdate = (flags = {}) => {
          res.write(`id: ${messageId++}\n`);
          res.write(`data: ${JSON.stringify(this.getInfo(flags))}\n\n`);
        };

        const onDiscoveryUpdate = () => onUpdate({ signal: true });

        broker.localBus.on('$presence.update', onUpdate);
        broker.localBus.on('$metrics.snapshot', onUpdate);
        broker.localBus.on('$discovery.update', onDiscoveryUpdate);
        eos(req, () => {
          this._sseRequests.delete(req);
          broker.localBus.off('$presence.update', onUpdate);
          broker.localBus.off('$metrics.snapshot', onUpdate);
          broker.localBus.off('$discovery.update', onDiscoveryUpdate);
        });
      };

      this._sseRequests.add(req);
      res.write(`data: ${JSON.stringify(this.getInfo({ signal: true }))}\n\n`);
      watch();
    },
    getInfo ({ signal = false } = {}) {
      const { network } = this.broker.shared;

      if (signal) {
        this._peersBySignal = this.peersBySignal();
      }

      const nodes = this.broker.registry.getNodeList({ onlyAvailable: true, withServices: true });

      return nodes.map(node => {
        const shortId = node.id.slice(0, 6);
        return {
          id: shortId,
          connections: network.getConnections(node.id).map(c => c.slice(0, 6)),
          metrics: this._metrics.get(node.id),
          signal: {
            topics: this._peersBySignal[node.id]
          }
        };
      });
    },
    peersBySignal () {
      const { peerMap } = this.broker.shared;

      const result = {};
      peerMap.topics.forEach(topic => {
        const topicStr = topic.toString('hex').slice(0, 6);
        peerMap.getPeersByTopic(topic).map(peerMap.encode).forEach(peer => {
          if (!result[peer.owner]) {
            result[peer.owner] = {};
          }

          if (!result[peer.owner][topicStr]) {
            result[peer.owner][topicStr] = { peers: [] };
          }

          const shortId = peer.id.slice(0, 6);
          if (result[peer.owner][topicStr].peers.includes(shortId)) return;
          result[peer.owner][topicStr].peers.push(shortId);
        });
      });

      return result;
    }
  },
  created () {
    this.settings.port = this.broker.metadata.port || 4000;
    this._signal = new SignalServer(this.server, this.broker);
    this._sseRequests = new Set();
    this._peersBySignal = {};
    this._metrics = new Map();
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
