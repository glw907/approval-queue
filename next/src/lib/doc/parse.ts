import { addresser } from '#lib/doc/address.ts';
import { faults } from '#lib/doc/faults.ts';
import { lex, plain, renderBlock, renderInline } from '#lib/doc/render.ts';
import { KINDS, type ButtonText, type Doc, type Facts, type Fault, type Heading, type Kind, type Option, type PullRequest, type Segment } from '#lib/doc/types.ts';

const PR = /^([\w.-]+\/[\w.-]+)#(\d+)\s*\|\s*(\S.*)$/;
const QUESTION = /^:::question(?:\s+(.*))?$/;
const OPTION = /^-\s+(.*?)(\s*\{recommended\})?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

interface Header {
	keys: Record<string, { value: string; line: number }>;
	prs: Facts['prs'];
	/** Index into the file's lines of the first body line. */
	bodyAt: number;
}

function readHeader(lines: string[]): Header | null {
	if (lines[0] !== '---') return null;
	const close = lines.indexOf('---', 1);
	if (close < 0) return null;
	const keys: Header['keys'] = {};
	const prs: Header['prs'] = [];
	let key = '';
	for (let i = 1; i < close; i++) {
		const item = /^\s+-\s+(.*)$/.exec(lines[i]);
		if (item) {
			if (key !== 'prs') continue;
			const text = item[1].trim();
			const m = PR.exec(text);
			const pr = m ? { repo: m[1], number: Number(m[2]), words: m[3].trim(), line: i + 1 } : null;
			prs.push({ text, line: i + 1, pr });
			continue;
		}
		const kv = /^(\w+):\s*(.*)$/.exec(lines[i]);
		if (!kv) continue;
		key = kv[1];
		keys[key] = { value: kv[2].trim(), line: i + 1 };
	}
	return { keys, prs, bodyAt: close + 1 };
}

function buttonText(value: string | undefined, changes: boolean): ButtonText | null {
	return value ? { text: value, html: renderInline(value, changes) } : null;
}

/**
 * Parses a document into what its page draws, and lists every fault but the pull-request ones.
 *
 * @remarks
 * The `doc` is a best effort whatever the faults, so a caller can show a faulty document. With
 * `changes`, the comparison's `{--x--}` and `{++y++}` marks render as `<del>` and `<ins>`;
 * without it they stay as typed.
 */
export function parse(source: string, opts: { changes?: boolean } = {}): { doc: Doc; faults: Fault[] } {
	const changes = opts.changes ?? false;
	const bytes = new TextEncoder().encode(source).length;
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	const header = readHeader(lines);
	const bodyAt = header?.bodyAt ?? 0;

	let at = bodyAt;
	while (at < lines.length && !lines[at].trim()) at++;
	const title: Facts['title'] = at < lines.length ? { line: at + 1, ok: lines[at].startsWith('# ') } : null;
	const titleText = title?.ok ? lines[at].slice(2).trim() : '';
	if (title?.ok) at++;
	else at = bodyAt;

	const segments: Segment[] = [];
	const questions: Facts['questions'] = [];
	const decides: number[] = [];
	let buf: string[] = [];
	let bufAt = -1;
	let firstHtmlAt = -1;
	let firstHtmlSrc = '';
	const flush = () => {
		const text = buf.join('\n').trim();
		if (text) {
			if (firstHtmlAt < 0) {
				firstHtmlAt = bufAt;
				firstHtmlSrc = text;
			}
			segments.push({ type: 'html', html: renderBlock(text, changes) });
		}
		buf = [];
		bufAt = -1;
	};

	// A question block or decide mark inside a code fence is text, and draws nothing.
	let fence = '';
	let firstLine = -1;
	for (let i = at; i < lines.length; i++) {
		const line = lines[i];
		if (firstLine < 0 && line.trim()) firstLine = i;
		const f = FENCE.exec(line);
		if (f && !fence) fence = f[1];
		else if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = '';
		const open = fence ? null : QUESTION.exec(line.trimEnd());
		if (open) {
			flush();
			const label = (open[1] ?? '').trim();
			const qLine = i + 1;
			const options: Option[] = [];
			let closed = false;
			// Stops at the file's end, so an unclosed block is a fault and never an endless loop.
			for (i++; i < lines.length; i++) {
				if (lines[i].trimEnd() === ':::') {
					closed = true;
					break;
				}
				const o = OPTION.exec(lines[i].trimEnd());
				if (!o) continue;
				const html = renderInline(o[1], changes);
				const bold = /<strong>(.*?)<\/strong>/s.exec(html);
				options.push({ html, label: plain(bold ? bold[1] : html).replace(/\.$/, ''), recommended: !!o[2] });
			}
			const recommended = options.filter((o) => o.recommended).length;
			questions.push({ label, line: qLine, closed, options: options.length, recommended });
			segments.push({ type: 'question', id: `q${questions.length}`, label, line: qLine, options });
		} else if (!fence && line.trimEnd() === ':::decide') {
			flush();
			decides.push(i + 1);
			if (decides.length === 1) segments.push({ type: 'decide' });
		} else {
			if (bufAt < 0 && line.trim()) bufAt = i;
			buf.push(line);
		}
	}
	flush();
	if (!decides.length) segments.push({ type: 'decide' });

	let firstBlock: Facts['firstBlock'] = null;
	let summary = '';
	if (title?.ok && firstLine >= 0) {
		const first = firstHtmlAt === firstLine ? lex(firstHtmlSrc).find((t) => t.type !== 'space') : undefined;
		firstBlock = { line: firstLine + 1, paragraph: first?.type === 'paragraph' };
		if (first?.type === 'paragraph') summary = plain(renderInline(first.text, changes));
	}

	const address = addresser();
	const titleHtml = renderInline(titleText, changes);
	const titlePlain = plain(titleHtml);
	const headings: Heading[] = [];
	const titleId = title?.ok ? address(titlePlain) : '';
	if (title?.ok) headings.push({ id: titleId, level: 1, text: titlePlain });
	// The ids go on after rendering, so a raw-HTML heading inside a <summary> gets one too.
	for (const s of segments) {
		if (s.type !== 'html') continue;
		s.html = s.html.replace(/<h([1-6])>(.*?)<\/h\1>/gs, (_, level: string, inner: string) => {
			const text = plain(inner);
			const id = address(text);
			headings.push({ id, level: Number(level) as Heading['level'], text });
			return `<h${level} id="${id}">${inner}</h${level}>`;
		});
	}

	const keys = header?.keys ?? {};
	const kindValue = keys.kind?.value ?? '';
	const kind = (KINDS as readonly string[]).includes(kindValue) ? (kindValue as Kind) : null;
	const prs = (header?.prs ?? []).flatMap((p): PullRequest[] => (p.pr ? [p.pr] : []));

	const doc: Doc = {
		kind,
		prs,
		approve: buttonText(keys.approve?.value, changes),
		sendback: buttonText(keys.sendback?.value, changes),
		title: titlePlain,
		titleHtml,
		titleId,
		summary,
		segments,
		headings,
		questions: questions.length
	};
	const facts: Facts = {
		bytes,
		header: header ? { keys: header.keys } : null,
		prs: header?.prs ?? [],
		title,
		firstBlock,
		questions,
		decides
	};
	return { doc, faults: faults(facts) };
}
