import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./DocEditor.svelte', import.meta.url), 'utf8')
	.split('<style>')[1]
	.replace(/\/\*[\s\S]*?\*\//g, '');

// The classes CodeMirror draws as whole lines or block widgets, whose boxes it measures for its height map.
const MEASURED = /\.(cm-line|cm-edited|cm-front|cm-fence|cm-in-block|cm-l-h\d|cm-gone)\b/;

/** Splits `text` at each `sep` outside parentheses. */
function splitTop(text: string, sep: RegExp): string[] {
	const parts = [''];
	let depth = 0;
	for (const ch of text) {
		if (ch === '(') depth++;
		if (ch === ')') depth--;
		if (depth === 0 && sep.test(ch)) parts.push('');
		else parts[parts.length - 1] += ch;
	}
	return parts.map((p) => p.trim()).filter(Boolean);
}

/** Whether one selector styles a measured line or widget itself, not something inside it or a pseudo-element. */
function targetsMeasured(selector: string): boolean {
	const inner = selector.match(/:global\((.*)\)\s*$/)?.[1] ?? selector;
	const last = splitTop(inner, /\s/).at(-1) ?? '';
	return MEASURED.test(last) && !last.includes('::');
}

/** Whether a rule body sets a vertical margin other than zero. */
function verticalMargin(body: string): boolean {
	for (const decl of body.split(';')) {
		const [prop, value] = decl.split(':').map((s) => s?.trim());
		if (!prop || !value) continue;
		if (/^margin-(top|bottom|block)/.test(prop) && !/^0(px)?\b/.test(value)) return true;
		if (prop === 'margin') {
			const [top, , bottom = top] = value.replace('!important', '').trim().split(/\s+/);
			if ([top, bottom].some((v) => !/^0(px)?$/.test(v))) return true;
		}
	}
	return false;
}

describe('the editor styles', () => {
	it('give no measured line or block widget a vertical margin, which would skew where a click lands', () => {
		const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
			.filter(([, sel, body]) => splitTop(sel, /,/).some(targetsMeasured) && verticalMargin(body))
			.map(([, sel]) => sel.trim());
		expect(offenders).toEqual([]);
	});
});
