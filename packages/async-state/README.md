# Async Cancellables / AsyncState

> Asynchronous class to track presence or absence of a value with builtin support of cancellation tokens

## Table of contents

- [Prerequisites](#prerequisites)
- [Table of contents](#table-of-contents)
- [Installation](#installation)
- [API](#api)
    - [Creating state](#creating-state)
    - [Waiting for a value](#waiting-for-a-value)
    - [Accessing current value](#accessing-current-value)
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

### Creating state

There are 2 types of AsyncState:
- `manual` state can be set only manually
- `event` state sets value after specified event on target object is fired, state value is set to the result of handler call with event arguments

```js
import { AsyncState } from 'async-cancellables';

const manualState = AsyncState.manual(value = undefined);
const eventState = AsyncState.event(target, event, handler);
```

### Waiting for the value

- `wait(cancellationToken = null)` waits for the value to be set to any defined value or returns it if already is
- `waitEmpty(cancellationToken = null)` waits for the value to be cleared back to `undefined`
- `handleValue(handler, cancellationToken = null)` waits for the value to be set to any defined value if not yet and returns the result of `handler(value)`

### Accessing current value

- `value` simple property to access currently set value

## Authors

* **vuwuv** - *Initial work* - [vuwuv](https://github.com/vuwuv)

## License

[MIT License] © vuwuv