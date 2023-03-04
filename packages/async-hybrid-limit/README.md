# Async Cancellables / AsyncHybridLimit

> Asynchronous lock class allows to limit simultaneous resource access supporting prioritized access and cancellation tokens. Each slot request defines its own maximum slot count, which can be best described as each user having access to a different number of resource instances.

## Table of contents

- [Prerequisites](#prerequisites)
- [Table of contents](#table-of-contents)
- [Installation](#installation)
- [Concept](#concept)
- [Example](#example)
- [API](#api)
    - [Creating limit](#creating-limit)
    - [Waiting slots](#waiting-slots)
    - [Releasing slots](#releasing-slots)
    - [Retrieving waiters and slots information](#retrieving-waiters-and-slots-information)
- [Authors](#authors)
- [License](#license)

## Prerequisites

This project requires NodeJS (version 18 or later) and NPM.

## Installation

To install and set up the library, run:

```sh
$ npm install @async-cancellables/async-hybrid-limit
```

## Concept

Hybrid limit is a lock with a dynamic number of slots. Each slot request defines its own maximum slot count, which can be best described as each user having access to a different number of resource instances. 

Assuming `wait(maxSlotCount, slotCount)` is a wait method:

- if calling consequently `wait(3, 1)`, `wait(2, 1)` and `wait(1, 1)` all of them will be granted immediately
- if calling consequently `wait(1, 1)`, `wait(3, 3)` the first one will be granted immediately and the second one will wait for the first one to release its slot

So the method tries to occupy the highest slots available: `wait(3, 1)` will try to occupy the third slot first, if it is not available, it will try to occupy the second slot and so on.

## Example

The following example downloads an array of files and the number of concurrent downloads can be changed in the runtime (if it is decreased, the limit won't be applied to the already running downloads)

```js
import AsyncHybridLimit from '@async-cancellables/async-hybrid-limit';

let changeableConcurrentDownloads = 5;

async downloadFile(limit, url) {
    let ticket = await limit.waitOne(changeableConcurrentDownloads);
    try {
        ...
    }
    finally {
        ticket.release();
    }
}

const limit = new AsyncHybridLimit();
const files = await Promise.all(urls.map(url => downloadFile(limit, url)));
```

## API

### Creating limit

`new AsyncHybridLimit()` creates new limit.

### Waiting slots

There are several wait methods:
- `wait(maxSlotCount, slotCount, cancellationToken = null)` waits for `slotCount` slots with default priority of `0` assuming `maxSlotCount` total slots
- `waitPrioritized(maxSlotCount, slotCount, priority, cancellationToken = null)` waits for `slotCount` slots with user defined (higher is sooner) priority assuming `maxSlotCount` total slots
- `waitOne(maxSlotCount, cancellationToken = null)` waits for `1` slot with default priority of `0` assuming `maxSlotCount` total slots

All of them return `ticket` to be used for release. When using `cancellationToken` the waiter will be removed from the queue on cancellation.

### Releasing slots

- `release(ticket)` releases slots locked by any of the wait methods
- `ticket.release()` releases slots locked by any of the wait methods

### Getting waiters and slots information

- `usedSlots(maxSlotCount)` get slot count currently used assuming `maxSlotCount` total slots
- `freeSlots(maxSlotCount)` get slot count currently free assuming `maxSlotCount` total slots
- `waitersPresent` returns `true` if there are waiters in the queue
- `waitersCount` returns number of waiters in the queue
- `waitersSlots` returns number of slots requested by waiters in the queue

## Authors

* **vuwuv** - *Initial work* - [vuwuv](https://github.com/vuwuv)

## License

[MIT License] © vuwuv