import AsyncLock from '@async-cancellables/async-lock';
import CT from '@async-cancellables/ct';

async function callFor(asyncLock, promise, time) {
    const ticket = await promise;
    //f (CT.isToken(ticket)) return ticket;
    await CT.sleep(time);
    asyncLock.release(ticket);
    return true;
}

describe('AsyncLock', () => {
    it('basic locks', async () => {
        let asyncLock = new AsyncLock(),
            results,
            promises;

        expect(asyncLock.availableSlots).toBe(1);
        let ticket = await asyncLock.waitOne();
        expect(asyncLock.availableSlots).toBe(0);
        asyncLock.release(ticket);
        expect(asyncLock.availableSlots).toBe(1);

        expect(asyncLock.availableSlots).toBe(1);
        ticket = await asyncLock.waitOne();
        expect(asyncLock.availableSlots).toBe(0);
        ticket.release();
        expect(asyncLock.availableSlots).toBe(1);

        promises = [
            callFor(asyncLock, asyncLock.waitOne(), 40),
            callFor(asyncLock, asyncLock.waitOne(), 20),
            callFor(asyncLock, asyncLock.waitOne(), 60),
            callFor(asyncLock, asyncLock.waitOne(), 80),
        ];

        await expect(promises).toPartiallyResolve([Pending, Pending, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await CT.sleep(40);
        await expect(promises).toPartiallyResolve([true, Pending, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await CT.sleep(20);
        await expect(promises).toPartiallyResolve([true, true, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await CT.sleep(60);
        await expect(promises).toPartiallyResolve([true, true, true, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await CT.sleep(80);
        await expect(promises).toPartiallyResolve([true, true, true, true]);
        expect(asyncLock.availableSlots).toBe(1);

        asyncLock = new AsyncLock(2);

        promises = [
            callFor(asyncLock, asyncLock.wait(1), 40),
            callFor(asyncLock, asyncLock.wait(2), 20),
            callFor(asyncLock, asyncLock.wait(1), 80),
            callFor(asyncLock, asyncLock.wait(1), 60),
        ];

        await expect(promises).toPartiallyResolve([Pending, Pending, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(1);

        await CT.sleep(40);
        await expect(promises).toPartiallyResolve([true, Pending, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await CT.sleep(20);
        await expect(promises).toPartiallyResolve([true, true, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await CT.sleep(60);
        await expect(promises).toPartiallyResolve([true, true, Pending, true]);
        expect(asyncLock.availableSlots).toBe(1);

        await CT.sleep(60);
        await expect(promises).toPartiallyResolve([true, true, true, true]);
        expect(asyncLock.availableSlots).toBe(2);

        asyncLock = new AsyncLock(2);

        promises = [
            callFor(asyncLock, asyncLock.wait(1), 40),
            callFor(asyncLock, asyncLock.wait(2), 40),
            callFor(asyncLock, asyncLock.wait(1), 20),
            callFor(asyncLock, asyncLock.waitPrioritized(1, 1), 60),
        ];

        await expect(promises).toPartiallyResolve([Pending, Pending, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await CT.sleep(40);
        await expect(promises).toPartiallyResolve([true, Pending, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(1);

        await CT.sleep(20);
        await expect(promises).toPartiallyResolve([true, Pending, Pending, true]);
        expect(asyncLock.availableSlots).toBe(0);

        await CT.sleep(40);
        await expect(promises).toPartiallyResolve([true, true, Pending, true]);
        expect(asyncLock.availableSlots).toBe(1);

        await CT.sleep(20);
        await expect(promises).toPartiallyResolve([true, true, true, true]);
        expect(asyncLock.availableSlots).toBe(2);

        asyncLock = new AsyncLock(2);
        await expect(async () => asyncLock.wait(3)).rejects.toThrow();

        asyncLock.wait(1);
        asyncLock.wait(2);
        expect(() => (asyncLock.totalSlots = 1)).toThrow();
    });

    it('release using ticket', async () => {
        let asyncLock = new AsyncLock();
        let ticket = await asyncLock.waitOne();
        expect(asyncLock.availableSlots).toBe(0);
        ticket.release();
        expect(asyncLock.availableSlots).toBe(1);
    });

    it('int checks', async () => {
        let asyncLock;

        expect(() => new AsyncLock(3.5)).toThrow();
        expect(() => (asyncLock = new AsyncLock(1))).not.toThrow();

        expect(() => (asyncLock.totalSlots = 1.5)).toThrow();
        expect(() => (asyncLock.totalSlots = 1)).not.toThrow();

        await expect(async () => asyncLock.waitPrioritized(1.5, 1.5)).rejects.toThrow();
        await expect(async () => asyncLock.waitPrioritized(1, 1.5)).resolves;
    });

    it('locks with cancellation', async () => {
        let asyncLock = new AsyncLock(),
            promises;

        let token1, token2;

        token1 = CT.timeout(40);
        token2 = CT.timeout(70);

        promises = [
            callFor(asyncLock, asyncLock.waitOne(), 100),
            callFor(asyncLock, asyncLock.waitOne(token1), 20),
            callFor(asyncLock, asyncLock.waitOne(token2), 60),
            callFor(asyncLock, asyncLock.waitOne(), 20),
        ];

        const sleep = [CT.sleep(45), CT.sleep(75), CT.sleep(105), CT.sleep(125)];

        await expect(promises).toPartiallyResolve([Pending, Pending, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await sleep[0];
        await expect(promises).toPartiallyResolve([Pending, token1, Pending, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await sleep[1];
        await expect(promises).toPartiallyResolve([Pending, token1, token2, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await sleep[2];
        await expect(promises).toPartiallyResolve([true, token1, token2, Pending]);
        expect(asyncLock.availableSlots).toBe(0);

        await sleep[3];
        await expect(promises).toPartiallyResolve([true, token1, token2, true]);
        expect(asyncLock.availableSlots).toBe(1);

        callFor(asyncLock, asyncLock.waitOne(), 70);
        await expect(async () => asyncLock.waitOne(CT.timeout(20))).rejects.toMatchError('Async call cancelled');
        await expect(async () => asyncLock.waitPrioritized(1, 0, CT.timeout(20))).rejects.toMatchError('Async call cancelled');
    });
});
