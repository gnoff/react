/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {current} from '../../../react-reconciler/src/ReactCurrentFiber';
import {
  validatePreloadResourceDifference,
  validateStyleResourceDifference,
  validateStyleAndHintProps,
  validateScriptResourceDifference,
  validateScriptAndHintProps,
  validateLinkPropsForStyleResource,
  validateLinkPropsForPreloadResource,
  validatePreloadArguments,
  validatePreinitArguments,
} from '../shared/ReactDOMResourceValidation';

type Props = {[string]: mixed};

type ResourceType = 'style' | 'font' | 'script';

type PreloadProps = {
  rel: 'preload',
  as: ResourceType,
  href: string,
  [string]: mixed,
};
type PreloadResource = {
  type: 'preload',
  as: ResourceType,
  href: string,
  props: PreloadProps,
  flushed: boolean,
};

type StyleProps = {
  rel: 'stylesheet',
  href: string,
  'data-precedence': string,
  [string]: mixed,
};
type StyleResource = {
  type: 'style',
  href: string,
  precedence: string,
  props: StyleProps,

  flushed: boolean,
  inShell: boolean, // flushedInShell
  hint: PreloadResource,
  set: Set<StyleResource>, // the precedence set this resource should be flushed in
};

type ScriptProps = {
  src: string,
  [string]: mixed,
};
type ScriptResource = {
  type: 'script',
  src: string,
  props: ScriptProps,

  flushed: boolean,
  hint: PreloadResource,
};

type TitleProps = {
  [string]: mixed,
};
type TitleResource = {
  type: 'title',
  props: TitleProps,

  flushed: boolean,
};

type MetaProps = {
  [string]: mixed,
};
type MetaResource = {
  type: 'meta',
  key: string,
  props: MetaProps,

  flushed: boolean,
};

type LinkProps = {
  href: string,
  rel: string,
  [string]: mixed,
};
type LinkResource = {
  type: 'link',
  props: LinkProps,

  flushed: boolean,
};

type BaseResource = {
  type: 'base',
  props: Props,

  flushed: boolean,
};

type HoistableTag = 'link' | 'meta' | 'title';
type Hoistable = {
  type: HoistableTag,
  props: Props,
};

export type LinkTagResource = PreloadResource | StyleResource | LinkResource;
export type Resource = PreloadResource | StyleResource | ScriptResource;
export type HeadResource =
  | TitleResource
  | MetaResource
  | LinkResource
  | BaseResource;

export type Resources = {
  // Request local cache
  preloadsMap: Map<string, PreloadResource>,
  stylesMap: Map<string, StyleResource>,
  scriptsMap: Map<string, ScriptResource>,
  headsMap: Map<string, HeadResource>,

  // Flushing queues for Resource dependencies
  charset: null | MetaResource,
  bases: Set<BaseResource>,
  preconnects: Set<LinkResource>,
  fontPreloads: Set<PreloadResource>,
  // usedImagePreloads: Set<PreloadResource>,
  firstPrecedence: string,
  firstPrecedenceFlushed: boolean,
  precedences: Map<string, Set<StyleResource>>,
  usedStylePreloads: Set<PreloadResource>,
  scripts: Set<ScriptResource>,
  usedScriptPreloads: Set<PreloadResource>,
  explicitStylePreloads: Set<PreloadResource>,
  // explicitImagePreloads: Set<PreloadResource>,
  explicitScriptPreloads: Set<PreloadResource>,
  headResources: Set<HeadResource>,

  // cache for tracking structured meta tags
  structuredMetaKeys: Map<string, MetaResource>,

  // Module-global-like reference for current boundary resources
  boundaryResources: ?BoundaryResources,
  ...
};

// @TODO add bootstrap script to implicit preloads
export function createResources(): Resources {
  return {
    // persistent
    preloadsMap: new Map(),
    stylesMap: new Map(),
    scriptsMap: new Map(),
    headsMap: new Map(),

    // cleared on flush
    charset: null,
    bases: new Set(),
    preconnects: new Set(),
    fontPreloads: new Set(),
    // usedImagePreloads: new Set(),
    firstPrecedence: '',
    firstPrecedenceFlushed: false,
    precedences: new Map(),
    usedStylePreloads: new Set(),
    scripts: new Set(),
    usedScriptPreloads: new Set(),
    explicitStylePreloads: new Set(),
    // explicitImagePreloads: new Set(),
    explicitScriptPreloads: new Set(),
    headResources: new Set(),

    // cache for tracking structured meta tags
    structuredMetaKeys: new Map(),

    // like a module global for currently rendering boundary
    boundaryResources: null,
  };
}

export type BoundaryResources = Set<StyleResource>;

export function createBoundaryResources(): BoundaryResources {
  return new Set();
}

let currentResources: null | Resources = null;
const currentResourcesStack = [];

export function prepareToRenderResources(resources: Resources) {
  currentResourcesStack.push(currentResources);
  currentResources = resources;
}

export function finishRenderingResources() {
  currentResources = currentResourcesStack.pop();
}

export function setCurrentlyRenderingBoundaryResourcesTarget(
  resources: Resources,
  boundaryResources: null | BoundaryResources,
) {
  resources.boundaryResources = boundaryResources;
}

export const ReactDOMServerFloatDispatcher = {
  preload,
  preinit,
};

type PreloadAs = ResourceType;
type PreloadOptions = {as: PreloadAs, crossOrigin?: string, integrity?: string};
function preload(href: string, options: PreloadOptions) {
  if (!currentResources) {
    // While we expect that preload calls are primarily going to be observed
    // during render because effects and events don't run on the server it is
    // still possible that these get called in module scope. This is valid on
    // the client since there is still a document to interact with but on the
    // server we need a request to associate the call to. Because of this we
    // simply return and do not warn.
    return;
  }
  const resources = currentResources;
  if (__DEV__) {
    validatePreloadArguments(href, options);
  }
  if (
    typeof href === 'string' &&
    href &&
    typeof options === 'object' &&
    options !== null
  ) {
    const as = options.as;
    let resource = resources.preloadsMap.get(href);
    if (resource) {
      if (__DEV__) {
        const originallyImplicit =
          (resource: any)._dev_implicit_construction === true;
        const latestProps = preloadPropsFromPreloadOptions(href, as, options);
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
        preloadPropsFromPreloadOptions(href, as, options),
      );
    }
    switch (as) {
      case 'font': {
        resources.fontPreloads.add(resource);
        break;
      }
      case 'style': {
        resources.explicitStylePreloads.add(resource);
        break;
      }
      case 'script': {
        resources.explicitScriptPreloads.add(resource);
        break;
      }
    }
  }
}

type PreinitAs = 'style' | 'script';
type PreinitOptions = {
  as: PreinitAs,
  precedence?: string,
  crossOrigin?: string,
  integrity?: string,
};
function preinit(href: string, options: PreinitOptions): void {
  if (!currentResources) {
    // While we expect that preinit calls are primarily going to be observed
    // during render because effects and events don't run on the server it is
    // still possible that these get called in module scope. This is valid on
    // the client since there is still a document to interact with but on the
    // server we need a request to associate the call to. Because of this we
    // simply return and do not warn.
    return;
  }
  preinitImpl(currentResources, href, options);
}

// On the server, preinit may be called outside of render when sending an
// external SSR runtime as part of the initial resources payload. Since this
// is an internal React call, we do not need to use the resources stack.
export function preinitImpl(
  resources: Resources,
  href: string,
  options: PreinitOptions,
): void {
  if (__DEV__) {
    validatePreinitArguments(href, options);
  }
  if (
    typeof href === 'string' &&
    href &&
    typeof options === 'object' &&
    options !== null
  ) {
    const as = options.as;
    switch (as) {
      case 'style': {
        let resource = resources.stylesMap.get(href);
        if (resource) {
          if (__DEV__) {
            const latestProps = stylePropsFromPreinitOptions(
              href,
              resource.precedence,
              options,
            );
            validateStyleResourceDifference(resource.props, latestProps);
          }
        } else {
          const precedence = options.precedence || 'default';
          const resourceProps = stylePropsFromPreinitOptions(
            href,
            precedence,
            options,
          );
          resource = createStyleResource(
            resources,
            href,
            precedence,
            resourceProps,
          );
        }
        resource.set.add(resource);
        resources.explicitStylePreloads.add(resource.hint);

        return;
      }
      case 'script': {
        const src = href;
        let resource = resources.scriptsMap.get(src);
        if (resource) {
          if (__DEV__) {
            const latestProps = scriptPropsFromPreinitOptions(src, options);
            validateScriptResourceDifference(resource.props, latestProps);
          }
        } else {
          const scriptProps = scriptPropsFromPreinitOptions(src, options);
          resource = createScriptResource(resources, src, scriptProps);
          resources.scripts.add(resource);
        }
        return;
      }
    }
  }
}

function preloadPropsFromPreloadOptions(
  href: string,
  as: ResourceType,
  options: PreloadOptions,
): PreloadProps {
  return {
    href,
    rel: 'preload',
    as,
    crossOrigin: as === 'font' ? '' : options.crossOrigin,
    integrity: options.integrity,
  };
}

export function preloadPropsFromRawProps(
  href: string,
  as: ResourceType,
  rawProps: Props,
): PreloadProps {
  const props: PreloadProps = Object.assign({}, rawProps);
  props.href = href;
  props.rel = 'preload';
  props.as = as;
  if (as === 'font') {
    // Font preloads always need CORS anonymous mode so we set it here
    // regardless of the props provided. This should warn elsewhere in
    // dev
    props.crossOrigin = '';
  }
  return props;
}

export function preloadAsStylePropsFromProps(
  href: string,
  props: Props | StyleProps,
): PreloadProps {
  return {
    rel: 'preload',
    as: 'style',
    href: href,
    crossOrigin: props.crossOrigin,
    integrity: props.integrity,
    media: props.media,
    hrefLang: props.hrefLang,
    referrerPolicy: props.referrerPolicy,
  };
}

function preloadAsScriptPropsFromProps(
  href: string,
  props: Props | ScriptProps,
): PreloadProps {
  return {
    rel: 'preload',
    as: 'script',
    href,
    crossOrigin: props.crossOrigin,
    integrity: props.integrity,
    referrerPolicy: props.referrerPolicy,
  };
}

export function createPreloadResource(
  resources: Resources,
  href: string,
  as: ResourceType,
  props: PreloadProps,
): PreloadResource {
  const {preloadsMap} = resources;
  if (__DEV__) {
    if (preloadsMap.has(href)) {
      console.error(
        'createPreloadResource was called when a preload Resource matching the same href already exists. This is a bug in React.',
      );
    }
  }

  const resource = {
    type: 'preload',
    as,
    href,
    flushed: false,
    props,
  };
  preloadsMap.set(href, resource);
  return resource;
}

export function stylePropsFromRawProps(
  href: string,
  precedence: string,
  rawProps: Props,
): StyleProps {
  const props: StyleProps = Object.assign({}, rawProps);
  props.href = href;
  props.rel = 'stylesheet';
  props['data-precedence'] = precedence;
  delete props.precedence;

  return props;
}

function stylePropsFromPreinitOptions(
  href: string,
  precedence: string,
  options: PreinitOptions,
): StyleProps {
  return {
    rel: 'stylesheet',
    href,
    'data-precedence': precedence,
    crossOrigin: options.crossOrigin,
  };
}

export function createStyleResource(
  resources: Resources,
  href: string,
  precedence: string,
  props: StyleProps,
): StyleResource {
  if (__DEV__) {
    if (resources.stylesMap.has(href)) {
      console.error(
        'createStyleResource was called when a style Resource matching the same href already exists. This is a bug in React.',
      );
    }
  }
  const {stylesMap, preloadsMap, precedences, firstPrecedence} = resources;

  // If this is the first time we've seen this precedence we encode it's position in our set even though
  // we don't add the resource to this set yet
  let precedenceSet = precedences.get(precedence);
  if (!precedenceSet) {
    precedenceSet = new Set();
    precedences.set(precedence, precedenceSet);
    if (!firstPrecedence) {
      resources.firstPrecedence = precedence;
    }
  }

  let hint = preloadsMap.get(href);
  if (hint) {
    // If a preload for this style Resource already exists there are certain props we want to adopt
    // on the style Resource, primarily focussed on making sure the style network pathways utilize
    // the preload pathways. For instance if you have diffreent crossOrigin attributes for a preload
    // and a stylesheet the stylesheet will make a new request even if the preload had already loaded
    adoptPreloadPropsForStyleProps(props, hint.props);

    if (__DEV__) {
      validateStyleAndHintProps(
        hint.props,
        props,
        (hint: any)._dev_implicit_construction,
      );
    }
  } else {
    const preloadResourceProps = preloadAsStylePropsFromProps(href, props);
    hint = createPreloadResource(
      resources,
      href,
      'style',
      preloadResourceProps,
    );
    if (__DEV__) {
      (hint: any)._dev_implicit_construction = true;
    }
    resources.explicitStylePreloads.add(hint);
  }

  const resource = {
    type: 'style',
    href,
    precedence,
    flushed: false,
    inShell: false,
    props,
    hint,
    set: precedenceSet,
  };
  stylesMap.set(href, resource);

  return resource;
}

export function adoptPreloadPropsForStyleProps(
  resourceProps: StyleProps,
  preloadProps: PreloadProps,
): void {
  if (resourceProps.crossOrigin == null)
    resourceProps.crossOrigin = preloadProps.crossOrigin;
  if (resourceProps.referrerPolicy == null)
    resourceProps.referrerPolicy = preloadProps.referrerPolicy;
  if (resourceProps.title == null) resourceProps.title = preloadProps.title;
}

function scriptPropsFromPreinitOptions(
  src: string,
  options: PreinitOptions,
): ScriptProps {
  return {
    src,
    async: true,
    crossOrigin: options.crossOrigin,
    integrity: options.integrity,
  };
}

function scriptPropsFromRawProps(src: string, rawProps: Props): ScriptProps {
  const props = Object.assign({}, rawProps);
  props.src = src;
  return props;
}

function createScriptResource(
  resources: Resources,
  src: string,
  props: ScriptProps,
): ScriptResource {
  if (__DEV__) {
    if (resources.scriptsMap.has(src)) {
      console.error(
        'createScriptResource was called when a script Resource matching the same src already exists. This is a bug in React.',
      );
    }
  }
  const {scriptsMap, preloadsMap} = resources;

  let hint = preloadsMap.get(src);
  if (hint) {
    // If a preload for this style Resource already exists there are certain props we want to adopt
    // on the style Resource, primarily focussed on making sure the style network pathways utilize
    // the preload pathways. For instance if you have diffreent crossOrigin attributes for a preload
    // and a stylesheet the stylesheet will make a new request even if the preload had already loaded
    adoptPreloadPropsForScriptProps(props, hint.props);

    if (__DEV__) {
      validateScriptAndHintProps(
        hint.props,
        props,
        (hint: any)._dev_implicit_construction,
      );
    }
  } else {
    const preloadResourceProps = preloadAsScriptPropsFromProps(src, props);
    hint = createPreloadResource(
      resources,
      src,
      'script',
      preloadResourceProps,
    );
    if (__DEV__) {
      (hint: any)._dev_implicit_construction = true;
    }
    resources.explicitScriptPreloads.add(hint);
  }

  const resource = {
    type: 'script',
    src,
    flushed: false,
    props,
    hint,
  };
  scriptsMap.set(src, resource);

  return resource;
}

function adoptPreloadPropsForScriptProps(
  resourceProps: ScriptProps,
  preloadProps: PreloadProps,
): void {
  if (resourceProps.crossOrigin == null)
    resourceProps.crossOrigin = preloadProps.crossOrigin;
  if (resourceProps.referrerPolicy == null)
    resourceProps.referrerPolicy = preloadProps.referrerPolicy;
  if (resourceProps.integrity == null)
    resourceProps.integrity = preloadProps.integrity;
}

function titlePropsFromRawProps(
  child: string | number,
  rawProps: Props,
): TitleProps {
  const props = Object.assign({}, rawProps);
  props.children = child;
  return props;
}

export function expectCurrentResources(): Resources {
  if (!currentResources) {
    throw new Error(
      '"currentResources" was expected to exist. This is a bug in React.',
    );
  }
  return currentResources;
}

// Construct a resource from link props.
export function resourcesFromScript(props: Props): boolean {
  if (!currentResources) {
    throw new Error(
      '"currentResources" was expected to exist. This is a bug in React.',
    );
  }
  const resources = currentResources;
  const {src, async, onLoad, onError} = props;
  if (!src || typeof src !== 'string') {
    return false;
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
    return true;
  }

  return false;
}

export function hoistResources(
  resources: Resources,
  source: BoundaryResources,
): void {
  const currentBoundaryResources = resources.boundaryResources;
  if (currentBoundaryResources) {
    source.forEach(resource => currentBoundaryResources.add(resource));
    source.clear();
  }
}

export function hoistResourcesToRoot(
  resources: Resources,
  boundaryResources: BoundaryResources,
): void {
  boundaryResources.forEach(resource => resource.set.add(resource));
  boundaryResources.clear();
}
