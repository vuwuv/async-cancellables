# Async Cancellables / CancellationToken

> Helper classes and functions with cancellation option.

## Table of contents

- [Prerequisites](#prerequisites)
- [Table of contents](#table-of-contents)
- [Installation](#installation)
- [Examples](#examples)
    - [Simple await with timeout](#simple-await-with-timeout)
    - [File download function limiting concurrent downloads](#file-download-function-limiting-concurrent-downloads)
    - [Cancellable async calls via socket](#cancellable-async-calls-via-socket)
    - [Cancellable sleep promise](#cancellable-sleep-promise
- [API](#api)
    - [Creating tokens](#creating-tokens)
    - [Wait methods](#wait-methods)
    - [Static wait methods](#static-wait-methods)
    - [Cancel methods](#cancel-methods)
    - [Properties](#properties)
    - [Utility properties and methods](#utility-properties-and-methods)
    - [Static utility methods](#static-utility-methods)
    - [Race methods](#race-methods)
    - [Events](#events)
- [Authors](#authors)
- [License](#license)

## Prerequisites

This project requires NodeJS (version 18 or later) and NPM.

## Installation

To install and set up the package, run:

```sh
$ npm install @async-cancellables/ct
```

## Examples

### Simple await with timeout

```js
CT.timeout(5000).waitPromise(asyncCall());
```

Waits for `asyncCall()` to finish, but throws an error it if it takes more than 5 seconds. The call itself is not cancelled, it will continue to run in the background.

### File download function limiting concurrent downloads

```js
const asyncLock = new AsyncLock(5);

async function downloadFile(url, ct = null) {
    const ticket = await asyncLock.waitOne(ct);
    try {
        return await ct.waitPromise(got(url));
    }
    finally {
        ticket.release();
    }
}

const content = await downloadFile('https://example.com/', CT.timeout(5000));
```

Downloads file from `url` with 5 concurrent downloads. If it takes more than 5 seconds, and the function still waits for a slot, it will exit the queue and throw an error. If it is already downloading, the function will throw an error immediately, but actual download will continue in the background. `asyncLock.waitOne` call supports cancellation, so if `ct` is cancelled, the function will exit the queue.

### Cancellable async calls via socket

```js
socket.on('connection', (client) => {
    const clientCT = CT.event(client, 'disconnect');

    client.on('startProcessing', (...args) => {
        const key = randomKey();
        const requestCT = CT.event(client, `cancelProcessing_${key}`).attachTo(clientCT);
        processing(requestCT, ...args).then(result => client.emit(`finishProcessing_${key}`, result), error => !CT.isCancellationError(error) && console.log(error));
    });
});
```

Socket processes async calls of `processing()` function. If client disconnects, all pending calls are cancelled. If client sends `cancelProcessing_${key}` event, the call with the same key is cancelled. `clientCT` is getting cancelled when client disconnects, it is created once per connection. `requestCT` is getting cancelled when client disconnects or sends `cancelProcessing_${key}` event, it is created once per call and attached to `clientCT` to cancel all calls when client disconnects.

### Cancellable sleep promise

```js
async function sleep(ms, ct = null) {
    return new Promise((resolve, reject) => {
        let timeout;
        if (ct) {
          ct.throwIfCancelled();
          [resolve, reject] = ct.processCancel(resolve, reject, clearTimeout.bind(null, timeout));
        }
        timeout = setTimeout(resolve, ms);
    });
}
```

Example of binding cancellation token to a promise. If `ct` is cancelled, the promise will be rejected with `ct` error. If `ct` is not cancelled, the promise will be resolved after `ms` milliseconds. `ct.throwIfCancelled()` checks if `ct` is already cancelled and throws an error if it is. `ct.processCancel()` returns a new `resolve` and `reject` functions that will prevent calling cancel function (in this case it is `clearTimeout.bind(null, timeout)`) after promise is resolved or rejected. On cancelling `ct`, `onCancel` function will be called, it should stop the operation that is being waited for. In this case, it is clearing existing timeout.

## API

### Creating tokens

There are 3 types of cancellation tokens:
- `manual` token can be cancelled only manually
- `timeout` token cancels after specified amount of time passes
- `event` token cancels after specified event on target object is fired, can safely listen to persistent objects as it listens using weak reference

They can be created using static methods:
- `CancellationToken.manual(options = null)`
- `CancellationToken.timeout(ms, options = null)`
- `CancellationToken.event(target, eventName, options = null)`

or by creating direct children for any token instance (same parameters apply):
- `token.manual(options = null)`
- `token.timeout(ms, options = null)`
- `token.event(target, eventName, options = null)`

Options can be:
- `parents` - array of parents which can contain `null` or duplicate values that are ignored for convenience reasons
- `name` - string name of the token, used for debugging or analysis purposes
- `options` - options object containing `name`, `parents`

You can also add/remove additional parents to existing tokens via `attachTo` and `detachFrom` methods
- `token.attachTo(...parents)` adds parents ignoring duplicate and `null` parents and returns `this`
- `token.detachFrom(...parents)` removes parents ignoring non-existent and `null` parents and returns `this`

Token is also cancelled when any of it's direct or indirect parents cancels. If a token chain is attached to a cancelled parent the whole chain immediately cancels.

Tokens can be cancelled ONLY ONCE!

### Wait methods

Token has several asynchronous wait methods. Each of them returns when token cancels or method task is done. Method can also throw on cancel if the corresponding option is used. `doNotThrow` parameter is optional, if it is `true` method returns token that cancelled  instead of throwing error.

- `wait(promise, doNotThrow = false)` waits for the promise to resolve and returns promise result if does not cancel
- `waitEvent(target, eventName, doNotThrow = false)` waits for the `eventName` on the `target` to fire and returns the array of event arguments if does not cancel
- `handleEvent(target, eventName, handler, doNotThrow = false)` waits for the `eventName` on the `target` to fire and returns the result of the `handler` function called with the array of event arguments if does not cancel
- `sleep(ms, successValue, doNotThrow = false)` waits for the specified amount of milliseconds to pass and returns `successValue` if does not cancel

### Static wait methods

CancellationToken token has the same static wait methods, except they have additional first parameter `cancellationToken` which can be `null` or CancellationToken instance. If it is `null` wait method is executed without any cancellation.

- `CancellationToken.wait(promise, cancellationToken = null, doNotThrow = false)`
- `CancellationToken.waitEvent(target, eventName, cancellationToken = null, doNotThrow = false)`
- `CancellationToken.handleEvent(target, eventName, handler, cancellationToken = null, doNotThrow = false)`
- `CancellationToken.sleep(ms, successValue, cancellationToken = null, doNotThrow = false)`

### Cancel methods

- `cancel(error = null)` cancels any (not just manual) token immediately and returns `this`, `error` can contain custom user error information

### Properties

- `name` returns token name or `null` if not specified
- `cancelled` returns `true` if token is cancelled
- `cancelledError` returns custom user error information optionally specified at `cancel()` method
- `isManual` returns `true` if token has `manual` type
- `isTimeout` returns `true` if token has `timeout` type
- `isEvent` returns `true` if token has `event` type
- `isCancellationToken` always returns `true`

### Utility properties and methods

- `isToken(object)` checks if the `object` is a cancellation token
- `cancelledBy` if cancelled returns token that cancelled, `null` otherwise
- `throwIfCancelled()` if cancelled throws cancel error
- `catchCancelError(promise)` awaits the promise and returns it's result, if cancel error is thrown returns cancelled token, rethrows any other error
- `processCancel(resolve, reject, cancel, doNotThrow = false)` when token is cancelled calls `cancel` and then `resolve` or `reject` depending on `doNotThrow` value and returns array of rewritten `resolve` and `reject` functions to be used

### Static utility methods

- `CancellationToken.isToken(object)` same as non-static method
- `CancellationToken.isCancellationError(error)` checks if the `error` is a `CancellationEventError`
- `CancellationToken.catchCancelError(promise)` same as non-static method

### Race methods

Both methods require generator function `promiseListGenerator(token)`: it should use `token` to create async calls and return promise list

`race(promiseListGenerator, doNotThrow = false)` uses `promiseListGenerator` to get a promise list, waits for any promise to resolve/reject or for the current token to cancel, then cancels `token` (which is direct descendant of the current token) to stop execution of the rest of the async calls

All possible execution scenarios depeding on `doNotThrow` value, async calls results and current token state:
- `doNotThrow` is `false` and current token cancels before any of the promises resolves or rejects - `CancellationEventError` is thrown
- `doNotThrow` is `true` and current token cancels before any of the promises resolves or rejects - cancelled token is returned
- one of the promises resolves before any other events - `RaceResult` object is returned containing `index` and `result` of the resolved promise
- one of the promises rejects before any other events - `RaceError` is thrown containing `index` and `result` of the rejected promise

`any(promiseListGenerator, doNotThrow = false)` uses `promiseListGenerator` to get a promise list, waits for any promise to resolve, all promises to reject or for the current token to cancel, then cancels `token` (which is a direct descendant of the current token) to stop execution of the rest of the async calls

All possible execution scenarios depeding on `doNotThrow` value, async calls results and current token state:
- `doNotThrow` is `false` and current token cancels before any of the promises resolves or rejects - `CancellationEventError` is thrown
- `doNotThrow` is `true` and current token cancels before any of the promises resolves or rejects - cancelled token is returned
- one of the promises resolves before current token cancellation - `RaceResult` object is returned containing `index` and `result` of the resolved promise
- all the promises reject before current token cancellation - `AggregateError` is thrown containing error list

### Events

- `cancel` fires on token cancel and gets cancelled token as an argument

## Authors

* **vuwuv** - *Initial work* - [vuwuv](https://github.com/vuwuv)

## License

[MIT License] © vuwuv