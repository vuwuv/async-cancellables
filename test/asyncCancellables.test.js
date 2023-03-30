import { sleep } from 'async-cancellables';

describe('async-cancellables', () => {
    it('sleep', async () => {
        await expect(sleep(5)).resolves.toBe(true);
        await expect(sleep(5, 'test')).resolves.toBe('test');
    });
});