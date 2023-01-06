import { AsyncLock, CancellationToken } from '../index.js';

async function delay(ms, param) {
    return new Promise((resolve, reject) => setTimeout(() => resolve(param), ms));
}

const symbol = Symbol();

async function checkPromises(promises) {
    let results = [];
    for (let promise of promises) results.push(await Promise.race([promise, delay(1, symbol)]));
    return results;
}

async function callFor(asyncLock, promise, time) {
    const ticket = await promise;
    if (CancellationToken.isToken(ticket)) return ticket;
    await delay(time);
    asyncLock.release(ticket);
    return true;
}

describe('AsyncValue', () => {
    it('basic locks', async () => {
        let asyncLock = new AsyncLock(),
            results,
            promises;

        expect(asyncLock.availableSlots).toBe(1);
        let ticket = await asyncLock.waitOne();
        expect(asyncLock.availableSlots).toBe(0);
        asyncLock.release(ticket);
        expect(asyncLock.availableSlots).toBe(1);

        promises = [
            callFor(asyncLock, asyncLock.waitOne(), 40),
            callFor(asyncLock, asyncLock.waitOne(), 20),
            callFor(asyncLock, asyncLock.waitOne(), 60),
            callFor(asyncLock, asyncLock.waitOne(), 80),
        ];

        results = await checkPromises(promises);
        expect(results).toEqual([symbol, symbol, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(40);
        results = await checkPromises(promises);
        expect(results).toEqual([true, symbol, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(20);
        results = await checkPromises(promises);
        expect(results).toEqual([true, true, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(60);
        results = await checkPromises(promises);
        expect(results).toEqual([true, true, true, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(80);
        results = await checkPromises(promises);
        expect(results).toEqual([true, true, true, true]);
        expect(asyncLock.availableSlots).toBe(1);

        asyncLock = new AsyncLock(2);

        promises = [
            callFor(asyncLock, asyncLock.wait(1), 40),
            callFor(asyncLock, asyncLock.wait(2), 20),
            callFor(asyncLock, asyncLock.wait(1), 80),
            callFor(asyncLock, asyncLock.wait(1), 60),
        ];

        results = await checkPromises(promises);
        expect(results).toEqual([symbol, symbol, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(1);

        await delay(40);
        results = await checkPromises(promises);
        expect(results).toEqual([true, symbol, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(20);
        results = await checkPromises(promises);
        expect(results).toEqual([true, true, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(60);
        results = await checkPromises(promises);
        expect(results).toEqual([true, true, symbol, true]);
        expect(asyncLock.availableSlots).toBe(1);

        await delay(60);
        results = await checkPromises(promises);
        expect(results).toEqual([true, true, true, true]);
        expect(asyncLock.availableSlots).toBe(2);

        asyncLock = new AsyncLock(2);

        promises = [
            callFor(asyncLock, asyncLock.wait(1), 40),
            callFor(asyncLock, asyncLock.wait(2), 40),
            callFor(asyncLock, asyncLock.wait(1), 20),
            callFor(asyncLock, asyncLock.wait(1, 1), 60),
        ];

        results = await checkPromises(promises);
        expect(results).toEqual([symbol, symbol, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(40);
        results = await checkPromises(promises);
        expect(results).toEqual([true, symbol, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(1);

        await delay(20);
        results = await checkPromises(promises);
        expect(results).toEqual([true, symbol, symbol, true]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(40);
        results = await checkPromises(promises);
        expect(results).toEqual([true, true, symbol, true]);
        expect(asyncLock.availableSlots).toBe(1);

        await delay(20);
        results = await checkPromises(promises);
        expect(results).toEqual([true, true, true, true]);
        expect(asyncLock.availableSlots).toBe(2);

        asyncLock = new AsyncLock(2);
        await expect(async () => asyncLock.wait(3)).rejects.toThrow();

        asyncLock.wait(1);
        asyncLock.wait(2)
        expect(() => asyncLock.totalSlots = 1).toThrow();
    });

    it('int checks', async () => {
        let asyncLock;
        
        expect(() => new AsyncLock(3.5)).toThrow();
        expect(() => asyncLock = new AsyncLock(1)).not.toThrow();

        expect(() => asyncLock.totalSlots = 1.5).toThrow();
        expect(() => asyncLock.totalSlots = 1).not.toThrow();

        await expect(async () => asyncLock.wait(1.5, 1.5)).rejects.toThrow();
        await expect(async () => asyncLock.wait(1, 1.5)).resolves;
    });

    it('locks with cancellation', async () => {
        let asyncLock = new AsyncLock(),
            results,
            promises;

        let token1, token2;

        token1 = CancellationToken.timeout(40);
        token2 = CancellationToken.timeout(70);

        promises = [
            callFor(asyncLock, asyncLock.waitOne(), 100),
            callFor(asyncLock, asyncLock.waitOne(token1), 20),
            callFor(asyncLock, asyncLock.waitOne(token2), 60),
            callFor(asyncLock, asyncLock.waitOne(), 20),
        ];

        results = await checkPromises(promises);
        expect(results).toEqual([symbol, symbol, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(40);
        results = await checkPromises(promises);
        expect(results).toEqual([symbol, token1, symbol, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(30);
        results = await checkPromises(promises);
        expect(results).toEqual([symbol, token1, token2, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(30);
        results = await checkPromises(promises);
        expect(results).toEqual([true, token1, token2, symbol]);
        expect(asyncLock.availableSlots).toBe(0);

        await delay(20);
        results = await checkPromises(promises);
        expect(results).toEqual([true, token1, token2, true]);
        expect(asyncLock.availableSlots).toBe(1);

        callFor(asyncLock, asyncLock.waitOne(), 70);
        await expect(async () => asyncLock.waitOne(CancellationToken.timeout(20).enableThrow())).rejects.toThrow();
        await expect(async () => asyncLock.wait(1, 0, CancellationToken.timeout(20).enableThrow())).rejects.toThrow();
    });
});
