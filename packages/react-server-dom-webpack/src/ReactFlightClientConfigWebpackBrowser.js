/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import escapeSelectorAttributeValueInsideDoubleQuotes from 'react-dom-bindings/src/client/escapeSelectorAttributeValueInsideDoubleQuotes';

const chunkLoadingMap: Map<string, Promise<mixed>> = new Map();

export function loadChunk(chunkFile: string): Promise<mixed> {
  let chunkPromise = chunkLoadingMap.get(chunkFile);
  if (chunkPromise) {
    return chunkPromise;
  }
  const publicPath = __webpack_public_path__ || '';
  const src = publicPath + chunkFile;

  chunkPromise = new Promise((resolve, reject) => {
    const limitedEscapedSrc =
      escapeSelectorAttributeValueInsideDoubleQuotes(src);
    const existing = document.querySelector(
      `script[src="${limitedEscapedSrc}"]`,
    );

    const script = document.createElement('script');
    script.setAttribute('src', src);
    if (__webpack_nonce__) {
      script.setAttribute('nonce', __webpack_nonce__);
    }

    if (
      // This global is is true when config.output.crossOriginLoading is 'use-credentials'
      __WEBPACK_FLIGHT_CROSS_ORIGIN_CREDENTIALS__
    ) {
      script.setAttribute('crossorigin', 'use-credentials');
    } else if (
      // This global is is true when config.output.crossOriginLoading is any other string
      __WEBPACK_FLIGHT_CROSS_ORIGIN_ANONYMOUS__ &&
      // Webpack JSONP loading has this check so I copied it. It's possible to do same-origin CORS
      // requests but maybe that's uncommon.
      !script.src.startsWith(window.location.origin + '/')
    ) {
      script.setAttribute('crossorigin', '');
    }

    function cleanup() {
      script.onload = null;
      script.onerror = null;
      if (existing) {
        existing.onload = null;
        existing.onerror = null;
      }
    }

    function onLoad() {
      cleanup();
      resolve();
    }

    function onError() {
      cleanup();
      reject();
    }

    if (existing) {
      function onExistingError() {
        existing.onload = null;
        existing.onerror = null;
      }
      existing.onload = onLoad;
      existing.onerror = onExistingError;
    }

    script.onload = onLoad;
    script.onerror = onError;

    (document.head: any).appendChild(script);
    (document.head: any).removeChild(script);
  });

  chunkLoadingMap.set(chunkFile, chunkPromise);

  return chunkPromise;
}
