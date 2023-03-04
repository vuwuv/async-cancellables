# Async Cancellables / AsyncLock

> Asynchronous lock class allows to limit simultaneous resource access supporting prioritized access and cancellation tokens

## Table of contents

- [Prerequisites](#prerequisites)
- [Table of contents](#table-of-contents)
- [Installation](#installation)
- [API](#api)
    - [Creating lock](#creating-lock)
    - [Waiting slots](#waiting-slots)
    - [Releasing slots](#releasing-slots)
    - [Accessing properties](#accessing-properties)
- [Authors](#authors)
- [License](#license)

## Prerequisites

This project requires NodeJS (version 18 or later) and NPM.

## Installation

To install and set up the library, run:

```sh
$ npm install @async-cancellables/async-state
```

## Example

The following example downloads a list of files having no more than 2 concurrent downloads

```js
import AsyncLock from '@async-cancellables/async-lock';
const lock = new AsyncLock(2);

async downloadFile(url) {
    let ticket = await lock.waitOne();
    try {
        ...
    }
    finally {
        lock.release(ticket);
    }
}

const files = await Promise.all(urls.map(url => downloadFile(lock, url)));
```

## API

### Creating lock

`new AsyncLock(totalSlots = 1)` creates new lock with `totalSlots` of slots.

### Waiting for slots

There are several wait methods:
- `waitOne(cancellationToken = null)` waits for one slot to be available
- `wait(slotCount, cancellationToken = null)` waits for `slotCount` slots to be available
- `waitPrioritized(slotCount, priority, cancellationToken = null)` waits with specified

All of them return `ticket` to be used for lock release. Default priority is `0`, the higher it is the sooner wait method returns.

### Releasing slots

- `release(ticket)` releases slot count locked by any of the wait methods

Another way to release slots used by `ticket` is to call `release()` method of the ticket: `ticket.release()`

### Accessing properties

- `totalSlots` gets or sets total slots of the lock
- `usedSlots` gets slot count currently occupied
- `availableSlots` get slot count currently available
- `waitersPresent` returns presence of any waiters in the queue

## Authors

* **vuwuv** - *Initial work* - [vuwuv](https://github.com/vuwuv)

## License

[MIT License] © vuwuv