# Async Cancellables

> Helper classes and functions with cancellation option.

## Table of contents

- [Async Cancellables](#async-cancellables)
  - [Prerequisites](#prerequisites)
  - [Table of contents](#table-of-contents)
  - [Installation](#installation)
  - [API](#api)


## Prerequisites

This project requires NodeJS (version 8 or later) and NPM.

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

Different token types to simplify cancellation of asynchronous calls

```js
async function downloadItems(cancellationToken, itemListUrl) {
    const itemsPage = await cancellationToken.wait(getPage(itemListUrl));
    const items = [];
    for (let itemUrl of parseItemListPage(itemsPage))
        items.push(parseItemPage(await cancellationToken.wait(getPage(itemUrl))));
    return items;
}

const items = await downloadItems(CancellationToken.timeout(5000).enableThrow(), url);
```

#### Creating tokens

There are 3 types of cancellation tokens:
- `manual` token can be cancelled only manually
- `timeout` token cancels after specified amount of time passes
- `event` token cancels after specified event on target object is fired

```js
import { CancellationToken } from 'async-cancellables';

const manualToken = CancellationToken.manual(cancelled = false);
const timeoutToken = CancellationToken.timeout(ms);
const eventToken = CancellationToken.event(target, eventName);
```

Tokens can be chained by creating child tokens. Every token in a chain is also cancelled when any of it's parents cancels. In the example below `eventToken` cancels either when `5000` milliseconds pass or `target` fires `'event'` event.

```js
const timeoutToken - CancellationToken.timeout(5000);
const eventToken - timeoutToken.event(target, 'event');
```

When token cancels by default token wait methods immediately return the token in the token chain that cancelled. This behaviour can be overridden by calling `enableThrow()` which enables throwing error on token cancel for this token and all the descending tokens.

```js
const throwingTimeoutToken - CancellationToken.timeout(5000).enableThrow();
const throwingEventToken - throwingTimeoutToken.event(target, 'event');

await throwingEventToken.wait(asyncTask()); // will throw if any of these tokens cancels
```

#### Wait methods

Token has several asynchronous wait methods. Each of them returns when token cancels or method task is done. Method can also throw on cancel if the corresponding option is used.

- `wait(promise)` waits for the promise to resolve and returns promise result if does not cancel.
- `waitEvent(target, eventName)` waits for the `eventName` on the `target` to fire and returns the array of event arguments if does not cancel.
- `handleEvent(target, eventName, handler)` waits for the `eventName` on the `target` to fire and returns the result of the `handler` function called with the array of event arguments if does not cancel.
- `sleep(ms, successValue)` waits for the specified amount of milliseconds to pass and returns `successValue` if does not cancel.

#### Cancel methods

- `cancel()` cancels any (not only manual) token immediately

#### Accessing token properties

- `isManual` if token is manual
- `isTimeout` if token is timeout
- `isEvent` if token is event
- `isCancellationToken` returns `true`

#### Accessing utility properties and methods

- `isToken(object)` checks if the object is a cancellation token
- `cancelledBy` if cancelled returns token that cancelled or throws an error if throw is enabled
- `cancelledByControlled(overrideThrow = null)` same as above, but with override of throw behavior

#### Events

- `cancel` fires on token cancels and gets cancelled token as n argument

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
- `wait(slotCount = 1, priority = 0, cancellationToken = null)` is the most general one, allows to specify all parameters.
- `waitSimple(slotCount = 1, cancellationToken = null)` does not require priority option
- `waitOne(cancellationToken = null)` uses slotCount

All of them return `ticket` to be used for lock release. Default priority is `0`, the higher it is the sooner wait method returns.

#### Releasing slots

- `release(ticket)` releases slot count locked by any of the wait methods.

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