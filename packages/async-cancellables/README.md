# Async Cancellables

> Cancellation token and example/utility classes that support cancellation

## Table of contents

- [Async Cancellables](#async-cancellables)
  - [Prerequisites](#prerequisites)
  - [Table of contents](#table-of-contents)
  - [Installation](#installation)
  - [API](#api)
  - [Examples](#examples)
    -   [Basic usage](#basic-usage)
    -   [Using improved race/any methods](#using-improved-raceany-methods)
    -   [File download function limiting concurrent downloads](#file-download-function-limiting-concurrent-downloads)
    -   [Cancellable async calls via socket](#cancellable-async-calls-via-socket)
    -   [Cancellable sleep promise](#cancellable-sleep-promise)
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

Exports basic classes (any of them can be used via standalone packages)

- CancellationToken from [@async-cancellables/ct](https://npmjs.com/package/@async-cancellables/ct)
- AsyncLock from [@async-cancellables/async-lock](https://npmjs.com/package/@async-cancellables/async-lock)
- AsyncState from [@async-cancellables/async-state](https://npmjs.com/package/@async-cancellables/async-state)

The rest of the classes should be installed separately

- AsyncCooldownQueue from [@async-cancellables/async-cooldown-queue](https://npmjs.com/package/@async-cancellables/async-cooldown-queue)
- AsyncHybridLimit from [@async-cancellables/async-hybrid-limit](https://npmjs.com/package/@async-cancellables/async-hybrid-limit)

## Examples

### Basic usage

Creating independent cancellation tokens:

```js
// cancelled manually by calling parent1.cancel()
const parent1 = CT.manual();

// cancelled after 5 seconds
const parent2 = CT.timeout(5000);

// cancelled when 'event' event is emitted on target
const parent3 = CT.event(target, 'event');
```

Creating child cancellation tokens:

```js
// cancelled after 10 seconds or when parent1 is cancelled (manually)
const child1 = parent1.timeout(10000);

// cancelled when 'event' event is emitted on target or when parent2 is cancelled (after 5 seconds)
const child2 = parent2.event(target, 'event');

// cancelled manually by calling child3.cancel() or when parent3 is cancelled (when 'event' event is emitted on target)
const child3 = parent3.manual();
```

Using tokens:

```js
const token = CT.manual();

// waits for asyncCall() to finish, but throws an error if token is cancelled
const asyncCallResult = await token.waitPromise(asyncCall());

// waits for target.event event to be emitted, but throws an error if token is cancelled, returns array of event arguments
const eventArgumentsArray = await token.waitEvent(target, 'event');

// waits for 10 seconds, but throws an error if token is cancelled
await token.sleep(10000);
```

### Using improved race/any methods

```js
// every lock imitates remote resource
const locks = [new AsyncLock(1), new AsyncLock(1), new AsyncLock(1)];

// waits for the first lock to be available, cancels waiting for other locks
const waitSuccess = await CT.any(locks.map((lock) => lock.waitOne()));

// it's possible to wait with a timeout
const waitSuccess = await CT.timeout(5000).any(locks.map((lock) => lock.waitOne()));

// waitSuccess contains index of the lock and the ticket
const index = waitSuccess.index;
const ticket = waitSuccess.value;
```

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

## Authors

* **vuwuv** - *Initial work* - [vuwuv](https://github.com/vuwuv)

## License

[MIT License] © vuwuv