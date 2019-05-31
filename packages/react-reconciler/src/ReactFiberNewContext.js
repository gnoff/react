/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactContext} from 'shared/ReactTypes';
import type {Fiber} from './ReactFiber';
import type {StackCursor} from './ReactFiberStack';
import type {ExpirationTime} from './ReactFiberExpirationTime';

export type ContextDependencyList = {
  first: ContextDependency<mixed>,
  expirationTime: ExpirationTime,
};

type ContextDependency<T> = {
  context: ReactContext<T>,
  observedBits: number,
  next: ContextDependency<mixed> | null,
};

import warningWithoutStack from 'shared/warningWithoutStack';
import {isPrimaryRenderer} from './ReactFiberHostConfig';
import {createCursor, push, pop} from './ReactFiberStack';
import getComponentName from 'shared/getComponentName';
import MAX_SIGNED_31_BIT_INT from './maxSigned31BitInt';
import {
  ContextProvider,
  ClassComponent,
  DehydratedSuspenseComponent,
} from 'shared/ReactWorkTags';

import invariant from 'shared/invariant';
import warning from 'shared/warning';
import is from 'shared/objectIs';
import {
  createUpdate,
  enqueueUpdate,
  ForceUpdate,
} from 'react-reconciler/src/ReactUpdateQueue';
import {NoWork} from './ReactFiberExpirationTime';
import {markWorkInProgressReceivedUpdate} from './ReactFiberBeginWork';
import {
  enableSuspenseServerRenderer,
  enableIncrementalUnifiedContextPropagation,
  traceContextPropagation,
} from 'shared/ReactFeatureFlags';

const valueCursor: StackCursor<mixed> = createCursor(null);

let rendererSigil;
if (__DEV__) {
  // Use this to detect multiple renderers using the same context
  rendererSigil = {};
}

let currentlyRenderingFiber: Fiber | null = null;
let lastContextDependency: ContextDependency<mixed> | null = null;
let lastContextWithAllBitsObserved: ReactContext<any> | null = null;

let isDisallowedContextReadInDEV: boolean = false;

export function resetContextDependences(): void {
  // This is called right before React yields execution, to ensure `readContext`
  // cannot be called outside the render phase.
  currentlyRenderingFiber = null;
  lastContextDependency = null;
  lastContextWithAllBitsObserved = null;
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

export function enterDisallowedContextReadInDEV(): void {
  if (__DEV__) {
    isDisallowedContextReadInDEV = true;
  }
}

export function exitDisallowedContextReadInDEV(): void {
  if (__DEV__) {
    isDisallowedContextReadInDEV = false;
  }
}

let contextSet: Set<ReactContext<mixed>> = new Set();
let propagationSigil = null;
let propagationHasChangedBits = false;

export function requiresPropagation(fiber: Fiber | null): boolean {
  if (fiber !== null) {
    if (__DEV__ && traceContextPropagation) {
      if (fiber.propagationSigil === propagationSigil) {
        console.log(
          'fiber does not require propagation',
          getComponentName(fiber.type),
        );
      } else {
        console.log('fiber requires propagation', getComponentName(fiber.type));
      }
    }
    return fiber.propagationSigil !== propagationSigil;
  }
  return false;
}

export function pushProvider<T>(
  providerFiber: Fiber,
  nextValue: T,
  nextChangedBits: number,
): void {
  const context: ReactContext<T> = providerFiber.type._context;

  if (enableIncrementalUnifiedContextPropagation) {
    if (__DEV__ && traceContextPropagation) {
      console.log('pushing Provider with nextChangedBits', nextChangedBits);
    }

    contextSet.add(context);

    let currentChangedBits = context._currentChangedBits;
    // update propagationHasChangedBits. only do full check if nextChangedBits
    // is zero and currentChangedBits is greater than zero. Otherwise can can
    // infer without checking each context
    let nextPropagationHasChangedBits =
      nextChangedBits > 0 ||
      (currentChangedBits > 0 && someChangedBits()) ||
      propagationHasChangedBits;

    // set next changed bits on the context
    push(valueCursor, currentChangedBits, providerFiber);
    context._currentChangedBits = nextChangedBits;

    // set next propagationHasChangedBits
    push(valueCursor, propagationHasChangedBits, providerFiber);
    propagationHasChangedBits = nextPropagationHasChangedBits;

    // create a new propagationSigil and save the previous one
    push(valueCursor, propagationSigil, providerFiber);
    propagationSigil = {};
  }

  if (isPrimaryRenderer) {
    push(valueCursor, context._currentValue, providerFiber);
    context._currentValue = nextValue;

    if (__DEV__) {
      warningWithoutStack(
        context._currentRenderer === undefined ||
          context._currentRenderer === null ||
          context._currentRenderer === rendererSigil,
        'Detected multiple renderers concurrently rendering the ' +
          'same context provider. This is currently unsupported.',
      );
      context._currentRenderer = rendererSigil;
    }
  } else {
    push(valueCursor, context._currentValue2, providerFiber);
    context._currentValue2 = nextValue;

    if (__DEV__) {
      warningWithoutStack(
        context._currentRenderer2 === undefined ||
          context._currentRenderer2 === null ||
          context._currentRenderer2 === rendererSigil,
        'Detected multiple renderers concurrently rendering the ' +
          'same context provider. This is currently unsupported.',
      );
      context._currentRenderer2 = rendererSigil;
    }
  }
}

function someChangedBits(): boolean {
  let iter = contextSet.values();
  let step = iter.next();
  for (; !step.done; step = iter.next()) {
    const context = step.value;
    if (context._currentChangedBits > 0) {
      return true;
    }
  }
  return false;
}

export function popProvider(providerFiber: Fiber): void {
  const currentValue = valueCursor.current;
  // pop context value
  pop(valueCursor, providerFiber);

  const context: ReactContext<any> = providerFiber.type._context;

  if (isPrimaryRenderer) {
    context._currentValue = currentValue;
  } else {
    context._currentValue2 = currentValue;
  }

  if (enableIncrementalUnifiedContextPropagation) {
    // restore previous propagationSigil
    propagationSigil = valueCursor.current;
    pop(valueCursor, providerFiber);

    // restore previous propagationHasChangedBits
    propagationHasChangedBits = valueCursor.current;
    pop(valueCursor, providerFiber);

    // pop changedBits value
    context._currentChangedBits = valueCursor.current;
    pop(valueCursor, providerFiber);
  }
}

export function calculateChangedBits<T>(
  context: ReactContext<T>,
  newValue: T,
  oldValue: T,
) {
  if (is(oldValue, newValue)) {
    // No change
    return 0;
  } else {
    const changedBits =
      typeof context._calculateChangedBits === 'function'
        ? context._calculateChangedBits(oldValue, newValue)
        : MAX_SIGNED_31_BIT_INT;

    if (__DEV__) {
      warning(
        (changedBits & MAX_SIGNED_31_BIT_INT) === changedBits,
        'calculateChangedBits: Expected the return value to be a ' +
          '31-bit integer. Instead received: %s',
        changedBits,
      );
    }
    return changedBits | 0;
  }
}

function scheduleWorkOnParentPath(
  parent: Fiber | null,
  renderExpirationTime: ExpirationTime,
) {
  // Update the child expiration time of all the ancestors, including
  // the alternates.
  let node = parent;
  while (node !== null) {
    let alternate = node.alternate;
    if (node.childExpirationTime < renderExpirationTime) {
      node.childExpirationTime = renderExpirationTime;
      if (
        alternate !== null &&
        alternate.childExpirationTime < renderExpirationTime
      ) {
        alternate.childExpirationTime = renderExpirationTime;
      }
    } else if (
      alternate !== null &&
      alternate.childExpirationTime < renderExpirationTime
    ) {
      alternate.childExpirationTime = renderExpirationTime;
    } else {
      // Neither alternate was updated, which means the rest of the
      // ancestor path already has sufficient priority.
      break;
    }
    node = node.return;
  }
}

export function continueAllContextPropagations(
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
): boolean {
  if (enableIncrementalUnifiedContextPropagation) {
    if (__DEV__ && traceContextPropagation) {
      console.log(
        'continueAllContextPropagations, propagating all contexts together',
      );
    }
    propagateContexts(workInProgress, renderExpirationTime);
  }
}

export function propagateContextFromProvider(
  workInProgress: Fiber,
  context: ReactContext<mixed>,
  changedBits: number,
  renderExpirationTime: ExpirationTime,
) {
  if (enableIncrementalUnifiedContextPropagation) {
    if (__DEV__ && traceContextPropagation) {
      console.log(
        'propagateContextFromProvider, propagating all contexts together',
      );
    }
    propagateContexts(workInProgress, renderExpirationTime);
  } else {
    propagateContextChange(
      workInProgress,
      context,
      changedBits,
      renderExpirationTime,
    );
  }
}

export function propagateContexts(
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
): void {
  if (__DEV__ && traceContextPropagation) {
    console.log(
      'propagateContexts propagationHasChangedBits',
      propagationHasChangedBits,
    );
  }
  // no need to propagate if no context values have not changed
  if (propagationHasChangedBits === false) {
    return;
  }
  let fiber = workInProgress.child;
  if (fiber !== null) {
    // Set the return pointer of the child to the work-in-progress fiber.
    fiber.return = workInProgress;
  }
  while (fiber !== null) {
    let nextFiber;

    let alternate = fiber.alternate;

    // mark fiber propagationSigil
    fiber.propagationSigil = propagationSigil;
    if (alternate !== null) {
      alternate.propagationSigil = propagationSigil;
    }

    // Visit this fiber.
    const list = fiber.contextDependencies;
    if (list !== null) {
      nextFiber = fiber.child;

      let dependency = list.first;
      while (dependency !== null) {
        // Check if dependency bits have changed for context
        let context = dependency.context;
        let observedBits = dependency.observedBits;
        if ((observedBits & context._currentChangedBits) !== 0) {
          let requiresUpdate = true;

          let selector = dependency.selector;
          if (typeof selector === 'function') {
            let [, isNew] = selector(
              isPrimaryRenderer
                ? context._currentValue
                : context._currentValue2,
            );
            requiresUpdate = isNew;
          }

          if (requiresUpdate) {
            // Match! Schedule an update on this fiber.

            if (fiber.tag === ClassComponent) {
              // Schedule a force update on the work-in-progress.
              const update = createUpdate(renderExpirationTime);
              update.tag = ForceUpdate;
              // TODO: Because we don't have a work-in-progress, this will add the
              // update to the current fiber, too, which means it will persist even if
              // this render is thrown away. Since it's a race condition, not sure it's
              // worth fixing.
              enqueueUpdate(fiber, update);
            }

            if (fiber.expirationTime < renderExpirationTime) {
              fiber.expirationTime = renderExpirationTime;
            }
            if (
              alternate !== null &&
              alternate.expirationTime < renderExpirationTime
            ) {
              alternate.expirationTime = renderExpirationTime;
            }

            scheduleWorkOnParentPath(fiber.return, renderExpirationTime);

            // Mark the expiration time on the list, too.
            if (list.expirationTime < renderExpirationTime) {
              list.expirationTime = renderExpirationTime;
            }

            // Since we already found a match, we can stop traversing the
            // dependency list.
            // we can also stop traversing down and simply move on to fiber siblings
            if (__DEV__ && traceContextPropagation) {
              console.log(
                'found match, bailing out of context propagation for this child tree',
                getComponentName(fiber.type),
                fiber.propagationSigil === propagationSigil,
              );
            }
            nextFiber = null;
            break;
          }
        }
        dependency = dependency.next;
      }
    } else if (
      fiber.expirationTime >= renderExpirationTime ||
      (alternate !== null && alternate.expirationTime >= renderExpirationTime)
    ) {
      // this fiber is already scheduled for work.
      // on to siblings
      if (__DEV__ && traceContextPropagation) {
        console.log(
          'fiber scheduled for work, bailing out of context propagation for this child tree',
          getComponentName(fiber.type),
        );
      }
      nextFiber = null;
    } else if (fiber.tag === ContextProvider) {
      // Don't scan deeper since this is a ContextProvider
      // schedule work on Provider
      if (fiber.expirationTime < renderExpirationTime) {
        fiber.expirationTime = renderExpirationTime;
      }
      if (
        alternate !== null &&
        alternate.expirationTime < renderExpirationTime
      ) {
        alternate.expirationTime = renderExpirationTime;
      }
      scheduleWorkOnParentPath(fiber.return, renderExpirationTime);
      // don't go deeper, visit siblings if any
      if (__DEV__ && traceContextPropagation) {
        console.log(
          'fiber is a ContextProvider, scheduling for work and bailing out of context propagation for this child tree',
          getComponentName(fiber.type),
        );
      }
      nextFiber = null;
    } else if (
      enableSuspenseServerRenderer &&
      fiber.tag === DehydratedSuspenseComponent
    ) {
      // If a dehydrated suspense component is in this subtree, we don't know
      // if it will have any context consumers in it. The best we can do is
      // mark it as having updates on its children.
      if (fiber.expirationTime < renderExpirationTime) {
        fiber.expirationTime = renderExpirationTime;
      }
      if (
        alternate !== null &&
        alternate.expirationTime < renderExpirationTime
      ) {
        alternate.expirationTime = renderExpirationTime;
      }
      // This is intentionally passing this fiber as the parent
      // because we want to schedule this fiber as having work
      // on its children. We'll use the childExpirationTime on
      // this fiber to indicate that a context has changed.
      scheduleWorkOnParentPath(fiber, renderExpirationTime);
      nextFiber = fiber.sibling;
    } else {
      // Traverse down.
      nextFiber = fiber.child;
    }

    if (nextFiber !== null) {
      // Set the return pointer of the child to the work-in-progress fiber.
      nextFiber.return = fiber;
    } else {
      // No child. Traverse to next sibling.
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          // We're back to the root of this subtree. Exit.
          nextFiber = null;
          break;
        }
        let sibling = nextFiber.sibling;
        if (sibling !== null) {
          // Set the return pointer of the sibling to the work-in-progress fiber.
          sibling.return = nextFiber.return;
          nextFiber = sibling;
          break;
        }
        // No more siblings. Traverse up.
        nextFiber = nextFiber.return;
      }
    }
    fiber = nextFiber;
  }
}

export function propagateContextChange(
  workInProgress: Fiber,
  context: ReactContext<mixed>,
  changedBits: number,
  renderExpirationTime: ExpirationTime,
): void {
  let fiber = workInProgress.child;
  if (fiber !== null) {
    // Set the return pointer of the child to the work-in-progress fiber.
    fiber.return = workInProgress;
  }
  while (fiber !== null) {
    let nextFiber;

    // Visit this fiber.
    const list = fiber.contextDependencies;
    if (list !== null) {
      nextFiber = fiber.child;

      let dependency = list.first;
      while (dependency !== null) {
        // Check if the context matches.
        if (
          dependency.context === context &&
          (dependency.observedBits & changedBits) !== 0 &&
          // @TODO cleanup this case where we want to ignore useContextSelector if we're not doing
          // unified context propagation
          (!enableIncrementalUnifiedContextPropagation ||
            typeof dependency.selector !== 'function')
        ) {
          // Match! Schedule an update on this fiber.

          if (fiber.tag === ClassComponent) {
            // Schedule a force update on the work-in-progress.
            const update = createUpdate(renderExpirationTime);
            update.tag = ForceUpdate;
            // TODO: Because we don't have a work-in-progress, this will add the
            // update to the current fiber, too, which means it will persist even if
            // this render is thrown away. Since it's a race condition, not sure it's
            // worth fixing.
            enqueueUpdate(fiber, update);
          }

          if (fiber.expirationTime < renderExpirationTime) {
            fiber.expirationTime = renderExpirationTime;
          }
          let alternate = fiber.alternate;
          if (
            alternate !== null &&
            alternate.expirationTime < renderExpirationTime
          ) {
            alternate.expirationTime = renderExpirationTime;
          }

          scheduleWorkOnParentPath(fiber.return, renderExpirationTime);

          // Mark the expiration time on the list, too.
          if (list.expirationTime < renderExpirationTime) {
            list.expirationTime = renderExpirationTime;
          }

          // Since we already found a match, we can stop traversing the
          // dependency list.
          break;
        }
        dependency = dependency.next;
      }
    } else if (fiber.tag === ContextProvider) {
      // Don't scan deeper if this is a matching provider
      nextFiber = fiber.type === workInProgress.type ? null : fiber.child;
    } else if (
      enableSuspenseServerRenderer &&
      fiber.tag === DehydratedSuspenseComponent
    ) {
      // If a dehydrated suspense component is in this subtree, we don't know
      // if it will have any context consumers in it. The best we can do is
      // mark it as having updates on its children.
      if (fiber.expirationTime < renderExpirationTime) {
        fiber.expirationTime = renderExpirationTime;
      }
      let alternate = fiber.alternate;
      if (
        alternate !== null &&
        alternate.expirationTime < renderExpirationTime
      ) {
        alternate.expirationTime = renderExpirationTime;
      }
      // This is intentionally passing this fiber as the parent
      // because we want to schedule this fiber as having work
      // on its children. We'll use the childExpirationTime on
      // this fiber to indicate that a context has changed.
      scheduleWorkOnParentPath(fiber, renderExpirationTime);
      nextFiber = fiber.sibling;
    } else {
      // Traverse down.
      nextFiber = fiber.child;
    }

    if (nextFiber !== null) {
      // Set the return pointer of the child to the work-in-progress fiber.
      nextFiber.return = fiber;
    } else {
      // No child. Traverse to next sibling.
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === workInProgress) {
          // We're back to the root of this subtree. Exit.
          nextFiber = null;
          break;
        }
        let sibling = nextFiber.sibling;
        if (sibling !== null) {
          // Set the return pointer of the sibling to the work-in-progress fiber.
          sibling.return = nextFiber.return;
          nextFiber = sibling;
          break;
        }
        // No more siblings. Traverse up.
        nextFiber = nextFiber.return;
      }
    }
    fiber = nextFiber;
  }
}

export function prepareToReadContext(
  workInProgress: Fiber,
  renderExpirationTime: ExpirationTime,
): void {
  currentlyRenderingFiber = workInProgress;
  lastContextDependency = null;
  lastContextWithAllBitsObserved = null;

  const currentDependencies = workInProgress.contextDependencies;
  if (
    currentDependencies !== null &&
    currentDependencies.expirationTime >= renderExpirationTime
  ) {
    // Context list has a pending update. Mark that this fiber performed work.
    markWorkInProgressReceivedUpdate();
  }

  // Reset the work-in-progress list
  workInProgress.contextDependencies = null;
}

export function readContext<T>(
  context: ReactContext<T>,
  observedBits: void | number | boolean,
): T {
  if (__DEV__) {
    // This warning would fire if you read context inside a Hook like useMemo.
    // Unlike the class check below, it's not enforced in production for perf.
    warning(
      !isDisallowedContextReadInDEV,
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, but not ' +
        'inside Hooks like useReducer() or useMemo().',
    );
  }

  if (lastContextWithAllBitsObserved === context) {
    // Nothing to do. We already observe everything in this context.
  } else if (observedBits === false || observedBits === 0) {
    // Do not observe any updates.
  } else {
    let resolvedObservedBits; // Avoid deopting on observable arguments or heterogeneous types.
    if (
      typeof observedBits !== 'number' ||
      observedBits === MAX_SIGNED_31_BIT_INT
    ) {
      // Observe all updates.
      lastContextWithAllBitsObserved = ((context: any): ReactContext<mixed>);
      resolvedObservedBits = MAX_SIGNED_31_BIT_INT;
    } else {
      resolvedObservedBits = observedBits;
    }

    let contextItem = {
      context: ((context: any): ReactContext<mixed>),
      observedBits: resolvedObservedBits,
      next: null,
    };

    if (lastContextDependency === null) {
      invariant(
        currentlyRenderingFiber !== null,
        'Context can only be read while React is rendering. ' +
          'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
          'In function components, you can read it directly in the function body, but not ' +
          'inside Hooks like useReducer() or useMemo().',
      );

      // This is the first dependency for this component. Create a new list.
      lastContextDependency = contextItem;
      currentlyRenderingFiber.contextDependencies = {
        first: contextItem,
        expirationTime: NoWork,
      };
    } else {
      // Append a new context item.
      lastContextDependency = lastContextDependency.next = contextItem;
    }
  }
  return isPrimaryRenderer ? context._currentValue : context._currentValue2;
}

export function selectFromContext<T, S>(
  context: ReactContext<T>,
  select: T => [S, boolean],
): [S, boolean] {
  if (__DEV__) {
    // This warning would fire if you read context inside a Hook like useMemo.
    // Unlike the class check below, it's not enforced in production for perf.
    warning(
      !isDisallowedContextReadInDEV,
      'Context can only be read while React is rendering. ' +
        'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
        'In function components, you can read it directly in the function body, but not ' +
        'inside Hooks like useReducer() or useMemo().',
    );
  }

  if (typeof select !== 'function') {
    // Nothing to do. We already observe everything in this context.
    console.error(
      'selectFromContext has not implemented support for null selectors',
    );
  } else {
    let contextItem = {
      context: ((context: any): ReactContext<mixed>),
      observedBits: MAX_SIGNED_31_BIT_INT,
      selector: select,
      next: null,
    };

    if (lastContextDependency === null) {
      invariant(
        currentlyRenderingFiber !== null,
        'Context can only be read while React is rendering. ' +
          'In classes, you can read it in the render method or getDerivedStateFromProps. ' +
          'In function components, you can read it directly in the function body, but not ' +
          'inside Hooks like useReducer() or useMemo().',
      );

      // This is the first dependency for this component. Create a new list.
      lastContextDependency = contextItem;
      currentlyRenderingFiber.contextDependencies = {
        first: contextItem,
        expirationTime: NoWork,
      };
    } else {
      // Append a new context item.
      lastContextDependency = lastContextDependency.next = contextItem;
    }
  }
  return isPrimaryRenderer
    ? select(context._currentValue)
    : select(context._currentValue2);
}
