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
      onAfterCall (ctx, route, req, res, data) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Surrogate-Control', 'no-store');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        return data;
      },
      aliases: {
        '/': 'web.status'
      }
    }]
  },
  actions: {
    status (ctx) {
      const { peerMap } = this.broker.shared;
      const nodes = this.broker.registry.getNodeList({ onlyAvailable: true, withServices: true });

      return {
        channels: peerMap.topics.map(topic => ({
          channel: topic.toString('hex'),
          peers: peerMap.getPeersByTopic(topic).map(peerMap.encode)
        })),
        signals: nodes.map(node => node.id.slice(0, 6)),
        network: {

        },
        version: this.broker.metadata.version
      };
    }
  },
  created () {
    this.settings.port = this.broker.metadata.port || 4000;
    this._signal = new SignalServer(this.server, this.broker);
  },
  async started () {
    return this._signal.open();
  },
  async stopped () {
    return this._signal.close();
  }
};
