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
        '/': 'web.signal',
        'GET network' (req, res) {
          this.network(req, res);
        }
      }
    }]
  },
  actions: {
    signal (ctx) {
      ctx.meta.$responseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Surrogate-Control': 'no-store',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      };

      const { peerMap } = this.broker.shared;
      const nodes = this.broker.registry.getNodeList({ onlyAvailable: true, withServices: true });

      return {
        channels: peerMap.topics.map(topic => ({
          channel: topic.toString('hex'),
          peers: peerMap.getPeersByTopic(topic).map(peerMap.encode)
        })),
        signals: nodes.map(node => node.id.slice(0, 6)),
        version: this.broker.metadata.version
      };
    },
    network (ctx) {

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

      broker.call('presence.network').then(data => {
        if (req.destroyed) return;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        watch();
      });

      this._sseRequests.add(req);

      function watch () {
        let messageId = 0;
        const onUpdate = (graph) => {
          res.write(`id: ${messageId++}\n`);
          res.write(`data: ${JSON.stringify(graph.export())}\n\n`);
        };
        broker.localBus.on('$presence.update', onUpdate);

        eos(req, () => {
          this._sseRequests.delete(req);
          broker.localBus.off('$presence.update', onUpdate);
        });
      }
    }
  },
  created () {
    this.settings.port = this.broker.metadata.port || 4000;
    this._signal = new SignalServer(this.server, this.broker);
    this._sseRequests = new Set();
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
