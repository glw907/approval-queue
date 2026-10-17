/**
 * Counts down `ms`, calling `tick` with the whole seconds left each second and `fire` once at the
 * end. `pause` freezes the time left and `resume` carries on from it. `flush` ends the countdown
 * early and fires; after a fire or a cancel, nothing does anything.
 */
export function startHold(
	ms: number,
	{ tick, fire }: { tick: (secondsLeft: number) => void; fire: () => void }
): { cancel: () => void; flush: () => void; pause: () => void; resume: () => void } {
	let left = ms;
	let startedAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let paused = false;
	let done = false;
	const stop = () => {
		done = true;
		clearTimeout(timer);
	};
	// Each step runs to the next whole second left, so a resume lands back on the second boundaries.
	const run = () => {
		const wait = left % 1000 || 1000;
		startedAt = Date.now();
		timer = setTimeout(() => {
			left -= wait;
			if (left > 0) {
				tick(left / 1000);
				run();
				return;
			}
			stop();
			fire();
		}, wait);
	};
	run();
	return {
		cancel: stop,
		flush: () => {
			if (done) return;
			stop();
			fire();
		},
		pause: () => {
			if (done || paused) return;
			paused = true;
			clearTimeout(timer);
			left -= Date.now() - startedAt;
		},
		resume: () => {
			if (done || !paused) return;
			paused = false;
			run();
		}
	};
}
