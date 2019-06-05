/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import invariant from 'shared/invariant';

import typeof * as FeatureFlagsType from 'shared/ReactFeatureFlags';
import typeof * as PersistentFeatureFlagsType from './ReactFeatureFlags.persistent';

export const debugRenderPhaseSideEffects = false;
export const debugRenderPhaseSideEffectsForStrictMode = false;
export const enableUserTimingAPI = __DEV__;
export const warnAboutDeprecatedLifecycles = false;
export const replayFailedUnitOfWorkWithInvokeGuardedCallback = false;
export const enableProfilerTimer = false;
export const enableSchedulerTracing = false;
export const enableSuspenseServerRenderer = false;
export const disableJavaScriptURLs = false;
export const disableYielding = false;
export const disableInputAttributeSyncing = false;
export const enableStableConcurrentModeAPIs = false;
export const warnAboutShorthandPropertyCollision = false;
export const enableSchedulerDebugging = false;
export const warnAboutDeprecatedSetNativeProps = false;
export const enableEventAPI = false;
export const enableJSXTransformAPI = false;
export const enableIncrementalUnifiedContextPropagation = true;
export const traceContextPropagation = false;

// Only used in www builds.
export function addUserTimingListener() {
  invariant(false, 'Not implemented.');
}

// Flow magic to verify the exports of this file match the original version.
// eslint-disable-next-line no-unused-vars
type Check<_X, Y: _X, X: Y = _X> = null;
// eslint-disable-next-line no-unused-expressions
(null: Check<PersistentFeatureFlagsType, FeatureFlagsType>);
