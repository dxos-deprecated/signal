//
// Copyright 2020 DxOS.
//

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
      }, { nodeID: ctx.params.node.id });
    },
    'discovery.peer-added' (ctx) {
      const { peerMap } = this.broker.context;

      const root = Buffer.from(ctx.nodeID, 'hex');
      if (ctx.nodeID !== this.broker.nodeID) {
        peerMap.add(ctx.params.topic, root, ctx.params.id);
      }
    },
    'discovery.peer-deleted' (ctx) {
      const { peerMap } = this.broker.context;

      const root = Buffer.from(ctx.nodeID, 'hex');
      if (ctx.nodeID !== this.broker.nodeID) {
        peerMap.delete(ctx.params.topic, root, ctx.params.id);
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

    peerMap.on('peer-added', ({ topic, root, id }) => {
      if (this.broker.nodeID === root.toString('hex')) {
        this.broker.broadcast('discovery.peer-added', { topic, id });
      }
    });

    peerMap.on('peer-deleted', ({ topic, root, id }) => {
      if (this.broker.nodeID === root.toString('hex')) {
        this.broker.broadcast('discovery.peer-deleted', { topic, id });
      }
    });
  }
};
