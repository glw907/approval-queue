import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare } from '#lib/doc/compare.ts';
import { parse } from '#lib/doc/parse.ts';

const read = (path: string) => readFileSync(new URL(`../../../../docs/mockup/${path}`, import.meta.url), 'utf8');

// The three passages the record's hand-written marks show, typed from them.
const REMOVED = [
	'Two answers needed before workstation #233 and #234 merge',
	'Both pull requests are ready. Both questions are about #233, and I recommend the first option in each.',
	"because its branch is cut from #233's"
];
const ADDED = [
	'Keep an edit to a file Survey owns, and accept a test with ten findings?',
	'Two workstation pull requests are ready to merge. One of them raises two questions, and neither merges until you answer. The first, #233, updates the packet skill for rounds. The second, #234, makes the launch guard stricter. I recommend the first option in each.',
	"because #234 was built on top of #233 and can't merge before it"
];

// The plain text of every element with the tag, after the renderer's entity escapes are undone.
function texts(html: string, tag: string): string[] {
	const found = [...html.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, 'gs'))].map((m) => m[1]);
	return found.map((s) =>
		s
			.replace(/<[^>]+>/g, '')
			.replace(/&#39;/g, "'")
			.replace(/&quot;/g, '"')
			.replace(/&amp;/g, '&')
	);
}

describe('the comparison drawn by the renderer', () => {
	it('marks exactly the three passages of the second close packet', () => {
		const { marked } = compare(read('versions/20-survey-edit.sent.md'), read('content/20-survey-edit.md'));
		const { doc } = parse(marked, { changes: true });
		const html = [
			doc.titleHtml,
			...doc.segments.flatMap((s) =>
				s.type === 'html' ? [s.html] : s.type === 'question' ? s.options.map((o) => o.html) : []
			)
		].join('\n');
		expect(texts(html, 'del')).toEqual(REMOVED);
		expect(texts(html, 'ins')).toEqual(ADDED);
	});
});
