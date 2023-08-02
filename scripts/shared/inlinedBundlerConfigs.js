/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
'use strict';

module.exports = [
  {
    shortName: 'webpack',
    entryPoints: [
      'react-server-dom-webpack/server',
      'react-server-dom-webpack/server.browser',
      'react-server-dom-webpack/server.edge',
      'react-server-dom-webpack/server.node',
      'react-server-dom-webpack/server.node.unbundled',
      'react-server-dom-webpack/client',
      'react-server-dom-webpack/client.browser',
      'react-server-dom-webpack/client.edge',
      'react-server-dom-webpack/client.node',
      'react-server-dom-webpack/client.node.unbundled',
    ],
    paths: [
      'react-server-dom-webpack',
      'react-server-dom-webpack/client.browser',
      'react-server-dom-webpack/client.node',
      'react-server-dom-webpack/server',
      'react-server-dom-webpack/server.node',
      'react-server-dom-webpack/src/ReactFlightClientBundlerConfigNode.js',
      'react-server-dom-webpack/src/ReactFlightClientBundlerConfigWebpack.js',
      'react-server-dom-webpack/src/ReactFlightServerBundlerConfigWebpack.js',
    ],
  },
  {
    shortName: 'esm',
    entryPoints: [
      'react-server-dom-esm',
      'react-server-dom-esm/server',
      'react-server-dom-esm/server.node',
      'react-server-dom-esm/client',
      'react-server-dom-esm/client.browser',
      'react-server-dom-esm/client.node',
    ],
    paths: [
      'react-server-dom-esm',
      'react-server-dom-esm/client.browser',
      'react-server-dom-esm/client.node',
      'react-server-dom-esm/server',
      'react-server-dom-esm/server.node',
      'react-server-dom-esm/src/ReactFlightClientBundlerConfigESM.js',
      'react-server-dom-esm/src/ReactFlightServerBundlerConfigESM.js',
    ],
  },
];
