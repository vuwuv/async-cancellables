import CT from '@async-cancellables/ct';
import AsyncCooldownQueue from '@async-cancellables/async-cooldown-queue';

const timeMultiplier = 1;
const tm = (time, delta = 0) => time * timeMultiplier - delta * timeMultiplier;

expect.extend({
    toMatchTimeline(value, start, timeline, step = 5) {
        value = value.map(item => item - start);
        let pass = value.length === timeline.length;

        if (pass) {
            for (let i = 0; i < value.length; i++) {
                if (value[i] < timeline[i] - step || value[i] > (i === value.length - 1 ? value[i] : timeline[i+1] - step)) {
                    pass = false;
                    break;
                }
            }
        }

        if (pass) {
            return {
                pass: true,
            };
        } else {
            return {
                message: () => `expected ${this.utils.printReceived(value)} to match timeline ${this.utils.printExpected(timeline)}`,
                pass: false,
            };
        }
    },

    toBeBetween(value, min, max) {
        const pass = value >= min && value <= max;

        if (pass) {
            return {
                pass: true,
            };
        } else {
            return {
                message: () => `expected ${this.utils.printReceived(value)} to be between ${this.utils.printExpected(min)} and ${this.utils.printExpected(max)}`,
                pass: false,
            };
        }
    },
});

async function waitPromises(generate) {
    const results = [];
    const times = [];
    let next = 0;

    const setResult = function(index, result) {
        results[index] = result;
        times[index] = performance.now();
    };

    const then = function(promise) {
        const index = next;
        next++;
        return promise.then(setResult.bind(null, index, true), setResult.bind(null, index, false));
    }

    const start = performance.now();

    const promises = generate(then);

    if (Array.isArray(promises)) {
        for (let i = 0; i < promises.length; i++) {
            promises[i].then(setResult.bind(null, i, true), setResult.bind(null, i, false));
        }

        await Promise.allSettled(promises);
    }
    else await promises;

    return [start, results, times];
}

describe('AsyncCooldownQueue', () => {
    it('waiters information' , async () => {
        const cooldown = tm(30);
        const asyncCooldownQueue = new AsyncCooldownQueue(cooldown);
        const records = [];

        records.push([asyncCooldownQueue.waitersPresent, asyncCooldownQueue.waitersCount, asyncCooldownQueue.timeUntilAvailable]);

        asyncCooldownQueue.wait();
        asyncCooldownQueue.wait();
        asyncCooldownQueue.wait();

        records.push([asyncCooldownQueue.waitersPresent, asyncCooldownQueue.waitersCount, asyncCooldownQueue.timeUntilAvailable]);
        await CT.sleep(cooldown * 2 + 3);
        records.push([asyncCooldownQueue.waitersPresent, asyncCooldownQueue.waitersCount, asyncCooldownQueue.timeUntilAvailable]);
        await CT.sleep(cooldown);
        records.push([asyncCooldownQueue.waitersPresent, asyncCooldownQueue.waitersCount, asyncCooldownQueue.timeUntilAvailable]);

        expect(records[0][0]).toEqual(false);
        expect(records[0][1]).toEqual(0);
        expect(records[0][2]).toEqual(0);

        expect(records[1][0]).toEqual(true);
        expect(records[1][1]).toEqual(2);
        expect(records[1][2]).toBeBetween(0, cooldown * 2);

        expect(records[2][0]).toEqual(false);
        expect(records[2][1]).toEqual(0);
        expect(records[2][2]).toBeBetween(0, cooldown);

        expect(records[3][0]).toEqual(false);
        expect(records[3][1]).toEqual(0);
        expect(records[3][2]).toEqual(0);
    });

    it('basic wait', async () => {
        const cooldown = tm(25);
        const expectedResults = [true, true, true, true];
        const expectedTimes = expectedResults.map((item, index) => index * (cooldown));
        const asyncCooldownQueue = new AsyncCooldownQueue(cooldown);

        const [start, results, times] = await waitPromises(() => [
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.wait(),
        ]);

        expect(results).toEqual(expectedResults);
        expect(times).toMatchTimeline(start, expectedTimes);
    });

    it('basic waitTime', async () => {
        const cooldown = tm(25);
        const expectedResults = [true, true, true, true, true];
        const expectedTimes = [tm(0), tm(50), tm(75), tm(150), tm(175)];
        const asyncCooldownQueue = new AsyncCooldownQueue(cooldown);

        const [start, results, times] = await waitPromises(() => [
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.waitTime(tm(50)),
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.waitTime(tm(75)),
            asyncCooldownQueue.wait(),
        ]);

        expect(results).toEqual(expectedResults);
        expect(times).toMatchTimeline(start, expectedTimes);
    });

    it('basic wait cancels', async () => {
        const cooldown = tm(25);
        const expectedResults = [true, false, true, false, true];
        const expectedTimes = [tm(0), tm(10), tm(25), tm(35), tm(50)];
        const asyncCooldownQueue = new AsyncCooldownQueue(cooldown);

        const [start, results, times] = await waitPromises(() => [
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.wait(CT.timeout(tm(10))),
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.wait(CT.timeout(tm(35))),
            asyncCooldownQueue.wait(),
        ]);

        //console.log(times.map(time => time - start));

        expect(results).toEqual(expectedResults);
        expect(times).toMatchTimeline(start, expectedTimes);
    });

    it('basic waitTime with cancels', async () => {
        const cooldown = tm(25);
        const expectedResults = [true, false, true, true, false, true, true];
        const expectedTimes = [tm(0), tm(15), tm(65), tm(90), tm(110), tm(165), tm(190)];
        const asyncCooldownQueue = new AsyncCooldownQueue(cooldown);

        const [start, results, times] = await waitPromises(() => [
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.waitTime(tm(50), CT.timeout(tm(15))),
            asyncCooldownQueue.waitTime(tm(65)),
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.waitTime(tm(75), CT.timeout(tm(110))),
            asyncCooldownQueue.waitTime(tm(75)),
            asyncCooldownQueue.wait(),
        ]);

        expect(results).toEqual(expectedResults);
        expect(times).toMatchTimeline(start, expectedTimes);
    });

    it('cancel every before', async () => {
        const cooldown = tm(40);
        const expectedResults = [true, false, false, true, true];
        const expectedTimes = [tm(0), tm(15), tm(30), tm(35), tm(75)];
        const asyncCooldownQueue = new AsyncCooldownQueue(cooldown);

        const [start, results, times] = await waitPromises(() => [
            asyncCooldownQueue.wait(),
            asyncCooldownQueue.wait(CT.timeout(tm(15))),
            asyncCooldownQueue.wait(CT.timeout(tm(30))),
            asyncCooldownQueue.waitTime(tm(35)),
            asyncCooldownQueue.wait(),
        ]);

        expect(results).toEqual(expectedResults);
        expect(times).toMatchTimeline(start, expectedTimes, 2.5);
    });

    it('sleep inbetween', async () => {
        const cooldown = tm(20);
        const expectedResults = [true, true, true, true];
        const expectedTimes = [tm(0), tm(25), tm(50), tm(75)];
        const asyncCooldownQueue = new AsyncCooldownQueue(cooldown);

        const [start, results, times] = await waitPromises(async (then) => {
            await then(asyncCooldownQueue.wait());
            await CT.sleep(tm(25));
            await then(asyncCooldownQueue.wait());
            await CT.sleep(tm(25));
            await then(asyncCooldownQueue.wait());
            await CT.sleep(tm(25));
            await then(asyncCooldownQueue.wait());
        });

        expect(results).toEqual(expectedResults);
        expect(times).toMatchTimeline(start, expectedTimes, 2.5);
    });

    it('number checks', async () => {
        expect(() => new AsyncCooldownQueue(0)).toThrow();
        expect(() => new AsyncCooldownQueue(-1)).toThrow();
        expect(() => new AsyncCooldownQueue(true)).toThrow();
        const asyncCooldownQueue = new AsyncCooldownQueue(1000);
        await expect(asyncCooldownQueue.waitTime(0)).rejects.toThrow();
        await expect(asyncCooldownQueue.waitTime(-1)).rejects.toThrow();
        await expect(asyncCooldownQueue.waitTime(true)).rejects.toThrow();
    });
});
