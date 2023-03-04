import { jest } from '@jest/globals';

import EventEmitter from 'node:events';
import CT, { sleep } from '@async-cancellables/ct';

const events = new EventEmitter();
const EventProxy = CT.EventProxy;

class Counter {
    #count = 0;

    get count() {
        return this.#count;
    }

    increase(value = 1) {
        this.#count += value;
    }

    reset() {
        this.#count = 0;
    }
}

async function stressTest() {
    const target = new EventEmitter();
    const reps = 10, count = 10000;

    for (let c = 0; c < reps; c++) {
        for (let i = 0; i < count; i++) {
            const counter = new Counter();
            const ref = new WeakRef(counter);
            EventProxy.once(target, 'test', ref, counter.increase);
        }
        await sleep(100);
        consoleLog(`count: ${EventProxy.count}`);
    }

    expect(EventProxy.count).toBeLessThan(reps * count);

    target.emit('test', 1);
}

async function timeTest() {
    const target = new EventEmitter();

    for (let i = 0; i < 1000; i++) {
        consoleLog(`${i}: ${EventProxy.addSpeed} - ${EventProxy.count}`);
        const counter = new Counter();
        const ref = new WeakRef(counter);
        EventProxy.once(target, 'test', ref, counter.increase);
        await sleep(i > 900 ? 1000 : 20);
        expect(performance.now() - EventProxy.lastCleaned).toBeLessThan(30 * 1000);
    }
    consoleLog(`count: ${EventProxy.count}`);
    for (let i = 0; i < 200; i++) await sleep(1000);
    expect(performance.now() - EventProxy.lastCleaned).toBeLessThan(30 * 1000);
    consoleLog(`count: ${EventProxy.count}`);
    target.emit('test', 1);
    expect(EventProxy.count).toBe(0);
    consoleLog(`count: ${EventProxy.count}`);
}

describe('EventProxy', () => {
    if (process.env.STRESS_TEST) {
        jest.setTimeout(500 * 1000);
        it('stress test', async () => {
            await stressTest();
            await timeTest();
        });
    }
    else {
        it('dup check', async () => {
            const counter = new Counter();
            const ref = new WeakRef(counter);

            EventProxy.once(events, 'test', ref, counter.increase);
            events.emit('test', 1);
            events.emit('test', 2);

            expect(counter.count).toBe(1);

            EventProxy.once(events, 'test', ref, counter.increase);
            events.emit('test', 3);
            events.emit('test', 4);

            expect(counter.count).toBe(4);

            EventProxy.once(events, 'test', ref, counter.increase);
            EventProxy.once(events, 'test', ref, counter.increase);
            EventProxy.once(events, 'test', ref, counter.increase);
            events.emit('test', 5);
            events.emit('test', 6);

            expect(counter.count).toBe(19);
        });

        it('off', async () => {
            const counter = new Counter();
            const ref = new WeakRef(counter);
            let subs = []

            subs.push(EventProxy.once(events, 'test', ref, counter.increase));
            subs.push(EventProxy.once(events, 'test', ref, counter.increase));
            subs.push(EventProxy.once(events, 'test', ref, counter.increase));
            subs.forEach(sub => EventProxy.off(sub));
            events.emit('test', 1);
            events.emit('test', 2);

            expect(counter.count).toBe(0);
        });
    }
});