import EventEmitter from 'events';
import CT, { CancellationEventError } from '@async-cancellables/ct';

const sleep = CT.sleep;

async function sleepError(ms, message) {
    await sleep(ms);
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

class TrackedSleep {
    #called = 0;
    #finished = 0;
    #sleepBound = this.#sleep.bind(this);

    async #sleep(token, time, result, error = false, doNotThrow = false) {
        this.#called++;
        let isCancellationError = false;
        try {
            if (error) {
                await token.sleep(time, result, doNotThrow);
                throw new Error(result);
            }
            else {
                const returned = await token.sleep(time, result, doNotThrow);
                if (CT.isToken(returned)) isCancellationError = true;
                return returned;
            }
        }
        catch (error) {
            if (CT.isCancellationError(error)) isCancellationError = true;
            throw error;
        }
        finally {
            if (!isCancellationError) this.#finished++;
        }
    }

    get sleep() {
        return this.#sleepBound;
    }

    get calledReset() {
        const called = this.#called;
        this.#called = 0;
        return called;
    }

    get finishedReset() {
        const finished = this.#finished;
        this.#finished = 0;
        return finished;
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
    it.each([['timeout'], ['manual'], ['event']])('no cancel case token %p', async (name) => {
        events.clear();
        const timeout = 15;
        let token = name === 'timeout' ? CT.timeout(timeout) : name === 'manual' ? CT.manual() : CT.event(events, 'test');
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        await expect(token.wait(sleep(7, true))).resolves.toBe(true);
    });

    it.each([['timeout'], ['manual'], ['event']])('cancel case token %p', async (name) => {
        events.clear();
        const timeout = 7;
        let token = name === 'timeout' ? CT.timeout(timeout) : name === 'manual' ? CT.manual() : CT.event(events, 'test');
        events.timer(timeout, 'test');
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        await expect(token.wait(sleep(15))).rejects.toThrow();
        expect(token.cancelledBy).toBe(token);
    });

    it.each(setNames(arraysRemoveDimensions(['timeout', 'manual', 'event'], ['options', 'simple'])))(
        'cancelError %j', async (name, tokenType, initType) => {
        const createError = (token) => new Error('custom error');
        const timeout = 7;
        const options = initType === 'options' ? { createError } : createError;

        // parent with customError cancelled first
        events.clear();
        let parent = tokenType === 'timeout' ? CT.timeout(timeout, options) : tokenType === 'manual' ? CT.manual(options) : CT.event(events, 'test', options);
        let token = parent.manual();
        events.timer(timeout, 'test', true);
        if (tokenType === 'manual') setTimeout(() => parent.cancel(), timeout);
        await expect(token.wait(sleep(15))).rejects.toThrow("custom error");
        expect(token.cancelledError).toBeInstanceOf(Error);
        expect(parent.cancelledError).toBeInstanceOf(Error);

        // child with customError, parent cancelled first
        events.clear();
        parent = CT.manual();
        token = tokenType === 'timeout' ? parent.timeout(timeout, options) : tokenType === 'manual' ? parent.manual(options) : parent.event(events, 'test', options);
        events.timer(timeout, 'test', true);
        setTimeout(() => parent.cancel(), 2);
        await expect(token.wait(sleep(15))).rejects.toThrow("Async call cancelled");
        expect(token.cancelledError).toBeInstanceOf(CancellationEventError);
        expect(parent.cancelledError).toBeInstanceOf(CancellationEventError);

        // parent with customError, child cancelled first
        events.clear();
        parent = tokenType === 'timeout' ? CT.timeout(timeout, options) : tokenType === 'manual' ? CT.manual(options) : CT.event(events, 'test', options);
        token = parent.manual();
        events.timer(timeout, 'test', true);
        if (tokenType === 'manual') setTimeout(() => parent.cancel(), timeout);
        token.cancel();
        await expect(token.wait(sleep(15))).rejects.toThrow("Async call cancelled");
        expect(token.cancelledError).toBeInstanceOf(CancellationEventError);
        await sleep(timeout);
        expect(parent.cancelledError).toBeInstanceOf(Error);
        expect(token.cancelledError).toBeInstanceOf(CancellationEventError);
        expect(token.cancelledBy).toBe(token);
        expect(parent.cancelledBy).toBe(parent);

        // parent with customError, parent cancelled first, using processCancel
        events.clear();
        parent = CT.manual();
        token = tokenType === 'timeout' ? parent.timeout(timeout, options) : tokenType === 'manual' ? parent.manual(options) : parent.event(events, 'test', options);
        events.timer(timeout, 'test', true);
        setTimeout(() => parent.cancel(), 2);

        let promise = new Promise((resolve, reject) => {
            let timeoutObject;
            [resolve, reject] = token.processCancel(resolve, reject, () => clearTimeout(timeoutObject));
            timeoutObject = setTimeout(resolve, timeout);
        });

        await expect(promise).rejects.toThrow("Async call cancelled");
        expect(token.cancelledError).toBeInstanceOf(CancellationEventError);
        expect(parent.cancelledError).toBeInstanceOf(CancellationEventError);
    });

    it.each([['timeout'], ['manual'], ['event']])('%p cancelError from cancelled token', async (name) => {
        const createError = (token) => new Error('custom error');
        const parent = CT.manual(createError).cancel();
        const token = name === 'timeout' ? parent.timeout(15) : name === 'manual' ? parent.manual() : parent.event(events, 'test');
        await expect(token.wait(sleep(15))).rejects.toThrow("custom error");
        expect(token.cancelledError).toBeInstanceOf(Error);
    });

    it.each([['timeout'], ['manual'], ['event']])('target promise rejected %p token', async (name) => {
        events.clear();
        const timeout = 30;
        let token = name === 'timeout' ? CT.timeout(timeout) : name === 'manual' ? CT.manual() : CT.event(events, 'test');
        events.timer(timeout, true);
        await expect(token.wait(sleepError(15, 'error message'))).rejects.toThrow('error message');
    });

    it.each([['timeout'], ['manual'], ['event']])('token name %p token', async (name) => {
        events.clear();
        const timeout = 15;
        const arg = 'test';
        let token = name === 'timeout' ? CT.timeout(timeout, arg) : name === 'manual' ? CT.manual(arg) : CT.event(events, 'test', arg);
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        let thrown = await CT.catchCancelError(token.wait(sleep(30)));
        expect(thrown.name).toBe('test');

        const parent = CT.manual();
        expect(parent.name).toBe(null);
        events.clear();
        token = name === 'timeout' ? parent.timeout(timeout, arg) : name === 'manual' ? parent.manual(arg) : parent.event(events, 'test', arg);
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        thrown = await CT.catchCancelError(token.wait(sleep(30)));
        expect(thrown.name).toBe('test');
    });

    it.each([['timeout'], ['manual'], ['event']])('options.name %p token', async (name) => {
        const timeout = 15;
        events.clear();
        let arg = { name: 'test' };
        let token = name === 'timeout' ? CT.timeout(timeout, arg) : name === 'manual' ? CT.manual(arg) : CT.event(events, 'test', arg);
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        let thrown = await CT.catchCancelError(token.wait(sleep(30)));
        expect(thrown.name).toBe('test');

        const parent = CT.manual();
        events.clear();
        arg = { name: 'test' };
        token = name === 'timeout' ? parent.timeout(timeout, arg) : name === 'manual' ? parent.manual(arg) : parent.event(events, 'test', arg);
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        thrown = await CT.catchCancelError(token.wait(sleep(30)));
        expect(thrown.name).toBe('test');
    });

    it.each([['timeout'], ['manual'], ['event']])('options.parents %p token', async (name) => {
        const timeout = 45;
        events.clear();
        let parentToken = CT.timeout(15);
        let arg = { parents: [parentToken] };
        let token = name === 'timeout' ? CT.timeout(timeout, arg) : name === 'manual' ? CT.manual(arg) : CT.event(events, 'test', arg);
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        let thrown = await CT.catchCancelError(token.wait(sleep(30)));
        expect(thrown).toBe(parentToken);

        events.clear();
        const sourceToken = CT.manual();
        parentToken = CT.timeout(15);
        arg = { parents: [parentToken] };
        token = name === 'timeout' ? sourceToken.timeout(timeout, arg) : name === 'manual' ? sourceToken.manual(arg) : sourceToken.event(events, 'test', arg);
        events.timer(timeout);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        thrown = await CT.catchCancelError(token.wait(sleep(30)));
        expect(thrown).toBe(parentToken);
    });

    it.each([['addOnce'], ['addMulti'], ['init'], ['childInit']])('multiparent %p token', async (name) => {
        const create = function(...tokens) {
            let child;

            if (name === 'addOnce') {
                tokens = tokens.concat(...tokens.slice(tokens.length < 2 ? 0 : tokens.length === 2 ? 1 : 2));
                child = CT.manual().attachTo(...tokens);
            }
            else if (name === 'addMulti') {
                child = CT.manual();
                for (let i = 0; i < tokens.length - 1; i++) child = child.attachTo(tokens[i], tokens[i+1]);    
            }
            else if (name === 'init') {
                tokens = tokens.concat(...tokens.slice(tokens.length < 2 ? 0 : tokens.length === 2 ? 1 : 2));
                child = CT.manual(tokens);
            }
            else if (name === 'childInit') {
                tokens = tokens.concat(...tokens.slice(tokens.length < 2 ? 0 : tokens.length === 2 ? 1 : 2));
                if (tokens.length) child = tokens[0].manual(tokens.slice(1));
                else child = CT.manual(tokens);
            }
            
            return child;
        };

        let parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        let child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent1.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3);
        parent2.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3);
        parent3.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent3);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3, null);
        parent1.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3, null);
        parent2.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3, null);
        parent3.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent3);

        expect(() => create(parent1, 'test', parent3, undefined, null)).toThrow();
        expect(() => create(parent1, false, parent3, undefined, null)).toThrow();
        expect(() => create(parent1, 0, parent3, undefined, null)).toThrow();
        expect(() => create(parent1, undefined, parent3, undefined, null)).toThrow();

        parent1 = CT.manual(), parent2 = CT.manual().cancel(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        parent1 = CT.manual(), parent2 = CT.manual().cancel(), parent3 = CT.manual().cancel();
        child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        parent1 = CT.manual().cancel(), parent2 = CT.manual().cancel(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        child = create();
        expect(child.cancelled).toBe(false);

        parent1 = CT.manual().cancel();
        parent2 = CT.manual();
        parent3 = parent2.manual();
        expect(parent2.cancelled).toBe(false);
        expect(parent3.cancelled).toBe(false);
        parent2.attachTo(parent1);
        expect(parent2.cancelled).toBe(true);
        expect(parent3.cancelled).toBe(true);
        expect(parent2.cancelledBy).toBe(parent1);
        expect(parent3.cancelledBy).toBe(parent1);

        let counter = 0;
        parent3 = CT.manual();
        parent3.on('cancel', () => counter += 1);
        parent3.cancel();
        expect(counter).toBe(1);
        parent3.cancel();
        expect(counter).toBe(1);
        parent2 = CT.manual().cancel();
        parent3.attachTo(parent2);
        expect(counter).toBe(1);
        parent1 = CT.manual().cancel();
        parent2.attachTo(parent1);
        expect(counter).toBe(1);
    });

    it.each([['oneByOne'], ['oneByOneAttachReverse'], ['oneByOneDetachReverse'], ['allAtOnce']])('attachTo/detachFrom %p method', async (name) => {
        const create = function(...tokens) {
            let child = CT.manual();

            if (name === 'oneByOne' || name === 'oneByOneDetachReverse') {
                for (let token of tokens) child.attachTo(token);
            }
            else if (name === 'oneByOneAttachReverse') {
                for (let token of tokens.reverse()) child.attachTo(token);
            }
            else if (name === 'allAtOnce') {
                child.attachTo(...tokens);   
            }
            
            return child;
        };

        const detach = function(child, ...tokens) {
            if (name === 'oneByOne' || name === 'oneByOneAttachReverse') {
                for (let token of tokens) child.detachFrom(token);
            }
            else if (name === 'oneByOneDetachReverse') {
                for (let token of tokens.reverse()) child.detachFrom(token);
            }
            else if (name === 'allAtOnce') {
                child.detachFrom(...tokens);   
            }
            
            return child;
        };

        let parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        let child = create(parent1, parent2, parent3);
        detach(child, parent1, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent1.cancel();       
        expect(child.cancelled).toBe(false);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3);
        detach(child, parent1, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent2.cancel();       
        expect(child.cancelled).toBe(false);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3);
        detach(child, parent1, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent3.cancel();       
        expect(child.cancelled).toBe(false);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3);
        detach(child, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent1.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3);
        detach(child, parent1, parent3);
        expect(child.cancelled).toBe(false);
        parent2.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1, parent2, parent3);
        detach(child, parent1, parent2);
        expect(child.cancelled).toBe(false);
        parent3.cancel();       
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent3);

        parent1 = CT.manual();
        child = create(parent1);
        detach(child, parent1);
        expect(child.cancelled).toBe(false);
        parent1.cancel();       
        expect(child.cancelled).toBe(false);

        parent1 = CT.manual(), parent2 = CT.manual(), parent3 = CT.manual();
        child = create(parent1);
        child.detachFrom(parent1);
        child.attachTo(parent2);
        child.detachFrom(parent2);
        child.attachTo(parent3);
        child.detachFrom(parent3);
        expect(child.cancelled).toBe(false);
        parent1.cancel();      
        parent2.cancel();
        parent3.cancel();
        expect(child.cancelled).toBe(false);

        parent1 = CT.manual().cancel();
        child = CT.manual().attachTo(parent1);
        child.detachFrom(parent1);
        expect(child.cancelled).toBe(true);
    });

    it('catch cancel error', async () => {
        let token = CT.timeout(10);
        await expect(token.catchCancelError(token.sleep(15))).resolves.toBeInstanceOf(CT);
        token = CT.timeout(15);
        await expect(token.catchCancelError(token.wait(sleepError(10, 'error message')))).rejects.toThrow('error message');
    });

    it.each([['timeout'], ['manual'], ['event']])('wait/handle event %p token', async (name) => {
        events.clear();
        const timeout = 200;
        let token =
            name === 'timeout' ? CT.timeout(timeout) : name === 'manual' ? CT.manual() : CT.event(events, 'test');
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
                        ? CT.timeout(timeout)
                        : tokenType === 'manual'
                        ? CT.manual()
                        : CT.event(events, 'test');

                if (cancelled) token.cancel();
                else {
                    events.timer(timeout);
                    if (tokenType === 'manual') setTimeout(() => token.cancel(), timeout);
                }

                let waittime = timeout * 2;
                let promise;

                if (callType === 'wait') {
                    promise = token.wait(sleep(waittime, true), doNotThrow);
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

            await expect(fn(true, false)).resolves.toBeInstanceOf(CT);
            await expect(fn(false, false)).rejects.toThrow();
            await expect(fn(true, true)).resolves.toBeInstanceOf(CT);
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
                        ? CT.timeout(timeout)
                        : tokenType === 'manual'
                        ? CT.manual()
                        : tokenType === 'event'
                        ? CT.event(events, 'test')
                        : null;

                if (token) {
                    events.timer(timeout);
                    if (tokenType === 'manual') setTimeout(() => token.cancel(), timeout);
                }

                let waittime = expires ? timeout * 2 : timeout / 2;
                let promise;

                if (callType === 'wait') {
                    promise = CT.wait(sleep(waittime, 2), token, doNotThrow);
                } else if (callType === 'waitEvent') {
                    events.timer(waittime, 'event', 2);
                    const call = async (promise) => {
                        const args = await promise;
                        return Array.isArray(args) ? args[0] : args;
                    };
                    promise = call(CT.waitEvent(events, 'event', token, doNotThrow));
                } else if (callType === 'handleEvent') {
                    events.timer(waittime, 'event', 1, 1);
                    promise = CT.handleEvent(events, 'event', (a, b) => a + b, token, doNotThrow);
                } else if (callType === 'sleep') {
                    promise = CT.sleep(waittime, 2, token, doNotThrow);
                }

                return promise;
            };

            await expect(fn(true, false)).resolves.toBe(2);
            if (tokenType === 'null') await expect(fn(true, true)).resolves.toBe(2);
            else await expect(fn(true, true)).resolves.toBeInstanceOf(CT);
            await expect(fn(false, false)).resolves.toBe(2);
            if (tokenType === 'null') await expect(fn(true, true)).resolves.toBe(2);
            else await expect(fn(false, true)).rejects.toThrow();
        }
    );

    it('token chain', async () => {
        let token1, token2, token3, result, promise;

        token1 = CT.timeout(30);
        token2 = token1.manual();
        token3 = token2.manual();

        result = await token3.wait(sleep(50, 'finished'), true);
        expect(result).toBe(token1);
        expect(token1.cancelledBy).toBe(token1);
        expect(token2.cancelledBy).toBe(token1);
        expect(token3.cancelledBy).toBe(token1);

        token1 = CT.timeout(30);
        token2 = token1.manual();
        token3 = token2.manual();

        await expect(token3.wait(sleep(50, 'finished'))).rejects.toThrow();

        expect(() => token1.throwIfCancelled()).toThrow();
        expect(() => token2.throwIfCancelled()).toThrow();
        expect(() => token3.throwIfCancelled()).toThrow();
    });

    it('sleep and static sleep', async () => {
        await expect(CT.timeout(10).sleep(5)).resolves.toBe(true);
        await expect(CT.timeout(10).sleep(5, 'test')).resolves.toBe('test');
        await expect(CT.timeout(5).sleep(10, true)).rejects.toThrow();
    });

    it('race', async () => {
        const tracked = new TrackedSleep();
        //sleep(token, time, result, error = false, doNotThrow = false)
        await expect(CT.manual().cancel().race((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)])).rejects.toThrow('Async call cancelled');
        expect(tracked.calledReset).toBe(0);
        await expect(CT.timeout(5).race((token) => [tracked.sleep(token, 20), tracked.sleep(token, 25)])).rejects.toThrow('Async call cancelled');
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(5).race((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)])).rejects.toThrow('Async call cancelled');
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.manual().race((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)])).rejects.toThrow('Race indexed error');
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.timeout(20).race((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)])).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);

        tracked.calledReset;

        await expect(CT.manual().cancel().race((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.calledReset).toBe(0);
        await expect(CT.timeout(5).race((token) => [tracked.sleep(token, 20), tracked.sleep(token, 25)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(5).race((token) => [tracked.sleep(token, 5), tracked.sleep(token, 6)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.manual().race((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)], true)).rejects.toThrow('Race indexed error');
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.timeout(20).race((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);

        await expect(CT.timeout(10).race((token) => [tracked.sleep(token.timeout(5), 10), tracked.sleep(token.timeout(6), 10)], true)).rejects.toThrow('Race indexed error');
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(10).race((token) => [tracked.sleep(token.timeout(5), 10, true, false, true), tracked.sleep(token.timeout(6), 10, true, false, true)], true)).resolves.toHaveProperty('index', 0);
        expect(tracked.finishedReset).toBe(0);
    });

    it('any', async () => {
        const tracked = new TrackedSleep();
        //sleep(token, time, result, error = false, doNotThrow = false)
        await expect(CT.manual().cancel().any((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)])).rejects.toThrow('Async call cancelled');
        expect(tracked.calledReset).toBe(0);
        await expect(CT.timeout(5).any((token) => [tracked.sleep(token, 20), tracked.sleep(token, 25)])).rejects.toThrow('Async call cancelled');
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(5).any((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)])).rejects.toThrow('Async call cancelled');
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.manual().any((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)])).rejects.toThrow(AggregateError);
        expect(tracked.finishedReset).toBe(2);
        await expect(CT.timeout(20).any((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)])).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);

        tracked.calledReset;

        await expect(CT.manual().cancel().any((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.calledReset).toBe(0);
        await expect(CT.timeout(5).any((token) => [tracked.sleep(token, 20), tracked.sleep(token, 25)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(5).any((token) => [tracked.sleep(token, 5), tracked.sleep(token, 6)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.manual().any((token) => [tracked.sleep(token, 2, 1, true), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(2);
        await expect(CT.timeout(20).any((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);

        await expect(CT.timeout(10).any((token) => [tracked.sleep(token.timeout(5), 10), tracked.sleep(token.timeout(6), 10)], true)).rejects.toThrow(AggregateError);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(10).any((token) => [tracked.sleep(token.timeout(5), 10, true, false, true), tracked.sleep(token.timeout(6), 10, true, false, true)], true)).resolves.toHaveProperty('index', 0);
        expect(tracked.finishedReset).toBe(0);
    });

    it('static race', async () => {
        const tracked = new TrackedSleep();
        //sleep(token, time, result, error = false, doNotThrow = false)
        await expect(CT.race((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)])).rejects.toThrow('Race indexed error');
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.race((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)])).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.race((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)], true)).rejects.toThrow('Race indexed error');
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.race((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.race((token) => [tracked.sleep(token.timeout(5), 10), tracked.sleep(token.timeout(6), 10)], true)).rejects.toThrow('Race indexed error');
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.race((token) => [tracked.sleep(token.timeout(5), 10, true, false, true), tracked.sleep(token.timeout(6), 10, true, false, true)], true)).resolves.toHaveProperty('index', 0);
        expect(tracked.finishedReset).toBe(0);
    });

    it('static any', async () => {
        const tracked = new TrackedSleep();
        //sleep(token, time, result, error = false, doNotThrow = false)
        await expect(CT.any((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)])).rejects.toThrow(AggregateError);
        expect(tracked.finishedReset).toBe(2);
        await expect(CT.any((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)])).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.any((token) => [tracked.sleep(token, 2, 1, true), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(2);
        await expect(CT.any((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.any((token) => [tracked.sleep(token.timeout(5), 10), tracked.sleep(token.timeout(6), 10)], true)).rejects.toThrow(AggregateError);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.any((token) => [tracked.sleep(token.timeout(5), 10, true, false, true), tracked.sleep(token.timeout(6), 10, true, false, true)], true)).resolves.toHaveProperty('index', 0);
        expect(tracked.finishedReset).toBe(0);
    });

    it('processCancel', async () => {
        let cancelled = false;
        let token1 = CT.timeout(10);
        let token2 = token1.manual();
        let promise = new Promise((resolve, reject) => {
            token2.processCancel(resolve, reject, () => (cancelled = true), true);
        });
        let result = await promise;
        expect(result).toBe(token1);
        expect(cancelled).toBe(true);

        cancelled = false;
        token1 = CT.timeout(10);
        token2 = token1.manual();
        promise = new Promise((resolve, reject) => {
            token2.processCancel(resolve, reject, () => (cancelled = true));
        });
        await expect(promise).rejects.toThrow();
        expect(cancelled).toBe(true);
    });

    it('processCancel unsubscribe check', async () => {
        let cancelled = false;
        let token = CT.timeout(10);
        let promiseResolve, promiseReject, promise;

        promise = new Promise((resolve, reject) => {
            [promiseResolve, promiseReject] = token.processCancel(resolve, reject, () => (cancelled = true), true, true);
        });
        setTimeout(() => promiseResolve(true), 5);
        await sleep(11);
        expect(await promise).toBe(true);
        expect(cancelled).toBe(false);

        token = CT.timeout(10);
        promise = new Promise((resolve, reject) => {
            [promiseResolve, promiseReject] = token.processCancel(resolve, reject, () => (cancelled = true), true, true);
        });
                setTimeout(() => promiseReject(new Error('test')), 5);
        await expect(promise).rejects.toThrow('test');
        await sleep(10);
        expect(cancelled).toBe(false);

        token = CT.timeout(10);
        promise = new Promise((resolve, reject) => {
            [promiseResolve, promiseReject] = token.processCancel(resolve, reject, () => (cancelled = true), true, true);
        });
        setTimeout(() => promiseResolve(true), 15);
        expect(await promise).toBe(token);
        expect(cancelled).toBe(true);
    });
});
