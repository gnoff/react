/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ClientReferenceMetadata} from './ReactFlightClientBundlerConfig';

export type ModuleLoading = null;

export function prepareDestinationForModule(
  moduleLoading: ModuleLoading,
  metadata: ClientReferenceMetadata,
): void {
  // We are running in the final destination, There is nothing more to prepare
}
