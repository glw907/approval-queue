/**
 * Counts down `ms`, calling `tick` with the whole seconds left each second and `fire` once at the
 * end. `flush` ends the countdown early and fires; after a fire or a cancel, neither does anything.
 */
export function startHold(
	ms: number,
	{ tick, fire }: { tick: (secondsLeft: number) => void; fire: () => void }
): { cancel: () => void; flush: () => void } {
	const end = Date.now() + ms;
	let done = false;
	const stop = () => {
		done = true;
		clearInterval(timer);
	};
	const timer = setInterval(() => {
		const left = Math.round((end - Date.now()) / 1000);
		if (left > 0) {
			tick(left);
			return;
		}
		stop();
		fire();
	}, 1000);
	return {
		cancel: stop,
		flush: () => {
			if (done) return;
			stop();
			fire();
		}
	};
}
