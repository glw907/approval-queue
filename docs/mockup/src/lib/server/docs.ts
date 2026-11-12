import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import type { Doc, Heading, Kind, Option, PullRequest, Segment } from '#lib/types';

const DIR = join(process.cwd(), 'content');

// Change marks. A session never types these: the queue writes them when it compares two versions.
// They are inline tokens, so a mark inside code stays as typed.
const changeMark = (name: string, open: string, close: string, tag: string) => ({
	name,
	level: 'inline' as const,
	start: (src: string) => src.indexOf(open),
	tokenizer(this: { lexer: { inlineTokens(s: string): unknown[] } }, src: string) {
		if (!src.startsWith(open)) return undefined;
		const end = src.indexOf(close, open.length);
		if (end < 0) return undefined;
		const text = src.slice(open.length, end);
		return { type: name, raw: src.slice(0, end + close.length), tokens: this.lexer.inlineTokens(text) };
	},
	renderer(this: { parser: { parseInline(t: unknown[]): string } }, token: { tokens: unknown[] }) {
		return `<${tag}>${this.parser.parseInline(token.tokens)}</${tag}>`;
	}
});

// The nine tags the GitHub Flavored Markdown specification turns into text (section 6.11).
const FILTERED = /<(?=\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?:[\s/>]|$))/gi;

marked.use({
	gfm: true,
	extensions: [changeMark('removed', '{--', '--}', 'del'), changeMark('added', '{++', '++}', 'ins')] as never,
	renderer: {
		// Struck text is <s>, so it never looks like a passage the session removed.
		del(this: { parser: { parseInline(t: unknown[]): string } }, token: { tokens: unknown[] }) {
			return `<s>${this.parser.parseInline(token.tokens)}</s>`;
		},
		html(token: { text: string }) {
			return token.text.replace(FILTERED, '&lt;');
		}
	} as never
});

const plain = (html: string) =>
	html
		.replace(/<del>.*?<\/del>\s*/gs, '')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.trim();
const inline = (s: string) => marked.parseInline(s, { async: false }) as string;
// A table scrolls inside its own frame on a narrow page, so the page itself never scrolls sideways.
const block = (s: string) =>
	(marked.parse(s, { async: false }) as string)
		.replaceAll('<table>', '<div class="table-frame" tabindex="0" role="group" aria-label="Table"><table>')
		.replaceAll('</table>', '</table></div>');

function frontMatter(raw: string): { meta: Record<string, string>; prs: string[]; body: string } {
	const m = /^---\n(.*?)\n---\n(.*)$/s.exec(raw);
	if (!m) throw new Error('A document starts with a header between two --- lines.');
	const meta: Record<string, string> = {};
	const prs: string[] = [];
	for (const line of m[1].split('\n')) {
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item) prs.push(item[1]);
		else {
			const kv = /^(\w+):\s*(.*)$/.exec(line);
			if (kv) meta[kv[1]] = kv[2];
		}
	}
	return { meta, prs, body: m[2] };
}

function parse(id: string, raw: string): Doc {
	const { meta, prs, body } = frontMatter(raw);
	const lines = body.split('\n');
	const titleAt = lines.findIndex((l) => l.startsWith('# '));
	const titleHtml = inline(lines[titleAt].slice(2));
	lines.splice(0, titleAt + 1);

	const segments: Segment[] = [];
	let buf: string[] = [];
	const flush = () => {
		const text = buf.join('\n').trim();
		if (text) segments.push({ type: 'html', html: block(text) });
		buf = [];
	};
	let q = 0;
	// A question block or decide mark inside a code fence is text, and draws nothing.
	let fence = '';
	for (let i = 0; i < lines.length; i++) {
		const f = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
		if (f && !fence) fence = f[1];
		else if (f && f[1][0] === fence[0] && f[1].length >= fence.length && lines[i].trim() === f[1]) fence = '';
		const open = fence ? null : /^:::question\s+(.*)$/.exec(lines[i]);
		if (open) {
			flush();
			const options: Option[] = [];
			for (i++; lines[i] !== ':::'; i++) {
				const o = /^-\s+(.*?)(\s*\{recommended\})?$/.exec(lines[i]);
				if (!o) continue;
				const html = inline(o[1]);
				const bold = /<strong>(.*?)<\/strong>/s.exec(html);
				options.push({ html, label: plain(bold ? bold[1] : html).replace(/\.$/, ''), recommended: !!o[2] });
			}
			segments.push({ type: 'question', id: `q${++q}`, name: open[1], options });
		} else if (!fence && lines[i] === ':::decide') {
			flush();
			segments.push({ type: 'decide' });
		} else buf.push(lines[i]);
	}
	flush();
	const kind = meta.kind as Kind;
	if (!segments.some((s) => s.type === 'decide')) segments.push({ type: 'decide' });

	// Every heading gets an address, formed the way GitHub forms one. The outline lists levels two and three.
	const outline: Heading[] = [];
	const used = new Map<string, number>();
	for (const s of segments) {
		if (s.type !== 'html') continue;
		s.html = s.html.replace(/<h([1-6])>(.*?)<\/h\1>/gs, (_, level: string, inner: string) => {
			const text = plain(inner);
			const slug = text.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/ /g, '-') || 'section';
			const seen = used.get(slug) ?? 0;
			used.set(slug, seen + 1);
			const id = seen ? `${slug}-${seen}` : slug;
			if (level === '2' || level === '3') outline.push({ id, level: Number(level) as 2 | 3, text });
			return `<h${level} id="${id}">${inner}</h${level}>`;
		});
	}

	const first = segments.find((s) => s.type === 'html');
	const para = first && first.type === 'html' ? /<p>(.*?)<\/p>/s.exec(first.html) : null;
	return {
		id,
		kind,
		repo: meta.repo,
		sent: meta.sent,
		returned: meta.returned,
		prs: prs.map((p): PullRequest => {
			const [n, name] = p.split('|').map((x) => x.trim());
			return { number: Number(n), name, url: `https://github.com/${meta.repo}/pull/${n}/files` };
		}),
		approve: inline(meta.approve ?? ''),
		sendback: inline(meta.sendback ?? ''),
		mock: meta.mock ?? '',
		titleHtml,
		title: plain(titleHtml),
		summary: para ? plain(para[1]) : '',
		segments,
		outline,
		questions: q,
		changes: (raw.match(/\{\+\+/g) ?? []).length
	};
}

export function allDocs(): Doc[] {
	return readdirSync(DIR)
		.filter((f) => f.endsWith('.md'))
		.sort()
		.map((f) => parse(f.replace(/\.md$/, ''), readFileSync(join(DIR, f), 'utf8')));
}

// A specimen has an address and stays out of the lists.
const SPECIMENS = join(process.cwd(), 'specimen');

export function oneDoc(id: string): Doc | undefined {
	if (/^[a-z-]+$/.test(id) && existsSync(join(SPECIMENS, `${id}.md`)))
		return parse(id, readFileSync(join(SPECIMENS, `${id}.md`), 'utf8'));
	return allDocs().find((d) => d.id === id);
}

export interface MergedGroup {
	tool: string;
	repo: string;
	lines: { pr: number; time: string; html: string }[];
}

export function merged(): MergedGroup[] {
	const groups = JSON.parse(readFileSync(join(DIR, 'merged.json'), 'utf8')) as {
		tool: string;
		repo: string;
		lines: { pr: number; time: string; text: string }[];
	}[];
	return groups.map((g) => ({
		...g,
		lines: g.lines.map((l) => ({ pr: l.pr, time: l.time, html: inline(l.text) }))
	}));
}
