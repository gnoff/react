'use strict';

var n, w;
if (process.env.NODE_ENV === 'production') {
  n = require('./cjs/react-server-dom-webpack-client.node.production.min.js');
  w = require('./cjs/react-server-dom-webpack-client.nodeweb.production.min.js');
} else {
  n = require('./cjs/react-server-dom-webpack-client.node.development.js');
  w = require('./cjs/react-server-dom-webpack-client.nodeweb.development.js');
}

exports.createServerReference = n.createServerReference;
exports.createFromNodeStream = n.createFromNodeStream;
exports.createFromFetch = w.createFromFetch;
exports.createFromReadableStream = w.createFromReadableStream;
