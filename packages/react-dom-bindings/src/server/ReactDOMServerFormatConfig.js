/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactNodeList} from 'shared/ReactTypes';
import type {
  Resources,
  BoundaryResources,
  LinkTagResource,
} from './ReactDOMFloatServer';
export type {Resources, BoundaryResources};

import {
  checkHtmlStringCoercion,
  checkCSSPropertyStringCoercion,
  checkAttributeStringCoercion,
} from 'shared/CheckStringCoercion';

import {Children} from 'react';

import {
  enableFilterEmptyStringAttributesDOM,
  enableCustomElementPropertySupport,
  enableFloat,
  enableFizzExternalRuntime,
} from 'shared/ReactFeatureFlags';

import type {
  Destination,
  Chunk,
  PrecomputedChunk,
} from 'react-server/src/ReactServerStreamConfig';

import {
  writeChunk,
  writeChunkAndReturn,
  stringToChunk,
  stringToPrecomputedChunk,
  clonePrecomputedChunk,
} from 'react-server/src/ReactServerStreamConfig';

import {
  getPropertyInfo,
  isAttributeNameSafe,
  BOOLEAN,
  OVERLOADED_BOOLEAN,
  NUMERIC,
  POSITIVE_NUMERIC,
} from '../shared/DOMProperty';
import {isUnitlessNumber} from '../shared/CSSProperty';

import {checkControlledValueProps} from '../shared/ReactControlledValuePropTypes';
import {validateProperties as validateARIAProperties} from '../shared/ReactDOMInvalidARIAHook';
import {validateProperties as validateInputProperties} from '../shared/ReactDOMNullInputValuePropHook';
import {validateProperties as validateUnknownProperties} from '../shared/ReactDOMUnknownPropertyHook';
import warnValidStyle from '../shared/warnValidStyle';

import escapeTextForBrowser from './escapeTextForBrowser';
import hyphenateStyleName from '../shared/hyphenateStyleName';
import hasOwnProperty from 'shared/hasOwnProperty';
import sanitizeURL from '../shared/sanitizeURL';
import isArray from 'shared/isArray';

import {
  preinitImpl,
  prepareToRenderResources,
  finishRenderingResources,
  resourcesFromScript,
  ReactDOMServerFloatDispatcher,
  expectCurrentResources,
  createStyleResource,
  createPreloadResource,
  createScriptResource,
  preloadAsStylePropsFromProps,
  stylePropsFromRawProps,
  adoptPreloadPropsForStyleProps,
  preloadPropsFromRawProps,
  preloadAsScriptPropsFromProps,
  scriptPropsFromRawProps,
  adoptPreloadPropsForScriptProps,
} from './ReactDOMFloatServer';
export {
  createResources,
  createBoundaryResources,
  setCurrentlyRenderingBoundaryResourcesTarget,
  hoistResources,
  hoistResourcesToRoot,
} from './ReactDOMFloatServer';
import {
  validateLinkPropsForStyleResource,
  validateStyleResourceDifference,
  validateLinkPropsForPreloadResource,
  validatePreloadResourceDifference,
  validateScriptResourceDifference,
} from '../shared/ReactDOMResourceValidation';

import {
  clientRenderBoundary as clientRenderFunctionString,
  completeBoundary as completeBoundaryFunctionString,
  completeContainer as completeContainerFunctionString,
  completeBoundaryWithStyles as styleInsertionFunctionString,
  completeSegment as completeSegmentFunctionString,
} from './fizz-instruction-set/ReactDOMFizzInstructionSetInlineCodeStrings';

import ReactDOMSharedInternals from 'shared/ReactDOMSharedInternals';
const ReactDOMCurrentDispatcher = ReactDOMSharedInternals.Dispatcher;

const ReactDOMServerDispatcher = enableFloat
  ? ReactDOMServerFloatDispatcher
  : {};

export function prepareToRender(resources: Resources): mixed {
  prepareToRenderResources(resources);

  const previousHostDispatcher = ReactDOMCurrentDispatcher.current;
  ReactDOMCurrentDispatcher.current = ReactDOMServerDispatcher;
  return previousHostDispatcher;
}

export function cleanupAfterRender(previousDispatcher: mixed) {
  finishRenderingResources();
  ReactDOMCurrentDispatcher.current = previousDispatcher;
}

// Used to distinguish these contexts from ones used in other renderers.
// E.g. this can be used to distinguish legacy renderers from this modern one.
export const isPrimaryRenderer = true;

export type StreamingFormat = 0 | 1;
const ScriptStreamingFormat: StreamingFormat = 0;
const DataStreamingFormat: StreamingFormat = 1;

export type DocumentStructureTag = number;
export const NONE: /*       */ DocumentStructureTag = 0b0000;
const HTML: /*              */ DocumentStructureTag = 0b0001;
const HEAD: /*              */ DocumentStructureTag = 0b0010;
const BODY: /*              */ DocumentStructureTag = 0b0100;
const HTML_HEAD_OR_BODY: /* */ DocumentStructureTag = 0b0111;
const FLOW: /*              */ DocumentStructureTag = 0b1000;

// Per response, global state that is not contextual to the rendering subtree.
export type ResponseState = {
  bootstrapChunks: Array<Chunk | PrecomputedChunk>,
  fallbackBootstrapChunks: void | Array<Chunk | PrecomputedChunk>,
  htmlChunks: Array<Chunk | PrecomputedChunk>,
  headChunks: Array<Chunk | PrecomputedChunk>,
  requiresEmbedding: boolean,
  rendered: DocumentStructureTag,
  flushed: DocumentStructureTag,
  charsetChunks: Array<Chunk | PrecomputedChunk>,
  hoistableChunks: Array<Chunk | PrecomputedChunk>,
  placeholderPrefix: PrecomputedChunk,
  segmentPrefix: PrecomputedChunk,
  boundaryPrefix: string,
  containerBoundaryID: SuspenseBoundaryID,
  idPrefix: string,
  nextSuspenseID: number,
  streamingFormat: StreamingFormat,
  // state for script streaming format, unused if using external runtime / data
  startInlineScript: PrecomputedChunk,
  sentCompleteSegmentFunction: boolean,
  sentCompleteBoundaryFunction: boolean,
  sentCompleteContainerFunction: boolean,
  sentClientRenderFunction: boolean,
  sentStyleInsertionFunction: boolean,
  // state for data streaming format
  externalRuntimeConfig: BootstrapScriptDescriptor | null,
  // We allow the legacy renderer to extend this object.
  ...
};

const dataElementQuotedEnd = stringToPrecomputedChunk('"></template>');

const startInlineScript = stringToPrecomputedChunk('<script>');
const endInlineScript = stringToPrecomputedChunk('</script>');

const startScriptSrc = stringToPrecomputedChunk('<script src="');
const startModuleSrc = stringToPrecomputedChunk('<script type="module" src="');
const scriptIntegirty = stringToPrecomputedChunk('" integrity="');
const endAsyncScript = stringToPrecomputedChunk('" async=""></script>');

/**
 * This escaping function is designed to work with bootstrapScriptContent only.
 * because we know we are escaping the entire script. We can avoid for instance
 * escaping html comment string sequences that are valid javascript as well because
 * if there are no sebsequent <script sequences the html parser will never enter
 * script data double escaped state (see: https://www.w3.org/TR/html53/syntax.html#script-data-double-escaped-state)
 *
 * While untrusted script content should be made safe before using this api it will
 * ensure that the script cannot be early terminated or never terminated state
 */
function escapeBootstrapScriptContent(scriptText: string) {
  if (__DEV__) {
    checkHtmlStringCoercion(scriptText);
  }
  return ('' + scriptText).replace(scriptRegex, scriptReplacer);
}
const scriptRegex = /(<\/|<)(s)(cript)/gi;
const scriptReplacer = (
  match: string,
  prefix: string,
  s: string,
  suffix: string,
) => `${prefix}${s === 's' ? '\\u0073' : '\\u0053'}${suffix}`;

export type BootstrapScriptDescriptor = {
  src: string,
  integrity?: string,
};
// Allows us to keep track of what we've already written so we can refer back to it.
// if passed externalRuntimeConfig and the enableFizzExternalRuntime feature flag
// is set, the server will send instructions via data attributes (instead of inline scripts)
export function createResponseState(
  identifierPrefix: string | void,
  nonce: string | void,
  bootstrapScriptContent: string | void,
  bootstrapScripts: $ReadOnlyArray<string | BootstrapScriptDescriptor> | void,
  bootstrapModules: $ReadOnlyArray<string | BootstrapScriptDescriptor> | void,
  fallbackBootstrapScriptContent: string | void,
  fallbackBootstrapScripts: $ReadOnlyArray<
    string | BootstrapScriptDescriptor,
  > | void,
  fallbackBootstrapModules: $ReadOnlyArray<
    string | BootstrapScriptDescriptor,
  > | void,
  externalRuntimeConfig: string | BootstrapScriptDescriptor | void,
  containerID: string | void,
  documentEmbedding: boolean | void,
): ResponseState {
  const idPrefix = identifierPrefix === undefined ? '' : identifierPrefix;
  const inlineScriptWithNonce =
    nonce === undefined
      ? startInlineScript
      : stringToPrecomputedChunk(
          '<script nonce="' + escapeTextForBrowser(nonce) + '">',
        );
  const bootstrapChunks: Array<Chunk | PrecomputedChunk> = [];
  let externalRuntimeDesc = null;
  let streamingFormat = ScriptStreamingFormat;
  if (bootstrapScriptContent !== undefined) {
    bootstrapChunks.push(
      inlineScriptWithNonce,
      stringToChunk(escapeBootstrapScriptContent(bootstrapScriptContent)),
      endInlineScript,
    );
  }
  if (enableFizzExternalRuntime) {
    if (!enableFloat) {
      throw new Error(
        'enableFizzExternalRuntime without enableFloat is not supported. This should never appear in production, since it means you are using a misconfigured React bundle.',
      );
    }
    if (externalRuntimeConfig !== undefined) {
      streamingFormat = DataStreamingFormat;
      if (typeof externalRuntimeConfig === 'string') {
        externalRuntimeDesc = {
          src: externalRuntimeConfig,
          integrity: undefined,
        };
      } else {
        externalRuntimeDesc = externalRuntimeConfig;
      }
    }
  }
  if (bootstrapScripts !== undefined) {
    for (let i = 0; i < bootstrapScripts.length; i++) {
      const scriptConfig = bootstrapScripts[i];
      const src =
        typeof scriptConfig === 'string' ? scriptConfig : scriptConfig.src;
      const integrity =
        typeof scriptConfig === 'string' ? undefined : scriptConfig.integrity;
      bootstrapChunks.push(
        startScriptSrc,
        stringToChunk(escapeTextForBrowser(src)),
      );
      if (integrity) {
        bootstrapChunks.push(
          scriptIntegirty,
          stringToChunk(escapeTextForBrowser(integrity)),
        );
      }
      bootstrapChunks.push(endAsyncScript);
    }
  }
  if (bootstrapModules !== undefined) {
    for (let i = 0; i < bootstrapModules.length; i++) {
      const scriptConfig = bootstrapModules[i];
      const src =
        typeof scriptConfig === 'string' ? scriptConfig : scriptConfig.src;
      const integrity =
        typeof scriptConfig === 'string' ? undefined : scriptConfig.integrity;
      bootstrapChunks.push(
        startModuleSrc,
        stringToChunk(escapeTextForBrowser(src)),
      );
      if (integrity) {
        bootstrapChunks.push(
          scriptIntegirty,
          stringToChunk(escapeTextForBrowser(integrity)),
        );
      }
      bootstrapChunks.push(endAsyncScript);
    }
  }

  const fallbackBootstrapChunks = [];
  if (fallbackBootstrapScriptContent !== undefined) {
    fallbackBootstrapChunks.push(
      inlineScriptWithNonce,
      stringToChunk(
        escapeBootstrapScriptContent(fallbackBootstrapScriptContent),
      ),
      endInlineScript,
    );
  }
  // We intentionally omit the rizz runtime for fallback bootstrap even if configured.
  // Even if it is configured the fallback bootstrap only executes if React errors at some Root
  // Boundary and in these cases there will be no instructions for the runtime to execute
  if (fallbackBootstrapScripts !== undefined) {
    for (let i = 0; i < fallbackBootstrapScripts.length; i++) {
      const scriptConfig = fallbackBootstrapScripts[i];
      const src =
        typeof scriptConfig === 'string' ? scriptConfig : scriptConfig.src;
      const integrity =
        typeof scriptConfig === 'string' ? undefined : scriptConfig.integrity;
      fallbackBootstrapChunks.push(
        startScriptSrc,
        stringToChunk(escapeTextForBrowser(src)),
      );
      if (integrity) {
        fallbackBootstrapChunks.push(
          scriptIntegirty,
          stringToChunk(escapeTextForBrowser(integrity)),
        );
      }
      fallbackBootstrapChunks.push(endAsyncScript);
    }
  }
  if (fallbackBootstrapModules !== undefined) {
    for (let i = 0; i < fallbackBootstrapModules.length; i++) {
      const scriptConfig = fallbackBootstrapModules[i];
      const src =
        typeof scriptConfig === 'string' ? scriptConfig : scriptConfig.src;
      const integrity =
        typeof scriptConfig === 'string' ? undefined : scriptConfig.integrity;
      fallbackBootstrapChunks.push(
        startModuleSrc,
        stringToChunk(escapeTextForBrowser(src)),
      );
      if (integrity) {
        fallbackBootstrapChunks.push(
          scriptIntegirty,
          stringToChunk(escapeTextForBrowser(integrity)),
        );
      }
      fallbackBootstrapChunks.push(endAsyncScript);
    }
  }

  return {
    bootstrapChunks: bootstrapChunks,
    fallbackBootstrapChunks: fallbackBootstrapChunks.length
      ? fallbackBootstrapChunks
      : undefined,
    htmlChunks: [],
    headChunks: [],
    requiresEmbedding: documentEmbedding === true,
    rendered: NONE,
    flushed: NONE,
    charsetChunks: [],
    hoistableChunks: [],
    placeholderPrefix: stringToPrecomputedChunk(idPrefix + 'P:'),
    segmentPrefix: stringToPrecomputedChunk(idPrefix + 'S:'),
    boundaryPrefix: idPrefix + 'B:',
    idPrefix: idPrefix,
    containerBoundaryID: containerID
      ? stringToPrecomputedChunk(containerID)
      : null,
    nextSuspenseID: 0,
    streamingFormat,
    startInlineScript: inlineScriptWithNonce,
    sentCompleteSegmentFunction: false,
    sentCompleteBoundaryFunction: false,
    sentCompleteContainerFunction: false,
    sentClientRenderFunction: false,
    sentStyleInsertionFunction: false,
    externalRuntimeConfig: externalRuntimeDesc,
  };
}

// Constants for the insertion mode we're currently writing in. We don't encode all HTML5 insertion
// modes. We only include the variants as they matter for the sake of our purposes.
// We don't actually provide the namespace therefore we use constants instead of the string.
const ROOT_HTML_MODE = 0; // Used for the root most element tag.
const HTML_HTML_MODE = 1; // mode for top level <html> element.
// We have a less than HTML_HTML_MODE check elsewhere. If you add more cases make cases here, make sure it
// still makes sense
export const HTML_MODE = 2;
const SVG_MODE = 3;
const MATHML_MODE = 4;
const HTML_TABLE_MODE = 5;
const HTML_TABLE_BODY_MODE = 6;
const HTML_TABLE_ROW_MODE = 7;
const HTML_COLGROUP_MODE = 8;
// We have a greater than HTML_TABLE_MODE check elsewhere. If you add more cases here, make sure it
// still makes sense

type InsertionMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// Lets us keep track of contextual state and pick it back up after suspending.
export type FormatContext = {
  insertionMode: InsertionMode, // root/svg/html/mathml/table
  selectedValue: null | string | Array<string>, // the selected value(s) inside a <select>, or null outside <select>
  noscriptTagInScope: boolean,
};

function createFormatContext(
  insertionMode: InsertionMode,
  selectedValue: null | string,
  noscriptTagInScope: boolean,
): FormatContext {
  return {
    insertionMode,
    selectedValue,
    noscriptTagInScope,
  };
}

export function createRootFormatContext(namespaceURI?: string): FormatContext {
  const insertionMode =
    namespaceURI === 'http://www.w3.org/2000/svg'
      ? SVG_MODE
      : namespaceURI === 'http://www.w3.org/1998/Math/MathML'
      ? MATHML_MODE
      : ROOT_HTML_MODE;
  return createFormatContext(insertionMode, null, false);
}

export function getChildFormatContext(
  parentContext: FormatContext,
  type: string,
  props: Object,
): FormatContext {
  switch (type) {
    case 'noscript':
      return createFormatContext(HTML_MODE, null, true);
    case 'select':
      return createFormatContext(
        HTML_MODE,
        props.value != null ? props.value : props.defaultValue,
        parentContext.noscriptTagInScope,
      );
    case 'svg':
      return createFormatContext(
        SVG_MODE,
        null,
        parentContext.noscriptTagInScope,
      );
    case 'math':
      return createFormatContext(
        MATHML_MODE,
        null,
        parentContext.noscriptTagInScope,
      );
    case 'foreignObject':
      return createFormatContext(
        HTML_MODE,
        null,
        parentContext.noscriptTagInScope,
      );
    // Table parents are special in that their children can only be created at all if they're
    // wrapped in a table parent. So we need to encode that we're entering this mode.
    case 'table':
      return createFormatContext(
        HTML_TABLE_MODE,
        null,
        parentContext.noscriptTagInScope,
      );
    case 'thead':
    case 'tbody':
    case 'tfoot':
      return createFormatContext(
        HTML_TABLE_BODY_MODE,
        null,
        parentContext.noscriptTagInScope,
      );
    case 'colgroup':
      return createFormatContext(
        HTML_COLGROUP_MODE,
        null,
        parentContext.noscriptTagInScope,
      );
    case 'tr':
      return createFormatContext(
        HTML_TABLE_ROW_MODE,
        null,
        parentContext.noscriptTagInScope,
      );
  }
  if (parentContext.insertionMode >= HTML_TABLE_MODE) {
    // Whatever tag this was, it wasn't a table parent or other special parent, so we must have
    // entered plain HTML again.
    return createFormatContext(
      HTML_MODE,
      null,
      parentContext.noscriptTagInScope,
    );
  }
  if (parentContext.insertionMode === ROOT_HTML_MODE) {
    // in ROOT_HTML_MODE it's not possible for a noscript tag to be
    // in scope so we use a false literal rather than forwarding
    // the parentContext value
    if (type === 'html') {
      return createFormatContext(HTML_HTML_MODE, null, false);
    }
    // We've emitted the root and is now in plain HTML mode.
    return createFormatContext(HTML_MODE, null, false);
  }
  return parentContext;
}

export type SuspenseBoundaryID = null | PrecomputedChunk;

export const UNINITIALIZED_SUSPENSE_BOUNDARY_ID: SuspenseBoundaryID = null;

export function assignSuspenseBoundaryID(
  responseState: ResponseState,
): SuspenseBoundaryID {
  const generatedID = responseState.nextSuspenseID++;
  return stringToPrecomputedChunk(
    responseState.boundaryPrefix + generatedID.toString(16),
  );
}

export function getRootBoundaryID(
  responseState: ResponseState,
): SuspenseBoundaryID {
  return responseState.containerBoundaryID;
}

export function makeId(
  responseState: ResponseState,
  treeId: string,
  localId: number,
): string {
  const idPrefix = responseState.idPrefix;

  let id = ':' + idPrefix + 'R' + treeId;

  // Unless this is the first id at this level, append a number at the end
  // that represents the position of this useId hook among all the useId
  // hooks for this fiber.
  if (localId > 0) {
    id += 'H' + localId.toString(32);
  }

  return id + ':';
}

function encodeHTMLTextNode(text: string): string {
  return escapeTextForBrowser(text);
}

const textSeparator = stringToPrecomputedChunk('<!-- -->');

export function pushTextInstance(
  target: Array<Chunk | PrecomputedChunk>,
  text: string,
  responseState: ResponseState,
  textEmbedded: boolean,
): boolean {
  if (text === '') {
    // Empty text doesn't have a DOM node representation and the hydration is aware of this.
    return textEmbedded;
  }
  if (textEmbedded) {
    target.push(textSeparator);
  }
  target.push(stringToChunk(encodeHTMLTextNode(text)));
  return true;
}

// Called when Fizz is done with a Segment. Currently the only purpose is to conditionally
// emit a text separator when we don't know for sure it is safe to omit
export function pushSegmentFinale(
  target: Array<Chunk | PrecomputedChunk>,
  responseState: ResponseState,
  lastPushedText: boolean,
  textEmbedded: boolean,
): void {
  if (lastPushedText && textEmbedded) {
    target.push(textSeparator);
  }
}

const styleNameCache: Map<string, PrecomputedChunk> = new Map();
function processStyleName(styleName: string): PrecomputedChunk {
  const chunk = styleNameCache.get(styleName);
  if (chunk !== undefined) {
    return chunk;
  }
  const result = stringToPrecomputedChunk(
    escapeTextForBrowser(hyphenateStyleName(styleName)),
  );
  styleNameCache.set(styleName, result);
  return result;
}

const styleAttributeStart = stringToPrecomputedChunk(' style="');
const styleAssign = stringToPrecomputedChunk(':');
const styleSeparator = stringToPrecomputedChunk(';');

function pushStyle(
  target: Array<Chunk | PrecomputedChunk>,
  responseState: ResponseState,
  style: Object,
): void {
  if (typeof style !== 'object') {
    throw new Error(
      'The `style` prop expects a mapping from style properties to values, ' +
        "not a string. For example, style={{marginRight: spacing + 'em'}} when " +
        'using JSX.',
    );
  }

  let isFirst = true;
  for (const styleName in style) {
    if (!hasOwnProperty.call(style, styleName)) {
      continue;
    }
    // If you provide unsafe user data here they can inject arbitrary CSS
    // which may be problematic (I couldn't repro this):
    // https://www.owasp.org/index.php/XSS_Filter_Evasion_Cheat_Sheet
    // http://www.thespanner.co.uk/2007/11/26/ultimate-xss-css-injection/
    // This is not an XSS hole but instead a potential CSS injection issue
    // which has lead to a greater discussion about how we're going to
    // trust URLs moving forward. See #2115901
    const styleValue = style[styleName];
    if (
      styleValue == null ||
      typeof styleValue === 'boolean' ||
      styleValue === ''
    ) {
      // TODO: We used to set empty string as a style with an empty value. Does that ever make sense?
      continue;
    }

    let nameChunk;
    let valueChunk;
    const isCustomProperty = styleName.indexOf('--') === 0;
    if (isCustomProperty) {
      nameChunk = stringToChunk(escapeTextForBrowser(styleName));
      if (__DEV__) {
        checkCSSPropertyStringCoercion(styleValue, styleName);
      }
      valueChunk = stringToChunk(
        escapeTextForBrowser(('' + styleValue).trim()),
      );
    } else {
      if (__DEV__) {
        warnValidStyle(styleName, styleValue);
      }

      nameChunk = processStyleName(styleName);
      if (typeof styleValue === 'number') {
        if (
          styleValue !== 0 &&
          !hasOwnProperty.call(isUnitlessNumber, styleName)
        ) {
          valueChunk = stringToChunk(styleValue + 'px'); // Presumes implicit 'px' suffix for unitless numbers
        } else {
          valueChunk = stringToChunk('' + styleValue);
        }
      } else {
        if (__DEV__) {
          checkCSSPropertyStringCoercion(styleValue, styleName);
        }
        valueChunk = stringToChunk(
          escapeTextForBrowser(('' + styleValue).trim()),
        );
      }
    }
    if (isFirst) {
      isFirst = false;
      // If it's first, we don't need any separators prefixed.
      target.push(styleAttributeStart, nameChunk, styleAssign, valueChunk);
    } else {
      target.push(styleSeparator, nameChunk, styleAssign, valueChunk);
    }
  }
  if (!isFirst) {
    target.push(attributeEnd);
  }
}

const attributeSeparator = stringToPrecomputedChunk(' ');
const attributeAssign = stringToPrecomputedChunk('="');
const attributeEnd = stringToPrecomputedChunk('"');
const attributeEmptyString = stringToPrecomputedChunk('=""');

function pushAttribute(
  target: Array<Chunk | PrecomputedChunk>,
  responseState: ResponseState,
  name: string,
  value: string | boolean | number | Function | Object, // not null or undefined
): void {
  switch (name) {
    case 'style': {
      pushStyle(target, responseState, value);
      return;
    }
    case 'defaultValue':
    case 'defaultChecked': // These shouldn't be set as attributes on generic HTML elements.
    case 'innerHTML': // Must use dangerouslySetInnerHTML instead.
    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
      // Ignored. These are built-in to React on the client.
      return;
  }
  if (
    // shouldIgnoreAttribute
    // We have already filtered out null/undefined and reserved words.
    name.length > 2 &&
    (name[0] === 'o' || name[0] === 'O') &&
    (name[1] === 'n' || name[1] === 'N')
  ) {
    return;
  }

  const propertyInfo = getPropertyInfo(name);
  if (propertyInfo !== null) {
    // shouldRemoveAttribute
    switch (typeof value) {
      case 'function':
      case 'symbol': // eslint-disable-line
        return;
      case 'boolean': {
        if (!propertyInfo.acceptsBooleans) {
          return;
        }
      }
    }
    if (enableFilterEmptyStringAttributesDOM) {
      if (propertyInfo.removeEmptyString && value === '') {
        if (__DEV__) {
          if (name === 'src') {
            console.error(
              'An empty string ("") was passed to the %s attribute. ' +
                'This may cause the browser to download the whole page again over the network. ' +
                'To fix this, either do not render the element at all ' +
                'or pass null to %s instead of an empty string.',
              name,
              name,
            );
          } else {
            console.error(
              'An empty string ("") was passed to the %s attribute. ' +
                'To fix this, either do not render the element at all ' +
                'or pass null to %s instead of an empty string.',
              name,
              name,
            );
          }
        }
        return;
      }
    }

    const attributeName = propertyInfo.attributeName;
    const attributeNameChunk = stringToChunk(attributeName); // TODO: If it's known we can cache the chunk.

    switch (propertyInfo.type) {
      case BOOLEAN:
        if (value) {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeEmptyString,
          );
        }
        return;
      case OVERLOADED_BOOLEAN:
        if (value === true) {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeEmptyString,
          );
        } else if (value === false) {
          // Ignored
        } else {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeAssign,
            stringToChunk(escapeTextForBrowser(value)),
            attributeEnd,
          );
        }
        return;
      case NUMERIC:
        if (!isNaN(value)) {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeAssign,
            stringToChunk(escapeTextForBrowser(value)),
            attributeEnd,
          );
        }
        break;
      case POSITIVE_NUMERIC:
        if (!isNaN(value) && (value: any) >= 1) {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeAssign,
            stringToChunk(escapeTextForBrowser(value)),
            attributeEnd,
          );
        }
        break;
      default:
        if (propertyInfo.sanitizeURL) {
          if (__DEV__) {
            checkAttributeStringCoercion(value, attributeName);
          }
          value = '' + (value: any);
          sanitizeURL(value);
        }
        target.push(
          attributeSeparator,
          attributeNameChunk,
          attributeAssign,
          stringToChunk(escapeTextForBrowser(value)),
          attributeEnd,
        );
    }
  } else if (isAttributeNameSafe(name)) {
    // shouldRemoveAttribute
    switch (typeof value) {
      case 'function':
      case 'symbol': // eslint-disable-line
        return;
      case 'boolean': {
        const prefix = name.toLowerCase().slice(0, 5);
        if (prefix !== 'data-' && prefix !== 'aria-') {
          return;
        }
      }
    }
    target.push(
      attributeSeparator,
      stringToChunk(name),
      attributeAssign,
      stringToChunk(escapeTextForBrowser(value)),
      attributeEnd,
    );
  }
}

const endOfStartTag = stringToPrecomputedChunk('>');
const endOfStartTagSelfClosing = stringToPrecomputedChunk('/>');

function pushInnerHTML(
  target: Array<Chunk | PrecomputedChunk>,
  innerHTML: any,
  children: any,
) {
  if (innerHTML != null) {
    if (children != null) {
      throw new Error(
        'Can only set one of `children` or `props.dangerouslySetInnerHTML`.',
      );
    }

    if (typeof innerHTML !== 'object' || !('__html' in innerHTML)) {
      throw new Error(
        '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
          'Please visit https://reactjs.org/link/dangerously-set-inner-html ' +
          'for more information.',
      );
    }

    const html = innerHTML.__html;
    if (html !== null && html !== undefined) {
      if (__DEV__) {
        checkHtmlStringCoercion(html);
      }
      target.push(stringToChunk('' + html));
    }
  }
}

// TODO: Move these to ResponseState so that we warn for every request.
// It would help debugging in stateful servers (e.g. service worker).
let didWarnDefaultInputValue = false;
let didWarnDefaultChecked = false;
let didWarnDefaultSelectValue = false;
let didWarnDefaultTextareaValue = false;
let didWarnInvalidOptionChildren = false;
let didWarnInvalidOptionInnerHTML = false;
let didWarnSelectedSetOnOption = false;

function checkSelectProp(props: any, propName: string) {
  if (__DEV__) {
    const value = props[propName];
    if (value != null) {
      const array = isArray(value);
      if (props.multiple && !array) {
        console.error(
          'The `%s` prop supplied to <select> must be an array if ' +
            '`multiple` is true.',
          propName,
        );
      } else if (!props.multiple && array) {
        console.error(
          'The `%s` prop supplied to <select> must be a scalar ' +
            'value if `multiple` is false.',
          propName,
        );
      }
    }
  }
}

function pushStartSelect(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
): ReactNodeList {
  if (__DEV__) {
    checkControlledValueProps('select', props);

    checkSelectProp(props, 'value');
    checkSelectProp(props, 'defaultValue');

    if (
      props.value !== undefined &&
      props.defaultValue !== undefined &&
      !didWarnDefaultSelectValue
    ) {
      console.error(
        'Select elements must be either controlled or uncontrolled ' +
          '(specify either the value prop, or the defaultValue prop, but not ' +
          'both). Decide between using a controlled or uncontrolled select ' +
          'element and remove one of these props. More info: ' +
          'https://reactjs.org/link/controlled-components',
      );
      didWarnDefaultSelectValue = true;
    }
  }

  target.push(startChunkForTag('select'));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          // TODO: This doesn't really make sense for select since it can't use the controlled
          // value in the innerHTML.
          innerHTML = propValue;
          break;
        case 'defaultValue':
        case 'value':
          // These are set on the Context instead and applied to the nested options.
          break;
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

function flattenOptionChildren(children: mixed): string {
  let content = '';
  // Flatten children and warn if they aren't strings or numbers;
  // invalid types are ignored.
  Children.forEach((children: any), function(child) {
    if (child == null) {
      return;
    }
    content += (child: any);
    if (__DEV__) {
      if (
        !didWarnInvalidOptionChildren &&
        typeof child !== 'string' &&
        typeof child !== 'number'
      ) {
        didWarnInvalidOptionChildren = true;
        console.error(
          'Cannot infer the option value of complex children. ' +
            'Pass a `value` prop or use a plain string as children to <option>.',
        );
      }
    }
  });
  return content;
}

const selectedMarkerAttribute = stringToPrecomputedChunk(' selected=""');

function pushStartOption(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
  formatContext: FormatContext,
): ReactNodeList {
  const selectedValue = formatContext.selectedValue;

  target.push(startChunkForTag('option'));

  let children = null;
  let value = null;
  let selected = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'selected':
          // ignore
          selected = propValue;
          if (__DEV__) {
            // TODO: Remove support for `selected` in <option>.
            if (!didWarnSelectedSetOnOption) {
              console.error(
                'Use the `defaultValue` or `value` props on <select> instead of ' +
                  'setting `selected` on <option>.',
              );
              didWarnSelectedSetOnOption = true;
            }
          }
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        // eslint-disable-next-line-no-fallthrough
        case 'value':
          value = propValue;
        // We intentionally fallthrough to also set the attribute on the node.
        // eslint-disable-next-line-no-fallthrough
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  if (selectedValue != null) {
    let stringValue;
    if (value !== null) {
      if (__DEV__) {
        checkAttributeStringCoercion(value, 'value');
      }
      stringValue = '' + value;
    } else {
      if (__DEV__) {
        if (innerHTML !== null) {
          if (!didWarnInvalidOptionInnerHTML) {
            didWarnInvalidOptionInnerHTML = true;
            console.error(
              'Pass a `value` prop if you set dangerouslyInnerHTML so React knows ' +
                'which value should be selected.',
            );
          }
        }
      }
      stringValue = flattenOptionChildren(children);
    }
    if (isArray(selectedValue)) {
      // multiple
      for (let i = 0; i < selectedValue.length; i++) {
        if (__DEV__) {
          checkAttributeStringCoercion(selectedValue[i], 'value');
        }
        const v = '' + selectedValue[i];
        if (v === stringValue) {
          target.push(selectedMarkerAttribute);
          break;
        }
      }
    } else {
      if (__DEV__) {
        checkAttributeStringCoercion(selectedValue, 'select.value');
      }
      if ('' + selectedValue === stringValue) {
        target.push(selectedMarkerAttribute);
      }
    }
  } else if (selected) {
    target.push(selectedMarkerAttribute);
  }

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

function pushInput(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
): ReactNodeList {
  if (__DEV__) {
    checkControlledValueProps('input', props);

    if (
      props.checked !== undefined &&
      props.defaultChecked !== undefined &&
      !didWarnDefaultChecked
    ) {
      console.error(
        '%s contains an input of type %s with both checked and defaultChecked props. ' +
          'Input elements must be either controlled or uncontrolled ' +
          '(specify either the checked prop, or the defaultChecked prop, but not ' +
          'both). Decide between using a controlled or uncontrolled input ' +
          'element and remove one of these props. More info: ' +
          'https://reactjs.org/link/controlled-components',
        'A component',
        props.type,
      );
      didWarnDefaultChecked = true;
    }
    if (
      props.value !== undefined &&
      props.defaultValue !== undefined &&
      !didWarnDefaultInputValue
    ) {
      console.error(
        '%s contains an input of type %s with both value and defaultValue props. ' +
          'Input elements must be either controlled or uncontrolled ' +
          '(specify either the value prop, or the defaultValue prop, but not ' +
          'both). Decide between using a controlled or uncontrolled input ' +
          'element and remove one of these props. More info: ' +
          'https://reactjs.org/link/controlled-components',
        'A component',
        props.type,
      );
      didWarnDefaultInputValue = true;
    }
  }

  target.push(startChunkForTag('input'));

  let value = null;
  let defaultValue = null;
  let checked = null;
  let defaultChecked = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${'input'} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        // eslint-disable-next-line-no-fallthrough
        case 'defaultChecked':
          defaultChecked = propValue;
          break;
        case 'defaultValue':
          defaultValue = propValue;
          break;
        case 'checked':
          checked = propValue;
          break;
        case 'value':
          value = propValue;
          break;
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  if (checked !== null) {
    pushAttribute(target, responseState, 'checked', checked);
  } else if (defaultChecked !== null) {
    pushAttribute(target, responseState, 'checked', defaultChecked);
  }
  if (value !== null) {
    pushAttribute(target, responseState, 'value', value);
  } else if (defaultValue !== null) {
    pushAttribute(target, responseState, 'value', defaultValue);
  }

  target.push(endOfStartTagSelfClosing);
  return null;
}

function pushStartTextArea(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
): ReactNodeList {
  if (__DEV__) {
    checkControlledValueProps('textarea', props);
    if (
      props.value !== undefined &&
      props.defaultValue !== undefined &&
      !didWarnDefaultTextareaValue
    ) {
      console.error(
        'Textarea elements must be either controlled or uncontrolled ' +
          '(specify either the value prop, or the defaultValue prop, but not ' +
          'both). Decide between using a controlled or uncontrolled textarea ' +
          'and remove one of these props. More info: ' +
          'https://reactjs.org/link/controlled-components',
      );
      didWarnDefaultTextareaValue = true;
    }
  }

  target.push(startChunkForTag('textarea'));

  let value = null;
  let defaultValue = null;
  let children = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'value':
          value = propValue;
          break;
        case 'defaultValue':
          defaultValue = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          throw new Error(
            '`dangerouslySetInnerHTML` does not make sense on <textarea>.',
          );
        // eslint-disable-next-line-no-fallthrough
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }
  if (value === null && defaultValue !== null) {
    value = defaultValue;
  }

  target.push(endOfStartTag);

  // TODO (yungsters): Remove support for children content in <textarea>.
  if (children != null) {
    if (__DEV__) {
      console.error(
        'Use the `defaultValue` or `value` props instead of setting ' +
          'children on <textarea>.',
      );
    }

    if (value != null) {
      throw new Error(
        'If you supply `defaultValue` on a <textarea>, do not pass children.',
      );
    }

    if (isArray(children)) {
      if (children.length > 1) {
        throw new Error('<textarea> can only have at most one child.');
      }

      // TODO: remove the coercion and the DEV check below because it will
      // always be overwritten by the coercion several lines below it. #22309
      if (__DEV__) {
        checkHtmlStringCoercion(children[0]);
      }
      value = '' + children[0];
    }
    if (__DEV__) {
      checkHtmlStringCoercion(children);
    }
    value = '' + children;
  }

  if (typeof value === 'string' && value[0] === '\n') {
    // text/html ignores the first character in these tags if it's a newline
    // Prefer to break application/xml over text/html (for now) by adding
    // a newline specifically to get eaten by the parser. (Alternately for
    // textareas, replacing "^\n" with "\r\n" doesn't get eaten, and the first
    // \r is normalized out by HTMLTextAreaElement#value.)
    // See: <http://www.w3.org/TR/html-polyglot/#newlines-in-textarea-and-pre>
    // See: <http://www.w3.org/TR/html5/syntax.html#element-restrictions>
    // See: <http://www.w3.org/TR/html5/syntax.html#newlines>
    // See: Parsing of "textarea" "listing" and "pre" elements
    //  from <http://www.w3.org/TR/html5/syntax.html#parsing-main-inbody>
    target.push(leadingNewline);
  }

  // ToString and push directly instead of recurse over children.
  // We don't really support complex children in the value anyway.
  // This also currently avoids a trailing comment node which breaks textarea.
  if (value !== null) {
    if (__DEV__) {
      checkAttributeStringCoercion(value, 'value');
    }
    target.push(stringToChunk(encodeHTMLTextNode('' + value)));
  }

  return null;
}

function pushMeta(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
  textEmbedded: boolean,
  noscriptTagInScope: boolean,
): ReactNodeList {
  if (enableFloat) {
    if (noscriptTagInScope) {
      return pushSelfClosing(target, props, 'meta', responseState);
    }
    if (textEmbedded) {
      // This meta tag is not going to emit in place and we are adjacent to text.
      // We defensively emit a textSeparator in case the next chunk is text.
      target.push(textSeparator);
    }
    if (props.charSet != null) {
      pushSelfClosing(
        responseState.charsetChunks,
        props,
        'meta',
        responseState,
      );
    } else {
      pushSelfClosing(
        responseState.hoistableChunks,
        props,
        'meta',
        responseState,
      );
    }
    return null;
  } else {
    return pushSelfClosing(target, props, 'meta', responseState);
  }
}

function pushLink(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
  textEmbedded: boolean,
  noscriptTagInScope: boolean,
): ReactNodeList {
  if (enableFloat) {
    if (noscriptTagInScope) {
      return pushLinkImpl(target, props, responseState);
    }
    if (textEmbedded) {
      // This link follows text but we aren't writing a tag. while not as efficient as possible we need
      // to be safe and assume text will follow by inserting a textSeparator
      target.push(textSeparator);
    }

    const resources = expectCurrentResources();

    const {rel, href} = props;
    if (!href || typeof href !== 'string' || !rel || typeof rel !== 'string') {
      return false;
    }

    let key = '';
    switch (rel) {
      case 'stylesheet': {
        const {onLoad, onError, precedence, disabled} = props;
        if (
          typeof precedence !== 'string' ||
          onLoad ||
          onError ||
          disabled != null
        ) {
          // This stylesheet is either not opted into Resource semantics or has conflicting properties which
          // disqualify it for such. We can still create a preload resource to help it load faster on the
          // client
          if (__DEV__) {
            validateLinkPropsForStyleResource(props);
          }
          let preloadResource = resources.preloadsMap.get(href);
          if (!preloadResource) {
            preloadResource = createPreloadResource(
              resources,
              href,
              'style',
              preloadAsStylePropsFromProps(href, props),
            );
            if (__DEV__) {
              (preloadResource: any)._dev_implicit_construction = true;
            }
            resources.usedStylePreloads.add(preloadResource);
          }
          // This link is neither a Resource nor Hoistable. we write it as normal chunks
          return pushLinkImpl(target, props, responseState);
        } else {
          // We are able to convert this link element to a resource exclusively. We construct the relevant Resource
          // and return true indicating that this link was fully consumed.
          let resource = resources.stylesMap.get(href);

          if (resource) {
            if (__DEV__) {
              const resourceProps = stylePropsFromRawProps(
                href,
                precedence,
                props,
              );
              adoptPreloadPropsForStyleProps(
                resourceProps,
                resource.hint.props,
              );
              validateStyleResourceDifference(resource.props, resourceProps);
            }
          } else {
            const resourceProps = stylePropsFromRawProps(
              href,
              precedence,
              props,
            );
            resource = createStyleResource(
              // $FlowFixMe[incompatible-call] found when upgrading Flow
              resources,
              href,
              precedence,
              resourceProps,
            );
            resources.usedStylePreloads.add(resource.hint);
          }
          if (resources.boundaryResources) {
            resources.boundaryResources.add(resource);
          } else {
            resource.set.add(resource);
          }
          // This was turned into a Resource
          return null;
        }
      }
      case 'preload': {
        const {as} = props;
        switch (as) {
          case 'script':
          case 'style':
          case 'font': {
            if (__DEV__) {
              validateLinkPropsForPreloadResource(props);
            }
            let resource = resources.preloadsMap.get(href);
            if (resource) {
              if (__DEV__) {
                const originallyImplicit =
                  (resource: any)._dev_implicit_construction === true;
                const latestProps = preloadPropsFromRawProps(href, as, props);
                validatePreloadResourceDifference(
                  resource.props,
                  originallyImplicit,
                  latestProps,
                  false,
                );
              }
            } else {
              resource = createPreloadResource(
                resources,
                href,
                as,
                preloadPropsFromRawProps(href, as, props),
              );
              switch (as) {
                case 'script': {
                  resources.explicitScriptPreloads.add(resource);
                  break;
                }
                case 'style': {
                  resources.explicitStylePreloads.add(resource);
                  break;
                }
                case 'font': {
                  resources.fontPreloads.add(resource);
                  break;
                }
              }
            }
            // This was turned into a resource
            return null;
          }
        }
        break;
      }
    }
    if (props.onLoad || props.onError) {
      // When a link has these props we can't treat it is a Resource but if we rendered it on the
      // server it would look like a Resource in the rendered html (the onLoad/onError aren't emitted)
      // Instead we expect the client to insert them rather than hydrate them which also guarantees
      // that the onLoad and onError won't fire before the event handlers are attached
      return null;
    }

    // This link is Hoistable
    pushLinkImpl(responseState.hoistableChunks, props, responseState);
    return null;
  } else {
    return pushLinkImpl(target, props, responseState);
  }
}

function pushLinkImpl(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
): ReactNodeList {
  const isStylesheet = props.rel === 'stylesheet';
  target.push(startChunkForTag('link'));

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${'link'} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        case 'precedence': {
          if (enableFloat && isStylesheet) {
            // precedence is a reversed property for stylesheets to opt-into resource semantcs
            continue;
          }
          // intentionally fall through
        }
        // eslint-disable-next-line-no-fallthrough
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTagSelfClosing);
  return null;
}

function pushSelfClosing(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  tag: string,
  responseState: ResponseState,
): ReactNodeList {
  target.push(startChunkForTag(tag));

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${tag} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        // eslint-disable-next-line-no-fallthrough
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTagSelfClosing);
  return null;
}

function pushStartMenuItem(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
): ReactNodeList {
  target.push(startChunkForTag('menuitem'));

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            'menuitems cannot have `children` nor `dangerouslySetInnerHTML`.',
          );
        // eslint-disable-next-line-no-fallthrough
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag);
  return null;
}

function pushTitle(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
  insertionMode: InsertionMode,
  noscriptTagInScope: boolean,
): ReactNodeList {
  if (__DEV__) {
    const children = props.children;
    const childForValidation =
      Array.isArray(children) && children.length < 2
        ? children[0] || null
        : children;
    if (Array.isArray(children) && children.length > 1) {
      console.error(
        'A title element received an array with more than 1 element as children. ' +
          'In browsers title Elements can only have Text Nodes as children. If ' +
          'the children being rendered output more than a single text node in aggregate the browser ' +
          'will display markup and comments as text in the title and hydration will likely fail and ' +
          'fall back to client rendering',
      );
    } else if (
      childForValidation != null &&
      childForValidation.$$typeof != null
    ) {
      console.error(
        'A title element received a React element for children. ' +
          'In the browser title Elements can only have Text Nodes as children. If ' +
          'the children being rendered output more than a single text node in aggregate the browser ' +
          'will display markup and comments as text in the title and hydration will likely fail and ' +
          'fall back to client rendering',
      );
    } else if (
      childForValidation != null &&
      typeof childForValidation !== 'string' &&
      typeof childForValidation !== 'number'
    ) {
      console.error(
        'A title element received a value that was not a string or number for children. ' +
          'In the browser title Elements can only have Text Nodes as children. If ' +
          'the children being rendered output more than a single text node in aggregate the browser ' +
          'will display markup and comments as text in the title and hydration will likely fail and ' +
          'fall back to client rendering',
      );
    }
  }

  if (enableFloat) {
    if (insertionMode === SVG_MODE || noscriptTagInScope) {
      return pushTitleImpl(target, props, responseState);
    } else {
      pushTitleImpl(responseState.hoistableChunks, props, responseState);
      return null;
    }
  } else {
    return pushTitleImpl(target, props, responseState);
  }
}

function pushTitleImpl(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
): null {
  target.push(startChunkForTag('title'));

  let children = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          throw new Error(
            '`dangerouslySetInnerHTML` does not make sense on <title>.',
          );
        // eslint-disable-next-line-no-fallthrough
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }
  target.push(endOfStartTag);

  const child = Array.isArray(children)
    ? children.length < 2
      ? children[0]
      : null
    : children;
  if (
    typeof child !== 'function' &&
    typeof child !== 'symbol' &&
    child !== null &&
    child !== undefined
  ) {
    // eslint-disable-next-line react-internal/safe-string-coercion
    target.push(stringToChunk(escapeTextForBrowser('' + child)));
  }
  target.push(endTag1, stringToChunk('title'), endTag2);
  return null;
}

function pushStartTitle(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
): ReactNodeList {
  target.push(startChunkForTag('title'));

  let children = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          throw new Error(
            '`dangerouslySetInnerHTML` does not make sense on <title>.',
          );
        // eslint-disable-next-line-no-fallthrough
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }
  target.push(endOfStartTag);

  if (__DEV__) {
    const childForValidation =
      Array.isArray(children) && children.length < 2
        ? children[0] || null
        : children;
    if (Array.isArray(children) && children.length > 1) {
      console.error(
        'A title element received an array with more than 1 element as children. ' +
          'In browsers title Elements can only have Text Nodes as children. If ' +
          'the children being rendered output more than a single text node in aggregate the browser ' +
          'will display markup and comments as text in the title and hydration will likely fail and ' +
          'fall back to client rendering',
      );
    } else if (
      childForValidation != null &&
      childForValidation.$$typeof != null
    ) {
      console.error(
        'A title element received a React element for children. ' +
          'In the browser title Elements can only have Text Nodes as children. If ' +
          'the children being rendered output more than a single text node in aggregate the browser ' +
          'will display markup and comments as text in the title and hydration will likely fail and ' +
          'fall back to client rendering',
      );
    } else if (
      childForValidation != null &&
      typeof childForValidation !== 'string' &&
      typeof childForValidation !== 'number'
    ) {
      console.error(
        'A title element received a value that was not a string or number for children. ' +
          'In the browser title Elements can only have Text Nodes as children. If ' +
          'the children being rendered output more than a single text node in aggregate the browser ' +
          'will display markup and comments as text in the title and hydration will likely fail and ' +
          'fall back to client rendering',
      );
    }
  }

  return children;
}

function pushStartHtml(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
  formatContext: FormatContext,
): ReactNodeList {
  if (enableFloat) {
    if (formatContext.insertionMode === ROOT_HTML_MODE) {
      responseState.rendered |= HTML;
      if (
        responseState.requiresEmbedding &&
        hasOwnProperty.call(props, 'dangerouslySetInnerHTML')
      ) {
        // We only enforce this restriction with new APIs like `renderIntoDocument` which
        // we currently feature detect with `requiresEmbedding`.
        // @TODO In a major version lets enforce this restriction globally
        throw new Error(
          'An <html> tag was rendered with a `dangerouslySetInnerHTML` prop while using `renderIntoDocument`. React does not support this; use a `children` prop instead',
        );
      }

      let children = null;
      let innerHTML = null;
      let renderedAttributeProps: Map<string, any>;
      if (__DEV__) {
        renderedAttributeProps = new Map();
      }

      const htmlChunks = responseState.htmlChunks;

      if (htmlChunks.length === 0) {
        htmlChunks.push(DOCTYPE);
        htmlChunks.push(startChunkForTag('html'));
        for (const propKey in props) {
          if (hasOwnProperty.call(props, propKey)) {
            const propValue = props[propKey];
            if (propValue == null) {
              continue;
            }
            switch (propKey) {
              case 'children':
                children = propValue;
                break;
              case 'dangerouslySetInnerHTML':
                innerHTML = propValue;
                break;
              default:
                if (__DEV__ && renderedAttributeProps) {
                  renderedAttributeProps.set(propKey, propValue);
                }
                pushAttribute(htmlChunks, responseState, propKey, propValue);
                break;
            }
          }
        }
        htmlChunks.push(endOfStartTag);
      } else {
        // If we have already flushed the preamble then we elide the <head>
        // tag itself but still return children and handle innerHTML
        for (const propKey in props) {
          if (hasOwnProperty.call(props, propKey)) {
            const propValue = props[propKey];
            if (propValue == null) {
              continue;
            }
            switch (propKey) {
              case 'children':
                children = propValue;
                break;
              case 'dangerouslySetInnerHTML':
                innerHTML = propValue;
                break;
              default:
                if (__DEV__ && renderedAttributeProps) {
                  renderedAttributeProps.set(propKey, propValue);
                }
                break;
            }
          }
        }
      }
      if (__DEV__) {
        const priorHtmlAttributes = (responseState: any).htmlAttributeMap;
        const inFallback = (responseState: any).inFallbackDEV === true;
        if (inFallback && priorHtmlAttributes && renderedAttributeProps) {
          let differentProps = '';
          priorHtmlAttributes.forEach(([propKey, propValue]) => {
            if (renderedAttributeProps.get(propKey) !== propValue) {
              if (differentProps.length === 0) {
                differentProps += '\n  ' + propKey;
              } else {
                differentProps += ', ' + propKey;
              }
            }
          });
          if (differentProps) {
            console.error(
              'React encountered differing props when rendering the root <html> element of' +
                ' the fallback children when using `renderIntoDocument`. When using `renderIntoDocument`' +
                ' React will often emit the <html> tag early, before the we know whether the' +
                ' Shell has finished. If the Shell errors and the fallback children are rendered' +
                ' the props used on the <html> tag of the fallback tree will be ignored.' +
                ' The props that differed in this instance are provided below.%s',
              differentProps,
            );
          }
        }
      }
      pushInnerHTML(target, innerHTML, children);
      return children;
    } else {
      // This is an <html> element deeper in the tree and should be rendered in place
      return pushStartGenericElement(target, props, 'html', responseState);
    }
  } else {
    if (formatContext.insertionMode === ROOT_HTML_MODE) {
      // If we're rendering the html tag and we're at the root (i.e. not in foreignObject)
      // then we also emit the DOCTYPE as part of the root content as a convenience for
      // rendering the whole document.
      target.push(DOCTYPE);
    }
    return pushStartGenericElement(target, props, 'html', responseState);
  }
}

function pushStartHead(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
  formatContext: FormatContext,
): ReactNodeList {
  if (enableFloat && formatContext.insertionMode <= HTML_HTML_MODE) {
    responseState.rendered |= HEAD;
    let children = null;
    let innerHTML = null;
    let attributePropsIncluded = false;

    if (
      responseState.requiresEmbedding &&
      hasOwnProperty.call(props, 'dangerouslySetInnerHTML')
    ) {
      // We only enforce this restriction with new APIs like `renderIntoDocument` which
      // we currently feature detect with `requiresEmbedding`.
      // @TODO In a major version lets enforce this restriction globally
      throw new Error(
        'A <head> tag was rendered with a `dangerouslySetInnerHTML` prop while using `renderIntoDocument`. React does not support this; use a `children` prop instead',
      );
    }

    const headChunks = responseState.headChunks;

    if (headChunks.length === 0) {
      headChunks.push(startChunkForTag('head'));
      for (const propKey in props) {
        if (hasOwnProperty.call(props, propKey)) {
          const propValue = props[propKey];
          if (propValue == null) {
            continue;
          }
          switch (propKey) {
            case 'children':
              children = propValue;
              break;
            case 'dangerouslySetInnerHTML':
              innerHTML = propValue;
              break;
            default:
              if (__DEV__) {
                attributePropsIncluded = true;
              }
              pushAttribute(headChunks, responseState, propKey, propValue);
              break;
          }
        }
      }
      headChunks.push(endOfStartTag);
    } else {
      // If we have already flushed the preamble then we elide the <head>
      // tag itself but still return children and handle innerHTML
      for (const propKey in props) {
        if (hasOwnProperty.call(props, propKey)) {
          const propValue = props[propKey];
          if (propValue == null) {
            continue;
          }
          switch (propKey) {
            case 'children':
              children = propValue;
              break;
            case 'dangerouslySetInnerHTML':
              innerHTML = propValue;
              break;
            default:
              if (__DEV__) {
                attributePropsIncluded = true;
              }
              break;
          }
        }
      }
    }

    if (__DEV__) {
      if (responseState.requiresEmbedding && attributePropsIncluded) {
        // We use this requiresEmbedding flag a heuristic for whether we are rendering with renderIntoDocument
        console.error(
          'A <head> tag was rendered with props when using `renderIntoDocument`. In this rendering mode' +
            ' React may emit the head tag early in some circumstances and therefore props on the <head> tag are not' +
            ' supported and may be missing in the rendered output for any particular render. In many cases props that' +
            ' are set on a <head> tag can be set on the <html> tag instead.',
        );
      }
    }

    pushInnerHTML(target, innerHTML, children);
    return children;
  } else {
    return pushStartGenericElement(target, props, 'head', responseState);
  }
}

function pushStartBody(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
  formatContext: FormatContext,
): ReactNodeList {
  if (enableFloat && formatContext.insertionMode <= HTML_HTML_MODE) {
    responseState.rendered |= BODY;
  }
  return pushStartGenericElement(target, props, 'body', responseState);
}

function pushScript(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
  textEmbedded: boolean,
  noscriptTagInScope: boolean,
): null {
  if (enableFloat) {
    if (!noscriptTagInScope) {
      const resources = expectCurrentResources();
      const {src, async, onLoad, onError} = props;

      if (!src || typeof src !== 'string') {
        // Inline script emits in place
        return pushScriptImpl(target, props, responseState);
      }

      if (async) {
        if (onLoad || onError) {
          if (__DEV__) {
            // validate
          }
          let preloadResource = resources.preloadsMap.get(src);
          if (!preloadResource) {
            preloadResource = createPreloadResource(
              resources,
              src,
              'script',
              preloadAsScriptPropsFromProps(src, props),
            );
            if (__DEV__) {
              (preloadResource: any)._dev_implicit_construction = true;
            }
            resources.usedScriptPreloads.add(preloadResource);
          }
        } else {
          let resource = resources.scriptsMap.get(src);
          if (resource) {
            if (__DEV__) {
              const latestProps = scriptPropsFromRawProps(src, props);
              adoptPreloadPropsForScriptProps(latestProps, resource.hint.props);
              validateScriptResourceDifference(resource.props, latestProps);
            }
          } else {
            const resourceProps = scriptPropsFromRawProps(src, props);
            resource = createScriptResource(resources, src, resourceProps);
            resources.scripts.add(resource);
          }
        }
        // If the async script had an onLoad or onError we do not emit the script
        // on the server and expect the client to insert it on hydration
        if (textEmbedded) {
          // This link follows text but we aren't writing a tag. while not as efficient as possible we need
          // to be safe and assume text will follow by inserting a textSeparator
          target.push(textSeparator);
        }
        return null;
      }
    }
    // The script was not a resource or client insertion script so we write it as a component
    return pushScriptImpl(target, props, responseState);
  } else {
    return pushScriptImpl(target, props, responseState);
  }
}

function pushScriptImpl(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  responseState: ResponseState,
): null {
  target.push(startChunkForTag('script'));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }
  target.push(endOfStartTag);

  if (__DEV__) {
    if (children != null && typeof children !== 'string') {
      const descriptiveStatement =
        typeof children === 'number'
          ? 'a number for children'
          : Array.isArray(children)
          ? 'an array for children'
          : 'something unexpected for children';
      console.error(
        'A script element was rendered with %s. If script element has children it must be a single string.' +
          ' Consider using dangerouslySetInnerHTML or passing a plain string as children.',
        descriptiveStatement,
      );
    }
  }

  pushInnerHTML(target, innerHTML, children);
  if (typeof children === 'string') {
    target.push(stringToChunk(encodeHTMLTextNode(children)));
  }
  target.push(endTag1, stringToChunk('script'), endTag2);
  return null;
}

function pushStartGenericElement(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  tag: string,
  responseState: ResponseState,
): ReactNodeList {
  target.push(startChunkForTag(tag));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  if (typeof children === 'string') {
    // Special case children as a string to avoid the unnecessary comment.
    // TODO: Remove this special case after the general optimization is in place.
    target.push(stringToChunk(encodeHTMLTextNode(children)));
    return null;
  }
  return children;
}

function pushStartCustomElement(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  tag: string,
  responseState: ResponseState,
): ReactNodeList {
  target.push(startChunkForTag(tag));

  let children = null;
  let innerHTML = null;
  for (let propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      let propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      if (
        enableCustomElementPropertySupport &&
        (typeof propValue === 'function' || typeof propValue === 'object')
      ) {
        // It is normal to render functions and objects on custom elements when
        // client rendering, but when server rendering the output isn't useful,
        // so skip it.
        continue;
      }
      if (enableCustomElementPropertySupport && propValue === false) {
        continue;
      }
      if (enableCustomElementPropertySupport && propValue === true) {
        propValue = '';
      }
      if (enableCustomElementPropertySupport && propKey === 'className') {
        // className gets rendered as class on the client, so it should be
        // rendered as class on the server.
        propKey = 'class';
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        case 'style':
          pushStyle(target, responseState, propValue);
          break;
        case 'suppressContentEditableWarning':
        case 'suppressHydrationWarning':
          // Ignored. These are built-in to React on the client.
          break;
        default:
          if (
            isAttributeNameSafe(propKey) &&
            typeof propValue !== 'function' &&
            typeof propValue !== 'symbol'
          ) {
            target.push(
              attributeSeparator,
              stringToChunk(propKey),
              attributeAssign,
              stringToChunk(escapeTextForBrowser(propValue)),
              attributeEnd,
            );
          }
          break;
      }
    }
  }

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

const leadingNewline = stringToPrecomputedChunk('\n');

function pushStartPreformattedElement(
  target: Array<Chunk | PrecomputedChunk>,
  props: Object,
  tag: string,
  responseState: ResponseState,
): ReactNodeList {
  target.push(startChunkForTag(tag));

  let children = null;
  let innerHTML = null;
  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'children':
          children = propValue;
          break;
        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag);

  // text/html ignores the first character in these tags if it's a newline
  // Prefer to break application/xml over text/html (for now) by adding
  // a newline specifically to get eaten by the parser. (Alternately for
  // textareas, replacing "^\n" with "\r\n" doesn't get eaten, and the first
  // \r is normalized out by HTMLTextAreaElement#value.)
  // See: <http://www.w3.org/TR/html-polyglot/#newlines-in-textarea-and-pre>
  // See: <http://www.w3.org/TR/html5/syntax.html#element-restrictions>
  // See: <http://www.w3.org/TR/html5/syntax.html#newlines>
  // See: Parsing of "textarea" "listing" and "pre" elements
  //  from <http://www.w3.org/TR/html5/syntax.html#parsing-main-inbody>
  // TODO: This doesn't deal with the case where the child is an array
  // or component that returns a string.
  if (innerHTML != null) {
    if (children != null) {
      throw new Error(
        'Can only set one of `children` or `props.dangerouslySetInnerHTML`.',
      );
    }

    if (typeof innerHTML !== 'object' || !('__html' in innerHTML)) {
      throw new Error(
        '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
          'Please visit https://reactjs.org/link/dangerously-set-inner-html ' +
          'for more information.',
      );
    }

    const html = innerHTML.__html;
    if (html !== null && html !== undefined) {
      if (typeof html === 'string' && html.length > 0 && html[0] === '\n') {
        target.push(leadingNewline, stringToChunk(html));
      } else {
        if (__DEV__) {
          checkHtmlStringCoercion(html);
        }
        target.push(stringToChunk('' + html));
      }
    }
  }
  if (typeof children === 'string' && children[0] === '\n') {
    target.push(leadingNewline);
  }
  return children;
}

// We accept any tag to be rendered but since this gets injected into arbitrary
// HTML, we want to make sure that it's a safe tag.
// http://www.w3.org/TR/REC-xml/#NT-Name
const VALID_TAG_REGEX = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/; // Simplified subset
const validatedTagCache = new Map();
function startChunkForTag(tag: string): PrecomputedChunk {
  let tagStartChunk = validatedTagCache.get(tag);
  if (tagStartChunk === undefined) {
    if (!VALID_TAG_REGEX.test(tag)) {
      throw new Error(`Invalid tag: ${tag}`);
    }

    tagStartChunk = stringToPrecomputedChunk('<' + tag);
    validatedTagCache.set(tag, tagStartChunk);
  }
  return tagStartChunk;
}

const DOCTYPE: PrecomputedChunk = stringToPrecomputedChunk('<!DOCTYPE html>');

export function pushStartInstance(
  target: Array<Chunk | PrecomputedChunk>,
  type: string,
  props: Object,
  responseState: ResponseState,
  formatContext: FormatContext,
  textEmbedded: boolean,
): ReactNodeList {
  if (__DEV__) {
    validateARIAProperties(type, props);
    validateInputProperties(type, props);
    validateUnknownProperties(type, props, null);

    if (
      !props.suppressContentEditableWarning &&
      props.contentEditable &&
      props.children != null
    ) {
      console.error(
        'A component is `contentEditable` and contains `children` managed by ' +
          'React. It is now your responsibility to guarantee that none of ' +
          'those nodes are unexpectedly modified or duplicated. This is ' +
          'probably not intentional.',
      );
    }

    if (
      formatContext.insertionMode !== SVG_MODE &&
      formatContext.insertionMode !== MATHML_MODE
    ) {
      if (
        type.indexOf('-') === -1 &&
        typeof props.is !== 'string' &&
        type.toLowerCase() !== type
      ) {
        console.error(
          '<%s /> is using incorrect casing. ' +
            'Use PascalCase for React components, ' +
            'or lowercase for HTML elements.',
          type,
        );
      }
    }
  }

  if (formatContext.insertionMode === ROOT_HTML_MODE) {
    responseState.rendered |= FLOW;
  }

  switch (type) {
    // Special tags
    case 'select':
      return pushStartSelect(target, props, responseState);
    case 'option':
      return pushStartOption(target, props, responseState, formatContext);
    case 'textarea':
      return pushStartTextArea(target, props, responseState);
    case 'input':
      return pushInput(target, props, responseState);
    case 'menuitem':
      return pushStartMenuItem(target, props, responseState);
    case 'title':
      return enableFloat
        ? pushTitle(
            target,
            props,
            responseState,
            formatContext.insertionMode,
            formatContext.noscriptTagInScope,
          )
        : pushStartTitle(target, props, responseState);
    case 'link':
      return pushLink(
        target,
        props,
        responseState,
        textEmbedded,
        formatContext.noscriptTagInScope,
      );
    case 'script':
      return enableFloat
        ? pushScript(
            target,
            props,
            responseState,
            textEmbedded,
            formatContext.noscriptTagInScope,
          )
        : pushStartGenericElement(target, props, type, responseState);
    case 'meta':
      return pushMeta(
        target,
        props,
        responseState,
        textEmbedded,
        formatContext.noscriptTagInScope,
      );
    // Newline eating tags
    case 'listing':
    case 'pre': {
      return pushStartPreformattedElement(target, props, type, responseState);
    }
    // Omitted close tags
    case 'base':
    case 'area':
    case 'br':
    case 'col':
    case 'embed':
    case 'hr':
    case 'img':
    case 'keygen':
    case 'param':
    case 'source':
    case 'track':
    case 'wbr': {
      return pushSelfClosing(target, props, type, responseState);
    }
    // These are reserved SVG and MathML elements, that are never custom elements.
    // https://w3c.github.io/webcomponents/spec/custom/#custom-elements-core-concepts
    case 'annotation-xml':
    case 'color-profile':
    case 'font-face':
    case 'font-face-src':
    case 'font-face-uri':
    case 'font-face-format':
    case 'font-face-name':
    case 'missing-glyph': {
      return pushStartGenericElement(target, props, type, responseState);
    }
    // Tags needing special handling for preambe/postamble or embedding
    case 'html':
      return pushStartHtml(target, props, responseState, formatContext);
    case 'head':
      return pushStartHead(target, props, responseState, formatContext);
    case 'body':
      return pushStartBody(target, props, responseState, formatContext);
    default: {
      if (type.indexOf('-') === -1 && typeof props.is !== 'string') {
        // Generic element
        return pushStartGenericElement(target, props, type, responseState);
      } else {
        // Custom element
        return pushStartCustomElement(target, props, type, responseState);
      }
    }
  }
}

const endTag1 = stringToPrecomputedChunk('</');
const endTag2 = stringToPrecomputedChunk('>');

export function pushEndInstance(
  target: Array<Chunk | PrecomputedChunk>,
  type: string,
  props: Object,
  formatContext: FormatContext,
): void {
  switch (type) {
    // When float is on we expect title and script tags to always be pushed in
    // a unit and never return children. when we end up pushing the end tag we
    // want to ensure there is no extra closing tag pushed
    case 'title':
    case 'script': {
      if (!enableFloat) {
        break;
      }
    }
    // Omitted close tags
    // TODO: Instead of repeating this switch we could try to pass a flag from above.
    // That would require returning a tuple. Which might be ok if it gets inlined.
    // eslint-disable-next-line-no-fallthrough
    case 'area':
    case 'base':
    case 'br':
    case 'col':
    case 'embed':
    case 'hr':
    case 'img':
    case 'input':
    case 'keygen':
    case 'link':
    case 'meta':
    case 'param':
    case 'source':
    case 'track':
    case 'wbr': {
      // No close tag needed.
      return;
    }
    // Postamble end tags*
    case 'body': {
      if (enableFloat) {
        if (formatContext.insertionMode <= HTML_HTML_MODE) {
          // If we are at the top level we omit the trailing tag
          // because it will be managed in the postamble
          return;
        }
      }
      break;
    }
    case 'html':
      if (enableFloat) {
        if (formatContext.insertionMode === ROOT_HTML_MODE) {
          // If we are at the top level we omit the trailing tag
          // because it will be managed in the postamble
          return;
        }
      }
      break;
  }
  target.push(endTag1, stringToChunk(type), endTag2);
}

// In some render modes (such as `renderIntoDocument`) WriteEarlyPreamble
// is called to allow flushing of the preamble and Resources as early as possible.
// It is possible for this to be called more than once and needs to be
// resilient to that. For instance by not writing the preamble open tags
// more than once
export function writeEarlyPreamble(
  destination: Destination,
  resources: Resources,
  responseState: ResponseState,
  willEmitInstructions: boolean,
): boolean {
  if (enableFloat) {
    // We use `requiresEmbedding` as a hueristic for `renderIntoDocument`
    // which is the only render method which should emit an early preamble
    // In the future other render methods might and this hueristic may need
    // to change
    if (responseState.requiresEmbedding) {
      // If we emitted a preamble early it will have flushed <html> and <head>.
      // We check that we haven't flushed anything yet which is equivalent
      // to checking whether we have not flushed an <html> or <head>
      if (responseState.rendered !== NONE) {
        if (responseState.flushed === NONE) {
          let i = 0;
          const {htmlChunks, headChunks} = responseState;
          if (htmlChunks.length) {
            for (i = 0; i < htmlChunks.length; i++) {
              writeChunk(destination, htmlChunks[i]);
            }
          } else {
            writeChunk(destination, DOCTYPE);
            writeChunk(destination, startChunkForTag('html'));
            writeChunk(destination, endOfStartTag);
          }
          if (headChunks.length) {
            for (i = 0; i < headChunks.length; i++) {
              writeChunk(destination, headChunks[i]);
            }
          } else {
            writeChunk(destination, startChunkForTag('head'));
            writeChunk(destination, endOfStartTag);
          }
          responseState.flushed |= HTML | HEAD;
        }

        let i = 0;
        let r = true;

        const {charsetChunks, hoistableChunks} = responseState;
        for (; i < charsetChunks.length; i++) {
          writeChunk(destination, charsetChunks[i]);
        }
        charsetChunks.length = 0;

        r = writeEarlyResources(
          destination,
          resources,
          responseState,
          willEmitInstructions,
        );

        for (i = 0; i < hoistableChunks.length - 1; i++) {
          writeChunk(destination, hoistableChunks[i]);
        }
        if (i < hoistableChunks.length) {
          r = writeChunkAndReturn(destination, hoistableChunks[i]);
        }
        hoistableChunks.length = 0;

        return r;
      }
    }
  }
  return true;
}

// Regardless of render mode, writePreamble must only be called at most once.
// It will emit the preamble open tags if they have not already been written
// and will close the preamble if necessary. After this function completes
// the shell will flush. In modes that do not have a shell such as `renderIntoContainer`
// this function is not called. In modes that render a shell fallback such as
// `renderIntoDocument` this function is still only called once, either for the
// primary shell (no fallback possible at this point) or for the fallback shell
// (was not called for the primary children).
export function writePreamble(
  destination: Destination,
  resources: Resources,
  responseState: ResponseState,
  willEmitInstructions: boolean,
): boolean {
  if (enableFloat) {
    if (responseState.flushed === NONE) {
      const {htmlChunks, headChunks} = responseState;
      let i = 0;
      if (htmlChunks.length) {
        responseState.flushed |= HTML;
        for (i = 0; i < htmlChunks.length; i++) {
          writeChunk(destination, htmlChunks[i]);
        }
      } else if (responseState.requiresEmbedding) {
        responseState.flushed |= HTML;
        writeChunk(destination, DOCTYPE);
        writeChunk(destination, startChunkForTag('html'));
        writeChunk(destination, endOfStartTag);
      }

      if (headChunks.length) {
        responseState.flushed |= HEAD;
        for (i = 0; i < headChunks.length; i++) {
          writeChunk(destination, headChunks[i]);
        }
      } else if (responseState.flushed & HTML) {
        // We insert a missing head if an <html> was emitted.
        // This encompasses cases where we require embedding
        // so we leave that check out
        responseState.flushed |= HEAD;
        // This render has not produced a <head> yet. we emit
        // a open tag so we can start to flush resources.
        writeChunk(destination, startChunkForTag('head'));
        writeChunk(destination, endOfStartTag);
      }
    }

    let i = 0;
    let r = true;

    const {charsetChunks, hoistableChunks} = responseState;
    for (; i < charsetChunks.length; i++) {
      writeChunk(destination, charsetChunks[i]);
    }
    charsetChunks.length = 0;

    // Write all remaining resources that should flush with the Shell
    r = writeInitialResources(
      destination,
      resources,
      responseState,
      willEmitInstructions,
    );

    for (i = 0; i < hoistableChunks.length - 1; i++) {
      writeChunk(destination, hoistableChunks[i]);
    }
    if (i < hoistableChunks.length) {
      r = writeChunkAndReturn(destination, hoistableChunks[i]);
    }
    hoistableChunks.length = 0;

    // If we did not render a <head> but we did flush one we need to emit
    // the closing tag now after writing resources. We know we won't get
    // a head in the shell so we can assume all shell content belongs after
    // the closed head tag
    if (
      (responseState.rendered & HEAD) === NONE &&
      responseState.flushed & HEAD
    ) {
      writeChunk(destination, endTag1);
      writeChunk(destination, stringToChunk('head'));
      r = writeChunkAndReturn(destination, endTag2);
    }

    // If the shell needs to be embedded and the rendered embedding is body
    // we need to emit an open <body> tag and prepare the postamble to close
    // the body tag
    if (
      responseState.requiresEmbedding &&
      (responseState.rendered & HTML_HEAD_OR_BODY) === NONE
    ) {
      responseState.flushed |= BODY;
      writeChunk(destination, startChunkForTag('body'));
      r = writeChunkAndReturn(destination, endOfStartTag);
    } else {
      // If we rendered a <body> we mark it as flushed here so we can emit
      // the closing tag in the postamble
      responseState.flushed |= responseState.rendered & BODY;
    }

    return r;
  }
  return true;
}

export function writePostamble(
  destination: Destination,
  responseState: ResponseState,
): void {
  if (enableFloat) {
    if ((responseState.flushed & BODY) !== NONE) {
      writeChunk(destination, endTag1);
      writeChunk(destination, stringToChunk('body'));
      writeChunk(destination, endTag2);
    }
    if ((responseState.flushed & HTML) !== NONE) {
      writeChunk(destination, endTag1);
      writeChunk(destination, stringToChunk('html'));
      writeChunk(destination, endTag2);
    }
  }
}

export function prepareForFallback(responseState: ResponseState): void {
  if (__DEV__) {
    (responseState: any).inFallbackDEV = true;
  }
  // Reset rendered states
  responseState.htmlChunks = [];
  responseState.headChunks = [];
  responseState.rendered = NONE;

  // Move fallback bootstrap to bootstrap if configured
  const fallbackBootstrapChunks = responseState.fallbackBootstrapChunks;
  if (fallbackBootstrapChunks && fallbackBootstrapChunks.length) {
    responseState.bootstrapChunks = fallbackBootstrapChunks;
  }
}

export function writeCompletedRoot(
  destination: Destination,
  responseState: ResponseState,
): boolean {
  const bootstrapChunks = responseState.bootstrapChunks;
  let i = 0;
  for (; i < bootstrapChunks.length - 1; i++) {
    writeChunk(destination, bootstrapChunks[i]);
  }
  if (i < bootstrapChunks.length) {
    return writeChunkAndReturn(destination, bootstrapChunks[i]);
  }
  return true;
}

// Structural Nodes

// A placeholder is a node inside a hidden partial tree that can be filled in later, but before
// display. It's never visible to users. We use the template tag because it can be used in every
// type of parent. <script> tags also work in every other tag except <colgroup>.
const placeholder1 = stringToPrecomputedChunk('<template id="');
const placeholder2 = stringToPrecomputedChunk('"></template>');
export function writePlaceholder(
  destination: Destination,
  responseState: ResponseState,
  id: number,
): boolean {
  writeChunk(destination, placeholder1);
  writeChunk(destination, responseState.placeholderPrefix);
  const formattedID = stringToChunk(id.toString(16));
  writeChunk(destination, formattedID);
  return writeChunkAndReturn(destination, placeholder2);
}

// Suspense boundaries are encoded as comments.
const startCompletedSuspenseBoundary = stringToPrecomputedChunk('<!--$-->');
const startPendingSuspenseBoundary1 = stringToPrecomputedChunk(
  '<!--$?--><template id="',
);
const startPendingSuspenseBoundary2 = stringToPrecomputedChunk('"></template>');
const startClientRenderedSuspenseBoundary = stringToPrecomputedChunk(
  '<!--$!-->',
);
const endSuspenseBoundary = stringToPrecomputedChunk('<!--/$-->');

const clientRenderedSuspenseBoundaryError1 = stringToPrecomputedChunk(
  '<template',
);
const clientRenderedSuspenseBoundaryErrorAttrInterstitial = stringToPrecomputedChunk(
  '"',
);
const clientRenderedSuspenseBoundaryError1A = stringToPrecomputedChunk(
  ' data-dgst="',
);
const clientRenderedSuspenseBoundaryError1B = stringToPrecomputedChunk(
  ' data-msg="',
);
const clientRenderedSuspenseBoundaryError1C = stringToPrecomputedChunk(
  ' data-stck="',
);
const clientRenderedSuspenseBoundaryError2 = stringToPrecomputedChunk(
  '></template>',
);

export function pushStartCompletedSuspenseBoundary(
  target: Array<Chunk | PrecomputedChunk>,
) {
  target.push(startCompletedSuspenseBoundary);
}

export function pushEndCompletedSuspenseBoundary(
  target: Array<Chunk | PrecomputedChunk>,
) {
  target.push(endSuspenseBoundary);
}

export function writeStartCompletedSuspenseBoundary(
  destination: Destination,
  responseState: ResponseState,
): boolean {
  return writeChunkAndReturn(destination, startCompletedSuspenseBoundary);
}
export function writeStartPendingSuspenseBoundary(
  destination: Destination,
  responseState: ResponseState,
  id: SuspenseBoundaryID,
): boolean {
  writeChunk(destination, startPendingSuspenseBoundary1);

  if (id === null) {
    throw new Error(
      'An ID must have been assigned before we can complete the boundary.',
    );
  }

  writeChunk(destination, id);
  return writeChunkAndReturn(destination, startPendingSuspenseBoundary2);
}
export function writeStartClientRenderedSuspenseBoundary(
  destination: Destination,
  responseState: ResponseState,
  errorDigest: ?string,
  errorMesssage: ?string,
  errorComponentStack: ?string,
): boolean {
  let result;
  result = writeChunkAndReturn(
    destination,
    startClientRenderedSuspenseBoundary,
  );
  writeChunk(destination, clientRenderedSuspenseBoundaryError1);
  if (errorDigest) {
    writeChunk(destination, clientRenderedSuspenseBoundaryError1A);
    writeChunk(destination, stringToChunk(escapeTextForBrowser(errorDigest)));
    writeChunk(
      destination,
      clientRenderedSuspenseBoundaryErrorAttrInterstitial,
    );
  }
  if (__DEV__) {
    if (errorMesssage) {
      writeChunk(destination, clientRenderedSuspenseBoundaryError1B);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorMesssage)),
      );
      writeChunk(
        destination,
        clientRenderedSuspenseBoundaryErrorAttrInterstitial,
      );
    }
    if (errorComponentStack) {
      writeChunk(destination, clientRenderedSuspenseBoundaryError1C);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorComponentStack)),
      );
      writeChunk(
        destination,
        clientRenderedSuspenseBoundaryErrorAttrInterstitial,
      );
    }
  }
  result = writeChunkAndReturn(
    destination,
    clientRenderedSuspenseBoundaryError2,
  );
  return result;
}
export function writeEndCompletedSuspenseBoundary(
  destination: Destination,
  responseState: ResponseState,
): boolean {
  return writeChunkAndReturn(destination, endSuspenseBoundary);
}
export function writeEndPendingSuspenseBoundary(
  destination: Destination,
  responseState: ResponseState,
): boolean {
  return writeChunkAndReturn(destination, endSuspenseBoundary);
}
export function writeEndClientRenderedSuspenseBoundary(
  destination: Destination,
  responseState: ResponseState,
): boolean {
  return writeChunkAndReturn(destination, endSuspenseBoundary);
}

const startSegmentHTML = stringToPrecomputedChunk('<div hidden id="');
const startSegmentHTML2 = stringToPrecomputedChunk('">');
const endSegmentHTML = stringToPrecomputedChunk('</div>');

const startSegmentSVG = stringToPrecomputedChunk(
  '<svg aria-hidden="true" style="display:none" id="',
);
const startSegmentSVG2 = stringToPrecomputedChunk('">');
const endSegmentSVG = stringToPrecomputedChunk('</svg>');

const startSegmentMathML = stringToPrecomputedChunk(
  '<math aria-hidden="true" style="display:none" id="',
);
const startSegmentMathML2 = stringToPrecomputedChunk('">');
const endSegmentMathML = stringToPrecomputedChunk('</math>');

const startSegmentTable = stringToPrecomputedChunk('<table hidden id="');
const startSegmentTable2 = stringToPrecomputedChunk('">');
const endSegmentTable = stringToPrecomputedChunk('</table>');

const startSegmentTableBody = stringToPrecomputedChunk(
  '<table hidden><tbody id="',
);
const startSegmentTableBody2 = stringToPrecomputedChunk('">');
const endSegmentTableBody = stringToPrecomputedChunk('</tbody></table>');

const startSegmentTableRow = stringToPrecomputedChunk('<table hidden><tr id="');
const startSegmentTableRow2 = stringToPrecomputedChunk('">');
const endSegmentTableRow = stringToPrecomputedChunk('</tr></table>');

const startSegmentColGroup = stringToPrecomputedChunk(
  '<table hidden><colgroup id="',
);
const startSegmentColGroup2 = stringToPrecomputedChunk('">');
const endSegmentColGroup = stringToPrecomputedChunk('</colgroup></table>');

export function writeStartSegment(
  destination: Destination,
  responseState: ResponseState,
  formatContext: FormatContext,
  id: number,
): boolean {
  switch (formatContext.insertionMode) {
    case ROOT_HTML_MODE:
    case HTML_HTML_MODE:
    case HTML_MODE: {
      writeChunk(destination, startSegmentHTML);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentHTML2);
    }
    case SVG_MODE: {
      writeChunk(destination, startSegmentSVG);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentSVG2);
    }
    case MATHML_MODE: {
      writeChunk(destination, startSegmentMathML);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentMathML2);
    }
    case HTML_TABLE_MODE: {
      writeChunk(destination, startSegmentTable);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentTable2);
    }
    // TODO: For the rest of these, there will be extra wrapper nodes that never
    // get deleted from the document. We need to delete the table too as part
    // of the injected scripts. They are invisible though so it's not too terrible
    // and it's kind of an edge case to suspend in a table. Totally supported though.
    case HTML_TABLE_BODY_MODE: {
      writeChunk(destination, startSegmentTableBody);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentTableBody2);
    }
    case HTML_TABLE_ROW_MODE: {
      writeChunk(destination, startSegmentTableRow);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentTableRow2);
    }
    case HTML_COLGROUP_MODE: {
      writeChunk(destination, startSegmentColGroup);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentColGroup2);
    }
    default: {
      throw new Error('Unknown insertion mode. This is a bug in React.');
    }
  }
}
export function writeEndSegment(
  destination: Destination,
  formatContext: FormatContext,
): boolean {
  switch (formatContext.insertionMode) {
    case ROOT_HTML_MODE:
    case HTML_HTML_MODE:
    case HTML_MODE: {
      return writeChunkAndReturn(destination, endSegmentHTML);
    }
    case SVG_MODE: {
      return writeChunkAndReturn(destination, endSegmentSVG);
    }
    case MATHML_MODE: {
      return writeChunkAndReturn(destination, endSegmentMathML);
    }
    case HTML_TABLE_MODE: {
      return writeChunkAndReturn(destination, endSegmentTable);
    }
    case HTML_TABLE_BODY_MODE: {
      return writeChunkAndReturn(destination, endSegmentTableBody);
    }
    case HTML_TABLE_ROW_MODE: {
      return writeChunkAndReturn(destination, endSegmentTableRow);
    }
    case HTML_COLGROUP_MODE: {
      return writeChunkAndReturn(destination, endSegmentColGroup);
    }
    default: {
      throw new Error('Unknown insertion mode. This is a bug in React.');
    }
  }
}

const completeSegmentScript1Full = stringToPrecomputedChunk(
  completeSegmentFunctionString + '$RS("',
);
const completeSegmentScript1Partial = stringToPrecomputedChunk('$RS("');
const completeSegmentScript2 = stringToPrecomputedChunk('","');
const completeSegmentScriptEnd = stringToPrecomputedChunk('")</script>');

const completeSegmentData1 = stringToPrecomputedChunk(
  '<template data-ri="s" data-sid="',
);
const completeSegmentData2 = stringToPrecomputedChunk('" data-pid="');
const completeSegmentDataEnd = dataElementQuotedEnd;

export function writeCompletedSegmentInstruction(
  destination: Destination,
  responseState: ResponseState,
  contentSegmentID: number,
): boolean {
  const scriptFormat =
    !enableFizzExternalRuntime ||
    responseState.streamingFormat === ScriptStreamingFormat;
  if (scriptFormat) {
    writeChunk(destination, responseState.startInlineScript);
    if (!responseState.sentCompleteSegmentFunction) {
      // The first time we write this, we'll need to include the full implementation.
      responseState.sentCompleteSegmentFunction = true;
      writeChunk(destination, completeSegmentScript1Full);
    } else {
      // Future calls can just reuse the same function.
      writeChunk(destination, completeSegmentScript1Partial);
    }
  } else {
    writeChunk(destination, completeSegmentData1);
  }

  // Write function arguments, which are string literals
  writeChunk(destination, responseState.segmentPrefix);
  const formattedID = stringToChunk(contentSegmentID.toString(16));
  writeChunk(destination, formattedID);
  if (scriptFormat) {
    writeChunk(destination, completeSegmentScript2);
  } else {
    writeChunk(destination, completeSegmentData2);
  }
  writeChunk(destination, responseState.placeholderPrefix);
  writeChunk(destination, formattedID);

  if (scriptFormat) {
    return writeChunkAndReturn(destination, completeSegmentScriptEnd);
  } else {
    return writeChunkAndReturn(destination, completeSegmentDataEnd);
  }
}

const completeBoundaryFunction = stringToPrecomputedChunk(
  completeBoundaryFunctionString,
);
const completeContainerFunction = stringToPrecomputedChunk(
  completeContainerFunctionString,
);
const styleInsertionFunction = stringToPrecomputedChunk(
  styleInsertionFunctionString,
);

const completeBoundaryScript1 = stringToPrecomputedChunk('$RC("');
const completeBoundaryWithStylesScript1 = stringToPrecomputedChunk('$RR($RC,"');

const completeContainerScript1 = stringToPrecomputedChunk('$RK("');
const completeContainerWithStylesScript1 = stringToPrecomputedChunk(
  '$RR($RK,"',
);
const completeBoundaryOrContainerScript2 = stringToPrecomputedChunk('","');
const completeBoundaryOrContainerScript2a = stringToPrecomputedChunk('",');
const completeBoundaryOrContainerScript3 = stringToPrecomputedChunk('"');
const completeBoundaryOrContainerScriptEnd = stringToPrecomputedChunk(
  ')</script>',
);

const bootstrapContainerOpenStart = stringToPrecomputedChunk(
  '<template id="bs:',
);
const bootstrapContainerOpenEnd = stringToPrecomputedChunk('">');
const bootstrapContainerClose = stringToPrecomputedChunk('</template>');

const completeContainerData1 = stringToPrecomputedChunk(
  '<template data-ri="c" data-bid="',
);
const completeContainerWithStylesData1 = stringToPrecomputedChunk(
  '<template data-ri="rc" data-bid="',
);
const completeBoundaryData1 = stringToPrecomputedChunk(
  '<template data-ri="b" data-bid="',
);
const completeBoundaryWithStylesData1 = stringToPrecomputedChunk(
  '<template data-ri="rb" data-bid="',
);
const completeBoundaryOrContainerData2 = stringToPrecomputedChunk(
  '" data-sid="',
);
const completeBoundaryOrContainerData3 = stringToPrecomputedChunk(
  '" data-sty="',
);
const completeBoundaryOrContainerDataEmptyEnd = dataElementQuotedEnd;

export function writeCompletedBoundaryInstruction(
  destination: Destination,
  responseState: ResponseState,
  boundaryID: SuspenseBoundaryID,
  contentSegmentID: number,
  boundaryResources: BoundaryResources,
): boolean {
  if (boundaryID === null) {
    throw new Error(
      'An ID must have been assigned before we can complete the boundary.',
    );
  }
  let hasStyleDependencies;
  if (enableFloat) {
    hasStyleDependencies = hasStyleResourceDependencies(boundaryResources);
  }
  const formattedContentID = stringToChunk(contentSegmentID.toString(16));
  const scriptFormat =
    !enableFizzExternalRuntime ||
    responseState.streamingFormat === ScriptStreamingFormat;
  let r = true;
  if (scriptFormat) {
    if (enableFloat && hasStyleDependencies) {
      if (boundaryID === responseState.containerBoundaryID) {
        // We emit the bootstrap chunks into a template container with an id
        // formed from the root segment ID. The insertion script will inject
        // the bootstrap scripts into the DOM after revealing the content.
        // We don't do this for cases where there are no style dependencies because
        // the content swap is synchronous and will therefore always complete before
        // the bootstrap scripts run
        const bootstrapChunks = responseState.bootstrapChunks;
        if (bootstrapChunks.length) {
          writeChunk(destination, bootstrapContainerOpenStart);
          writeChunk(destination, responseState.segmentPrefix);
          writeChunk(destination, formattedContentID);
          writeChunk(destination, bootstrapContainerOpenEnd);
          for (let i = 0; i < bootstrapChunks.length; i++) {
            writeChunk(destination, bootstrapChunks[i]);
          }
          writeChunk(destination, bootstrapContainerClose);
        }

        writeChunk(destination, responseState.startInlineScript);
        if (!responseState.sentStyleInsertionFunction) {
          responseState.sentStyleInsertionFunction = true;
          writeChunk(
            destination,
            clonePrecomputedChunk(styleInsertionFunction),
          );
        }
        if (!responseState.sentCompleteContainerFunction) {
          responseState.sentCompleteContainerFunction = true;
          writeChunk(destination, completeContainerFunction);
        }
        writeChunk(destination, completeContainerWithStylesScript1);
        writeChunk(destination, boundaryID);
        writeChunk(destination, completeBoundaryOrContainerScript2);
        writeChunk(destination, responseState.segmentPrefix);
        writeChunk(destination, formattedContentID);
        writeChunk(destination, completeBoundaryOrContainerScript2a);
        writeStyleResourceDependenciesInJS(destination, boundaryResources);
        return writeChunkAndReturn(
          destination,
          completeBoundaryOrContainerScriptEnd,
        );
      } else {
        writeChunk(destination, responseState.startInlineScript);
        if (!responseState.sentStyleInsertionFunction) {
          responseState.sentStyleInsertionFunction = true;
          writeChunk(
            destination,
            clonePrecomputedChunk(styleInsertionFunction),
          );
        }
        if (!responseState.sentCompleteBoundaryFunction) {
          responseState.sentCompleteBoundaryFunction = true;
          writeChunk(destination, completeBoundaryFunction);
        }
        writeChunk(destination, completeBoundaryWithStylesScript1);
        writeChunk(destination, boundaryID);
        writeChunk(destination, completeBoundaryOrContainerScript2);
        writeChunk(destination, responseState.segmentPrefix);
        writeChunk(destination, formattedContentID);
        writeChunk(destination, completeBoundaryOrContainerScript2a);
        writeStyleResourceDependenciesInJS(destination, boundaryResources);
        return writeChunkAndReturn(
          destination,
          completeBoundaryOrContainerScriptEnd,
        );
      }
    } else {
      if (boundaryID === responseState.containerBoundaryID) {
        writeChunk(destination, responseState.startInlineScript);
        if (!responseState.sentCompleteContainerFunction) {
          responseState.sentCompleteContainerFunction = true;
          writeChunk(destination, completeContainerFunction);
        }
        writeChunk(destination, completeContainerScript1);
        writeChunk(destination, boundaryID);
        writeChunk(destination, completeBoundaryOrContainerScript2);
        writeChunk(destination, responseState.segmentPrefix);
        writeChunk(destination, formattedContentID);
        writeChunk(destination, completeBoundaryOrContainerScript3);
        r = writeChunkAndReturn(
          destination,
          completeBoundaryOrContainerScriptEnd,
        );

        // We emit bootstrap scripts after the completeContainer instruction
        // because we want to ensure the reveal ocurrs before the bootstrap
        // scripts execute. Notice that unlike with the styles case the scripts
        // are not embedded in a template
        const bootstrapChunks = responseState.bootstrapChunks;
        let i = 0;
        for (; i < bootstrapChunks.length - 1; i++) {
          writeChunk(destination, bootstrapChunks[i]);
        }
        if (i < bootstrapChunks.length) {
          r = writeChunkAndReturn(destination, bootstrapChunks[i]);
        }
        return r;
      } else {
        writeChunk(destination, responseState.startInlineScript);
        if (!responseState.sentCompleteBoundaryFunction) {
          responseState.sentCompleteBoundaryFunction = true;
          writeChunk(destination, completeBoundaryFunction);
        }
        writeChunk(destination, completeBoundaryScript1);
        writeChunk(destination, boundaryID);
        writeChunk(destination, completeBoundaryOrContainerScript2);
        writeChunk(destination, responseState.segmentPrefix);
        writeChunk(destination, formattedContentID);
        writeChunk(destination, completeBoundaryOrContainerScript3);
        return writeChunkAndReturn(
          destination,
          completeBoundaryOrContainerScriptEnd,
        );
      }
    }
  } else {
    if (enableFloat && hasStyleDependencies) {
      if (boundaryID === responseState.containerBoundaryID) {
        // We emit the bootstrap chunks into a template container with an id
        // formed from the root segment ID. The insertion script will inject
        // the bootstrap scripts into the DOM after revealing the content.
        // We don't do this for cases where there are no style dependencies because
        // the content swap is synchronous and will therefore always complete before
        // the bootstrap scripts run
        const bootstrapChunks = responseState.bootstrapChunks;
        if (bootstrapChunks.length) {
          writeChunk(destination, bootstrapContainerOpenStart);
          writeChunk(destination, responseState.segmentPrefix);
          writeChunk(destination, formattedContentID);
          writeChunk(destination, bootstrapContainerOpenEnd);
          for (let i = 0; i < bootstrapChunks.length; i++) {
            writeChunk(destination, bootstrapChunks[i]);
          }
          writeChunk(destination, bootstrapContainerClose);
        }

        writeChunk(destination, completeContainerWithStylesData1);
        writeChunk(destination, boundaryID);
        writeChunk(destination, completeBoundaryOrContainerData2);
        writeChunk(destination, responseState.segmentPrefix);
        writeChunk(destination, formattedContentID);
        writeChunk(destination, completeBoundaryOrContainerData3);
        writeStyleResourceDependenciesInAttr(destination, boundaryResources);
        return writeChunkAndReturn(
          destination,
          completeBoundaryOrContainerDataEmptyEnd,
        );
      } else {
        writeChunk(destination, completeBoundaryWithStylesData1);
        writeChunk(destination, boundaryID);
        writeChunk(destination, completeBoundaryOrContainerData2);
        writeChunk(destination, responseState.segmentPrefix);
        writeChunk(destination, formattedContentID);
        writeChunk(destination, completeBoundaryOrContainerData3);
        writeStyleResourceDependenciesInAttr(destination, boundaryResources);
        return writeChunkAndReturn(
          destination,
          completeBoundaryOrContainerDataEmptyEnd,
        );
      }
    } else {
      if (boundaryID === responseState.containerBoundaryID) {
        // We emit the bootstrap chunks into a template container with an id
        // formed from the root segment ID. The insertion script will inject
        // the bootstrap scripts into the DOM after revealing the content.
        const bootstrapChunks = responseState.bootstrapChunks;
        if (bootstrapChunks.length) {
          writeChunk(destination, bootstrapContainerOpenStart);
          writeChunk(destination, responseState.segmentPrefix);
          writeChunk(destination, formattedContentID);
          writeChunk(destination, bootstrapContainerOpenEnd);
          for (let i = 0; i < bootstrapChunks.length; i++) {
            writeChunk(destination, bootstrapChunks[i]);
          }
          writeChunk(destination, bootstrapContainerClose);
        }

        writeChunk(destination, completeContainerData1);
        writeChunk(destination, boundaryID);
        writeChunk(destination, completeBoundaryOrContainerData2);
        writeChunk(destination, responseState.segmentPrefix);
        writeChunk(destination, formattedContentID);
        return writeChunkAndReturn(
          destination,
          completeBoundaryOrContainerDataEmptyEnd,
        );
      } else {
        writeChunk(destination, completeBoundaryData1);
        writeChunk(destination, boundaryID);
        writeChunk(destination, completeBoundaryOrContainerData2);
        writeChunk(destination, responseState.segmentPrefix);
        writeChunk(destination, formattedContentID);
        return writeChunkAndReturn(
          destination,
          completeBoundaryOrContainerDataEmptyEnd,
        );
      }
    }
  }
}

const clientRenderScript1Full = stringToPrecomputedChunk(
  clientRenderFunctionString + '$RX("',
);
const clientRenderScript1Partial = stringToPrecomputedChunk('$RX("');
const clientRenderScript1A = stringToPrecomputedChunk('"');
const clientRenderErrorScriptArgInterstitial = stringToPrecomputedChunk(',');
const clientRenderScriptEnd = stringToPrecomputedChunk(')</script>');

const clientRenderData1 = stringToPrecomputedChunk(
  '<template data-ri="x" data-bid="',
);
const clientRenderData2 = stringToPrecomputedChunk('" data-dgst="');
const clientRenderData3 = stringToPrecomputedChunk('" data-msg="');
const clientRenderData4 = stringToPrecomputedChunk('" data-stck="');
const clientRenderDataEnd = dataElementQuotedEnd;

export function writeClientRenderBoundaryInstruction(
  destination: Destination,
  responseState: ResponseState,
  boundaryID: SuspenseBoundaryID,
  errorDigest: ?string,
  errorMessage?: string,
  errorComponentStack?: string,
): boolean {
  const scriptFormat =
    !enableFizzExternalRuntime ||
    responseState.streamingFormat === ScriptStreamingFormat;
  if (boundaryID === responseState.containerBoundaryID) {
    // If fallback bootstrap scripts were provided and we errored at the Root Boundary
    // then use those. Use the normal bootstrapChunks if no fallbacks were provided
    const bootstrapChunks =
      responseState.fallbackBootstrapChunks || responseState.bootstrapChunks;
    let i = 0;
    for (; i < bootstrapChunks.length - 1; i++) {
      writeChunk(destination, bootstrapChunks[i]);
    }
    if (i < bootstrapChunks.length) {
      return writeChunkAndReturn(destination, bootstrapChunks[i]);
    }
    return true;
  } else if (scriptFormat) {
    writeChunk(destination, responseState.startInlineScript);
    if (!responseState.sentClientRenderFunction) {
      // The first time we write this, we'll need to include the full implementation.
      responseState.sentClientRenderFunction = true;
      writeChunk(destination, clientRenderScript1Full);
    } else {
      // Future calls can just reuse the same function.
      writeChunk(destination, clientRenderScript1Partial);
    }
  } else {
    // <template data-ri="x" data-bid="
    writeChunk(destination, clientRenderData1);
  }

  if (boundaryID === null) {
    throw new Error(
      'An ID must have been assigned before we can complete the boundary.',
    );
  }

  writeChunk(destination, boundaryID);
  if (scriptFormat) {
    // " needs to be inserted for scripts, since ArgInterstitual does not contain
    // leading or trailing quotes
    writeChunk(destination, clientRenderScript1A);
  }

  if (errorDigest || errorMessage || errorComponentStack) {
    if (scriptFormat) {
      // ,"JSONString"
      writeChunk(destination, clientRenderErrorScriptArgInterstitial);
      writeChunk(
        destination,
        stringToChunk(escapeJSStringsForInstructionScripts(errorDigest || '')),
      );
    } else {
      // " data-dgst="HTMLString
      writeChunk(destination, clientRenderData2);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorDigest || '')),
      );
    }
  }
  if (errorMessage || errorComponentStack) {
    if (scriptFormat) {
      // ,"JSONString"
      writeChunk(destination, clientRenderErrorScriptArgInterstitial);
      writeChunk(
        destination,
        stringToChunk(escapeJSStringsForInstructionScripts(errorMessage || '')),
      );
    } else {
      // " data-msg="HTMLString
      writeChunk(destination, clientRenderData3);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorMessage || '')),
      );
    }
  }
  if (errorComponentStack) {
    // ,"JSONString"
    if (scriptFormat) {
      writeChunk(destination, clientRenderErrorScriptArgInterstitial);
      writeChunk(
        destination,
        stringToChunk(
          escapeJSStringsForInstructionScripts(errorComponentStack),
        ),
      );
    } else {
      // " data-stck="HTMLString
      writeChunk(destination, clientRenderData4);
      writeChunk(
        destination,
        stringToChunk(escapeTextForBrowser(errorComponentStack)),
      );
    }
  }

  if (scriptFormat) {
    // ></script>
    return writeChunkAndReturn(destination, clientRenderScriptEnd);
  } else {
    // "></template>
    return writeChunkAndReturn(destination, clientRenderDataEnd);
  }
}

const regexForJSStringsInInstructionScripts = /[<\u2028\u2029]/g;
function escapeJSStringsForInstructionScripts(input: string): string {
  const escaped = JSON.stringify(input);
  return escaped.replace(regexForJSStringsInInstructionScripts, match => {
    switch (match) {
      // santizing breaking out of strings and script tags
      case '<':
        return '\\u003c';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default: {
        // eslint-disable-next-line react-internal/prod-error-codes
        throw new Error(
          'escapeJSStringsForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React',
        );
      }
    }
  });
}

const regexForJSStringsInScripts = /[&><\u2028\u2029]/g;
function escapeJSObjectForInstructionScripts(input: Object): string {
  const escaped = JSON.stringify(input);
  return escaped.replace(regexForJSStringsInScripts, match => {
    switch (match) {
      // santizing breaking out of strings and script tags
      case '&':
        return '\\u0026';
      case '>':
        return '\\u003e';
      case '<':
        return '\\u003c';
      case '\u2028':
        return '\\u2028';
      case '\u2029':
        return '\\u2029';
      default: {
        // eslint-disable-next-line react-internal/prod-error-codes
        throw new Error(
          'escapeJSObjectForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React',
        );
      }
    }
  });
}

const precedencePlaceholderStart = stringToPrecomputedChunk(
  '<style data-precedence="',
);
const precedencePlaceholderEnd = stringToPrecomputedChunk('"></style>');

export function writeEarlyResources(
  destination: Destination,
  resources: Resources,
  responseState: ResponseState,
  willEmitInstructions: boolean,
): boolean {
  // Write initially discovered resources after the shell completes
  if (
    enableFizzExternalRuntime &&
    responseState.externalRuntimeConfig &&
    willEmitInstructions
  ) {
    // If the root segment is incomplete due to suspended tasks
    // (e.g. willFlushAllSegments = false) and we are using data
    // streaming format, ensure the external runtime is sent.
    // (User code could choose to send this even earlier by calling
    //  preinit(...), if they know they will suspend).
    const {src, integrity} = responseState.externalRuntimeConfig;
    preinitImpl(resources, src, {as: 'script', integrity});
  }
  function flushLinkResource(resource: LinkTagResource) {
    if (!resource.flushed) {
      pushLinkImpl(target, resource.props, responseState);
      resource.flushed = true;
    }
  }

  const target = [];

  const {
    bases,
    preconnects,
    fontPreloads,
    firstPrecedence,
    precedences,
    usedStylePreloads,
    scripts,
    usedScriptPreloads,
    explicitStylePreloads,
    explicitScriptPreloads,
    headResources,
  } = resources;

  bases.forEach(r => {
    pushSelfClosing(target, r.props, 'base', responseState);
    r.flushed = true;
  });
  bases.clear();

  preconnects.forEach(r => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  preconnects.clear();

  fontPreloads.forEach(r => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  fontPreloads.clear();

  // Flush stylesheets first by earliest precedence
  if (firstPrecedence) {
    const precedenceSet = precedences.get(firstPrecedence);
    if (precedenceSet && precedenceSet.size) {
      precedenceSet.forEach(r => {
        if (!r.flushed) {
          pushLinkImpl(target, r.props, responseState);
          r.flushed = true;
          r.inShell = true;
          r.hint.flushed = true;
        }
      });
      resources.firstPrecedenceFlushed = true;
      precedenceSet.clear();
    }
  }

  usedStylePreloads.forEach(flushLinkResource);
  usedStylePreloads.clear();

  scripts.forEach(r => {
    // should never be flushed already
    pushScriptImpl(target, r.props, responseState);
    r.flushed = true;
    r.hint.flushed = true;
  });
  scripts.clear();

  usedScriptPreloads.forEach(flushLinkResource);
  usedScriptPreloads.clear();

  explicitStylePreloads.forEach(flushLinkResource);
  explicitStylePreloads.clear();

  explicitScriptPreloads.forEach(flushLinkResource);
  explicitScriptPreloads.clear();

  headResources.forEach(r => {
    switch (r.type) {
      case 'title': {
        pushTitleImpl(target, r.props, responseState);
        break;
      }
      case 'meta': {
        pushSelfClosing(target, r.props, 'meta', responseState);
        break;
      }
      case 'link': {
        pushLinkImpl(target, r.props, responseState);
        break;
      }
    }
    r.flushed = true;
  });
  headResources.clear();

  let i;
  let r = true;
  for (i = 0; i < target.length - 1; i++) {
    writeChunk(destination, target[i]);
  }
  if (i < target.length) {
    r = writeChunkAndReturn(destination, target[i]);
  }
  return r;
}

function writeInitialResources(
  destination: Destination,
  resources: Resources,
  responseState: ResponseState,
  willEmitInstructions: boolean,
): boolean {
  // Write initially discovered resources after the shell completes
  if (
    enableFizzExternalRuntime &&
    responseState.externalRuntimeConfig &&
    willEmitInstructions
  ) {
    // If the root segment is incomplete due to suspended tasks
    // (e.g. willFlushAllSegments = false) and we are using data
    // streaming format, ensure the external runtime is sent.
    // (User code could choose to send this even earlier by calling
    //  preinit(...), if they know they will suspend).
    const {src, integrity} = responseState.externalRuntimeConfig;
    preinitImpl(resources, src, {as: 'script', integrity});
  }
  function flushLinkResource(resource: LinkTagResource) {
    if (!resource.flushed) {
      pushLinkImpl(target, resource.props, responseState);
      resource.flushed = true;
    }
  }

  const target: Array<Chunk | PrecomputedChunk> = [];

  const {
    bases,
    preconnects,
    fontPreloads,
    firstPrecedence,
    firstPrecedenceFlushed,
    precedences,
    usedStylePreloads,
    scripts,
    usedScriptPreloads,
    explicitStylePreloads,
    explicitScriptPreloads,
    headResources,
  } = resources;

  bases.forEach(r => {
    pushSelfClosing(target, r.props, 'base', responseState);
    r.flushed = true;
  });
  bases.clear();

  preconnects.forEach(r => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  preconnects.clear();

  fontPreloads.forEach(r => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  fontPreloads.clear();

  // Flush stylesheets first by earliest precedence
  precedences.forEach((p, precedence) => {
    if (
      precedence === firstPrecedence &&
      firstPrecedenceFlushed &&
      p.size === 0
    ) {
      // We don't have anything to flush for the first precedence now but
      // we already emitted items for this precedence and do not need a
      // placeholder
      return;
    }
    if (p.size) {
      p.forEach(r => {
        if (!r.flushed) {
          pushLinkImpl(target, r.props, responseState);
          r.flushed = true;
          r.inShell = true;
          r.hint.flushed = true;
        }
      });
      p.clear();
    } else {
      target.push(
        precedencePlaceholderStart,
        stringToChunk(escapeTextForBrowser(precedence)),
        precedencePlaceholderEnd,
      );
    }
  });

  usedStylePreloads.forEach(flushLinkResource);
  usedStylePreloads.clear();

  scripts.forEach(r => {
    // should never be flushed already
    pushScriptImpl(target, r.props, responseState);
    r.flushed = true;
    r.hint.flushed = true;
  });
  scripts.clear();

  usedScriptPreloads.forEach(flushLinkResource);
  usedScriptPreloads.clear();

  explicitStylePreloads.forEach(flushLinkResource);
  explicitStylePreloads.clear();

  explicitScriptPreloads.forEach(flushLinkResource);
  explicitScriptPreloads.clear();

  headResources.forEach(r => {
    switch (r.type) {
      case 'title': {
        pushTitleImpl(target, r.props, responseState);
        break;
      }
      case 'meta': {
        pushSelfClosing(target, r.props, 'meta', responseState);
        break;
      }
      case 'link': {
        pushLinkImpl(target, r.props, responseState);
        break;
      }
    }
    r.flushed = true;
  });
  headResources.clear();

  let i;
  let r = true;
  for (i = 0; i < target.length - 1; i++) {
    writeChunk(destination, target[i]);
  }
  if (i < target.length) {
    r = writeChunkAndReturn(destination, target[i]);
  }
  return r;
}

export function writeResources(
  destination: Destination,
  resources: Resources,
  responseState: ResponseState,
  willEmitInstructions: boolean,
): boolean {
  // Write initially discovered resources after the shell completes
  if (
    enableFizzExternalRuntime &&
    responseState.externalRuntimeConfig &&
    willEmitInstructions
  ) {
    const {src, integrity} = responseState.externalRuntimeConfig;
    preinitImpl(resources, src, {as: 'script', integrity});
  }

  function flushLinkResource(resource: LinkTagResource) {
    if (!resource.flushed) {
      pushLinkImpl(target, resource.props, responseState);
      resource.flushed = true;
    }
  }

  const target: Array<Chunk | PrecomputedChunk> = [];

  const {
    preconnects,
    fontPreloads,
    usedStylePreloads,
    scripts,
    usedScriptPreloads,
    explicitStylePreloads,
    explicitScriptPreloads,
    headResources,
  } = resources;

  preconnects.forEach(r => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  preconnects.clear();

  fontPreloads.forEach(r => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  fontPreloads.clear();

  usedStylePreloads.forEach(flushLinkResource);
  usedStylePreloads.clear();

  scripts.forEach(r => {
    // should never be flushed already
    pushScriptImpl(target, r.props, responseState);
    r.flushed = true;
    r.hint.flushed = true;
  });
  scripts.clear();

  usedScriptPreloads.forEach(flushLinkResource);
  usedScriptPreloads.clear();

  explicitStylePreloads.forEach(flushLinkResource);
  explicitStylePreloads.clear();

  explicitScriptPreloads.forEach(flushLinkResource);
  explicitScriptPreloads.clear();

  headResources.forEach(r => {
    switch (r.type) {
      case 'title': {
        pushTitleImpl(target, r.props, responseState);
        break;
      }
      case 'meta': {
        pushSelfClosing(target, r.props, 'meta', responseState);
        break;
      }
      case 'link': {
        pushLinkImpl(target, r.props, responseState);
        break;
      }
    }
    r.flushed = true;
  });
  headResources.clear();

  let i;
  let r = true;
  for (i = 0; i < target.length - 1; i++) {
    writeChunk(destination, target[i]);
  }
  if (i < target.length) {
    r = writeChunkAndReturn(destination, target[i]);
  }
  return r;
}

function hasStyleResourceDependencies(
  boundaryResources: BoundaryResources,
): boolean {
  const iter = boundaryResources.values();
  // At the moment boundaries only accumulate style resources
  // so we assume the type is correct and don't check it
  while (true) {
    const {value: resource} = iter.next();
    if (!resource) break;

    // If every style Resource flushed in the shell we do not need to send
    // any dependencies
    if (!resource.inShell) {
      return true;
    }
  }
  return false;
}

const arrayFirstOpenBracket = stringToPrecomputedChunk('[');
const arraySubsequentOpenBracket = stringToPrecomputedChunk(',[');
const arrayInterstitial = stringToPrecomputedChunk(',');
const arrayCloseBracket = stringToPrecomputedChunk(']');

// This function writes a 2D array of strings to be embedded in javascript.
// E.g.
//  [["JS_escaped_string1", "JS_escaped_string2"]]
function writeStyleResourceDependenciesInJS(
  destination: Destination,
  boundaryResources: BoundaryResources,
): void {
  writeChunk(destination, arrayFirstOpenBracket);

  let nextArrayOpenBrackChunk = arrayFirstOpenBracket;
  boundaryResources.forEach(resource => {
    if (resource.inShell) {
      // We can elide this dependency because it was flushed in the shell and
      // should be ready before content is shown on the client
    } else if (resource.flushed) {
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependencyHrefOnlyInJS(destination, resource.href);
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;
    } else {
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependencyInJS(
        destination,
        resource.href,
        resource.precedence,
        resource.props,
      );
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;

      resource.flushed = true;
      resource.hint.flushed = true;
    }
  });
  writeChunk(destination, arrayCloseBracket);
}

/* Helper functions */
function writeStyleResourceDependencyHrefOnlyInJS(
  destination: Destination,
  href: string,
) {
  // We should actually enforce this earlier when the resource is created but for
  // now we make sure we are actually dealing with a string here.
  if (__DEV__) {
    checkAttributeStringCoercion(href, 'href');
  }
  const coercedHref = '' + (href: any);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(coercedHref)),
  );
}

function writeStyleResourceDependencyInJS(
  destination: Destination,
  href: string,
  precedence: string,
  props: Object,
) {
  if (__DEV__) {
    checkAttributeStringCoercion(href, 'href');
  }
  const coercedHref = '' + (href: any);
  sanitizeURL(coercedHref);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(coercedHref)),
  );

  if (__DEV__) {
    checkAttributeStringCoercion(precedence, 'precedence');
  }
  const coercedPrecedence = '' + (precedence: any);
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(coercedPrecedence)),
  );

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'href':
        case 'rel':
        case 'precedence':
        case 'data-precedence': {
          break;
        }
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${'link'} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        // eslint-disable-next-line-no-fallthrough
        default:
          writeStyleResourceAttributeInJS(destination, propKey, propValue);
          break;
      }
    }
  }
  return null;
}

function writeStyleResourceAttributeInJS(
  destination: Destination,
  name: string,
  value: string | boolean | number | Function | Object, // not null or undefined
): void {
  let attributeName = name.toLowerCase();
  let attributeValue;
  switch (typeof value) {
    case 'function':
    case 'symbol':
      return;
  }

  switch (name) {
    // Reserved names
    case 'innerHTML':
    case 'dangerouslySetInnerHTML':
    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
    case 'style':
      // Ignored
      return;

    // Attribute renames
    case 'className':
      attributeName = 'class';
      break;

    // Booleans
    case 'hidden':
      if (value === false) {
        return;
      }
      attributeValue = '';
      break;

    // Santized URLs
    case 'src':
    case 'href': {
      if (__DEV__) {
        checkAttributeStringCoercion(value, attributeName);
      }
      attributeValue = '' + (value: any);
      sanitizeURL(attributeValue);
      break;
    }
    default: {
      if (!isAttributeNameSafe(name)) {
        return;
      }
    }
  }

  if (
    // shouldIgnoreAttribute
    // We have already filtered out null/undefined and reserved words.
    name.length > 2 &&
    (name[0] === 'o' || name[0] === 'O') &&
    (name[1] === 'n' || name[1] === 'N')
  ) {
    return;
  }

  if (__DEV__) {
    checkAttributeStringCoercion(value, attributeName);
  }
  attributeValue = '' + (value: any);
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(attributeName)),
  );
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(attributeValue)),
  );
}

// This function writes a 2D array of strings to be embedded in an attribute
// value and read with JSON.parse in ReactDOMServerExternalRuntime.js
// E.g.
//  [[&quot;JSON_escaped_string1&quot;, &quot;JSON_escaped_string2&quot;]]
function writeStyleResourceDependenciesInAttr(
  destination: Destination,
  boundaryResources: BoundaryResources,
): void {
  writeChunk(destination, arrayFirstOpenBracket);

  let nextArrayOpenBrackChunk = arrayFirstOpenBracket;
  boundaryResources.forEach(resource => {
    if (resource.inShell) {
      // We can elide this dependency because it was flushed in the shell and
      // should be ready before content is shown on the client
    } else if (resource.flushed) {
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependencyHrefOnlyInAttr(destination, resource.href);
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;
    } else {
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependencyInAttr(
        destination,
        resource.href,
        resource.precedence,
        resource.props,
      );
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;

      resource.flushed = true;
      resource.hint.flushed = true;
    }
  });
  writeChunk(destination, arrayCloseBracket);
}

/* Helper functions */
function writeStyleResourceDependencyHrefOnlyInAttr(
  destination: Destination,
  href: string,
) {
  // We should actually enforce this earlier when the resource is created but for
  // now we make sure we are actually dealing with a string here.
  if (__DEV__) {
    checkAttributeStringCoercion(href, 'href');
  }
  const coercedHref = '' + (href: any);
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(coercedHref))),
  );
}

function writeStyleResourceDependencyInAttr(
  destination: Destination,
  href: string,
  precedence: string,
  props: Object,
) {
  if (__DEV__) {
    checkAttributeStringCoercion(href, 'href');
  }
  const coercedHref = '' + (href: any);
  sanitizeURL(coercedHref);
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(coercedHref))),
  );

  if (__DEV__) {
    checkAttributeStringCoercion(precedence, 'precedence');
  }
  const coercedPrecedence = '' + (precedence: any);
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(coercedPrecedence))),
  );

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];
      if (propValue == null) {
        continue;
      }
      switch (propKey) {
        case 'href':
        case 'rel':
        case 'precedence':
        case 'data-precedence': {
          break;
        }
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            `${'link'} is a self-closing tag and must neither have \`children\` nor ` +
              'use `dangerouslySetInnerHTML`.',
          );
        // eslint-disable-next-line-no-fallthrough
        default:
          writeStyleResourceAttributeInAttr(destination, propKey, propValue);
          break;
      }
    }
  }
  return null;
}

function writeStyleResourceAttributeInAttr(
  destination: Destination,
  name: string,
  value: string | boolean | number | Function | Object, // not null or undefined
): void {
  let attributeName = name.toLowerCase();
  let attributeValue;
  switch (typeof value) {
    case 'function':
    case 'symbol':
      return;
  }

  switch (name) {
    // Reserved names
    case 'innerHTML':
    case 'dangerouslySetInnerHTML':
    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
    case 'style':
      // Ignored
      return;

    // Attribute renames
    case 'className':
      attributeName = 'class';
      break;

    // Booleans
    case 'hidden':
      if (value === false) {
        return;
      }
      attributeValue = '';
      break;

    // Santized URLs
    case 'src':
    case 'href': {
      if (__DEV__) {
        checkAttributeStringCoercion(value, attributeName);
      }
      attributeValue = '' + (value: any);
      sanitizeURL(attributeValue);
      break;
    }
    default: {
      if (!isAttributeNameSafe(name)) {
        return;
      }
    }
  }

  if (
    // shouldIgnoreAttribute
    // We have already filtered out null/undefined and reserved words.
    name.length > 2 &&
    (name[0] === 'o' || name[0] === 'O') &&
    (name[1] === 'n' || name[1] === 'N')
  ) {
    return;
  }

  if (__DEV__) {
    checkAttributeStringCoercion(value, attributeName);
  }
  attributeValue = '' + (value: any);
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(attributeName))),
  );
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeTextForBrowser(JSON.stringify(attributeValue))),
  );
}
