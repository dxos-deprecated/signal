//
// Copyright 2020 DxOS.
//

const debounce = require('lodash.debounce');
const { default: PQueue } = require('p-queue');

exports.DiscoveryService = {
  name: 'discovery',
  events: {
    '$node.disconnected' (ctx) {
      const { peerMap } = this.broker.context;

      peerMap.deleteAllByRoot(Buffer.from(ctx.params.node.id, 'hex'));
    },
    '$node.connected' (ctx) {
      const { peerMap } = this.broker.context;

      ctx.call('discovery.update', {
        rootPeers: peerMap.getRootPeers(Buffer.from(this.broker.nodeID, 'hex'))
      }, { nodeID: ctx.params.node.id }).catch(err => {
        this.broker.logger.error('Error on $node.connected -> discovery.update', err);
      });
    }
  },
  actions: {
    update: {
      params: {
        rootPeers: {
          type: 'array',
          items: {
            type: 'object',
            props: {
              topic: { type: 'object' }, // buffer objects
              peers: { type: 'array', items: 'object' } // buffer objects
            }
          }
        }
      },
      handler (ctx) {
        this.logger.debug('update-root-peers', ctx.params);

        const { peerMap } = this.broker.context;

        peerMap.updateRootPeers(Buffer.from(ctx.nodeID, 'hex'), ctx.params.rootPeers);
      }
    },
    offer (ctx) {
      this.logger.debug('offer', ctx.params);

      const { peerMap } = this.broker.context;

      const rpc = peerMap.findRPC(ctx.params.remoteId);
      if (!rpc) throw new Error('rpc not found');

      return rpc.call('offer', ctx.params);
    },
    candidates (ctx) {
      this.logger.debug('candidates', ctx.params);

      const { peerMap } = this.broker.context;

      const rpc = peerMap.findRPC(ctx.params.remoteId);
      if (!rpc) throw new Error('rpc not found');

      return rpc.emit('candidates', ctx.params);
    }
  },
  created () {
    const { peerMap } = this.broker.context;

    this._queue = new PQueue({ concurrency: 1 });

    this._updatePeers = debounce(() => {
      this._queue.add(() => {
        const nodes = this
          .broker
          .registry
          .getNodeList({ onlyAvailable: true, withServices: true })
          .filter(node => node.id !== this.broker.nodeID);

        const rootPeers = peerMap.getRootPeers(Buffer.from(this.broker.nodeID, 'hex'));

        return Promise.all(nodes.map(node =>
          this.broker.call('discovery.update', { rootPeers }, { nodeID: node.id }).catch(() => {})
        ));
      });
    }, 2 * 1000);
  },
  started () {
    const { peerMap } = this.broker.context;

    peerMap.on('peer-added', this._updatePeers);
    peerMap.on('peer-deleted', this._updatePeers);
  },
  stopped () {
    const { peerMap } = this.broker.context;

    peerMap.off('peer-added', this._updatePeers);
    peerMap.off('peer-deleted', this._updatePeers);
  }
};
