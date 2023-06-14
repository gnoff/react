/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {preinitModulesForSSR} from 'react-client/src/ReactFlightClientConfig';

export type ChunkLoading = {
  prefix: string,
  crossOrigin?: 'use-credentials' | '',
};

export function prepareDestinationWithChunks(
  chunkLoading: ChunkLoading,
  // Chunks are double-indexed [..., idx, filenamex, idy, filenamey, ...]
  chunks: Array<string>,
) {
  for (let i = 1; i < chunks.length; i += 2) {
    preinitModulesForSSR(
      chunkLoading.prefix + chunks[i],
      chunkLoading.crossOrigin,
    );
  }
}
