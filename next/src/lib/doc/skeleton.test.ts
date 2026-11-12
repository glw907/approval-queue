import { describe, expect, it } from 'vitest';

describe('skeleton', () => {
	it('resolves a #lib import', async () => {
		const mod = await import('#lib/doc/skeleton.test.ts');
		expect(mod).toBeDefined();
	});
});
