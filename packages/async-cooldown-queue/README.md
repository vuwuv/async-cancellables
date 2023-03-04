# Async Cancellables / AsyncCooldownQueue

> Asynchronous cooldown queue class provides cooldown control and supports cancellation tokens.

## Table of contents

- [Prerequisites](#prerequisites)
- [Table of contents](#table-of-contents)
- [Installation](#installation)
- [Example](#example)
- [API](#api)
    - [Creating queue](#creating-queue)
    - [Waiting for cooldown](#waiting-for-cooldown)
    - [Getting waiters information](#getting-waiters-information)
- [Authors](#authors)
- [License](#license)

## Prerequisites

This project requires NodeJS (version 18 or later) and NPM.

## Installation

To install and set up the library, run:

```sh
$ npm install @async-cancellables/async-cooldown-queue
```

### Example

Function that can send a message no more than once in 2 seconds. The function will wait for the cooldown to end before sending the message. If `ct` is provided, the function will throw if the cancellation token is cancelled before the cooldown ends and quit the cooldown queue.

```js
import AsyncCooldownQueue from '@async-cancellables/async-cooldown-queue';

const cooldownQueue = new AsyncCooldownQueue(2000);

async sendMessage(text, ct = null) {
    await cooldownQueue.wait(ct);
    socket.emit('message', text);
}
```

## API

### Creating queue

`new AsyncCooldownQueue()` creates new queue.

### Waiting for cooldown

There are two wait methods:
- `wait(ct = null)` waits for the cooldown to end. If `ct` is provided, the function will throw if the cancellation token is cancelled before the cooldown ends and quit the cooldown queue.
- `waitTime(time, ct = null)` same as `wait` but waits for `time` milliseconds instead of the default cooldown time.

### Getting waiters information

- `waitersPresent` returns `true` if there are waiters in the queue
- `waitersCount` returns the number of waiters in the queue
- `timeUntilAvailable` returns the time in milliseconds until the queue can immediately allow a waiter to proceed

## Authors

* **vuwuv** - *Initial work* - [vuwuv](https://github.com/vuwuv)

## License

[MIT License] © vuwuv