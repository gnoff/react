/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

// This file is only used for tests.
// It lazily loads the implementation so that we get the correct set of host configs.

export function createFromNodeStream() {
  return require('./src/ReactFlightDOMClientNode').createFromNodeStream.apply(
    this,
    arguments,
  );
}

export function createServerReference() {
  return require('./src/ReactFlightDOMClientNode').createServerReference.apply(
    this,
    arguments,
  );
}

export function createFromFetch() {
  return require('./src/ReactFlightDOMClientNodeWeb').createFromFetch.apply(
    this,
    arguments,
  );
}

export function createFromReadableStream() {
  return require('./src/ReactFlightDOMClientNodeWeb').createFromReadableStream.apply(
    this,
    arguments,
  );
}
