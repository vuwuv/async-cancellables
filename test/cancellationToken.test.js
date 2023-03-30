import EventEmitter from 'events';
import CT from '@async-cancellables/ct';

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
            } else {
                const returned = await token.sleep(time, result, doNotThrow);
                if (CT.isToken(returned)) isCancellationError = true;
                return returned;
            }
        } catch (error) {
            if (CT.isCancellationError(error)) isCancellationError = true;
            throw error;
        } finally {
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

const errorMatcher = CT.isCancellationError.bind(CT);
errorMatcher.message = 'not to be a cancellation error';
const events = new Events('test');

const errorText = 'Async call cancelled';
const tokenTypes = Object.freeze(['manual', 'timeout', 'event']);
const extendedTokenTypes = Object.freeze(['manual', 'timeout', 'event', 'null']);
const methodNames = Object.freeze(['sleep', 'wait', 'waitEvent', 'handleEvent', 'processCancel']);
const throwTypes = Object.freeze(['throw', 'noThrow']);
const expireTypes = Object.freeze(['noExpire', 'expire']);
const cancelledTypes = Object.freeze(['regular', 'cancelled']);

function tokenCall(methodName, token, timer, custom) {
    custom = custom || {};
    const doNotThrow = custom.doNotThrow;
    const result = custom.result || undefined;
    const resultNeeded = custom.hasOwnProperty('result');

    if (methodName === 'sleep') return token.sleep(timer, resultNeeded ? result : true, doNotThrow);
    else if (methodName === 'wait') return token.wait(sleep(timer, resultNeeded ? result : true), doNotThrow);
    else if (methodName === 'waitEvent') {
        const event = Symbol();
        events.timer(timer, event, resultNeeded ? result : undefined);
        return token.waitEvent(events, event, doNotThrow).then((value) => (Array.isArray(value) ? value[0] : value));
    } else if (methodName === 'handleEvent') {
        const event = Symbol();
        events.timer(timer, event, resultNeeded ? result : undefined);
        return token.handleEvent(events, event, (value) => value, doNotThrow);
    } else if (methodName === 'processCancel') {
        return new Promise((resolve, reject) => {
            let timeout;
            if (token !== CT) [resolve, reject] = token.processCancel(resolve, reject, clearTimeout.bind(null, timeout), doNotThrow);
            timeout = setTimeout(resolve.bind(null, resultNeeded ? result : undefined), timer);
        });
    }
}

function tokenCreate(tokenType, timeout, options, custom) {
    if (tokenType === 'null') return CT;
    custom = custom || {};
    const parent = custom.parent || CT;
    let token;
    if (tokenType === 'timeout') token = parent.timeout(timeout, options);
    else if (tokenType === 'manual') {
        token = parent.manual(options);
        setTimeout(() => token.cancel(), timeout);
    } else if (tokenType === 'event') {
        const event = Symbol();
        events.timer(timeout, event);
        token = parent.event(events, event, options);
    }
    if (custom.cancelled) token.cancel();
    return token;
}

describe('CancellationToken', () => {
    eachMulti(extendedTokenTypes, methodNames)('no cancellation %j', async (testName, tokenType, methodName) => {
        const result = Symbol('result');
        const token = tokenCreate(tokenType, 10);
        expect(await tokenCall(methodName, token, 3, { result })).toBe(result);
    });

    eachMulti(
        tokenTypes,
        methodNames,
        throwTypes,
        cancelledTypes
    )('doNotThrow %j', async (name, tokenType, methodName, throwType, cancelledType) => {
        const doNotThrow = throwType === 'noThrow';
        const cancelled = cancelledType === 'cancelled';
        const token = tokenCreate(tokenType, 2, undefined, { cancelled });
        const call = tokenCall(methodName, token, 10, { doNotThrow });

        if (doNotThrow) await expect(call).resolves.toBeInstanceOf(CT);
        else await expect(call).rejects.toMatchError(errorText);
    });

    eachMulti(
        extendedTokenTypes,
        methodNames,
        throwTypes,
        expireTypes,
        cancelledTypes
    )('wait methods %j', async (name, tokenType, methodName, throwType, expireType, cancelledType) => {
        const isNull = tokenType === 'null';
        const expires = expireType === 'expire';
        const doNotThrow = throwType === 'noThrow';
        const cancelled = cancelledType === 'cancelled';
        const result = Symbol('result');
        const token = tokenCreate(tokenType, 8, undefined, { cancelled });
        if (cancelled && !isNull) expect(token.cancelled).toBe(true);
        const call = tokenCall(methodName, token, expires ? 12 : 4, { doNotThrow, result });
        if (isNull || (!expires && !cancelled)) await expect(call).resolves.toBe(result);
        else if (doNotThrow) await expect(call).resolves.toBeInstanceOf(CT);
        else await expect(call).rejects.toMatchError(errorText);
    });

    eachMulti(
        tokenTypes,
        methodNames,
        ['options', 'simple'],
        ['parentCancelled', 'childCancelled'],
        ['parentCustom', 'childCustom'],
        ['parentManual', 'childManual']
    )('cancelError custom %j', async (name, tokenType, methodName, initType, tokenCancelled, tokenCustom, tokenManual) => {
        const createError = (token) => new Error('custom error');
        const timeout = 7;
        const options = initType === 'options' ? { createError } : createError;
        const parentCustom = tokenCustom === 'parentCustom';
        const parentManual = tokenManual === 'parentManual';
        const parentCancelled = tokenCancelled === 'parentCancelled';

        const parent = parentManual ? CT.manual(parentCustom ? options : undefined) : tokenCreate(tokenType, timeout, parentCustom ? options : undefined);
        const token = parentManual
            ? tokenCreate(tokenType, timeout, parentCustom ? undefined : options, { parent })
            : parent.manual(parentCustom ? undefined : options);

        if (parentCancelled === parentManual) setTimeout(() => (parentManual ? parent : token).cancel(), 3);

        const call = tokenCall(methodName, token, 15);

        for (let i = 0; i < 2; i++) {
            if (parentCancelled && parentCustom || !parentCancelled && !parentCustom) await expect(call).rejects.toMatchError('custom error');
            else await expect(call).rejects.toMatchError(errorText);
        }
    });

    eachMulti(
        tokenTypes,
        methodNames,
        ['symbolName', 'stringName'],
        ['parentCancelled', 'childCancelled'],
        ['parentCustom', 'childCustom'],
        ['parentManual', 'childManual'],
    )(`cancelError named %j`, async (testName, tokenType, methodName, nameType, tokenCancelled, tokenCustom, tokenManual) => {
        const tokenName = 'test cause';
        const name = nameType === 'symbolName' ? Symbol(tokenName) : tokenName;
        const parentCustom = tokenCustom === 'parentCustom';
        const parentManual = tokenManual === 'parentManual';
        const parentCancelled = tokenCancelled === 'parentCancelled';
        const timeout = 7;
        const timer = 10;

        const parent = parentManual ? CT.manual(parentCustom ? name : undefined) : tokenCreate(tokenType, timeout, parentCustom ? name : undefined);
        const token = parentManual
            ? tokenCreate(tokenType, timeout, parentCustom ? undefined : name, { parent })
            : parent.manual(parentCustom ? undefined : name);

        if (parentCancelled === parentManual) setTimeout(() => (parentManual ? parent : token).cancel(), 3);

        const call = tokenCall(methodName, token, timer);

        for (let i = 0; i < 2; i++) {
            if (parentCancelled && parentCustom || !parentCancelled && !parentCustom) await expect(call).rejects.toMatchError(`${errorText} (${tokenName})`);
            else await expect(call).rejects.toMatchError(errorText);
        }

        if (parent.cancelled) expect(parent.cancelledBy).toBe(parent);
        expect(token.cancelledBy).toBe(parentCancelled ? parent : token);
    });

    it.each([tokenTypes])('target promise rejected %p token', async (name) => {
        const timeout = 30;
        const event = Symbol();
        let token = name === 'timeout' ? CT.timeout(timeout) : name === 'manual' ? CT.manual() : CT.event(events, event);
        events.timer(timeout, true);
        await expect(token.wait(sleepError(15, 'error message'))).rejects.toMatchError('error message');
    });

    eachMulti(tokenTypes, ['simple', 'options'])('token name %j token', async (testName, methodType, nameType) => {
        const timeout = 5;
        const name = nameType === 'options' ? { name: 'test' } : 'test';
        let token = tokenCreate(methodType, timeout, name);
        let thrown = await CT.catchCancelError(token.wait(sleep(10)));
        expect(thrown.name).toBe('test');

        const parent = CT.manual();
        expect(parent.name).toBe(null);
        token = tokenCreate(methodType, timeout, name, { parent });
        thrown = await CT.catchCancelError(token.wait(sleep(10)));
        expect(thrown.name).toBe('test');
    });

    eachMulti(tokenTypes, methodNames, ['stringName', 'symbolName'])('error marker %j token', async (testName, tokenType, methodName, nameType) => {
        const timeout = 2;
        const timer = 5;
        const name = nameType === 'stringName' ? 'test' : Symbol('test');
        const token = tokenCreate(tokenType, timeout, name);

        for (let i = 0; i < 2; i++) {
            try {
                await tokenCall(methodName, token, timer);
            }
            catch (error) {
                expect(error.token).toBe(token);
                expect(error.marker).toBe(name);
            }
        }
    });

    it.each([tokenTypes])('options.parents %p token', async (name) => {
        const timeout = 45;
        const event = Symbol();
        let parentToken = CT.timeout(15);
        let arg = { parents: [parentToken] };
        let token = name === 'timeout' ? CT.timeout(timeout, arg) : name === 'manual' ? CT.manual(arg) : CT.event(events, event, arg);
        events.timer(timeout, event);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        let thrown = await CT.catchCancelError(token.wait(sleep(30)));
        expect(thrown).toBe(parentToken);

        events.clear();
        const sourceToken = CT.manual();
        parentToken = CT.timeout(15);
        arg = { parents: [parentToken] };
        token = name === 'timeout' ? sourceToken.timeout(timeout, arg) : name === 'manual' ? sourceToken.manual(arg) : sourceToken.event(events, event, arg);
        events.timer(timeout, event);
        if (name === 'manual') setTimeout(() => token.cancel(), timeout);
        thrown = await CT.catchCancelError(token.wait(sleep(30)));
        expect(thrown).toBe(parentToken);
    });

    it.each([['addOnce'], ['addMulti'], ['init'], ['childInit']])('multiparent %p token', async (name) => {
        const create = function (...tokens) {
            let child;

            if (name === 'addOnce') {
                tokens = tokens.concat(...tokens.slice(tokens.length < 2 ? 0 : tokens.length === 2 ? 1 : 2));
                child = CT.manual().attachTo(...tokens);
            } else if (name === 'addMulti') {
                child = CT.manual();
                for (let i = 0; i < tokens.length - 1; i++) child = child.attachTo(tokens[i], tokens[i + 1]);
            } else if (name === 'init') {
                tokens = tokens.concat(...tokens.slice(tokens.length < 2 ? 0 : tokens.length === 2 ? 1 : 2));
                child = CT.manual(tokens);
            } else if (name === 'childInit') {
                tokens = tokens.concat(...tokens.slice(tokens.length < 2 ? 0 : tokens.length === 2 ? 1 : 2));
                if (tokens.length) child = tokens[0].manual(tokens.slice(1));
                else child = CT.manual(tokens);
            }

            return child;
        };

        let parent1 = CT.manual(),
            parent2 = CT.manual(),
            parent3 = CT.manual();
        let child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent1.cancel();
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3);
        parent2.cancel();
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3);
        parent3.cancel();
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent3);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3, null);
        parent1.cancel();
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3, null);
        parent2.cancel();
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3, null);
        parent3.cancel();
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent3);

        expect(() => create(parent1, 'test', parent3, undefined, null)).toThrow();
        expect(() => create(parent1, false, parent3, undefined, null)).toThrow();
        expect(() => create(parent1, 0, parent3, undefined, null)).toThrow();
        expect(() => create(parent1, undefined, parent3, undefined, null)).toThrow();

        (parent1 = CT.manual()), (parent2 = CT.manual().cancel()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        (parent1 = CT.manual()), (parent2 = CT.manual().cancel()), (parent3 = CT.manual().cancel());
        child = create(parent1, parent2, parent3);
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        (parent1 = CT.manual().cancel()), (parent2 = CT.manual().cancel()), (parent3 = CT.manual());
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
        parent3.on('cancel', () => (counter += 1));
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
        const create = function (...tokens) {
            let child = CT.manual();

            if (name === 'oneByOne' || name === 'oneByOneDetachReverse') {
                for (let token of tokens) child.attachTo(token);
            } else if (name === 'oneByOneAttachReverse') {
                for (let token of tokens.reverse()) child.attachTo(token);
            } else if (name === 'allAtOnce') {
                child.attachTo(...tokens);
            }

            return child;
        };

        const detach = function (child, ...tokens) {
            if (name === 'oneByOne' || name === 'oneByOneAttachReverse') {
                for (let token of tokens) child.detachFrom(token);
            } else if (name === 'oneByOneDetachReverse') {
                for (let token of tokens.reverse()) child.detachFrom(token);
            } else if (name === 'allAtOnce') {
                child.detachFrom(...tokens);
            }

            return child;
        };

        let parent1 = CT.manual(),
            parent2 = CT.manual(),
            parent3 = CT.manual();
        let child = create(parent1, parent2, parent3);
        detach(child, parent1, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent1.cancel();
        expect(child.cancelled).toBe(false);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3);
        detach(child, parent1, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent2.cancel();
        expect(child.cancelled).toBe(false);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3);
        detach(child, parent1, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent3.cancel();
        expect(child.cancelled).toBe(false);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3);
        detach(child, parent2, parent3);
        expect(child.cancelled).toBe(false);
        parent1.cancel();
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent1);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
        child = create(parent1, parent2, parent3);
        detach(child, parent1, parent3);
        expect(child.cancelled).toBe(false);
        parent2.cancel();
        expect(child.cancelled).toBe(true);
        expect(child.cancelledBy).toBe(parent2);

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
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

        (parent1 = CT.manual()), (parent2 = CT.manual()), (parent3 = CT.manual());
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
        await expect(token.catchCancelError(token.wait(sleepError(10, 'error message')))).rejects.toMatchError('error message');
    });

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

        await expect(token3.wait(sleep(50, 'finished'))).rejects.toMatchError(errorText);

        expect(() => token1.throwIfCancelled()).toThrow(errorText);
        expect(() => token2.throwIfCancelled()).toThrow(errorText);
        expect(() => token3.throwIfCancelled()).toThrow(errorText);
    });

    it('sleep and static sleep', async () => {
        await expect(CT.timeout(10).sleep(5)).resolves.toBe(true);
        await expect(CT.timeout(10).sleep(5, 'test')).resolves.toBe('test');
        await expect(CT.timeout(5).sleep(10, true)).rejects.toMatchError(errorText);
    });

    it('race', async () => {
        const tracked = new TrackedSleep();
        //sleep(token, time, result, error = false, doNotThrow = false)
        await expect(
            CT.manual()
                .cancel()
                .race((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)])
        ).rejects.toMatchError(errorText);
        expect(tracked.calledReset).toBe(0);
        await expect(CT.timeout(5).race((token) => [tracked.sleep(token, 20), tracked.sleep(token, 25)])).rejects.toMatchError(errorText);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(5).race((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)])).rejects.toMatchError(errorText);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.manual().race((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)])).rejects.toMatchError(
            'Race indexed error'
        );
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.timeout(20).race((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)])).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);

        tracked.calledReset;

        await expect(
            CT.manual()
                .cancel()
                .race((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)], true)
        ).resolves.toBeInstanceOf(CT);
        expect(tracked.calledReset).toBe(0);
        await expect(CT.timeout(5).race((token) => [tracked.sleep(token, 20), tracked.sleep(token, 25)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(5).race((token) => [tracked.sleep(token, 5), tracked.sleep(token, 6)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.manual().race((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)], true)).rejects.toMatchError(
            'Race indexed error'
        );
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.timeout(20).race((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);

        await expect(CT.timeout(10).race((token) => [tracked.sleep(token.timeout(5), 10), tracked.sleep(token.timeout(6), 10)], true)).rejects.toMatchError(
            'Race indexed error'
        );
        expect(tracked.finishedReset).toBe(0);
        await expect(
            CT.timeout(10).race(
                (token) => [tracked.sleep(token.timeout(5), 10, true, false, true), tracked.sleep(token.timeout(6), 10, true, false, true)],
                true
            )
        ).resolves.toHaveProperty('index', 0);
        expect(tracked.finishedReset).toBe(0);
    });

    it('any', async () => {
        const tracked = new TrackedSleep();
        //sleep(token, time, result, error = false, doNotThrow = false)
        await expect(
            CT.manual()
                .cancel()
                .any((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)])
        ).rejects.toMatchError(errorText);
        expect(tracked.calledReset).toBe(0);
        await expect(CT.timeout(5).any((token) => [tracked.sleep(token, 20), tracked.sleep(token, 25)])).rejects.toMatchError(errorText);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(5).any((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)])).rejects.toMatchError(errorText);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.manual().any((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)])).rejects.toMatchError(
            AggregateError
        );
        expect(tracked.finishedReset).toBe(2);
        await expect(CT.timeout(20).any((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)])).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);

        tracked.calledReset;

        await expect(
            CT.manual()
                .cancel()
                .any((token) => [tracked.sleep(token, 5), tracked.sleep(token, 5)], true)
        ).resolves.toBeInstanceOf(CT);
        expect(tracked.calledReset).toBe(0);
        await expect(CT.timeout(5).any((token) => [tracked.sleep(token, 20), tracked.sleep(token, 25)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.timeout(5).any((token) => [tracked.sleep(token, 5), tracked.sleep(token, 6)], true)).resolves.toBeInstanceOf(CT);
        expect(tracked.finishedReset).toBe(0);
        await expect(CT.manual().any((token) => [tracked.sleep(token, 2, 1, true), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(2);
        await expect(CT.timeout(20).any((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);

        await expect(CT.timeout(10).any((token) => [tracked.sleep(token.timeout(5), 10), tracked.sleep(token.timeout(6), 10)], true)).rejects.toMatchError(
            AggregateError
        );
        expect(tracked.finishedReset).toBe(0);
        await expect(
            CT.timeout(10).any(
                (token) => [tracked.sleep(token.timeout(5), 10, true, false, true), tracked.sleep(token.timeout(6), 10, true, false, true)],
                true
            )
        ).resolves.toHaveProperty('index', 0);
        expect(tracked.finishedReset).toBe(0);
    });

    it('static race', async () => {
        const tracked = new TrackedSleep();
        //sleep(token, time, result, error = false, doNotThrow = false)
        await expect(CT.race((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)])).rejects.toMatchError(
            'Race indexed error'
        );
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.race((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)])).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.race((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)], true)).rejects.toMatchError(
            'Race indexed error'
        );
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.race((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.race((token) => [tracked.sleep(token.timeout(5), 10), tracked.sleep(token.timeout(6), 10)], true)).rejects.toMatchError(
            'Race indexed error'
        );
        expect(tracked.finishedReset).toBe(0);
        await expect(
            CT.race((token) => [tracked.sleep(token.timeout(5), 10, true, false, true), tracked.sleep(token.timeout(6), 10, true, false, true)], true)
        ).resolves.toHaveProperty('index', 0);
        expect(tracked.finishedReset).toBe(0);
    });

    it('static any', async () => {
        const tracked = new TrackedSleep();
        //sleep(token, time, result, error = false, doNotThrow = false)
        await expect(CT.any((token) => [tracked.sleep(token, 2, 'error', true), tracked.sleep(token, 5, 'error', true)])).rejects.toMatchError(AggregateError);
        expect(tracked.finishedReset).toBe(2);
        await expect(CT.any((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)])).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.any((token) => [tracked.sleep(token, 2, 1, true), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(2);
        await expect(CT.any((token) => [tracked.sleep(token, 7, 1), tracked.sleep(token, 5, 2)], true)).resolves.toEqual({ index: 1, value: 2 });
        expect(tracked.finishedReset).toBe(1);
        await expect(CT.any((token) => [tracked.sleep(token.timeout(5), 10), tracked.sleep(token.timeout(6), 10)], true)).rejects.toMatchError(AggregateError);
        expect(tracked.finishedReset).toBe(0);
        await expect(
            CT.any((token) => [tracked.sleep(token.timeout(5), 10, true, false, true), tracked.sleep(token.timeout(6), 10, true, false, true)], true)
        ).resolves.toHaveProperty('index', 0);
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
        await expect(promise).rejects.toMatchError(errorText);
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
        await expect(promise).rejects.toMatchError('test');
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
