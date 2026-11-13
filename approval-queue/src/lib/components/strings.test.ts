import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIRS = ['routes', 'lib/components'];
const LETTER = /\p{L}/u;
const ATTRIBUTE = /\s(aria-label|title|placeholder|alt)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Removes every `{...}` expression from `markup`, nested braces included. */
function dropExpressions(markup: string): string {
	let out = '';
	let depth = 0;
	for (const ch of markup) {
		if (ch === '{') depth++;
		else if (ch === '}' && depth > 0) depth--;
		else if (depth === 0) out += ch;
	}
	return out;
}

/** The words a component's markup shows that no `strings.ts` import supplies. */
export function strays(source: string): string[] {
	const markup = source
		.replace(/<script[\s\S]*?<\/script>/g, '')
		.replace(/<style[\s\S]*?<\/style>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '');
	const found: string[] = [];
	for (const m of markup.matchAll(ATTRIBUTE)) {
		const value = dropExpressions(m[2] ?? m[3] ?? '');
		if (LETTER.test(value)) found.push(`${m[1]}="${value}"`);
	}
	const text = dropExpressions(markup).replace(/<[^>]*>/g, '\n');
	for (const line of text.split('\n')) {
		if (LETTER.test(line)) found.push(line.trim());
	}
	return found;
}

function svelteFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
		.filter((e) => e.isFile() && e.name.endsWith('.svelte'))
		.map((e) => path.join(e.parentPath, e.name));
}

describe('strays', () => {
	it('finds a sentence written into the markup', () => {
		const fixture = '<script>let a = "fine";</script><p>{DOC.approve}</p><p>The queue is down.</p>';
		expect(strays(fixture)).toEqual(['The queue is down.']);
	});

	it('finds a label written into an attribute', () => {
		expect(strays('<button aria-label="Close" title={x}></button>')).toEqual(['aria-label="Close"']);
	});

	it('passes markup whose words all come from expressions', () => {
		expect(strays('<a href="/d/{id}" class="rail-row">{row.title}<span>{LAYOUT.rail}</span></a>')).toEqual([]);
	});
});

describe('the pages', () => {
	const files = DIRS.flatMap((d) => svelteFiles(path.join(SRC, d)));

	it('have components to read', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files.map((f) => [path.relative(SRC, f), f]))('%s holds no sentence of its own', (_name, file) => {
		expect(strays(fs.readFileSync(file, 'utf8'))).toEqual([]);
	});
});
