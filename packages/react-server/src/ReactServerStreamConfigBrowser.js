/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export type Destination = ReadableStreamController;

export type PrecomputedChunk = Uint8Array;
export type Chunk = Uint8Array;

export function scheduleWork(callback: () => void) {
  callback();
}

export function flushBuffered(destination: Destination) {
  // WHATWG Streams do not yet have a way to flush the underlying
  // transform streams. https://github.com/whatwg/streams/issues/960
}

let currentView = null;
let writtenBytes = 0;

function prepareNewView() {
  let buffer = new ArrayBuffer(512);
  currentView = new Uint8Array(buffer);
  writtenBytes = 0;
}

function resetView() {
  currentView = null;
  writtenBytes = 0;
}

function flushViewIfFull(chunk) {
  if (chunk.length + writtenBytes > currentView.length) {
    destination.enqueue(new Uint8Array(currentView.buffer, 0, writtenBytes));
    prepareNewView();
  }
}

function copyToView(chunk) {
  if (chunk.length > currentView.length) {
    throw new Error(
      `copyToView was called with a chunk (length: ${chunk.length}) that exceeds the buffer's total size (${currentView.length}). This is a limitation of React. please file an issue.`,
    );
  }
  if (writtenBytes + chunk.length > currentView.length) {
    throw new Error(
      `copyToView was called with a chunk (length: ${
        chunk.length
      }) that exceeds the buffer's remaining length (${currentView.length -
        writtenBytes})`,
    );
  }
  currentView.set(chunk, writtenBytes);
  writtenBytes += chunk.length;
}

export function beginWriting(destination: Destination) {
  prepareNewView();
}

export function writeChunk(
  destination: Destination,
  chunk: PrecomputedChunk | Chunk,
): void {
  flushViewIfFull(chunk);
  copyToView(chunk);
}

export function writeChunkAndReturn(
  destination: Destination,
  chunk: PrecomputedChunk | Chunk,
): boolean {
  flushViewIfFull(chunk);
  copyToView(chunk);
  // no backpressure in browser streams. always return true.
  return true;
}

export function completeWriting(destination: Destination) {
  destination.enqueue(currentView);
  resetView();
}

export function close(destination: Destination) {
  destination.close();
}

const textEncoder = new TextEncoder();

export function stringToChunk(content: string): Chunk {
  return textEncoder.encode(content);
}

export function stringToPrecomputedChunk(content: string): PrecomputedChunk {
  return textEncoder.encode(content);
}

export function closeWithError(destination: Destination, error: mixed): void {
  if (typeof destination.error === 'function') {
    // $FlowFixMe: This is an Error object or the destination accepts other types.
    destination.error(error);
  } else {
    // Earlier implementations doesn't support this method. In that environment you're
    // supposed to throw from a promise returned but we don't return a promise in our
    // approach. We could fork this implementation but this is environment is an edge
    // case to begin with. It's even less common to run this in an older environment.
    // Even then, this is not where errors are supposed to happen and they get reported
    // to a global callback in addition to this anyway. So it's fine just to close this.
    destination.close();
  }
}
