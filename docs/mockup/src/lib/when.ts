const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "today at 08:16", or "on 11 November at 21:25" for another day. */
export function when(iso: string, now = new Date()): string {
	const d = new Date(iso);
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	if (d.toDateString() === now.toDateString()) return `today at ${time}`;
	return `on ${d.getDate()} ${MONTHS[d.getMonth()]} at ${time}`;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export const count = (n: number) => WORDS[n] ?? String(n);
