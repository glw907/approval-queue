import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, queuePort } from './port.ts';

describe('queuePort', () => {
	it('serves 7907 when the variable is unset or empty', () => {
		expect(DEFAULT_PORT).toBe(7907);
		expect(queuePort(undefined)).toBe(7907);
		expect(queuePort('')).toBe(7907);
	});

	it('reads a port number', () => {
		expect(queuePort('7927')).toBe(7927);
	});

	it.each(['abc', '0', '70000', '79.07', '-1', ' 7927'])('refuses %j', (value) => {
		expect(() => queuePort(value)).toThrow('APPROVAL_QUEUE_PORT');
	});
});
