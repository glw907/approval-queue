import { describe, expect, it } from 'vitest';
import { params } from './params.ts';

describe('id matcher', () => {
	it('accepts an item id', async () => {
		const r = await params.id['~standard'].validate('20261011T143000-4242');
		expect(r).toEqual({ value: '20261011T143000-4242' });
	});

	it.each(['..', 'a/b'])('refuses %s', async (id) => {
		const r = await params.id['~standard'].validate(id);
		expect(r).toHaveProperty('issues');
	});
});
