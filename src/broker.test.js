//
// Copyright 2020 DxOS.
//

const crypto = require('crypto');
const pEvent = require('p-event');
const debug = require('debug');
const render = require('graphology-canvas');
const shortestPath = require('graphology-shortest-path/unweighted');

const { createBroker } = require('./broker');

const log = debug('dxos:test:broker');

jest.setTimeout(100 * 1000);

const MAX_BROKERS = 5;

function complete (graph) {
  if (graph.nodes().length !== MAX_BROKERS || graph.edges().length < MAX_BROKERS) return false;

  for (const source of graph.nodes()) {
    for (const target of graph.nodes()) {
      if (source === target) continue;

      if (!shortestPath(graph, source, target)) {
        return false;
      }
    }
  }

  return true;
}

test('20 brokers connectivity', async () => {
  const topic = crypto.randomBytes(32);

  const brokers = [...Array(MAX_BROKERS).keys()].map(i => createBroker(topic, { port: 4000 + i, logger: false }));

  const waitForGraph = Promise.all(brokers.map(async broker => {
    const graph = await pEvent(broker.localBus, '$presence.update', (graph) => {
      return complete(graph, broker.nodeID);
    });
    return { nodeID: broker.nodeID, graph };
  }));

  const waitForConnected = Promise.all(brokers.map(broker => {
    const nodes = brokers.filter(b => b.nodeID !== broker.nodeID).map(b => b.nodeID);
    return Promise.all(nodes.map(nodeID => pEvent(broker.localBus, '$node.connected', ({ node }) => node.id === nodeID)));
  }));

  log('> starting brokers');
  await Promise.all(brokers.map(b => b.start()));

  log('> waiting for the nodes to be connected');
  await waitForConnected;

  const graphs = await waitForGraph;
  // await new Promise(resolve => setTimeout(resolve, 10000));
  console.log(require('util').inspect(graphs.map(b => ({
    id: b.nodeID,
    edges: b.graph.edges().length,
    graph: b.graph.export()
  })), false, 5, true));
  const positions = new Map();
  brokers.forEach(b => {
    positions.set(b.nodeID, {
      x: Math.floor(Math.random() * (100 - 1)) + 1,
      y: Math.floor(Math.random() * (100 - 1)) + 1
    });
  });
  await Promise.all(graphs.map(b => {
    positions.forEach((value, key) => {
      b.graph.setNodeAttribute(key, 'x', value.x);
      b.graph.setNodeAttribute(key, 'y', value.y);
    });
    return new Promise(resolve => render(b.graph, `./images/${b.nodeID}.png`, resolve));
  }));

  log('> stopping brokers');
  return Promise.all(brokers.map(b => b.stop()));
});
