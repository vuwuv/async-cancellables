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

## API

The following example downloads the list of files with 2 concurrent downloads.

```js
import AsyncLock from '@async-cancellables/async-lock';

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
- `waitOne(cancellationToken = null)` uses slotCount
- `wait(slotCount, cancellationToken = null)` does not require priority option
- `waitPrioritized(slotCount, priority, cancellationToken = null)` is the most general one, allows to specify all parameters


All of them return `ticket` to be used for lock release. Default priority is `0`, the higher it is the sooner wait method returns.

#### Releasing slots

- `release(ticket)` releases slot count locked by any of the wait methods

Another way to release slots used by `ticket` is to call `release()` method of the ticket: `ticket.release()`

#### Accessing properties

- `totalSlots` gets or sets total slots of the lock
- `usedSlots` gets slot count currently occupied
- `availableSlots` get slot count currently available
- `waitersPresent` returns presence of any waiters in the queue

## Authors

* **vuwuv** - *Initial work* - [vuwuv](https://github.com/vuwuv)

## License

[MIT License] © vuwuv