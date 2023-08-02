/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ClientReferenceMetadata} from './ReactFlightClientBundlerConfig';

import {getSpecifierFromMetadata} from './ReactFlightClientBundlerConfig';
import {preinitModuleForSSR} from 'react-client/src/ReactFlightClientConfig';

export type ModuleLoading = string; // baseURL

export function prepareDestinationForModule(
  baseURL: ModuleLoading,
  metadata: ClientReferenceMetadata,
) {
  // We are running upstream of our destination (SSR) and need to emit preinits
  // for the browser to start executing even before the client bootstraps
  preinitModuleForSSR(baseURL + getSpecifierFromMetadata(metadata), undefined);
}
