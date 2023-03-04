import EventEmitter from 'events';
import AsyncState from '@async-cancellables/async-state';
import CT from '@async-cancellables/ct';

async function delay(ms, param) {
    return new Promise((resolve, reject) => setTimeout(() => resolve(param), ms));
}

async function sleep(ms, returnValue = true) {
    return new Promise((resolve) => {
        setTimeout(resolve.bind(undefined, returnValue), ms);
    });
}

const symbol = Symbol();

async function checkPromises(promises) {
    let results = [];
    for (let i = 0; i < promises.length; i++) {
        let result = await Promise.any([promises[i], sleep(1, symbol)]);
        results[i] = result;
    }
    return results;
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

const emitter = new EventEmitter();

describe('AsyncState', () => {
    it.each(setNames(arraysRemoveDimensions(['manual', 'event'], ['simple', 'cancellation'])))(
        'wait/waitEmpty type %j',
        async (name, stateType, cancellationType) => {
            let state,
                timeout,
                promises,
                results,
                ct = null,
                timeoutSetResult,
                timeoutClearResult;
            const cancel = cancellationType === 'cancellation';

            if (cancel) ct = CT.timeout(10);

            if (stateType === 'manual') {
                state = AsyncState.manual();
                timeout = setTimeout(() => state.set(2), 20);
            } else {
                state = AsyncState.event(emitter, 'test1', (a, b) => a + b);
                timeout = setTimeout(() => emitter.emit('test1', 1, 1), 20);
            }

            promises = [state.wait(), state.waitEmpty(), CT.catchCancelError(state.wait(ct)), CT.catchCancelError(state.waitEmpty(ct))];
            results = await checkPromises(promises);
            expect(results).toEqual([symbol, undefined, symbol, undefined]);

            await delay(22);

            results = await checkPromises(promises);
            expect(results).toEqual(cancel ? [2, undefined, ct, undefined] : [2, undefined, 2, undefined]);

            promises = [state.wait(), state.waitEmpty(), CT.catchCancelError(state.wait(ct)), CT.catchCancelError(state.waitEmpty(ct))];
            results = await checkPromises(promises);
            expect(results).toEqual(cancel ? [2, symbol, 2, ct] : [2, symbol, 2, symbol]);

            if (cancel) ct = CT.timeout(10);

            timeout = setTimeout(() => state.clear(), 20);

            promises = [state.wait(), state.waitEmpty(), CT.catchCancelError(state.wait(ct)), CT.catchCancelError(state.waitEmpty(ct))];
            results = await checkPromises(promises);
            expect(results).toEqual(cancel ? [2, symbol, 2, symbol] : [2, symbol, 2, symbol]);

            await delay(25);

            results = await checkPromises(promises);
            expect(results).toEqual(cancel ? [2, undefined, 2, ct] : [2, undefined, 2, undefined]);

            promises = [state.wait(), state.waitEmpty(), CT.catchCancelError(state.wait(ct)), CT.catchCancelError(state.waitEmpty(ct))];
            results = await checkPromises(promises);
            expect(results).toEqual(cancel ? [symbol, undefined, ct, undefined] : [symbol, undefined, symbol, undefined]);

            if (cancel) {
                ct = CT.timeout(10);
                await expect(state.wait(ct)).rejects.toThrow();
                state.set(true);
                ct = CT.timeout(10);
                await expect(state.waitEmpty(ct)).rejects.toThrow();
                state.clear();
                await expect(state.wait(ct)).rejects.toThrow();
                state.set(true);
                await expect(state.waitEmpty(ct)).rejects.toThrow();
                await expect(state.wait(ct)).resolves.toBe(true);
                state.clear();
                await expect(state.waitEmpty(ct)).resolves.toBe(undefined);
            }
        }
    );

    it.each([['manual'], ['event']])('handleValue %p state', async (name) => {
        let state, timeout, promises, results;

        let ct1 = CT.timeout(10),
            ct2 = CT.manual().cancel();

        const handler = (value) => value + 1;

        if (name === 'manual') {
            state = AsyncState.manual();
            timeout = setTimeout(() => state.set(2), 20);
        } else {
            state = AsyncState.event(emitter, 'test', (a, b) => a + b);
            timeout = setTimeout(() => emitter.emit('test', 1, 1), 20);
        }

        promises = [
            state.handleValue(handler),
            CT.catchCancelError(state.handleValue(handler, ct1)),
            CT.catchCancelError(state.handleValue(handler, ct2)),
        ];
        results = await checkPromises(promises);

        expect(results).toEqual([symbol, symbol, ct2]);
        await sleep(22);
        results = await checkPromises(promises);
        expect(results).toEqual([3, ct1, ct2]);

        if (name === 'manual') {
            state = AsyncState.manual();
            timeout = setTimeout(() => state.set(2), 20);
        } else {
            state = AsyncState.event(emitter, 'test', (a, b) => a + b);
            timeout = setTimeout(() => emitter.emit('test', 1, 1), 20);
        }

        ct1 = CT.timeout(10);
        ct2 = CT.manual().cancel();

        await Promise.all([expect(state.handleValue(handler, ct1)).rejects.toThrow(), expect(state.handleValue(handler, ct2)).rejects.toThrow()]);
    });
});
