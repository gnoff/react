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
let ReactCache;
let Suspense;
let TextResource;
let textResourceShouldFail;
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

    ReactCache = require('react-cache');

    Suspense = React.Suspense;

    TextResource = ReactCache.unstable_createResource(
      ([text, ms = 0]) => {
        let listeners = null;
        let status = 'pending';
        let value = null;
        return {
          then(resolve, reject) {
            switch (status) {
              case 'pending': {
                if (listeners === null) {
                  listeners = [{resolve, reject}];
                  setTimeout(() => {
                    if (textResourceShouldFail) {
                      Scheduler.unstable_yieldValue(
                        `Promise rejected [${text}]`,
                      );
                      status = 'rejected';
                      value = new Error('Failed to load: ' + text);
                      listeners.forEach(listener => listener.reject(value));
                    } else {
                      Scheduler.unstable_yieldValue(
                        `Promise resolved [${text}]`,
                      );
                      status = 'resolved';
                      value = text;
                      listeners.forEach(listener => listener.resolve(value));
                    }
                  }, ms);
                } else {
                  listeners.push({resolve, reject});
                }
                break;
              }
              case 'resolved': {
                resolve(value);
                break;
              }
              case 'rejected': {
                reject(value);
                break;
              }
            }
          },
        };
      },
      ([text, ms]) => text,
    );
    textResourceShouldFail = false;
  });

  function Text(props) {
    Scheduler.unstable_yieldValue(props.text);
    return props.text;
  }

  function AsyncText(props) {
    const text = props.text;
    try {
      TextResource.read([props.text, props.ms]);
      Scheduler.unstable_yieldValue(text);
      return text;
    } catch (promise) {
      if (typeof promise.then === 'function') {
        Scheduler.unstable_yieldValue(`Suspend! [${text}]`);
      } else {
        Scheduler.unstable_yieldValue(`Error! [${text}]`);
      }
      throw promise;
    }
  }

  async function driveSteam(stream, interval) {
    let result = '';
    let driving = false;

    async function readStream() {
      let reader = stream.getReader();
      let decoder = new TextDecoder();
      while (true) {
        console.log('+++ queueing next read');
        let {done, value} = await reader.read();
        if (done) {
          result += decoder.decode();
          break;
        }
        result += decoder.decode(value, {stream: true});
        console.log('partial result', result);
      }
    }

    async function driveInterval(interval, maxDuration = 4000) {
      driving = true;
      let time = 0;
      while (driving && time < maxDuration) {
        time += interval;
        console.log('+++ advancing timers to', time);
        await jest.advanceTimersByTime(interval);
      }
      return;
    }

    driveInterval(interval);
    await readStream();
    driving = false;

    return result;
  }

  function stripScriptsForEasierMatching(document) {
    let scripts = document.getElementsByTagName('script');
    try {
      for (let s of Array.from(scripts)) {
        console.log('removing script', s);
        s.remove();
      }
    } catch (e) {
      console.log('eeeeeror', e);
    }
  }

  function toDOM(html) {
    return new JSDOM(html, {
      runScripts: 'dangerously',
    });
  }

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

  it('Fizz - heads are streamble', async () => {
    let doc, result, stream;

    function App() {
      return (
        <html>
          <head>
            <title>a title</title>
          </head>
          <body>
            <Suspense fallback={<span>loading around html...</span>}>
              <div id="container">
                <p>hello</p>
              </div>
              <AsyncText text={'inside suspense'} ms={50} />
              <head>
                <title>a different title</title>
              </head>
              <AsyncText text={'also inside suspense'} ms={100} />
            </Suspense>
          </body>
        </html>
      );
    }

    stream = await ReactDOMServer.renderToReadableStream(<App />);
    result = await driveSteam(stream, 10);
    doc = toDOM(result).window.document;
    stripScriptsForEasierMatching(doc);
    expect(doc.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>a different title</title></head><body><!--$--><div id=\\"container\\"><p>hello</p></div>inside suspense<!-- -->also inside suspense<!-- --><!--/$--></body>"',
    );

    stream = await ReactDOMServer.renderToReadableStream(<App />);
    result = await driveSteam(stream, 50);
    doc = toDOM(result).window.document;
    stripScriptsForEasierMatching(doc);
    expect(doc.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>a different title</title></head><body><!--$--><div id=\\"container\\"><p>hello</p></div>inside suspense<!-- -->also inside suspense<!-- --><!--/$--></body>"',
    );

    stream = await ReactDOMServer.renderToReadableStream(<App />);
    result = await driveSteam(stream, 100);
    doc = toDOM(result).window.document;
    stripScriptsForEasierMatching(doc);
    expect(doc.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>a different title</title></head><body><!--$--><div id=\\"container\\"><p>hello</p></div>inside suspense<!-- -->also inside suspense<!-- --><!--/$--></body>"',
    );
  });

  fit('Fizz/hydrateRoot - heads are streamble', async () => {
    let doc, result, stream;

    function App({title, isSSR}) {
      let text = isSSR ? (
        <AsyncText text={'inside suspense'} ms={50} />
      ) : (
        <Text text={'inside suspense'} />
      );
      return (
        <html>
          <head>
            <title>a title</title>
          </head>
          <body>
            <Suspense fallback={<span>loading around html...</span>}>
              {text}
              <React.Fragment key={title}>
                <head>
                  <title>{title}</title>
                </head>
              </React.Fragment>
            </Suspense>
          </body>
        </html>
      );
    }

    stream = await ReactDOMServer.renderToReadableStream(
      <App title={'server rendered title'} />,
    );
    result = await driveSteam(stream, 10);
    doc = toDOM(result).window.document;
    stripScriptsForEasierMatching(doc);
    expect(doc.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>server rendered title</title></head><body><!--$-->inside suspense<!-- --><!--/$--></body>"',
    );

    console.log('====================');
    let root = ReactDOMClient.hydrateRoot(
      doc,
      <App title={'client rendered title'} />,
    );
    expect(Scheduler).toHaveYielded(['inside suspense']);
    Scheduler.unstable_flushAll();
    expect(doc.documentElement.innerHTML).toMatchInlineSnapshot(
      '"<head><title>client rendered title</title></head><body><!--$-->inside suspense<!-- --><!--/$--></body>"',
    );
  });
});
