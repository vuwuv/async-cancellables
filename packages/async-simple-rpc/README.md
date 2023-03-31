# Async Cancellables / AsyncSimpleRpc

> Asynchronous remote function calls with cancellation support via socket.io

## Table of contents

-   [Prerequisites](#prerequisites)
-   [Table of contents](#table-of-contents)
-   [Installation](#installation)
-   [API](#api)
    -   [Remote resource](#remote-resource)
    -   [Creating server](#creating-server)
    -   [Creating client](#creating-client)
    -   [Calling remote methods](#calling-remote-methods)
    -   [Releasing remote resources](#releasing-remote-resources)
    -   [Misc client methods and properties](#misc-client-methods-and-properties)
    -   [Misc server methods and properties](#misc-server-methods-and-properties)
    -   [Events](#events)
    -   [Client error markers](#client-error-markers)
-   [Authors](#authors)
-   [License](#license)

## Prerequisites

This project requires NodeJS (version 18 or later) and NPM.

## Installation

To install and set up the library, run:

```sh
$ npm install @async-cancellables/async-simple-rpc
```

## Example

The following example downloads a list of files having no more than 2 concurrent downloads

```js
import { Server } from 'socket.io';
import Client from 'socket.io-client';
import { createServer } from 'http';
import { AsyncRpcServer, AsyncRpcClient } from '@async-cancellables/async-simple-rpc';
import { AsyncLock, AsyncLockTicket } from '@async-cancellables/async-lock';
import AsyncCooldownQueue from '@async-cancellables/async-cooldown-queue';
import CT from '@async-cancellables/ct';

const namespace = '/__asyncSimpleRpc';
const url = `http://127.0.0.1:8080${namespace}`;

const asyncLock = new AsyncLock(2);
const asyncCooldownQueue = new AsyncCooldownQueue(1000);

const methods = {
    add: (a, b) => a + b,
    lock: async (ct, slotCount) => asyncLock.wait(slotCount, ct),
    wait: async (ct) => asyncCooldownQueue.wait(ct),
};

const httpServer = createServer();
httpServer.listen(8080);

const socketServer = new Server(httpServer);
const asyncRpcServer = AsyncRpcServer.socketio(socketServer.of(namespace), methods, { resourceClasses: [AsyncLockTicket, 'release'] });
const asyncRpcClient = AsyncRpcClient.socketio(Client(url));

let sum = await asyncRpcClient.add(CT.manual(), 1, 2); // 3
let ticket = await asyncRpcClient.lock(CT.manual(), 1); // acquire remote lock, returns AsyncRpcRemoteResource
await ticket.waitRelease(); // wait for remote lock release
await asyncRpcClient.wait(CT.manual()); // wait for cooldown
```

## API

### Remote resource

Remote resource is a class that represents remote resource and provides methods to release it. Example of such resource is `AsyncLockTicket` which represents lock ticket. To release slots occupied by the ticket you should call `release()` method of the ticket, so other waiters can acquire these slots.

### Creating server

AsyncRpcServer requires socket.io server instance and methods to be exposed, also you may specify resource classes list and their release method names.
`AsyncRpcServer.socketio(socketServer, methods, options)` method creates AsyncRpcServer instance and exposes methods to socket.io server instance: 
    - `socketServer` socket.io server instance 
    - `methods` is an object with methods to be exposed 
    - `options` is an object with options: 
        - `resourceClasses` is a mixed array of resource classes and their release method names or a respective `Map`

Methods can be regular or async functions. If it is an async function, it the first parameter should receive a `CancellationToken` instance.

```js
const asyncRpcServer = AsyncRpcServer.socketio(
    socketServer, 
    {
        add: (a, b) => a + b,
        wait: async (ct, time) => CT.sleep(time, ct),
    }, 
    { 
        resourceClasses: [AsyncLockTicket, 'release'] 
    }
);
```

### Creating client

AsyncRpcClient requires socket.io client instance and a list of methods to be exposed.

`AsyncRpcClient.socketio(socketClient, methods, options)` method creates AsyncRpcClient instance and exposes methods to socket.io client instance: 
    - `socketClient` socket.io client instance 
    - `methods` is an array with method names to be exposed
    - `options` is an object with options: 
        - `requestTimeout` is a timeout for request to be confirmed by the server in milliseconds, default is no timeout

### Calling remote methods

`AsyncRpcClient` exposes methods that were specified in the constructor and the first argument should be a `CancellationToken` instance or `null` regardless of whether the  server method is async or not.

```js
let sum = await asyncRpcClient.add(null, 1, 2); // `ct` argument is null, wait for the result indefinitely
sum = await asyncRpcClient.add(CT.timeout(100), 1, 2); // call will be cancelled after 100ms if the result is not received
await asyncRpcClient.wait(CT.manual(), 1000); // wait for 1 second
```

### Releasing remote resources

Remote resources are released by calling `release()` method of the resource instance. If the resource is not released, it will be released automatically when the connection is closed.

```js
let remoteResource = await asyncRpcClient.lock(null, 1); // acquire remote lock, returns AsyncRpcRemoteResource
remoteResource.release(); // request for a release and return immediately
await remoteResource.waitRelease(CT.manual()); // wait for remote lock release
```

### Misc client methods and properties

- `waitConnected(ct = null)` wait for the connection to be established
- `waitDisconnected(ct = null)` wait for the connection to be closed
- `connected` returns `true` if the connection is currently established
- `connect()` establish connection
- `disconnect()` close connection

### Misc server methods and properties

- `destroy()` stop accepting new connections

### Events

- `open` - emitted when the connection is established
- `close` - emitted when the connection is closed

### Client error markers

Used as markers for cancellation errors thrown by the client (`error.marker`);

```js
import { AsyncRpcClientMarkers } from '@async-cancellables/async-simple-rpc';
```

- `AsyncRpcClientMarkers.RequestTimeout` - request timeout (if `requestTimeout` option is specified)
- `AsyncRpcClientMarkers.ConnectionClosed` - connection closed during request or was closed before request was made

## Authors

-   **vuwuv** - _Initial work_ - [vuwuv](https://github.com/vuwuv)

## License

[MIT License] © vuwuv
