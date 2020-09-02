//
// Copyright 2020 DxOS.
//

const crypto = require('crypto');
const debug = require('debug');
const swarm = require('@geut/discovery-swarm-webrtc');
const wrtc = require('wrtc');

const { createBroker } = require('./broker');

const log = debug('dxos:test:signal');

jest.setTimeout(100 * 1000);

const checkDiscoveryUpdate = (brokers, check) => Promise.all(brokers.map(broker => {
  return new Promise(resolve => {
    const onUpdate = () => {
      if (check(broker)) {
        broker.localBus.off('$discovery.update', onUpdate);
        resolve();
      }
    };
    broker.localBus.on('$discovery.update', onUpdate);
  });
}));

test.only('join/leave peer', async () => {
  const topic = crypto.randomBytes(32);

  const brokers = [...Array(10).keys()].map(i => createBroker(topic, { port: 5000 + i, logger: false }));

  log('> starting brokers');
  await Promise.all(brokers.map(b => b.start()));

  const clients = [...Array(3).keys()].map(i => swarm({
    bootstrap: [`ws://127.0.0.1:${5000 + i}`],
    simplePeer: {
      wrtc
    }
  }));

  const peerIds = clients.map(c => c.id);
  const waitForJoin = checkDiscoveryUpdate(brokers, broker => {
    const { peerMap } = broker.shared;

    return peerIds.reduce((prev, peerId) => {
      return prev && peerMap.peers.find(p => p.topic.equals(topic) && p.id.equals(peerId));
    }, true);
  });

  const waitForPeerConnections = new Promise(resolve => {
    let connections = 0;
    const done = (conn, { initiator }) => {
      if (initiator) connections++;
      if (connections >= 2) {
        clients.forEach(client => client.off('connection', done));
        resolve();
      }
    };
    clients.forEach(client => client.on('connection', done));
  });

  log('> waiting for joining');
  clients.forEach(client => client.join(topic));
  await waitForJoin;

  log('> waiting for webrtc connections');
  await waitForPeerConnections;

  log('> waiting for leaving');
  const waitForLeave = checkDiscoveryUpdate(brokers, broker => {
    const { peerMap } = broker.shared;
    return peerMap.getPeersByTopic(topic).length === 0;
  });

  clients.forEach(client => client.leave(topic));
  await waitForLeave;

  log('> stopping brokers');
  await Promise.all(clients.map(client => client.signal.close()));
  return Promise.all(brokers.map(b => b.stop()));
});
