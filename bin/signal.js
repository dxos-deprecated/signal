#!/usr/bin/env node

//
// Copyright 2020 DxOS.
//

const crypto = require('crypto');
const yargs = require('yargs');

const { createBroker } = require('../index.js');

yargs
  .command('$0 [topic]', 'start a signal server', {
    topic: {
      describe: 'topic to find other signal servers',
      default: '#dxos',
      type: 'string'
    },
    port: {
      alias: 'p',
      describe: 'defines a port to listening',
      default: 4000
    },
    repl: {
      alias: 'r',
      describe: 'start a repl console with your signal',
      type: 'boolean'
    },
    logLevel: {
      alias: 'l',
      describe: 'defines the log level',
      default: 'info',
      choices: ['debug', 'info', 'warn', 'error']
    }
  }, (argv) => {
    const topic = crypto.createHash('sha256')
      .update(argv.topic)
      .digest();

    createBroker(topic, argv).start();
  })
  .help()
  .parse();
