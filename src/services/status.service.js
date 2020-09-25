//
// Copyright 2020 DxOS.
//

const { GraphQLClient, gql } = require('graphql-request');
const { AbortController } = require('@azure/abort-controller');

const delay = (ms, signal) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort);
  });
};

exports.StatusService = {
  name: 'status',
  settings: {
    graphql: {
      type: `
        type Status {
          id: String!
          updatedAt: Timestamp!
          version: String!
          nodes: [Node]!
        }

        type Node {
          id: String!
          kubeServices: [KubeService]!
          connections: [Connection]!
          metrics: [Metric]!
          signal: Signal
        }

        type Connection {
          id: String!
          target: String!
        }

        type Signal {
          topics: [Topic]!
        }

        type Topic {
          id: String!
          peers: [String]!
        }

        type Metric {
          type: String!,
          name: String!,
          description: String!,
          unit: String,
          values: [MetricValue]!
        }

        type MetricValue {
          key: String,
          value: Any
        }

        type KubeService {
          name: String!
          status: String!
          cpu: Int!
          memory: Int!
        }
      `
    }
  },
  actions: {
    status: {
      graphql: {
        query: 'status: Status'
      },
      handler (ctx) {
        const status = this.getStatus();

        return {
          updatedAt: status.updatedAt,
          id: ctx.nodeID,
          nodes: Array.from(status.nodes.values()),
          version: this.broker.metadata.version
        };
      }
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
    },
    'status.kube-services' (ctx) {
      this.updateKubeServices(ctx.nodeID, ctx.params.services);
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
          kubeServices: oldNode.kubeServices || [],
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
      this._status.updatedAt = new Date();

      return this._status;
    },
    updateMetrics (nodeID, metrics) {
      if (!this._status.nodes.has(nodeID)) return;

      const node = this._status.nodes.get(nodeID);
      node.metrics = metrics;
      this._status.updatedAt = new Date();
    },
    updateKubeServices (nodeID, services) {
      if (!this._status.nodes.has(nodeID)) return;

      const node = this._status.nodes.get(nodeID);
      node.kubeServices = services;
      this._status.updatedAt = new Date();
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
    this._status = {
      updatedAt: new Date(),
      toUpdate: true,
      nodes: new Map()
    };
  },
  started () {
    this.getStatus();

    this._controller = new AbortController();
    const signal = this._controller.signal;

    const graphQLClient = new GraphQLClient('https://apollo1.kube.moon.dxos.network/api', {
      signal
    });

    const serviceStatusQuery = gql`
      {
        serviceStatus: service_status {
          json
        }
      }
    `;

    (async () => {
      while (!signal.aborted) {
        await delay(5 * 1000, signal);
        const data = await graphQLClient.request(serviceStatusQuery).catch(() => {});
        if (data && data.serviceStatus) {
          this.broker.broadcast('status.kube-services', { services: JSON.parse(data.serviceStatus.json) });
        }
      }
    })().catch(() => {});
  },
  stopped () {
    if (this._controller) this._controller.abort();
  }
};
