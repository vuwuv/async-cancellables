import { CancellationToken, AsyncState } from "../index.js";

import EventEmitter from "events";

async function delay(ms, param) {
    return new Promise((resolve, reject) => setTimeout(() => resolve(param), ms));
}

const symbol = Symbol();
const settled = Promise.resolve(symbol);

async function checkPromises(promises) {
    let results = [];
    for (let i = 0; i < promises.length; i++) {
        let result = await Promise.any([promises[i], settled]);
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
        'overrideThrow %j', async (name, stateType, cancellationType) => {
        let state, timeout, promises, results, token = null, timeoutSetResult, timeoutClearResult;
        const cancel = cancellationType === 'cancellation';
        
        if (cancel) token = CancellationToken.timeout(10);

        if (stateType === 'manual') {
            state = AsyncState.manual();
            timeout = setTimeout(() => state.set(2), 20);
        }
        else {
            state = AsyncState.event(emitter, 'test', (a, b) => a + b);
            timeout = setTimeout(() => emitter.emit('test', 1, 1), 20);
        }
        
        promises = [state.wait(), state.waitEmpty(), CancellationToken.catchCancelError(state.wait(token)), CancellationToken.catchCancelError(state.waitEmpty(token))];
        results = await checkPromises(promises);
        expect(results).toEqual([symbol, undefined, symbol, undefined]);

        await delay(22);

        results = await checkPromises(promises);
        expect(results).toEqual(cancel ? [2, undefined, token, undefined] : [2, undefined, 2, undefined]);

        promises = [state.wait(), state.waitEmpty(), CancellationToken.catchCancelError(state.wait(token)), CancellationToken.catchCancelError(state.waitEmpty(token))];
        results = await checkPromises(promises);
        expect(results).toEqual(cancel ? [2, symbol, 2, token] : [2, symbol, 2, symbol]);

        if (cancel) token = CancellationToken.timeout(10);

        timeout = setTimeout(() => state.clear(), 20);

        promises = [state.wait(), state.waitEmpty(), CancellationToken.catchCancelError(state.wait(token)), CancellationToken.catchCancelError(state.waitEmpty(token))];
        results = await checkPromises(promises);
        expect(results).toEqual(cancel ? [2, symbol, 2, symbol] : [2, symbol, 2, symbol]);

        await delay(25);

        results = await checkPromises(promises);
        expect(results).toEqual(cancel ? [2, undefined, 2, token] : [2, undefined, 2, undefined]);

        promises = [state.wait(), state.waitEmpty(), CancellationToken.catchCancelError(state.wait(token)), CancellationToken.catchCancelError(state.waitEmpty(token))];
        results = await checkPromises(promises);
        expect(results).toEqual(cancel ? [symbol, undefined, token, undefined] : [symbol, undefined, symbol, undefined]);

        if (cancel) {
            token = CancellationToken.timeout(10);
            await expect(state.wait(token)).rejects.toThrow();
            state.set(true);
            token = CancellationToken.timeout(10);
            await expect(state.waitEmpty(token)).rejects.toThrow();
            state.clear();
            await expect(state.wait(token)).rejects.toThrow();
            state.set(true);
            await expect(state.waitEmpty(token)).rejects.toThrow();
            await expect(state.wait(token)).resolves.toBe(true);
            state.clear();
            await expect(state.waitEmpty(token)).resolves.toBe(undefined);
        }
    });
});
