import EventEmitter from 'events';

import { CancellationToken, CT, sleep } from '../index.js';

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
    it.each([['timeout'], ['manual'], ['event']])('CT case token %p', async (name) => {
        events.clear();
        const timeout = 7;
        let token =
            name === 'timeout' ? CT.timeout(timeout) : name === 'manual' ? CT.manual() : CT.event(events, 'test');
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        await expect(token.wait(delay(15))).rejects.toThrow();
        expect(token instanceof CT).toBe(true);
    });

    it.each([['timeout'], ['manual'], ['event']])('no cancel case token %p', async (name) => {
        events.clear();
        const timeout = 15;
        let token =
            name === 'timeout' ? CancellationToken.timeout(timeout) : name === 'manual' ? CancellationToken.manual() : CancellationToken.event(events, 'test');
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        await expect(token.wait(delay(7, true))).resolves.toBe(true);
    });

    it.each([['timeout'], ['manual'], ['event']])('cancel case token %p', async (name) => {
        events.clear();
        const timeout = 7;
        let token =
            name === 'timeout' ? CancellationToken.timeout(timeout) : name === 'manual' ? CancellationToken.manual() : CancellationToken.event(events, 'test');
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        await expect(token.wait(delay(15))).rejects.toThrow();
    });

    it.each([['timeout'], ['manual'], ['event']])('cancel error token %p', async (name) => {
        events.clear();
        const timeout = 7;
        let token =
            name === 'timeout' ? CT.timeout(timeout) : name === 'manual' ? CT.manual() : CT.event(events, 'test');
        let error = new Error('test error');
        token.cancel(error);
        await sleep(10);
        await expect(token.wait(delay(15))).rejects.toThrow();
        await expect(token.wait(delay(15), true)).resolves.toBe(token);
        expect(token.cancelledError).toBe(error);
    });

    it.each([['timeout'], ['manual'], ['event']])('target promise rejected %p token', async (name) => {
        events.clear();
        const timeout = 30;
        let token =
            name === 'timeout' ? CancellationToken.timeout(timeout) : name === 'manual' ? CancellationToken.manual() : CancellationToken.event(events, 'test');
        events.timer(timeout);
        await expect(token.wait(delayError(15, 'error message'))).rejects.toThrow('error message');
    });

    it.each([['addOnce'], ['addMulti'], ['init'], ['childInit']])('multiparent %p token', async (name) => {
        const create = function(...tokens) {
            let child;

            if (name === 'addOnce') {
                tokens = tokens.concat(...tokens.slice(tokens.length < 2 ? 0 : tokens.length === 2 ? 1 : 2));
                child = CancellationToken.manual().attachTo(...tokens);
            }
            else if (name === 'addMulti') {
                child = CancellationToken.manual();
                for (let i = 0; i < tokens.length - 1; i++) child = child.attachTo(tokens[i], tokens[i+1]);    
            }
            else if (name === 'init') {
                tokens = tokens.concat(...tokens.slice(tokens.length < 2 ? 0 : tokens.length === 2 ? 1 : 2));
                child = CancellationToken.manual(tokens);
            }
            else if (name === 'childInit') {
                tokens = tokens.concat(...tokens.slice(tokens.length < 2 ? 0 : tokens.length === 2 ? 1 : 2));
                if (tokens.length) child = tokens[0].manual(tokens.slice(1));
                else child = CancellationToken.manual(tokens);
            }
            
            return child;
        };

        let parent1 = CancellationToken.manual(), parent2 = CancellationToken.manual(), parent3 = CancellationToken.manual();
        let child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent1.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        parent1 = CancellationToken.manual(), parent2 = CancellationToken.manual(), parent3 = CancellationToken.manual();
        child = create(parent1, parent2, parent3);
        parent2.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        parent1 = CancellationToken.manual(), parent2 = CancellationToken.manual(), parent3 = CancellationToken.manual();
        child = create(parent1, parent2, parent3);
        parent3.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent3);

        parent1 = CancellationToken.manual(), parent2 = CancellationToken.manual(), parent3 = CancellationToken.manual();
        child = create(parent1, parent2, parent3, null);
        parent1.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        parent1 = CancellationToken.manual(), parent2 = CancellationToken.manual(), parent3 = CancellationToken.manual();
        child = create(parent1, parent2, parent3, null);
        parent2.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        parent1 = CancellationToken.manual(), parent2 = CancellationToken.manual(), parent3 = CancellationToken.manual();
        child = create(parent1, parent2, parent3, null);
        parent3.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent3);

        expect(() => create(parent1, 'test', parent3, undefined, null)).toThrow();
        expect(() => create(parent1, false, parent3, undefined, null)).toThrow();
        expect(() => create(parent1, 0, parent3, undefined, null)).toThrow();
        expect(() => create(parent1, undefined, parent3, undefined, null)).toThrow();

        parent1 = CancellationToken.manual(), parent2 = CancellationToken.manual().cancel(), parent3 = CancellationToken.manual();
        child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        parent1 = CancellationToken.manual(), parent2 = CancellationToken.manual().cancel(), parent3 = CancellationToken.manual().cancel();
        child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        parent1 = CancellationToken.manual().cancel(), parent2 = CancellationToken.manual().cancel(), parent3 = CancellationToken.manual();
        child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        child = create();
        expect(child.cancelled).toBe(false);

        parent1 = CancellationToken.manual().cancel();
        parent2 = CancellationToken.manual();
        parent3 = parent2.manual();
        expect(parent2.cancelled).toBe(false);
        expect(parent3.cancelled).toBe(false);
        parent2.attachTo(parent1);
        expect(parent2.cancelled).toBe(true);
        expect(parent3.cancelled).toBe(true);
        expect(parent2.cancelledBy).toBe(parent1);
        expect(parent3.cancelledBy).toBe(parent1);

        let counter = 0;
        parent3 = CancellationToken.manual();
        parent3.on('cancel', () => counter += 1);
        parent3.cancel();
        expect(counter).toBe(1);
        parent3.cancel();
        expect(counter).toBe(1);
        parent2 = CancellationToken.manual().cancel();
        parent3.attachTo(parent2);
        expect(counter).toBe(1);
        parent1 = CancellationToken.manual().cancel();
        parent2.attachTo(parent1);
        expect(counter).toBe(1);
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
            name === 'timeout' ? CancellationToken.timeout(timeout) : name === 'manual' ? CancellationToken.manual() : CancellationToken.event(events, 'test');
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
                        ? CancellationToken.manual()
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
                        ? CancellationToken.manual()
                        : tokenType === 'event'
                        ? CancellationToken.event(events, 'test')
                        : null;

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
            if (tokenType === 'null') await expect(fn(true, true)).resolves.toBe(2);
            else await expect(fn(true, true)).resolves.toBeInstanceOf(CancellationToken);
            await expect(fn(false, false)).resolves.toBe(2);
            if (tokenType === 'null') await expect(fn(true, true)).resolves.toBe(2);
            else await expect(fn(false, true)).rejects.toThrow();
        }
    );

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

    it('sleep and static sleep', async () => {
        await expect(CancellationToken.timeout(10).sleep(5)).resolves.toBe(true);
        await expect(CancellationToken.timeout(10).sleep(5, 'test')).resolves.toBe('test');
        await expect(CancellationToken.timeout(5).sleep(10, true)).rejects.toThrow();
    });

    it('race', async () => {
        await expect(CancellationToken.timeout(5).race((token) => [token.sleep(20), token.sleep(25)])).rejects.toThrow('Async call cancelled');
        await expect(CancellationToken.timeout(5).race((token) => [token.sleep(5), token.sleep(5)])).rejects.toThrow('Async call cancelled');
        await expect(CancellationToken.manual().race((token) => [delayError(2), delayError(5)])).rejects.toThrow('Race indexed error');
        await expect(CancellationToken.timeout(20).race((token) => [token.sleep(7, 1), token.sleep(5, 2)])).resolves.toEqual({ index: 1, result: 2 });

        await expect(CancellationToken.timeout(5).race((token) => [token.sleep(20), token.sleep(25)], true)).resolves.toBeInstanceOf(CancellationToken);
        await expect(CancellationToken.timeout(5).race((token) => [token.sleep(5), token.sleep(6)], true)).resolves.toBeInstanceOf(CancellationToken);
        await expect(CancellationToken.manual().race((token) => [delayError(2), delayError(5)], true)).rejects.toThrow('Race indexed error');
        await expect(CancellationToken.timeout(20).race((token) => [token.sleep(7, 1), token.sleep(5, 2)], true)).resolves.toEqual({ index: 1, result: 2 });

        await expect(CancellationToken.timeout(10).race((token) => [token.timeout(5).sleep(10), token.timeout(6).sleep(10)])).rejects.toThrow('Race indexed error');
        await expect(CancellationToken.timeout(10).race((token) => [token.timeout(5).sleep(10, true, true), token.timeout(6).sleep(10, true, true)])).resolves.toHaveProperty('index', 0);
    });

    it('any', async () => {
        await expect(CancellationToken.timeout(5).any((token) => [token.sleep(20), token.sleep(25)])).rejects.toThrow('Async call cancelled');
        await expect(CancellationToken.timeout(5).any((token) => [token.sleep(5), token.sleep(5)])).rejects.toThrow('Async call cancelled');
        await expect(CancellationToken.manual().any((token) => [delayError(2), delayError(5)])).rejects.toThrow(AggregateError);
        await expect(CancellationToken.timeout(20).any((token) => [token.sleep(7, 1), token.sleep(5, 2)])).resolves.toEqual({ index: 1, result: 2 });

        await expect(CancellationToken.timeout(5).any((token) => [token.sleep(20), token.sleep(25)], true)).resolves.toBeInstanceOf(CancellationToken);
        await expect(CancellationToken.timeout(5).any((token) => [token.sleep(5), token.sleep(6)], true)).resolves.toBeInstanceOf(CancellationToken);
        await expect(CancellationToken.manual().any((token) => [delayError(2), delay(5, 2)], true)).resolves.toEqual({ index: 1, result: 2 });
        await expect(CancellationToken.timeout(20).any((token) => [token.sleep(7, 1), token.sleep(5, 2)], true)).resolves.toEqual({ index: 1, result: 2 });

        await expect(CancellationToken.timeout(10).any((token) => [token.timeout(5).sleep(10), token.timeout(6).sleep(10)])).rejects.toThrow(AggregateError);
        await expect(CancellationToken.timeout(10).any((token) => [token.timeout(5).sleep(10, true, true), token.timeout(6).sleep(10, true, true)])).resolves.toHaveProperty('index', 0)
    });

    it('processCancel', async () => {
        let cancelled = false;
        let token1 = CancellationToken.timeout(10);
        let token2 = token1.manual();
        let promise = new Promise((resolve, reject) => {
            token2.processCancel(resolve, reject, () => (cancelled = true), true);
        });
        let result = await promise;
        expect(result).toBe(token1);
        expect(cancelled).toBe(true);

        cancelled = false;
        token1 = CancellationToken.timeout(10);
        token2 = token1.manual();
        promise = new Promise((resolve, reject) => {
            token2.processCancel(resolve, reject, () => (cancelled = true));
        });
        await expect(promise).rejects.toThrow();
        expect(cancelled).toBe(true);
    });

    it('processCancel unsubscribe check', async () => {
        let cancelled = false;
        let token = CancellationToken.timeout(10);
        let promiseResolve, promiseReject, promise;

        promise = new Promise((resolve, reject) => {
            [promiseResolve, promiseReject] = token.processCancel(resolve, reject, () => (cancelled = true), true, true);
        });
        setTimeout(() => promiseResolve(true), 5);
        await sleep(11);
        expect(await promise).toBe(true);
        expect(cancelled).toBe(false);

        token = CancellationToken.timeout(10);
        promise = new Promise((resolve, reject) => {
            [promiseResolve, promiseReject] = token.processCancel(resolve, reject, () => (cancelled = true), true, true);
        });
                setTimeout(() => promiseReject(new Error('test')), 5);
        await expect(promise).rejects.toThrow('test');
        await sleep(10);
        expect(cancelled).toBe(false);

        token = CancellationToken.timeout(10);
        promise = new Promise((resolve, reject) => {
            [promiseResolve, promiseReject] = token.processCancel(resolve, reject, () => (cancelled = true), true, true);
        });
        setTimeout(() => promiseResolve(true), 15);
        expect(await promise).toBe(token);
        expect(cancelled).toBe(true);
    });
});
