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
        peers: peerMap.peersFromRoot(Buffer.from(this.broker.nodeID, 'hex'))
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
    update (ctx) {
      this.logger.debug('offer', ctx.params);

      const { peerMap } = this.broker.context;

      peerMap.update(Buffer.from(ctx.nodeID, 'hex'), ctx.params.peers);
    },
    offer (ctx) {
      this.logger.debug('offer', ctx.params);

      const { peerMap } = this.broker.context;

      const rpc = peerMap.findRPC(ctx.params.remoteId);
      return rpc.call('offer', ctx.params);
    },
    candidates (ctx) {
      this.logger.debug('candidates', ctx.params);

      const { peerMap } = this.broker.context;

      const rpc = peerMap.findRPC(ctx.params.remoteId);
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
