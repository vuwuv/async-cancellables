import { AsyncRpcServer, AsyncRpcClient, AsyncRpcRemoteResource, AsyncRpcClientMarkers } from '@async-cancellables/async-simple-rpc';
import AsyncLock, { AsyncLockTicket } from '@async-cancellables/async-lock';
import AsyncHybridLimit, { AsyncHybridLimitTicket } from '@async-cancellables/async-hybrid-limit';
import AsyncCooldownQueue from '@async-cancellables/async-cooldown-queue';
import CT from '@async-cancellables/ct';
import { EventProxy } from '@async-cancellables/ct';
import { Server } from 'socket.io';
import { createServer } from 'http';
import Client from 'socket.io-client';
import { mockWarn } from 'jest-mock-warn';
import { jest } from '@jest/globals';

const portNumber = 35893;
const namespace = '/__asyncSimpleRpc';
const url = `http://127.0.0.1:${portNumber}${namespace}`;
const testNamespace = '/__asyncSimpleRpcTest';
const testUrl = `http://127.0.0.1:${portNumber}${testNamespace}`;

const asyncLock = new AsyncLock(1);
const asyncHybridLimit = new AsyncHybridLimit();
const asyncCooldownQueue = new AsyncCooldownQueue(100);

let addCalls = 0;

class InvalidResource { }

class ValidResource {
    release() {

    }
}

class ParametrizedResource {
    constructor(arg) {
        this.arg = arg;
    }

    release() {

    }
}

const methods = {
    add(a, b) {
        return a + b;
    },

    async fastAdd(ct, a, b) {
        return a + b;
    },

    async waitAdd(ct, a, b, time = 50) {
        await CT.sleep(time, true, ct);
        addCalls++;
        return a + b;
    },

    async lock(ct, slots) {
        return asyncLock.wait(slots, ct);
    },

    async limit(ct, maxSlots, slots) {
        return asyncHybridLimit.wait(maxSlots, slots, ct);
    },

    async cooldown(ct = null, time) {
        if (time) return asyncCooldownQueue.waitTime(time, ct);
        else return asyncCooldownQueue.wait(ct);
    },

    throw(error) {
        throw new Error(error);
    },

    async waitThrow(ct = null, error, time = 50) {
        await CT.sleep(time, true, ct);
        throw new Error(error);
    },

    async resource() {
        return new InvalidResource();
    },

    instantResource() {
        return new ValidResource();
    },
};

const testMethods = {
    testAdd(a, b) {
        return a + b;
    },

    async testWaitAdd(ct, a, b, time = 50) {
        await CT.sleep(time, true, ct);
        return a + b;
    },

    async testResource(ct, arg) {
        return new ParametrizedResource(arg);
    }
};

const httpServer = createServer();
const ioServer = new Server(httpServer);
let asyncRpcServer = AsyncRpcServer.socketio(ioServer.of(namespace), methods, { resourceClasses: [AsyncLockTicket, 'release', InvalidResource, 'release', ValidResource, 'release'] });
const clientSocket = Client(url);
const testClientSocket = Client(testUrl);

async function reconnect(asyncRpcClient) {
    try {
        asyncRpcClient.disconnect();
        await asyncRpcClient.waitDisconnected();
        asyncRpcClient.connect();
        await asyncRpcClient.waitConnected();
    }
    catch (error) {
        consoleLog(error);
    }
}

async function stressTest() {
    const asyncRpcClient = AsyncRpcClient.socketio(clientSocket, Object.keys(methods));
    await asyncRpcClient.waitConnected();

    for (let i = 0; i < 1000; i++) {
        await asyncRpcClient.add(CT.manual(), 1, 2);
    }

    for (let i = 0; i < 1000; i++) {
        await asyncRpcClient.fastAdd(CT.manual(), 1, 2);
    }

    for (let i = 0; i < 1000; i++) {
        await CT.catchCancelError(asyncRpcClient.waitAdd(CT.timeout(1), 1, 2));
    }

    for (let i = 0; i < 1000; i++) {
        const ticket = await asyncRpcClient.lock(CT.manual(), 1);
        await ticket.waitRelease()
    }
}

async function disconnectTest() {
    const asyncRpcClient = AsyncRpcClient.socketio(clientSocket, Object.keys(methods));
    await asyncRpcClient.waitConnected();

    const interval = setInterval(reconnect.bind(null, asyncRpcClient), 300);
    if (interval.unref) interval.unref();
    const token = CT.manual();
    let rejectCount = 0;
    const total = 10000;

    for (let i = 0; i < total; i++) {
        try {
            expect(await asyncRpcClient.waitAdd(token, 1, 2, 10)).toBe(3);
        }
        catch (error) {
            await CT.sleep(10);
            expect(error.message).toBe('Async call cancelled (connection closed)');
            rejectCount++;
        }

        if (i % 100 === 0) {
            consoleLog(`EventProxy: ${EventProxy.count}`);
        }

        //expect(EventProxy.count).toBeLessThan(300);
    }

    consoleLog(`rejectCount: ${(rejectCount / total * 100).toFixed(2)}%} (${rejectCount}/${total}))`);

    clearInterval(interval);
}


beforeAll(async () => {
    httpServer.listen(portNumber);
});

mockWarn();

describe('AsyncSimpleRpc', () => {
    if (process.env.STRESS_TEST) {
        jest.setTimeout(500 * 1000);

        it('stress test', async () => {
            await stressTest();
        });

        it('disconnect test', async () => {
            await disconnectTest();
        });
    }
    else {
        it('init', async () => {
            let testAsyncRpcServer = AsyncRpcServer.socketio(ioServer.of(testNamespace), testMethods);
            expect(() => testAsyncRpcServer = AsyncRpcServer.socketio(ioServer.of(testNamespace), testMethods)).toThrow('socket.io server already used for RPC');
            testAsyncRpcServer.destroy();
            expect(() => testAsyncRpcServer = AsyncRpcServer.socketio(ioServer.of(testNamespace), testMethods)).not.toThrow();
            testAsyncRpcServer.destroy();

            testAsyncRpcServer = AsyncRpcServer.socketio(ioServer.of(testNamespace), testMethods, { resourceClasses: [ParametrizedResource, 'release'] });
            const testAsyncRpcClient = AsyncRpcClient.socketio(testClientSocket, Object.keys(testMethods));
            await testAsyncRpcClient.waitConnected();

            let result = await testAsyncRpcClient.testResource(CT.manual(), 1);
            expect(result).toBeInstanceOf(AsyncRpcRemoteResource);

            testAsyncRpcServer.destroy();
            testAsyncRpcServer = AsyncRpcServer.socketio(ioServer.of(testNamespace), testMethods);
            await testAsyncRpcClient.waitConnected();

            result = await testAsyncRpcClient.testResource(CT.manual(), 1);
            expect(result).toBeInstanceOf(Object);

            testAsyncRpcServer.destroy();
            testAsyncRpcServer = AsyncRpcServer.socketio(ioServer.of(testNamespace), testMethods, { resourceClasses: new Map([[ParametrizedResource, 'release']]) });
            await testAsyncRpcClient.waitConnected();

            result = await testAsyncRpcClient.testResource(CT.manual(), 1);
            expect(result).toBeInstanceOf(AsyncRpcRemoteResource);

            testAsyncRpcServer.destroy();
            expect(() => testAsyncRpcServer = AsyncRpcServer.socketio(ioServer.of(testNamespace), testMethods, { resourceClasses: true })).toThrow();
        });

        it('basics and cancels', async () => {
            const asyncRpcClient = AsyncRpcClient.socketio(clientSocket, Object.keys(methods));
            await asyncRpcClient.waitConnected();
            await asyncRpcClient.waitConnected();

            let result, promise;

            expect(await asyncRpcClient.add(null, 1, 2)).toBe(3);
            expect(await asyncRpcClient.fastAdd(null, 1, 2)).toBe(3);

            result = await asyncRpcClient.add(CT.manual(), 1, 2);
            expect(result).toBe(3);

            result = await asyncRpcClient.waitAdd(CT.manual(), 1, 2);
            expect(result).toBe(3);
            expect(addCalls).toBe(1);

            await expect(asyncRpcClient.waitAdd(CT.timeout(25), 1, 2)).rejects.toMatchError('Async call cancelled');
            expect(addCalls).toBe(1);

            let ticket = await asyncRpcClient.lock(CT.manual(), 1);
            expect(asyncLock.availableSlots).toBe(0);
            await ticket.waitRelease();
            expect(asyncLock.availableSlots).toBe(1);

            asyncRpcClient.cooldown();
            await CT.sleep(0);
            expect(asyncCooldownQueue.waitersCount).toBe(0);
            promise = asyncRpcClient.cooldown();
            await CT.sleep(0);
            expect(asyncCooldownQueue.waitersCount).toBe(1);
            await promise;
            expect(asyncCooldownQueue.waitersCount).toBe(0);
            promise = asyncRpcClient.cooldown();
            await expect(asyncRpcClient.cooldown(CT.timeout(25))).rejects.toMatchError('Async call cancelled');
            expect(asyncCooldownQueue.waitersCount).toBe(2);
            await CT.sleep(0);
            expect(asyncCooldownQueue.waitersCount).toBe(1);
            await promise;
            expect(asyncCooldownQueue.waitersCount).toBe(0);

            ticket = await asyncRpcClient.instantResource();
            expect(ticket).toBeInstanceOf(AsyncRpcRemoteResource);
            await ticket.waitRelease();
        });

        it('errors', async () => {
            const asyncRpcClient = AsyncRpcClient.socketio(clientSocket, Object.keys(methods));
            await asyncRpcClient.waitConnected();

            expect(() => asyncRpcClient.sub()).toThrow();
            await expect(asyncRpcClient.throw(CT.manual(), 'test error')).rejects.toMatchError('test error');
            await expect(asyncRpcClient.waitThrow(CT.manual(), 'test error')).rejects.toMatchError('test error');
            await expect(asyncRpcClient.waitThrow(CT.timeout(25), 'test error', 50)).rejects.toMatchError('Async call cancelled');
            await expect(asyncRpcClient.resource()).rejects.toMatchError('Internal error: invalid resource');
            expect("Resource class").toHaveBeenWarned();
            expect("Resource class").toHaveBeenWarnedTimes(1);
        });

        it('disconnect', async () => {
            const asyncRpcClient = AsyncRpcClient.socketio(clientSocket, Object.keys(methods));
            await asyncRpcClient.waitConnected();

            expect(asyncRpcClient.connected).toBe(true);
            await expect(asyncRpcClient.waitConnected()).resolves.toBe(true);
            asyncRpcClient.disconnect();
            await expect(asyncRpcClient.waitDisconnected()).resolves.toBe(true);
            asyncRpcClient.connect();
            await expect(asyncRpcClient.waitConnected()).resolves.toBe(true);
            asyncRpcClient.disconnect();
            asyncRpcClient.connect();
            await expect(asyncRpcClient.waitConnected(CT.timeout(1))).rejects.toMatchError('Async call cancelled');

            await asyncRpcClient.waitConnected();
            CT.sleep(10).then(() => reconnect(asyncRpcClient)).catch((error) => console.log('reconnect:' + error));
            try {
                await asyncRpcClient.waitAdd(null, 1, 2, 100);
            }
            catch (error) {
                expect(error).toMatchError('Async call cancelled (connection closed)');
                expect(error.marker).toBe(AsyncRpcClientMarkers.ConnectionClosed);
            }
        });

        it('request timeout', async () => {
            const asyncRpcClient = AsyncRpcClient.socketio(clientSocket, Object.keys(methods), { requestTimeout: 200 });
            await asyncRpcClient.waitConnected();

            await expect(asyncRpcClient.waitAdd(null, 1, 2, 100)).resolves.toBe(3);
        });

        it('request timeout small', async () => {
            const asyncRpcClient = AsyncRpcClient.socketio(clientSocket, Object.keys(methods), { requestTimeout: 2 });
            await asyncRpcClient.waitConnected();

            try {
                await asyncRpcClient.waitAdd(null, 1, 2, 100);
            }
            catch (error) {
                expect(error).toMatchError('Async call cancelled (request timeout)');
                expect(error.marker).toBe(AsyncRpcClientMarkers.RequestTimeout);
            }
        });
    }
});

afterAll((done) => {
    testClientSocket.close();
    clientSocket.close();
    httpServer.close(done);
});


