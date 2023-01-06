import EventEmitter from 'events';

import { CancellationToken } from '../index.js';

async function delay(ms, param) {
    return new Promise((resolve, reject) => setTimeout(() => resolve(param), ms));
}

async function delayError(ms, message) {
    await delay(ms);
    throw new Error(message);
}

class Events extends EventEmitter {
    #defaultEvent;
    #timeouts = [];

    constructor(defaultEvent) {
        super();
        this.#defaultEvent = defaultEvent;
    }

    timer(time, eventName, ...args) {
        this.#timeouts.push(
            setTimeout(() => {
                this.emit(eventName || this.#defaultEvent, ...args);
            }, time)
        );
    }

    clear(message) {
        this.#timeouts.forEach((timeout) => clearTimeout(timeout));
        this.#timeouts = [];
    }
}

function arraysRemoveDimensions(...arrays) {
    const array = arrays.shift() || [];
    const rest = arrays.length ? arraysRemoveDimensions(...arrays) : [[]];
    const result = [];

    for (let current of array) {
        for (let item of rest) {
            result.push([current, ...item]);
        }
    }

    return result;
}

function setNames(list) {
    for (let line of list) {
        line.unshift(line.join('/'));
    }
    return list;
}

const events = new Events('test');

describe('CancellationToken', () => {
    it.each([['timeout'], ['manual'], ['event']])('%p token does not cancel', async (name) => {
        events.clear();
        const timeout = 25;
        let token =
            name === 'timeout'
                ? CancellationToken.timeout(timeout)
                : name === 'manual'
                ? CancellationToken.manual(false)
                : CancellationToken.event(events, 'test');
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        await expect(token.wait(delay(15, true))).resolves.toBe(true);
    });

    it.each([['timeout'], ['manual'], ['event']])('%p token cancels', async (name) => {
        events.clear();
        const timeout = 25;
        let token =
            name === 'timeout'
                ? CancellationToken.timeout(timeout)
                : name === 'manual'
                ? CancellationToken.manual(false)
                : CancellationToken.event(events, 'test');
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        await expect(token.wait(delay(30))).rejects.toThrow();
    });

    it.each([['timeout'], ['manual'], ['event']])('target promise rejected %p token', async (name) => {
        events.clear();
        const timeout = 30;
        let token =
            name === 'timeout'
                ? CancellationToken.timeout(timeout)
                : name === 'manual'
                ? CancellationToken.manual(false)
                : CancellationToken.event(events, 'test');
        events.timer(timeout);
        await expect(token.wait(delayError(15, 'error message'))).rejects.toThrow('error message');
    });

    it('catch cancel error', async () => {
        let token = CancellationToken.timeout(10);
        await expect(token.catchCancelError(token.sleep(15))).resolves.toBeInstanceOf(CancellationToken);
        token = CancellationToken.timeout(15);
        await expect(token.catchCancelError(token.wait(delayError(10, 'error message')))).rejects.toThrow('error message');
    });

    it.each([['timeout'], ['manual'], ['event']])('wait/handle event %p token', async (name) => {
        events.clear();
        const timeout = 200;
        let token =
            name === 'timeout'
                ? CancellationToken.timeout(timeout)
                : name === 'manual'
                ? CancellationToken.manual(false)
                : CancellationToken.event(events, 'test');
        events.timer(timeout);
        let wait, result;
        wait = token.waitEvent(events, 'event');
        events.emit('event', 1, 2);
        result = await wait;
        expect(result).toEqual([1, 2]);
        wait = token.handleEvent(events, 'event', (a, b) => a + b);
        events.emit('event', 1, 2);
        result = await wait;
        expect(result).toBe(3);
    });

    it.each(setNames(arraysRemoveDimensions(['timeout', 'manual', 'event'], ['wait', 'waitEvent', 'handleEvent', 'sleep'])))(
        'doNotThrow %j',
        async (name, tokenType, callType) => {
            const fn = async (doNotThrow, cancelled) => {
                events.clear();
                const timeout = 10;
                let token =
                    tokenType === 'timeout'
                        ? CancellationToken.timeout(timeout)
                        : tokenType === 'manual'
                        ? CancellationToken.manual(false)
                        : CancellationToken.event(events, 'test');

                if (cancelled) token.cancel();
                else {
                    events.timer(timeout);
                    if (tokenType === 'manual') setTimeout(() => token.cancel(), timeout);
                }

                let waittime = timeout * 2;
                let promise;

                if (callType === 'wait') {
                    promise = token.wait(delay(waittime, true), doNotThrow);
                } else if (callType === 'waitEvent') {
                    events.timer(waittime, 'event', true);
                    promise = token.waitEvent(events, 'event', doNotThrow);
                } else if (callType === 'handleEvent') {
                    events.timer(waittime, 'event', true);
                    promise = token.handleEvent(events, 'event', (result) => result, doNotThrow);
                } else if (callType === 'sleep') {
                    promise = token.sleep(waittime, true, doNotThrow);
                }

                return promise;
            };

            await expect(fn(true, false)).resolves.toBeInstanceOf(CancellationToken);
            await expect(fn(false, false)).rejects.toThrow();
            await expect(fn(true, true)).resolves.toBeInstanceOf(CancellationToken);
            await expect(fn(false, true)).rejects.toThrow();
        }
    );

    it.each(setNames(arraysRemoveDimensions(['timeout', 'manual', 'event', 'null'], ['wait', 'waitEvent', 'handleEvent', 'sleep'])))(
        'global wait methods %j',
        async (name, tokenType, callType) => {
            const fn = async (doNotThrow, expires) => {
                events.clear();
                const timeout = 10;
                let token =
                    tokenType === 'timeout'
                        ? CancellationToken.timeout(timeout)
                        : tokenType === 'manual'
                        ? CancellationToken.manual(false)
                        : tokenType === 'event' ? CancellationToken.event(events, 'test') : null;

                if (token) {
                    events.timer(timeout);
                    if (tokenType === 'manual') setTimeout(() => token.cancel(), timeout);
                }

                let waittime = expires ? timeout * 2 : timeout / 2;
                let promise;

                if (callType === 'wait') {
                    promise = CancellationToken.wait(token, delay(waittime, 2), doNotThrow);
                } else if (callType === 'waitEvent') {
                    events.timer(waittime, 'event', 2);
                    const call = async (promise) => {
                        const args = await promise;
                        return Array.isArray(args) ? args[0] : args;
                    };
                    promise = call(CancellationToken.waitEvent(token, events, 'event', doNotThrow));
                } else if (callType === 'handleEvent') {
                    events.timer(waittime, 'event', 1, 1);
                    promise = CancellationToken.handleEvent(token, events, 'event', (a, b) => a + b, doNotThrow);
                } else if (callType === 'sleep') {
                    promise = CancellationToken.sleep(token, waittime, 2, doNotThrow);
                }

                return promise;
            };

            await expect(fn(true, false)).resolves.toBe(2);
            if (tokenType === "null") await expect(fn(true, true)).resolves.toBe(2);
            else await expect(fn(true, true)).resolves.toBeInstanceOf(CancellationToken);
            await expect(fn(false, false)).resolves.toBe(2);
            if (tokenType === "null") await expect(fn(true, true)).resolves.toBe(2);
            else await expect(fn(false, true)).rejects.toThrow();;
        }
    );

    it('pause/resume basics', async () => {
        let token1, token2, token3;
        token1 = CancellationToken.timeout(15).allowPause();
        token2 = token1.manual();
        token3 = token2.timeout(15);

        token3.pause();
        await delay(20);
        token3.resume();

        await expect(token3.catchCancelError(token3.sleep(10, true))).resolves.toBe(true);
    });

    it.each([['timeout'], ['manual'], ['event']])('pause/resume %p token', async (name) => {
        events.clear();
        const timeout = 100;
        let token =
            name === 'timeout'
                ? CancellationToken.timeout(timeout)
                : name === 'manual'
                ? CancellationToken.manual(false)
                : CancellationToken.event(events, 'test');
        token.allowPause();
        events.timer(timeout);
        let trackedPause = false,
            trackedResume = false;
        const trackPause = () => (trackedPause = true);
        const trackResume = () => (trackedResume = true);
        token.on('pause', trackPause);
        token.on('resume', trackResume);
        token.pause();
        expect(trackedPause).toBe(true);
        expect(trackedResume).toBe(false);
        trackedPause = false;
        token.resume();
        expect(trackedPause).toBe(false);
        expect(trackedResume).toBe(true);
        trackedResume = false;
        token.off('pause', trackPause);
        token.off('resume', trackResume);
        token.pause();
        token.resume();
        expect(trackedPause).toBe(false);
        expect(trackedResume).toBe(false);
    });

    it('token chain', async () => {
        let token1, token2, token3, result, promise;

        token1 = CancellationToken.timeout(30);
        token2 = token1.manual();
        token3 = token2.manual();

        result = await token3.wait(delay(50, 'finished'), true);
        expect(result).toBe(token1);
        expect(token1.cancelledBy).toBe(token1);
        expect(token2.cancelledBy).toBe(token1);
        expect(token3.cancelledBy).toBe(token1);

        token1 = CancellationToken.timeout(30);
        token2 = token1.manual();
        token3 = token2.manual();

        await expect(token3.wait(delay(50, 'finished'))).rejects.toThrow();

        expect(() => token1.throwIfCancelled()).toThrow();
        expect(() => token2.throwIfCancelled()).toThrow();
        expect(() => token3.throwIfCancelled()).toThrow();
    });

    it('token chain pause and wait', async () => {
        let token1, token2, token3, token4, result, promise1, promise2;

        token1 = CancellationToken.timeout(150).allowPause();
        token2 = token1.manual();
        token3 = token2.manual();
        token4 = token1.timeout(150);

        token3.pause();
        await delay(120);
        token3.resume();
        promise1 = token3.wait(delay(50, 'finished'), true);
        promise2 = token4.wait(delay(50, 'finished'), true);
        result = await promise1;
        expect(result).toBe('finished');
        result = await promise2;
        expect(result).not.toBe('finished');
    });

    it('token chain allowsPause and pause/resume', async () => {
        let token1, token2, token3, token4;

        token1 = CancellationToken.timeout(150);
        token2 = token1.manual();
        token3 = token2.timeout(150);
        token4 = token2.manual();

        expect(() => token1.allowPause()).toThrow();
        expect(() => token2.allowPause()).toThrow();
        expect(() => token3.allowPause()).toThrow();
        expect(() => token4.allowPause()).toThrow();
        expect(() => token1.pause()).toThrow();
        expect(() => token2.pause()).toThrow();
        expect(() => token3.pause()).toThrow();
        expect(() => token4.pause()).toThrow();

        expect(token1.allowsPause).toBe(false);
        expect(token2.allowsPause).toBe(false);
        expect(token3.allowsPause).toBe(false);
        expect(token4.allowsPause).toBe(false);

        token1 = CancellationToken.timeout(150);
        expect(() => token1.allowPause()).not.toThrow();
        token2 = token1.manual();
        expect(() => token2.allowPause()).not.toThrow();
        token3 = token2.timeout(150);
        expect(() => token3.allowPause()).not.toThrow();
        token4 = token2.manual();
        expect(() => token4.allowPause()).not.toThrow();

        expect(token1.allowsPause).toBe(true);
        expect(token2.allowsPause).toBe(true);
        expect(token3.allowsPause).toBe(true);
        expect(token4.allowsPause).toBe(true);

        expect(() => token4.pause()).not.toThrow();
        expect(() => token4.resume()).not.toThrow();
        expect(() => token3.pause()).not.toThrow();
        expect(() => token3.resume()).not.toThrow();

        expect(() => token1.pause()).not.toThrow();
        expect(() => token2.pause()).not.toThrow();
        expect(() => token3.pause()).not.toThrow();
        expect(() => token4.pause()).not.toThrow();

        expect(token1.paused).toBe(true);
        expect(token2.paused).toBe(true);
        expect(token3.paused).toBe(true);
        expect(token4.paused).toBe(true);

        expect(() => token4.resume()).not.toThrow();

        expect(token1.paused).toBe(true);
        expect(token2.paused).toBe(true);
        expect(token3.paused).toBe(true);
        expect(token4.paused).toBe(false);

        expect(() => token3.resume()).not.toThrow();

        expect(token1.paused).toBe(true);
        expect(token2.paused).toBe(true);
        expect(token3.paused).toBe(false);
        expect(token4.paused).toBe(false);

        expect(() => token2.resume()).not.toThrow();

        expect(token1.paused).toBe(true);
        expect(token2.paused).toBe(false);
        expect(token3.paused).toBe(false);
        expect(token4.paused).toBe(false);

        expect(() => token1.resume()).not.toThrow();

        expect(token1.paused).toBe(false);
        expect(token2.paused).toBe(false);
        expect(token3.paused).toBe(false);
        expect(token4.paused).toBe(false);

        expect(() => token1.pause()).not.toThrow();
        expect(() => token2.pause()).not.toThrow();
        expect(() => token3.pause()).not.toThrow();
        expect(() => token4.pause()).not.toThrow();
        expect(() => token1.pause()).toThrow();
        expect(() => token2.pause()).toThrow();
        expect(() => token3.pause()).toThrow();
        expect(() => token4.pause()).toThrow();
        expect(() => token1.resume()).not.toThrow();
        expect(() => token2.resume()).not.toThrow();
        expect(() => token3.resume()).not.toThrow();
        expect(() => token4.resume()).not.toThrow();
        expect(() => token1.resume()).toThrow();
        expect(() => token2.resume()).toThrow();
        expect(() => token3.resume()).toThrow();
        expect(() => token4.resume()).toThrow();
    });

    it('sleep and static sleep', async () => {
        await expect(CancellationToken.timeout(30).sleep(20, true)).resolves.toBe(true);
        await expect(CancellationToken.timeout(20).sleep(30, true)).rejects.toThrow();
    });

    it('race', async () => {
        let token, result;

        token = CancellationToken.timeout(10);
        await expect(token.race((token) => [token.sleep(20), token.sleep(25)])).rejects.toThrow();

        token = CancellationToken.manual();
        result = await token.race((token) => [token.sleep(20), token.sleep(10)]);
        expect(result.index).toBe(1);

        await expect(CancellationToken.manual().race((token) => [delayError(20), delayError(10)])).rejects.toThrow(AggregateError);
        await expect(CancellationToken.manual().race((token) => [delayError(20), delayError(10)], false)).rejects.not.toThrow(AggregateError);
        await expect(CancellationToken.timeout(50).race((token) => [token.sleep(100), token.sleep(200)])).rejects.toThrow();
        await expect(CancellationToken.timeout(50).race((token) => [token.sleep(10, true), delayError(20)], false)).resolves.toMatchObject({
            result: true,
            index: 0,
        });

        await expect(CancellationToken.timeout(20).race((token) => [token.sleep(20), delayError(10, "error message")], false)).rejects.toThrow("error message");

        let cancelled = true;

        await expect(CancellationToken.timeout(25).race((token) => [
                token.sleep(10, true),
                (async (token) => {
                    await token.sleep(20);
                    cancelled = false;
                })(),
            ])).resolves.toMatchObject({
                result: true,
                index: 0,
            });

        expect(cancelled).toBe(true);
    });

    it('processCancel', async () => {
        let cancelled = false;
        let token1 = CancellationToken.timeout(10);
        let token2 = token1.manual(false);
        let promise = new Promise((resolve, reject) => {
            token2.processCancel(resolve, reject, () => (cancelled = true), true);
        });
        let result = await promise;
        expect(result).toBe(token1);
        expect(cancelled).toBe(true);

        cancelled = false;
        token1 = CancellationToken.timeout(10);
        token2 = token1.manual(false);
        promise = new Promise((resolve, reject) => {
            token2.processCancel(resolve, reject, () => (cancelled = true));
        });
        await expect(promise).rejects.toThrow();
        expect(cancelled).toBe(true);
    });
});
