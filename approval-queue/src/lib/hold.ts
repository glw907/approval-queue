/** Counts down `ms`, calling `tick` with the whole seconds left each second and `fire` once at the end. */
export function startHold(
	ms: number,
	{ tick, fire }: { tick: (secondsLeft: number) => void; fire: () => void }
): { cancel: () => void } {
	const end = Date.now() + ms;
	const timer = setInterval(() => {
		const left = Math.round((end - Date.now()) / 1000);
		if (left > 0) {
			tick(left);
			return;
		}
		clearInterval(timer);
		fire();
	}, 1000);
	return { cancel: () => clearInterval(timer) };
}
