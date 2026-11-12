/**
 * The address GitHub would give a heading of this plain text, before any repeat suffix. Text with
 * no letter or digit left gets `section`.
 */
export function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N} _-]/gu, '')
			.trim()
			.replace(/ /g, '-') || 'section'
	);
}

/**
 * Returns a function that addresses headings in the order it is called, adding `-1`, `-2`, and on
 * to a repeat. One addresser serves one document, so the title must be addressed first.
 */
export function addresser(): (text: string) => string {
	const used = new Map<string, number>();
	return (text) => {
		const base = slug(text);
		const seen = used.get(base) ?? 0;
		used.set(base, seen + 1);
		return seen ? `${base}-${seen}` : base;
	};
}
