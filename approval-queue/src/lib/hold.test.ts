import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHold } from './hold.ts';

describe('startHold', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('ticks the whole seconds left and fires once at the end', () => {
		const tick = vi.fn();
		const fire = vi.fn();
		startHold(5000, { tick, fire });
		vi.advanceTimersByTime(4000);
		expect(tick.mock.calls.map((c) => c[0])).toEqual([4, 3, 2, 1]);
		expect(fire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1000);
		expect(fire).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(10000);
		expect(fire).toHaveBeenCalledTimes(1);
		expect(tick).toHaveBeenCalledTimes(4);
	});

	it('never fires or ticks after cancel', () => {
		const tick = vi.fn();
		const fire = vi.fn();
		const hold = startHold(5000, { tick, fire });
		vi.advanceTimersByTime(2000);
		hold.cancel();
		vi.advanceTimersByTime(10000);
		expect(fire).not.toHaveBeenCalled();
		expect(tick).toHaveBeenCalledTimes(2);
	});

	it('fires at once on flush, and never again', () => {
		const tick = vi.fn();
		const fire = vi.fn();
		const hold = startHold(5000, { tick, fire });
		vi.advanceTimersByTime(2000);
		hold.flush();
		expect(fire).toHaveBeenCalledTimes(1);
		hold.flush();
		vi.advanceTimersByTime(10000);
		expect(fire).toHaveBeenCalledTimes(1);
		expect(tick).toHaveBeenCalledTimes(2);
	});
});
