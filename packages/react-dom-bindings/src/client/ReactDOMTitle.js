/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import isArray from 'shared/isArray';

import {enableFloat} from 'shared/ReactFeatureFlags';
import {isMarkedResource} from './ReactDOMComponentTree';

function getTitleChildren(children: mixed): void | null | string {
  if (children == null) {
    return children;
  } else if (typeof children === 'string') {
    return children;
  } else if (typeof children === 'number') {
    return '' + children;
  } else if (isArray(children) && children.length === 1) {
    return getTitleChildren(children[0]);
  } else {
    return null;
  }
}

// For titles that are Hoistables the only valid values for children are
// void, null, or single alphanumeric values. We could in theory make this
// restriction apply to all titles however to avoid breaking changes this
// is for now only applied to Hoistable titles
export function getProps(element: Element, props: Object): Object {
  if (enableFloat && isMarkedResource(element)) {
    const titleChildren = getTitleChildren(props.children);
    if (titleChildren !== props.children) {
      // We only bother constructing a new object if the children value differs
      // from what was passed in
      const resourceProps = Object.assign({}, props);
      resourceProps.children = titleChildren;
      return resourceProps;
    }
  }
  return props;
}
