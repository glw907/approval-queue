import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codeSpans, wordDiff } from './inline.ts';
import { anchors, frontMatter, headingList, outline, placeNotes, type Note } from './notes.ts';

const DOC = readFileSync(new URL('../fixtures/sample.blueprint.md', import.meta.url), 'utf8');
const NOTES = JSON.parse(readFileSync(new URL('../fixtures/sample-notes.json', import.meta.url), 'utf8')) as Note[];
const at = (name: string) => {
	const r = anchors(DOC).get(name);
	return r && DOC.slice(r[0], r[1]);
};

const slugs = (headings: string[], kind: 'blueprint' | 'page' = 'page') =>
	headingList(headings.map((h) => `## ${h}\n`).join('\n'), kind).map((h) => h.slug);

describe('heading slugs', () => {
	it.each([
		['Read the build log', 'read-the-build-log'],
		["Set a section's starting state", 'set-a-sections-starting-state'],
		['`admin.action.session_absent`', 'adminactionsession_absent'],
		['The `site-facts.json` check was skipped', 'the-site-factsjson-check-was-skipped'],
		['use foo_bar-_x_', 'use-foo_bar-x'],
		['a [link](http://x)', 'a-link']
	])('%s gives %s', (text, want) => expect(slugs([text])).toEqual([want]));

	it('gives a repeated heading -1, -2, as the page does', () => {
		expect(slugs(['Same', 'Other', 'Same', 'Same'])).toEqual(['same', 'other', 'same-1', 'same-2']);
	});

	it('seeds a blueprint with its page title, and a page with nothing', () => {
		const doc = '---\npage: Fix a slow build\n---\n\n# Fix a slow build\n';
		expect(headingList(doc, 'blueprint').map((h) => h.slug)).toEqual(['fix-a-slow-build-1']);
		expect(headingList(doc, 'page').map((h) => h.slug)).toEqual(['fix-a-slow-build']);
	});

	it('still resolves the first version’s spelling to the same range', () => {
		const doc = "## Set a section's starting state\n\n- First.\n- Second.\n\n## `Run` it\n\n- Third.\n";
		for (const kind of ['blueprint', 'page'] as const) {
			const found = anchors(doc, kind);
			for (const suffix of ['.heading', '.p0', '.p1']) {
				expect(found.get(`set-a-section-s-starting-state${suffix}`)).toEqual(found.get(`set-a-sections-starting-state${suffix}`));
			}
			expect(found.get('set-a-sections-starting-state.p1')).toBeDefined();
			expect(found.get('run-it.p0')).toBeDefined();
		}
	});

	it('lets a current key win over an alias of the same name', () => {
		const doc = "## A'b\n\n- One.\n\n## A b\n\n- Two.\n";
		const found = anchors(doc, 'page');
		expect(doc.slice(...found.get('a-b.p0')!)).toBe('Two.');
		expect(doc.slice(...found.get('ab.p0')!)).toBe('One.');
	});
});

describe('anchors', () => {
	it('names a heading by its text', () => {
		expect(at('read-the-build-log.heading')).toBe('Read the build log');
		expect(at('build-cache-miss-events.heading')).toBe('`build.cache_miss` events');
	});

	it('counts bullets, numbered steps, and rows in one sequence per heading, without trailing fact tags', () => {
		expect(at('read-the-build-log.p0')).toBe('The build log names each step and its time.');
		expect(at('read-the-build-log.p1')).toBe('A step over a minute is worth a look.');
		expect(at('find-the-slow-step.p0')).toBe('Sort the steps by time.');
		expect(at('find-the-slow-step.p1')).toBe('Open the slowest one.');
		expect(at('find-the-slow-step.p2')).toMatch(/^:::row\n[\s\S]*\n:::$/);
		expect(at('find-the-slow-step.p3')).toBe('See [the cache guide](cache.md).');
	});

	it('names a row part after its bold label', () => {
		expect(at('find-the-slow-step.p2.symptom')).toBe('The image step takes minutes.');
		expect(at('find-the-slow-step.p2.cause')).toBe('Every image is resized on every build.');
		expect(at('find-the-slow-step.p2.fix')).toBe('Cache the resized images between builds.');
	});

	it('defines nothing in front matter, a reader block, or a code block', () => {
		const names = [...anchors(DOC).keys()];
		expect(names.filter((n) => n.startsWith('fix-a-slow-build.p'))).toEqual([]);
		expect(names).not.toContain('nor-is-this-a-heading.heading');
		expect(names.filter((n) => n.startsWith('build-cache-miss-events.p'))).toEqual(['build-cache-miss-events.p0']);
	});
});

const PAGE = readFileSync(new URL('../fixtures/sample.page.md', import.meta.url), 'utf8');
const PAGE_NOTES = JSON.parse(readFileSync(new URL('../fixtures/sample-page-notes.json', import.meta.url), 'utf8')) as Note[];
const onPage = (name: string) => {
	const r = anchors(PAGE, 'page').get(name);
	return r && PAGE.slice(r[0], r[1]);
};

describe('anchors of a page', () => {
	it('names a heading by its text, and counts paragraphs from 0 under the H1', () => {
		expect(onPage('read-the-build-log.heading')).toBe('Read the build log');
		expect(onPage('fix-a-slow-build.p0')).toBe('A slow build almost always has one slow step.\nThis page shows how to find it.');
	});

	it('counts paragraphs, list items, and tables in one sequence per heading, without trailing fact tags', () => {
		expect(onPage('read-the-build-log.p0')).toBe('The build log names each step and its time. A step over a minute is worth a look.');
		expect(onPage('read-the-build-log.p1')).toBe('Sort the steps by time.');
		expect(onPage('read-the-build-log.p2')).toBe(
			'Open the slowest one, then read its output\n  for the file it was working on. :fact[cc33]\n\n  Keep the log open while you work.'
		);
		expect(onPage('read-the-build-log.p3')).toBe('| Step | Typical time |\n| ---- | ------------ |\n| Images | 40 s |\n| Pages | 5 s |');
		expect(onPage('read-the-build-log.p4')).toBeUndefined();
	});

	it('defines nothing in front matter, a directive container, or a code block, and counts blocks after them', () => {
		expect([...anchors(PAGE, 'page').keys()].sort()).toEqual([
			'cache-the-resized-images.heading',
			'cache-the-resized-images.p0',
			'cache-the-resized-images.p1',
			'fix-a-slow-build.heading',
			'fix-a-slow-build.p0',
			'read-the-build-log.heading',
			'read-the-build-log.p0',
			'read-the-build-log.p1',
			'read-the-build-log.p2',
			'read-the-build-log.p3'
		]);
		expect(onPage('cache-the-resized-images.p1')).toBe('See [the cache guide](cache.md).');
	});

	it('gives a repeated heading its own -1 key, and the first keeps the plain one', () => {
		const doc = '## Same\n\nFirst.\n\n## Same\n\nSecond.\n';
		const found = anchors(doc, 'page');
		expect(doc.slice(...found.get('same.p0')!)).toBe('First.');
		expect(doc.slice(...found.get('same-1.p0')!)).toBe('Second.');
		expect(found.size).toBe(4);
	});

	it('does not read the blueprint scheme on a page, nor the page scheme on a blueprint', () => {
		expect(anchors(DOC, 'page').has('find-the-slow-step.p2.cause')).toBe(false);
		expect(anchors(PAGE).has('read-the-build-log.p3')).toBe(false);
	});
});

describe('placeNotes', () => {
	const NOTE: Note = { id: 'Q', kind: 'info', anchor: '', title: 't', body: [] };
	const quoted = (doc: string, anchor: Note['anchor'], kind: 'blueprint' | 'page' = 'blueprint') => {
		const r = placeNotes(doc, [{ ...NOTE, anchor }], kind)[0].range;
		return r && doc.slice(r[0], r[1]);
	};

	it('places a quote on a bullet, a reader-block line, and a heading', () => {
		expect(quoted(DOC, { quote: 'A step over a minute' })).toBe('A step over a minute');
		expect(quoted(DOC, { quote: 'A developer whose site builds slowly' })).toBe('A developer whose site builds slowly');
		expect(quoted(DOC, { quote: 'Find the slow step' })).toBe('Find the slow step');
	});

	it('settles a repeated quote by its prefix, else takes the first', () => {
		const doc = '## A\n\n- Sort by time.\n- Open it. Sort by time.\n';
		const first = placeNotes(doc, [{ ...NOTE, anchor: { quote: 'Sort by time' } }])[0].range!;
		const second = placeNotes(doc, [{ ...NOTE, anchor: { quote: 'Sort by time', prefix: 'Open it. ' } }])[0].range!;
		expect(first[0]).toBe(doc.indexOf('Sort by time'));
		expect(second[0]).toBe(doc.lastIndexOf('Sort by time'));
		const suffixed = placeNotes(doc, [{ ...NOTE, anchor: { quote: 'Sort by time', suffix: '.\n- Open' } }])[0].range!;
		expect(suffixed[0]).toBe(first[0]);
	});

	it('leaves a quote that matches nothing unplaced', () => {
		expect(placeNotes(DOC, [{ ...NOTE, anchor: { quote: 'not in the document' } }])[0].range).toBeNull();
	});

	it('keeps a quote note on its line when a bullet above it splits, while a p<n> note below moves', () => {
		const before = '## Steps\n\n- One.\n- Two.\n- Three target.\n';
		const after = '## Steps\n\n- One.\n- Split.\n- Two.\n- Three target.\n';
		const notes: Note[] = [
			{ ...NOTE, id: 'A', anchor: { quote: 'Three target' } },
			{ ...NOTE, id: 'B', anchor: 'steps.p2' }
		];
		const lineOf = (doc: string, id: string) => doc.slice(0, placeNotes(doc, notes).find((n) => n.id === id)!.range![0]).split('\n').length;
		expect(lineOf(after, 'A')).toBe(lineOf(before, 'A') + 1);
		expect(quoted(after, { quote: 'Three target' })).toBe('Three target');
		expect(quoted(after, 'steps.p2')).toBe('Two.');
		expect(quoted(before, 'steps.p2')).toBe('Three target.');
	});

	it('places a page’s notes with the page scheme', () => {
		const placed = placeNotes(PAGE, PAGE_NOTES, 'page');
		const text = (id: string) => {
			const r = placed.find((n) => n.id === id)!.range!;
			return PAGE.slice(r[0], r[1]);
		};
		expect(text('R1')).toMatch(/^The build log names each step/);
		expect(text('D1')).toBe('Every image is resized on every build because the cache key includes the build time.');
		expect(text('Q1')).toMatch(/^\| Step \| Typical time \|/);
	});

	it('places each note on its anchor and leaves an unknown anchor unplaced', () => {
		const placed = placeNotes(DOC, NOTES);
		expect(placed.map((n) => n.id)).toEqual(['C1', 'D1', 'Q1', 'X1']);
		expect(placed.find((n) => n.id === 'X1')?.range).toBeNull();
		const d1 = placed.find((n) => n.id === 'D1')!.range!;
		expect(DOC.slice(d1[0], d1[1])).toBe('Every image is resized on every build.');
	});
});

describe('outline and front matter', () => {
	it('lists the second- and third-level headings outside code', () => {
		expect(outline(DOC).map((h) => [h.level, h.text])).toEqual([
			[2, 'Read the build log'],
			[3, 'Find the slow step'],
			[2, '`build.cache_miss` events']
		]);
	});

	it('reads the front matter keys', () => {
		expect(frontMatter(DOC)).toEqual({ page: 'Fix a slow build', type: 'troubleshooting', track: 'extend' });
		expect(frontMatter('# no front matter')).toEqual({});
	});
});

describe('inline', () => {
	it('splits code spans and keeps an unpaired backtick literal', () => {
		expect(codeSpans('a `b` c `d')).toEqual([
			{ text: 'a ', code: false },
			{ text: 'b', code: true },
			{ text: ' c `d', code: false }
		]);
	});

	it('diffs by word and rebuilds both sides', () => {
		const runs = wordDiff('a step over ten seconds', 'a step over a minute');
		expect(runs.filter((r) => r.op !== 'ins').map((r) => r.text).join('')).toBe('a step over ten seconds');
		expect(runs.filter((r) => r.op !== 'del').map((r) => r.text).join('')).toBe('a step over a minute');
		expect(runs[0]).toEqual({ op: 'same', text: 'a step over ' });
	});
});
