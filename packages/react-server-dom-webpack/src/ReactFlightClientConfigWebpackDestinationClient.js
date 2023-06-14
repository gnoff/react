/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export type ChunkLoading = null;

export function prepareDestinationWithChunks(
  chunkLoading: ChunkLoading,
  chunks: mixed,
): void {
  // The client is ultimately the destination so there is nothing further to prepare.
  // On the server this is where we would potentially emit a script tag to kick start
  // chunk loading before hydration
}
