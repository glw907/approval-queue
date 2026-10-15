/** Returns the markdown under a "## Before merge" heading up to the next heading of level 1 or 2, or null. */
export function beforeMerge(body: string): string | null {
	const lines = body.split('\n');
	const start = lines.findIndex((line) => /^##\s+before merge\s*#*\s*$/i.test(line));
	if (start === -1) return null;
	const section: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (/^#{1,2}\s/.test(line)) break;
		section.push(line);
	}
	return section.join('\n').trim() || null;
}
