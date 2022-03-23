/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

// Polyfills for test environment
global.ReadableStream = require('web-streams-polyfill/ponyfill/es6').ReadableStream;
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;

let JSDOM = require('jsdom').JSDOM;
let React = require('react');
let ReactDOM = require('react-dom');
let ReactDOMClient = require('react-dom/client');
let ReactDOMServer = require('react-dom/server.browser');
let Scheduler = require('scheduler');
let act;
let useEffect;

describe('ReactDOMHead', () => {
  let container;

  beforeEach(() => {
    jest.resetModules();

    React = require('react');
    ReactDOM = require('react-dom');
    ReactDOMClient = require('react-dom/client');
    ReactDOMServer = require('react-dom/server.browser');
    Scheduler = require('scheduler');
    act = require('jest-react').act;
    useEffect = React.useEffect;
    JSDOM = require('jsdom').JSDOM;
    container = document.getElementById('container');
  });

  it('renders <head> into the documentElement as a singleton', () => {
    let container = document.createElement('div');
    document.body.appendChild(container);
    let root = ReactDOMClient.createRoot(container);

    // debugger
    root.render(
      <>
        <head>
          <title>a title</title>
        </head>
      </>,
    );
    Scheduler.unstable_flushAll();
    expect(document.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>a title</title></head><body><div></div></body>"',
    );

    root.render(
      <>
        <head>
          <title>a different title</title>
          <meta charSet="utf-8" />
        </head>
      </>,
    );
    Scheduler.unstable_flushAll();
    expect(document.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>a different title</title><meta charset=\\"utf-8\\"></head><body><div></div></body>"',
    );

    root.render(
      <>
        <head>
          <title>another different title</title>
          <meta charSet="utf-8" />
        </head>
        <div>
          <head>
            <title>an entirely different head</title>
          </head>
        </div>
      </>,
    );
    Scheduler.unstable_flushAll();
    expect(document.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>an entirely different head</title></head><body><div><div></div></div></body>"',
    );

    root.render(
      <>
        <div>
          <head>
            <title>fresh</title>
          </head>
        </div>
      </>,
    );
    Scheduler.unstable_flushAll();
    expect(document.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>fresh</title></head><body><div><div></div></div></body>"',
    );

    root.render(
      <>
        <div>
          <head>
            <title>fresh</title>
          </head>
        </div>
        <head>
          <title>fresher</title>
        </head>
      </>,
    );
    Scheduler.unstable_flushAll();
    expect(document.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>fresher</title></head><body><div><div></div></div></body>"',
    );

    root.render(
      <>
        <div>
          <head>
            <title>fresh</title>
          </head>
          <p>hello</p>
        </div>
        <head>
          <title>fresher</title>
        </head>
      </>,
    );
    Scheduler.unstable_flushAll();
    expect(document.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>fresher</title></head><body><div><div><p>hello</p></div></div></body>"',
    );
  });

  it('ignores hydration when encountering a <head>', async () => {
    let html = `
      <html>
        <head>
          <title>a title</title>
        </head>
        <body>
          <div id="container">
            <p>hello</p>
          </div>
        </body>
      </html>`;

    let dom = new JSDOM(html.replace(/(^|\r|\n)\s+(?=<)/g, ''), {
      runScripts: 'dangerously',
    });
    document.documentElement.innerHTML =
      dom.window.document.documentElement.innerHTML;

    let clientContainer = document.getElementById('container');

    let root = ReactDOMClient.hydrateRoot(
      clientContainer,
      <>
        <head>
          <title>a different title</title>
        </head>
        <p>hello</p>
      </>,
    );
    Scheduler.unstable_flushAll();
    expect(document.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>a different title</title></head><body><div id=\\"container\\"><p>hello</p></div></body>"',
    );
  });

  xit('unimplemented - streaming heads', async () => {
    let stream = await ReactDOMServer.renderToReadableStream(
      <html>
        <head>
          <title>a title</title>
        </head>
        <body>
          <div id="container">
            <p>hello</p>
          </div>
        </body>
      </html>,
    );

    let result = '';
    let reader = stream.getReader();
    let decoder = new TextDecoder();
    while (true) {
      let {done, value} = await reader.read();
      if (done) {
        result += decoder.decode();
        break;
      }
      result += decoder.decode(value, {stream: true});
    }

    let dom = new JSDOM(result, {
      runScripts: 'dangerously',
    });
    document.documentElement.innerHTML =
      dom.window.document.documentElement.innerHTML;

    let clientContainer = document.getElementById('container');
  });
});
