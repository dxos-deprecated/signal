//
// Copyright 2020 DxOS.
//
const debounce = require('lodash.debounce');

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
    },
    'peers-update' (ctx) {
      const { peerMap } = this.broker.context;

      if (ctx.nodeID !== this.broker.nodeID) {
        peerMap.updateRootPeers(Buffer.from(ctx.nodeID, 'hex'), ctx.params.rootPeers);
      }
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
  started () {
    const { peerMap } = this.broker.context;

    const updatePeers = debounce(() => {
      this.broker.broadcast('peers-update', {
        rootPeers: peerMap.getRootPeers(Buffer.from(this.broker.nodeID, 'hex'))
      });
    }, 2 * 1000);

    peerMap.on('peer-added', () => {
      updatePeers();
    });

    peerMap.on('peer-deleted', ({ topic, root, id }) => {
      updatePeers();
    });
  }
};
