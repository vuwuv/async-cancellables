# Async Cancellables

> Helper classes and functions with cancellation option.

## Table of contents

- [Async Cancellables](#async-cancellables)
  - [Prerequisites](#prerequisites)
  - [Table of contents](#table-of-contents)
  - [Installation](#installation)
  - [API](#api)
  - [Versioning](#versioning)
  - [Authors](#authors)
  - [License](#license)

## Prerequisites

This project requires NodeJS (version 18 or later) and NPM.

## Installation

To install and set up the library, run:

```sh
$ npm install async-cancellables
```

## API

Classes: 
- [CancellationToken](#cancellationtoken)
- [AsyncLock](#asynclock)
- [AsyncState](#asyncstate)

Functions: 
- [sleep](#sleep)

### CancellationToken

Different token types for simplifying cancellation of asynchronous calls

```js
import { CancellationToken } from 'async-cancellables';

async function downloadItems(cancellationToken, itemListUrl) {
    const itemsPage = await cancellationToken.wait(getPage(itemListUrl));
    const items = [];
    for (let itemUrl of parseItemListPage(itemsPage))
        items.push(parseItemPage(await cancellationToken.wait(getPage(itemUrl))));
    return items;
}

const items = await downloadItems(CancellationToken.timeout(5000), url);
```

#### Using CT as CancellationToken shortcut

```js
import { CT } from 'async-cancellables';
const ct = CT.manual();
```

#### Creating tokens

There are 3 types of cancellation tokens:
- `manual` token can be cancelled only manually
- `timeout` token cancels after specified amount of time passes
- `event` token cancels after specified event on target object is fired, can safely listen to persistent objects as it listens using weak reference

They can be created using static methods:
- `CancellationToken.manual(parents = null)` creates a `manual` token with optional list of parents which can contain `null` or duplicate values that are ignored for convenience reasons
- `CancellationToken.timeout(ms, parents = null)` creates a `timeout` token which cancels after `ms` milliseconds elapse
- `CancellationToken.event(target, eventName, parents = null)` create an `event` token which cancels after `eventName` event on `target` emitter fires

or by creating direct children for any token instance (same parameters apply):
- `token.manual(parents = null)`
- `token.timeout(ms, parents = null)`
- `token.event(target, eventName, parents = null)`

You can also add/remove additional parents to existing tokens via `attachTo` and `detachFrom` methods
- `token.attachTo(...parents)` adds parents ignoring duplicate and `null` parents and returns `this`
- `token.detachFrom(...parents)` removes parents ignoring non-existent and `null` parents and returns `this`

Token is also cancelled when any of it's direct or indirect parents cancels. If a token chain is attached to a cancelled parent the whole chain immediately cancels.


Tokens can be cancelled ONLY ONCE!

#### Wait methods

Token has several asynchronous wait methods. Each of them returns when token cancels or method task is done. Method can also throw on cancel if the corresponding option is used. `doNotThrow` parameter is optional, if it is `true` method returns token that cancelled  instead of throwing error.

- `wait(promise, doNotThrow = false)` waits for the promise to resolve and returns promise result if does not cancel
- `waitEvent(target, eventName, doNotThrow = false)` waits for the `eventName` on the `target` to fire and returns the array of event arguments if does not cancel
- `handleEvent(target, eventName, handler, doNotThrow = false)` waits for the `eventName` on the `target` to fire and returns the result of the `handler` function called with the array of event arguments if does not cancel
- `sleep(ms, successValue, doNotThrow = false)` waits for the specified amount of milliseconds to pass and returns `successValue` if does not cancel

#### Static wait methods

CancellationToken token has the same static wait methods, except they have additional first parameter `cancellationToken` which can be `null` or CancellationToken instance. If it is `null` wait method is executed without any cancellation.

- `CancellationToken.wait(cancellationToken, promise, doNotThrow = false)`
- `CancellationToken.waitEvent(cancellationToken, target, eventName, doNotThrow = false)`
- `CancellationToken.handleEvent(cancellationToken, target, eventName, handler, doNotThrow = false)`
- `CancellationToken.sleep(cancellationToken, ms, successValue, doNotThrow = false)`

#### Cancel methods

- `cancel(error = null)` cancels any (not just manual) token immediately and returns `this`, `error` can contain custom user error information

#### Properties

- `cancelled` returns `true` if token is cancelled
- `cancelledError` returns custom user error information optionally specified at `cancel()` method
- `isManual` returns `true` if token has `manual` type
- `isTimeout` returns `true` if token has `timeout` type
- `isEvent` returns `true` if token has `event` type
- `isCancellationToken` always returns `true`

#### Utility properties and methods

- `isToken(object)` checks if the `object` is a cancellation token
- `cancelledBy` if cancelled returns token that cancelled, `null` otherwise
- `throwIfCancelled()` if cancelled throws cancel error
- `catchCancelError(promise)` awaits the promise and returns it's result, if cancel error is thrown returns cancelled token, rethrows any other error
- `processCancel(resolve, reject, cancel, doNotThrow = false)` when token is cancelled calls `cancel` and then `resolve` or `reject` depending on `doNotThrow` value and returns array of rewritten `resolve` and `reject` functions to be used

#### Static utility methods

- `CancellationToken.isToken(object)` same as non-static method
- `CancellationToken.isCancellationError(error)` checks if the `error` is a `CancellationEventError`
- `CancellationToken.catchCancelError(promise)` same as non-static method

#### Race methods

Both methods require generator function `promiseListGenerator(token)`: it should use `token` to create async calls and return promise list

`race(promiseListGenerator, doNotThrow = false)` uses `promiseListGenerator` to get promise list, waits for any promise to resolve/reject or current token to cancel, then cancels `token` (which is direct descendant of the current token) to stop execution of the rest of the async calls

All possible execution scenarios depeding on `doNotThrow` value, async calls results and current token state:
- `doNotThrow` is `false` and current token cancels before any of the promises resolves or rejects - `CancellationEventError` is thrown
- `doNotThrow` is `true` and current token cancels before any of the promises resolves or rejects - cancelled token is returned
- one of the promises resolves before any other events - `RaceResult` object is returned containing `index` and `result` of the resolved promise
- one of the promises rejects before any other events - `RaceError` is thrown containing `index` and `result` of the rejected promise

`any(promiseListGenerator, doNotThrow = false)` uses `promiseListGenerator` to get promise list, waits for any promise to resolve, all promises to reject or current token to cancel, then cancels `token` (which is direct descendant of the current token) to stop execution of the rest of the async calls

All possible execution scenarios depeding on `doNotThrow` value, async calls results and current token state:
- `doNotThrow` is `false` and current token cancels before any of the promises resolves or rejects - `CancellationEventError` is thrown
- `doNotThrow` is `true` and current token cancels before any of the promises resolves or rejects - cancelled token is returned
- one of the promises resolves before current token cancellation - `RaceResult` object is returned containing `index` and `result` of the resolved promise
- all the promises reject before current token cancellation - `AggregateError` is thrown containing error list

#### Events

- `cancel` fires on token cancel and gets cancelled token as an argument

### AsyncLock

Asynchronous lock class allows to limit simultaneous resource access to `n` slots supporting prioritized access and cancellation tokens. The following example downloads the list of files with 2 concurrent downloads.

```js
import { AsyncLock } from 'async-cancellables';

async downloadFile(lock, url) {
    let ticket = await lock.waitOne();
    try {
        ...
    }
    finally {
        lock.release(ticket);
    }
}

const lock = new AsyncLock(2);
const files = await Promise.all(urls.map(url => downloadFile(lock, url)));
```

#### Creating lock

`new AsyncLock(totalSlots = 1)` creates new lock with `totalSlots` of slots.

#### Waiting slots

There are several wait methods:
- `wait(slotCount = 1, priority = 0, cancellationToken = null)` is the most general one, allows to specify all parameters
- `waitSimple(slotCount = 1, cancellationToken = null)` does not require priority option
- `waitOne(cancellationToken = null)` uses slotCount

All of them return `ticket` to be used for lock release. Default priority is `0`, the higher it is the sooner wait method returns.

#### Releasing slots

- `release(ticket)` releases slot count locked by any of the wait methods

Another way to release slots used by `ticket` is to call `release()` method of the ticket: `ticket.release()`

#### Accessing properties

- `totalSlots` gets or sets total slots of the lock
- `usedSlots` gets slot count currently occupied
- `availableSlots` get slot count currently available
- `waitersPresent` returns presence of any waiters in the queue

### AsyncState

Asynchronous class to track presence or absence of a value with builtin support of cancellation tokens.

#### Creating state

There are 2 types of AsyncState:
- `manual` state can be set only manually
- `event` state sets value after specified event on target object is fired, state value is set to the result of handler call with event arguments

```js
import { AsyncState } from 'async-cancellables';

const manualState = AsyncState.manual(value = undefined);
const eventState = AsyncState.event(target, event, handler);
```

#### Waiting for the value

- `wait(cancellationToken = null)` waits for the value to be set to any defined value or returns it if already is
- `waitEmpty(cancellationToken = null)` waits for the value to be cleared back to `undefined`
- `handleValue(handler, cancellationToken = null)` waits for the value to be set to any defined value if not yet and returns the result of `handler(value)`

#### Accessing current value

- `value` simple property to access currently set value

### sleep

Function allowing asynchronous conditionless sleep.
`async sleep(ms, returnValue)` returns `returnValue` after `ms` milliseconds

```js
import { sleep } from 'async-cancellables';

await sleep(5000, true);
```

## Versioning

We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/vuwuv/async-cancellables/tags).

## Authors

* **vuwuv** - *Initial work* - [vuwuv](https://github.com/vuwuv)

## License

[MIT License] © vuwuv