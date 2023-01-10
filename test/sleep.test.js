import { sleep } from '../index.js';

describe('sleep', () => {
    it('basics', async () => {
        const start = performance.now();
        const result = await sleep(30, 'test');
        const end = performance.now();
        const time = end - start - 30;
        expect(time).toBeLessThan(2);
        expect(time).toBeGreaterThanOrEqual(-1);
        expect(result).toBe('test');
        await expect(sleep(1)).resolves.toBe(true);
    });
});