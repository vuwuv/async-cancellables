import { jest } from '@jest/globals';

import AsyncHybridLimit from '@async-cancellables/async-hybrid-limit';
import CT from '@async-cancellables/ct';

function usedSlots(limit, ...max) {
    return max.map((max) => limit.usedSlots(max));
}

function freeSlots(limit, ...max) {
    return max.map((max) => limit.freeSlots(max));
}

function random(length) {
    return Math.floor(Math.random() * length);
}

async function stressTest() {
    const limit = new AsyncHybridLimit();
    
    const totalWaves = 30;
    const tickets = [];
    let promises = [];
    let balance = 6;
    const log = [];
    let waves = 0;
    
    try {
        for (let i = 0; waves < totalWaves || promises.length || tickets.length ; i++){
            for (let j = 0; j < balance; j++) {
                const max = random(100) || 1;
                const slots = random(max / 4) || 1;
                //log.push([0, max, slots]);
                promises.push(Math.random() > 0.5 ? limit.waitPrioritized(max, slots, Math.random()) : limit.wait(max, slots));
            }
            
            let pending = [];
            (await promiseCheck(promises)).forEach((item, index) => item === promiseCheck.pendingSymbol ? pending.push(promises[index]) : tickets.push(item));
    
            promises = pending;
    
            for (let j = 0; j < 10 - balance; j++) {
                if (tickets.length === 0) break;
                const index = random(tickets.length);
                const ticket = tickets[index];
                //log.push([1, ticket.maxSlotCount, ticket.slotCount]);
                limit.release(ticket);
                tickets.splice(index, 1);
            }
    
            if (promises.length > 600) balance = 3;
            else if (promises.length === 0) {
                if (balance < 5) waves++;
                balance = 6;
            }
    
            if (i % 100 === 0) {
                consoleLog(`${Math.round(waves / totalWaves * 100)}% complete (${limit.usedSlots(100)} slots used, ${promises.length} promises waiting)`, false);
            }
        }

        consoleLog("");

        expect(limit.usedSlots(1000)).toBe(0);
    }
    catch (error) {
        consoleLog(error);
    
        const limit = new AsyncHybridLimit();
    
        for (let i = 0; i < log.length; i++) {
            let op = log[i];
            
            if (i === log.length - 1) 
                consoleLog();
    
            if (op[0] === 0) {
                await Promise.any([limit.wait(op[1], op[2]), settled]);
            }
            else {
                limit.release({ limit, maxSlotCount: op[1], slotCount: op[2] });
            }
        }
    }
}

describe('AsyncHybridLimit', () => {
    if (process.env.STRESS_TEST) {
        jest.setTimeout(300 * 1000);
        it('stress test', async () => {
            await stressTest();
        });
    }
    else {
        it('number checks', async () => {
            let limit = new AsyncHybridLimit();
            await expect(limit.waitOne(0)).rejects.toThrow();
            await expect(limit.waitOne(-1)).rejects.toThrow();
            await expect(limit.waitOne(true)).rejects.toThrow();
            await expect(limit.wait(0, 1)).rejects.toThrow();
            await expect(limit.wait(-1, 1)).rejects.toThrow();
            await expect(limit.wait(true, 1)).rejects.toThrow();
            await expect(limit.wait(1, 2)).rejects.toThrow();
            await expect(limit.wait(1, 0)).rejects.toThrow();
            await expect(limit.wait(1, -1)).rejects.toThrow();
            await expect(limit.wait(1, true)).rejects.toThrow();
            await expect(limit.waitPrioritized(1, 1, true)).rejects.toThrow();
            expect(limit.usedSlots(10)).toBe(0);
        });

        it('ticket checks', async () => {
            let limit = new AsyncHybridLimit(), limit2 = new AsyncHybridLimit();
            let ticket = await limit.wait(5, 2);
            ticket.release();
            expect(() => ticket.release()).toThrow();
            expect(() => limit.release(true)).toThrow();

            ticket = await limit.wait(5, 2);
            await limit2.wait(5, 2);
            expect(() => limit2.release(ticket)).toThrow();
        });

        it('usedSlots/freeSlots', async () => {
            let limit = new AsyncHybridLimit();
            let tickets = [], promises = [];

            tickets[0] = await limit.wait(1, 1);
            expect(usedSlots(limit, 1, 3, 5)).toEqual([1, 1, 1]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([0, 2, 4]);
            tickets[0].release();
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 0, 0]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 3, 5]);

            tickets[0] = await limit.wait(5, 2);
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 0, 2]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 3, 3]);
            tickets[0].release();
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 0, 0]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 3, 5]);

            tickets[0] = await limit.wait(5, 2);
            tickets[1] = await limit.wait(5, 2);
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 2, 4]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 1, 1]);
            tickets[0].release();
            tickets[1].release();
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 0, 0]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 3, 5]);

            tickets[0] = await limit.wait(5, 2);
            tickets[1] = await limit.wait(5, 2);
            tickets[2] = await limit.wait(2, 1);
            expect(usedSlots(limit, 1, 3, 5)).toEqual([1, 3, 5]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([0, 0, 0]);
            tickets[0].release();
            tickets[1].release();
            tickets[2].release();
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 0, 0]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 3, 5]);

            tickets[0] = await limit.wait(9, 5);
            tickets[1] = await limit.wait(7, 1);
            tickets[2] = await limit.wait(5, 1);
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 1, 3]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 2, 2]);
            tickets[0].release();
            tickets[1].release();
            tickets[2].release();
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 0, 0]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 3, 5]);

            tickets[1] = await limit.wait(7, 4);
            tickets[0] = await limit.wait(9, 5);
            expect(usedSlots(limit, 1, 3, 5)).toEqual([1, 3, 5]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([0, 0, 0]);
            tickets[0].release();
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 0, 2]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 3, 3]);
            tickets[1].release();
            expect(usedSlots(limit, 1, 3, 5)).toEqual([0, 0, 0]);
            expect(freeSlots(limit, 1, 3, 5)).toEqual([1, 3, 5]);

            tickets[0] = await limit.wait(25, 7);
            tickets[1] = await limit.wait(21, 2);
            tickets[2] = await limit.wait(19, 2);
            tickets[3] = await limit.wait(11, 5);
            tickets[4] = await limit.wait(9, 2);
            tickets[5] = await limit.wait(7, 2);
            expect(usedSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([0, 1, 4, 6, 8, 13, 15, 19]);
            expect(freeSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([1, 2, 2, 2, 2, 5, 5, 5]);
            tickets[6] = await limit.wait(26, 6);
            expect(usedSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([1, 3, 6, 8, 10, 18, 20, 24]);
            expect(freeSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
            tickets[6].release();
            expect(usedSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([0, 1, 4, 6, 8, 13, 15, 19]);
            expect(freeSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([1, 2, 2, 2, 2, 5, 5, 5]);
            tickets[1].release();
            expect(usedSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([0, 1, 4, 6, 8, 11, 13, 17]);
            expect(freeSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([1, 2, 2, 2, 2, 7, 7, 7]);
            tickets[2].release();
            expect(usedSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([0, 1, 4, 6, 8, 9, 11, 15]);
            expect(freeSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([1, 2, 2, 2, 2, 9, 9, 9]);
            tickets[4].release();
            expect(usedSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([0, 0, 2, 4, 6, 7, 9, 13]);
            expect(freeSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([1, 3, 4, 4, 4, 11, 11, 11]);
            tickets[5].release();
            expect(usedSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([0, 0, 0, 2, 4, 5, 7, 11]);
            expect(freeSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([1, 3, 6, 6, 6, 13, 13, 13]);
            tickets[3].release();
            expect(usedSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([0, 0, 0, 0, 0, 0, 2, 6]);
            expect(freeSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([1, 3, 6, 8, 10, 18, 18, 18]);
            tickets[0].release();
            expect(usedSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
            expect(freeSlots(limit, 1, 3, 6, 8, 10, 18, 20, 24)).toEqual([1, 3, 6, 8, 10, 18, 20, 24]);

            promises[0] = limit.wait(2, 2);
            promises[1] = limit.wait(3, 2);
            promises[2] = limit.wait(4, 2);
            tickets = await promiseCheck(promises);
            expect(usedSlots(limit, 1, 3, 4, 5)).toEqual([1, 3, 4, 4]);
            expect(freeSlots(limit, 1, 3, 4, 5)).toEqual([0, 0, 0, 1]);
        });

        it('same max', async () => {
            let limit = new AsyncHybridLimit();
            let tickets, promises;

            promises = [limit.wait(2, 1), limit.wait(20, 2), limit.wait(6, 1), limit.wait(20, 2), limit.wait(15, 1), limit.wait(20, 2)];
            tickets = await promiseCheck(promises);
            expect(usedSlots(limit, 5, 10, 15, 25)).toEqual([1, 2, 4, 9]);
            expect(freeSlots(limit, 5, 10, 15, 25)).toEqual([4, 8, 11, 16]);

            tickets[5].release();
            expect(usedSlots(limit, 5, 10, 15, 25)).toEqual([1, 2, 3, 7]);
            expect(freeSlots(limit, 5, 10, 15, 25)).toEqual([4, 8, 12, 18]);

            tickets[3].release();
            expect(usedSlots(limit, 5, 10, 15, 25)).toEqual([1, 2, 3, 5]);
            expect(freeSlots(limit, 5, 10, 15, 25)).toEqual([4, 8, 12, 20]);

            tickets[1].release();
            expect(usedSlots(limit, 5, 10, 15, 25)).toEqual([1, 2, 3, 3]);
            expect(freeSlots(limit, 5, 10, 15, 25)).toEqual([4, 8, 12, 22]);
        });

        it('insert', async () => {
            let limit = new AsyncHybridLimit();
            let tickets, promises;

            promises = [limit.wait(2, 2), limit.wait(3, 2), limit.wait(4, 2), limit.waitPrioritized(3, 1, 1), limit.wait(5, 1)];

            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 0, 0, 1, 1]);
        })

        it('order', async () => {
            let limit = new AsyncHybridLimit();
            let tickets, promises;

            promises = [limit.waitOne(1), limit.waitOne(2), limit.wait(2, 2), limit.waitOne(1)];
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 0, 0]);

            tickets[0].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 0, 0]);

            tickets[1].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 1, 0]);

            tickets[2].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 1, 1]);
            tickets[3].release();

            promises = [limit.waitOne(1), limit.wait(2, 2), limit.wait(3, 3), limit.wait(4, 2)];
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 0, 0, 0]);

            tickets[0].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 0, 0]);

            tickets[1].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 1, 0]);

            tickets[2].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 1, 1]);
            tickets[3].release();
        });

        it('priority', async () => {
            let limit = new AsyncHybridLimit();
            let tickets, promises;

            promises = [limit.waitOne(1), limit.waitOne(1), limit.waitPrioritized(1, 1, -1), limit.waitOne(1), limit.waitPrioritized(1, 1, 1)];
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 0, 0, 0, 0]);

            tickets[0].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 0, 0, 0, 1]);

            tickets[4].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 0, 0, 1]);

            tickets[1].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 0, 1, 1]);

            tickets[3].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 1, 1, 1]);
            tickets[2].release();
        });

        it('custom', async () => {
            let limit = new AsyncHybridLimit();
            let tickets, promises;

            promises = [limit.wait(10, 5), limit.wait(10, 5), limit.wait(5, 1), limit.wait(5, 1), limit.wait(3, 1)];
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 0, 0, 0]);
            expect(usedSlots(limit, 10)).toEqual([10]);
            expect(freeSlots(limit, 10)).toEqual([0]);

            tickets[0].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 1, 1, 1]);
        });

        it('slot reservation', async () => {
            let limit = new AsyncHybridLimit();
            let tickets, promises;

            promises = [limit.wait(1, 1), limit.wait(1, 1), limit.wait(2, 2), limit.wait(3, 2), limit.wait(3, 1), limit.wait(4, 1)];
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 0, 0, 0, 0, 1]);

            tickets[0].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 0, 0, 0, 1]);
        });

        it('priority + reservation', async () => {
            let limit = new AsyncHybridLimit();
            let tickets, promises;

            promises = [limit.wait(1, 1), limit.wait(1, 1), limit.wait(2, 2), limit.wait(3, 2), limit.wait(3, 1), limit.wait(4, 1)];
        });

        it('waitersPresent/waitersCount/waitersSlots', async () => {
            let limit = new AsyncHybridLimit(),
                tickets,
                promises;
            expect(limit.waitersPresent).toBe(false);
            expect(limit.waitersCount).toBe(0);
            expect(limit.waitersSlots).toBe(0);
            promises = [limit.waitOne(1), limit.waitOne(1), limit.wait(2, 2)];
            tickets = await promiseCheck(promises);
            expect(limit.waitersPresent).toBe(true);
            expect(limit.waitersCount).toBe(2);
            expect(limit.waitersSlots).toBe(3);
            tickets[0].release();
            tickets = await promiseCheck(promises);
            expect(limit.waitersPresent).toBe(true);
            expect(limit.waitersCount).toBe(1);
            expect(limit.waitersSlots).toBe(2);
            tickets[1].release();
            expect(limit.waitersPresent).toBe(false);
            expect(limit.waitersCount).toBe(0);
            expect(limit.waitersSlots).toBe(0);
        });

        it.each([['wait'], ['waitOne'], ['waitPrioritized']])('%p basic cancellation', async (name) => {
            let limit = new AsyncHybridLimit();
            let tickets, promises;
            
            let token = CT.manual();

            promises = [
                limit.waitOne(1),
                CT.catchCancelError(name === 'wait' ? limit.wait(1, 1, token) : name === 'waitOne' ? limit.waitOne(1, token) : limit.waitPrioritized(1, 1, 1, token)),
                limit.wait(3, 3),
            ];

            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 0, 0]);
            token.cancel();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 2, 0]);
            tickets[0].release();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 2, 1]);
            tickets[2].release();

            token = CT.manual();

            promises = [
                limit.wait(1, 1),
                CT.catchCancelError(limit.wait(1, 1, token)),
            ];

            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 0]);
            token.cancel();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 2]);
            tickets[0].release();
        });

        it('cancellation order', async () => {
            let limit, tickets, promises, token;

            limit = new AsyncHybridLimit();
            token = CT.manual();

            promises = [
                limit.wait(1, 1),
                CT.catchCancelError(limit.wait(2, 2, token)),
                limit.wait(3, 2),
                limit.wait(5, 3),
            ];

            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 0, 0, 0]);
            expect(limit.waitersPresent).toBe(true);
            expect(limit.waitersCount).toBe(3);
            expect(limit.waitersSlots).toBe(7);
            token.cancel();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 2, 1, 0]);
            expect(limit.waitersPresent).toBe(true);
            expect(limit.waitersCount).toBe(1);
            expect(limit.waitersSlots).toBe(3);

            limit = new AsyncHybridLimit();
            token = CT.manual();

            promises = [
                limit.wait(1, 1),
                limit.wait(2, 1),
                CT.catchCancelError(limit.wait(3, 2, token)),
                limit.wait(4, 2),
                limit.wait(6, 4),
            ];

            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 0, 0, 0]);
            expect(limit.waitersPresent).toBe(true);
            expect(limit.waitersCount).toBe(3);
            expect(limit.waitersSlots).toBe(8);
            token.cancel();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 2, 1, 0]);
            expect(limit.waitersPresent).toBe(true);
            expect(limit.waitersCount).toBe(1);
            expect(limit.waitersSlots).toBe(4);

            limit = new AsyncHybridLimit();
            token = CT.manual();

            promises = [
                limit.wait(1, 1),
                limit.wait(2, 1),
                CT.catchCancelError(limit.wait(8, 7, token)),
                limit.wait(4, 1),
                limit.wait(6, 3),
                limit.wait(8, 6),
            ];

            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 0, 0, 0, 0]);
            expect(limit.waitersPresent).toBe(true);
            expect(limit.waitersCount).toBe(4);
            expect(limit.waitersSlots).toBe(17);
            token.cancel();
            tickets = await promiseCheck(promises);
            expect(tickets).toPartiallyResolve([1, 1, 2, 1, 1, 0]);
            expect(limit.waitersPresent).toBe(true);
            expect(limit.waitersCount).toBe(1);
            expect(limit.waitersSlots).toBe(6);
        });
    }
});
