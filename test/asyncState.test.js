import EventEmitter from 'events';
import AsyncState from '@async-cancellables/async-state';
import CT from '@async-cancellables/ct';
import syncify from './lib/syncify';

const symbol = Symbol();

async function checkPromises(promises) {
    let results = [];
    for (let i = 0; i < promises.length; i++) {
        let result = await Promise.any([promises[i], CT.sleep(1, symbol)]);
        results[i] = result;
    }
    return results;
}

const emitter = new EventEmitter();

describe('AsyncState', () => {
    eachMulti(['manual', 'event'], ['simple', 'cancellation'])(
        'wait/waitEmpty type %j',
        async (name, stateType, cancellationType) => {
            let state,
                timeout,
                promises,
                ct = null,
                sleep,
                event = Symbol();
            const cancel = cancellationType === 'cancellation';

            if (cancel) ct = CT.timeout(10);

            if (stateType === 'manual') {
                state = AsyncState.manual();
                timeout = setTimeout(() => state.set(2), 20);
            } else {
                state = AsyncState.event(emitter, event, (a, b) => a + b);
                timeout = setTimeout(() => emitter.emit(event, 1, 1), 20);
            }

            sleep = [CT.sleep(22)];

            promises = [state.wait(), state.waitEmpty(), state.wait(ct), state.waitEmpty(ct)];
            await expect(promises).toPartiallyResolve([Pending, undefined, Pending, undefined]);
            await sleep[0];
            await expect(promises).toPartiallyResolve(cancel ? [2, undefined, ct, undefined] : [2, undefined, 2, undefined]);

            promises = [state.wait(), state.waitEmpty(), state.wait(ct), state.waitEmpty(ct)];
            await expect(promises).toPartiallyResolve(cancel ? [2, Pending, 2, ct] : [2, Pending, 2, Pending]);

            if (cancel) ct = CT.timeout(10);
            timeout = setTimeout(() => state.clear(), 20);
            sleep = [CT.sleep(25)];

            promises = [state.wait(), state.waitEmpty(), state.wait(ct), state.waitEmpty(ct)];
            await expect(promises).toPartiallyResolve(cancel ? [2, Pending, 2, Pending] : [2, Pending, 2, Pending]);
            await sleep[0];
            await expect(promises).toPartiallyResolve(cancel ? [2, undefined, 2, ct] : [2, undefined, 2, undefined]);

            promises = [state.wait(), state.waitEmpty(), state.wait(ct), state.waitEmpty(ct)];
            await expect(promises).toPartiallyResolve(cancel ? [Pending, undefined, ct, undefined] : [Pending, undefined, Pending, undefined]);

            if (cancel) {
                ct = CT.timeout(10);
                await expect(state.wait(ct)).rejects.toMatchError('Async call cancelled');
                state.set(true);
                ct = CT.timeout(10);
                await expect(state.waitEmpty(ct)).rejects.toMatchError('Async call cancelled');
                state.clear();
                await expect(state.wait(ct)).rejects.toMatchError('Async call cancelled');
                state.set(true);
                await expect(state.waitEmpty(ct)).rejects.toMatchError('Async call cancelled');
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
        await CT.sleep(22);
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

        await Promise.all([expect(state.handleValue(handler, ct1)).rejects.toMatchError('Async call cancelled'), expect(state.handleValue(handler, ct2)).rejects.toMatchError('Async call cancelled')]);
    });
});
