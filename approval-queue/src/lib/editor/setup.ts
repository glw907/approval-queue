// The review editor: CodeMirror 6 with cairn's markdown setup (`markdown({ base: markdownLanguage })`,
// line wrapping, a highlight style), the directive marking ported from cairn-cms
// `src/lib/admin/editor-highlight.ts` (`cairnDirectivePlugin`), and the review's highlights: each
// note's text, Geoff's comments, and the author's threads, whose cards sit in the margin beside the
// editor. Every range is mapped through every change, so a highlight follows its text through edits.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension, type StateEffectType } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	keymap,
	showTooltip,
	ViewPlugin,
	WidgetType,
	type DecorationSet,
	type Tooltip,
	type ViewUpdate
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { fenceScan, fenceTokens, findInlineDirectives, frontmatterSpan, type FenceScan } from './directives.ts';
import { WIDE_MARGIN } from './margin.ts';
import type { PlacedNote, Range } from './notes.ts';

/** What the editor reports to the screen around it. */
export interface EditorHooks {
	/** The document changed, by typing, undo, or a choice that rewrote a line. */
	change(view: EditorView): void;
	/** Ctrl+S or Cmd+S in the editor. */
	save(): void;
	/** The selection moved, or the editor gained or lost focus. */
	select(view: EditorView): void;
	/** A line's height or the viewport changed, so the margin's cards may need to move. */
	geometry(): void;
	/** The Comment button beside a selection, shown where the margin is a drawer. */
	comment(): void;
}

export interface EditorOptions {
	doc: string;
	notes: PlacedNote[];
	/** The text the review opened with; "Mark the lines you changed" compares each line against it. */
	original: string;
	/** The editable region's accessible name. */
	label: string;
	decided: Record<string, number>;
	/** The corrections resolved in the margin, which lose their highlight. */
	resolved: string[];
	/** The comment and thread ranges, keyed `comment:<id>` and `thread:<id>`; a collapsed range is text that is gone. */
	comments: Record<string, Range>;
	readonly: boolean;
	/** A selection offers a Comment button where the margin is a drawer. */
	commentable: boolean;
	/**
	 * A YAML file rather than markdown: set in the monospace face with no markdown marking, and each
	 * wrapped line hangs at its own indentation so the nesting stays readable.
	 */
	yaml?: boolean;
	hooks: EditorHooks;
}

const markChangesEffect = StateEffect.define<boolean>();
const decidedEffect = StateEffect.define<Record<string, number>>();
const resolvedEffect = StateEffect.define<string[]>();
const currentEffect = StateEffect.define<string | null>();
const commentableEffect = StateEffect.define<boolean>();
const rangeEffect = StateEffect.define<{ id: string; range: Range }>();
const commentRangeEffect = StateEffect.define<{ key: string; range: Range | null }>();

/** A field holding the value its effect last set. */
const valueField = <T>(effect: StateEffectType<T>, initial: T) =>
	StateField.define<T>({
		create: () => initial,
		update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(effect) ? e.value : acc), v)
	});

const markChangesField = valueField(markChangesEffect, false);
const decidedField = valueField<Record<string, number>>(decidedEffect, {});
const resolvedField = valueField<string[]>(resolvedEffect, []);
/** The current card's key (`note:<id>`, `comment:<id>`, `thread:<id>`, or `draft`), whose highlight deepens. */
const currentField = valueField<string | null>(currentEffect, null);
const commentableField = valueField(commentableEffect, false);

/** Each note's range, mapped through every change; null for a note whose anchor named nothing. */
const rangesField = StateField.define<Record<string, Range | null>>({
	create: () => ({}),
	update(v, tr) {
		let out = v;
		if (tr.docChanged) {
			out = {};
			for (const [id, r] of Object.entries(v)) out[id] = r && [tr.changes.mapPos(r[0], 1), tr.changes.mapPos(r[1], -1)];
		}
		for (const e of tr.effects) if (e.is(rangeEffect)) out = { ...out, [e.value.id]: e.value.range };
		return out;
	}
});

/**
 * Each comment's and thread's range, and the open comment box's as `draft`, mapped as the notes'
 * are. A range whose text is deleted collapses to a point rather than going, so its card stays
 * where the text was.
 */
const commentRangesField = StateField.define<Record<string, Range>>({
	create: () => ({}),
	update(v, tr) {
		let out = v;
		if (tr.docChanged) {
			out = {};
			for (const [key, [a, b]] of Object.entries(v)) {
				const from = tr.changes.mapPos(a, 1);
				out[key] = [from, Math.max(from, tr.changes.mapPos(b, -1))];
			}
		}
		for (const e of tr.effects) {
			if (!e.is(commentRangeEffect)) continue;
			out = { ...out };
			if (e.value.range) out[e.value.key] = e.value.range;
			else delete out[e.value.key];
		}
		return out;
	}
});

/** The DOM id of a card, which its highlight's `aria-details` names. */
export const cardId = (key: string) => (key === 'draft' ? 'comment-draft' : key.replace(':', '-'));

/** A dotted rule under the line where a comment's text was, so its card has something to sit beside. */
class GoneWidget extends WidgetType {
	eq() {
		return true;
	}
	toDOM() {
		const rule = document.createElement('div');
		rule.className = 'cm-gone';
		rule.setAttribute('aria-hidden', 'true');
		return rule;
	}
}
const goneMark = Decoration.widget({ widget: new GoneWidget(), block: true, side: 2 });

function highlights(state: EditorState, notes: PlacedNote[]): DecorationSet {
	const ranges = state.field(rangesField);
	const decided = state.field(decidedField);
	const resolved = state.field(resolvedField);
	const current = state.field(currentField);
	const len = state.doc.length;
	const out = [];
	// A decided call or a resolved correction has nothing left to point at, so it loses its highlight.
	for (const note of notes) {
		const r = ranges[note.id];
		if (!r || r[0] > len || decided[note.id] !== undefined || resolved.includes(note.id)) continue;
		const to = Math.min(r[1], len);
		if (to <= r[0]) continue;
		const key = `note:${note.id}`;
		const cls = ['cm-anchor', note.kind === 'info' && 'info', current === key && 'cur'].filter(Boolean).join(' ');
		out.push(Decoration.mark({ class: cls, attributes: { 'aria-details': cardId(key) } }).range(r[0], to));
	}
	for (const [key, [a, b]] of Object.entries(state.field(commentRangesField))) {
		if (a > len) continue;
		if (b > a) {
			const cls = key === current || key === 'draft' ? 'cm-cmt cur' : 'cm-cmt';
			out.push(Decoration.mark({ class: cls, attributes: { 'aria-details': cardId(key) } }).range(a, Math.min(b, len)));
		} else out.push(goneMark.range(state.doc.lineAt(a).to));
	}
	return Decoration.set(out, true);
}

function highlightsExtension(opts: EditorOptions): Extension {
	const field = StateField.define<DecorationSet>({
		create: (state) => highlights(state, opts.notes),
		update: (v, tr) =>
			tr.docChanged ||
			tr.effects.some(
				(e) => e.is(decidedEffect) || e.is(resolvedEffect) || e.is(currentEffect) || e.is(rangeEffect) || e.is(commentRangeEffect)
			)
				? highlights(tr.state, opts.notes)
				: v,
		provide: (f) => EditorView.decorations.from(f)
	});
	return [
		rangesField.init(() => Object.fromEntries(opts.notes.map((n) => [n.id, n.range]))),
		commentRangesField.init(() => ({ ...opts.comments })),
		decidedField,
		resolvedField.init(() => opts.resolved),
		currentField,
		field
	];
}

/**
 * The Comment button at a selection, where the margin is a drawer and a selection cannot open the
 * box beside it. The button takes no focus, so pressing it keeps the selection.
 */
function commentTip(opts: EditorOptions): Extension {
	const field = StateField.define<Tooltip | null>({
		create: () => null,
		update(v, tr) {
			if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(commentableEffect))) return v;
			const s = tr.state.selection.main;
			if (s.empty || !tr.state.field(commentableField) || matchMedia(WIDE_MARGIN).matches) return null;
			return {
				pos: s.head,
				above: s.head < s.anchor,
				strictSide: true,
				arrow: false,
				create: () => {
					const dom = document.createElement('div');
					dom.className = 'cm-cbtn';
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'btn btn-sm';
					button.textContent = 'Comment';
					button.addEventListener('pointerdown', (e) => {
						e.preventDefault();
						opts.hooks.comment();
					});
					// A keyboard press; a pointer press already acted on pointerdown.
					button.addEventListener('click', (e) => e.detail === 0 && opts.hooks.comment());
					dom.append(button);
					return { dom };
				}
			};
		},
		provide: (f) => showTooltip.from(f)
	});
	return [commentableField.init(() => opts.commentable), field];
}

const line = (cls: string) => Decoration.line({ class: cls });
/** A YAML line whose wrapped rows hang at its own indentation, so the nesting survives a wrap. */
const hang = (indent: number, classes: string[]) =>
	Decoration.line({ class: ['cm-yaml', ...classes].join(' '), attributes: { style: `--hang: ${indent}ch` } });
const mark = (cls: string) => Decoration.mark({ class: cls });

/**
 * The source marking: front matter, directive fences and their content, headings, the italic
 * purpose line, inline directives, code spans, and links. The fence scan needs the whole document,
 * since a line's container can open far above it, so it is cached and rerun on a change only.
 */
function sourcePlugin(original: string, yaml: boolean) {
	const originalLines = new Set(original.split('\n'));
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			scan: FenceScan;
			constructor(view: EditorView) {
				this.scan = fenceScan(view.state.doc.toString().split('\n'));
				this.decorations = this.build(view);
			}
			update(u: ViewUpdate) {
				if (u.docChanged) this.scan = fenceScan(u.state.doc.toString().split('\n'));
				const marking = u.transactions.some((tr) => tr.effects.some((e) => e.is(markChangesEffect)));
				if (u.docChanged || u.viewportChanged || marking) this.decorations = this.build(u.view);
			}
			build(view: EditorView) {
				const b = new RangeSetBuilder<Decoration>();
				const doc = view.state.doc;
				const front = frontmatterSpan(doc.sliceString(0, Math.min(doc.length, 4000)));
				const changes = view.state.field(markChangesField);
				for (const { from, to } of view.visibleRanges) {
					for (let pos = from; pos <= to; ) {
						const l = doc.lineAt(pos);
						const i = l.number - 1;
						const tx = l.text;
						const classes: string[] = [];
						const marks: Array<[number, number, string]> = [];
						const role = this.scan.roles[i];
						if (yaml) {
							if (changes && tx.trim() && !originalLines.has(tx)) classes.push('cm-edited');
							b.add(l.from, l.from, hang(/^ */.exec(tx)?.[0].length ?? 0, classes));
							pos = l.to + 1;
							continue;
						}
						if (front && l.from < front.to) classes.push('cm-front');
						else if (role) {
							classes.push('cm-fence');
							for (const t of fenceTokens(tx)) marks.push([l.from + t.from, l.from + t.to, t.kind === 'mark' ? 'cm-mark' : 'cm-dir-label']);
						} else if (!this.scan.inCode[i]) {
							if (this.scan.depths[i] !== null) classes.push('cm-in-block');
							const h = /^(#{1,3}) /.exec(tx);
							if (h) {
								classes.push(`cm-l-h${h[1].length}`);
								marks.push([l.from, l.from + h[0].length, 'cm-mark']);
								marks.push([l.from + h[0].length, l.to, `cm-h cm-h${h[1].length}`]);
							} else if (/^\*[^*].*\*$/.test(tx)) marks.push([l.from, l.to, 'cm-purpose']);
							for (const r of findInlineDirectives(tx)) marks.push([l.from + r.from, l.from + r.to, 'cm-fact']);
							for (const m of tx.matchAll(/`[^`]+`/g)) marks.push([l.from + m.index, l.from + m.index + m[0].length, 'cm-code']);
							for (const m of tx.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
								const s = l.from + m.index;
								marks.push([s + 1, s + 1 + m[1].length, 'cm-link']);
								marks.push([s + m[1].length + 3, s + m[1].length + 3 + m[2].length, 'cm-url']);
							}
						}
						if (changes && tx.trim() && !originalLines.has(tx)) classes.push('cm-edited');
						if (classes.length) b.add(l.from, l.from, line(classes.join(' ')));
						marks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
						for (const [f, t, c] of marks) if (t > f) b.add(f, t, mark(c));
						pos = l.to + 1;
					}
				}
				return b.finish();
			}
		},
		{ decorations: (v) => v.decorations }
	);
}

// Headings and code take their look from the source marking's classes; the parser supplies
// emphasis, strong, and the muted syntax markers.
const highlight = HighlightStyle.define([
	{ tag: tags.strong, fontWeight: '600' },
	{ tag: tags.emphasis, fontStyle: 'italic' },
	// A fixed class, so the editor's styles can deepen the markers under a current highlight.
	{ tag: tags.processingInstruction, class: 'cm-syntax-mark' }
]);

const editable = new Compartment();
// A read-only editor is not contenteditable, so it takes a tab stop of its own to stay reachable and caret-browsable.
const editableExt = (readonly: boolean) => [
	EditorState.readOnly.of(readonly),
	EditorView.editable.of(!readonly),
	EditorView.contentAttributes.of(readonly ? { tabindex: '0' } : {})
];

// Ctrl+Enter is the screen's approve, so the editor must not take it as "insert a blank line".
const keys = defaultKeymap.filter((b) => b.key !== 'Mod-Enter');

/** Builds the editor in `parent`. */
export function createEditor(parent: HTMLElement, opts: EditorOptions): EditorView {
	const view = new EditorView({
		parent,
		doc: opts.doc,
		extensions: [
			history(),
			keymap.of([
				{
					key: 'Mod-s',
					run: () => {
						opts.hooks.save();
						return true;
					}
				},
				...keys,
				...historyKeymap
			]),
			opts.yaml ? [] : [markdown({ base: markdownLanguage }), syntaxHighlighting(highlight)],
			EditorView.lineWrapping,
			markChangesField,
			sourcePlugin(opts.original, opts.yaml ?? false),
			highlightsExtension(opts),
			commentTip(opts),
			editable.of(editableExt(opts.readonly)),
			EditorView.scrollMargins.of(() => ({ top: 56, bottom: 140 })),
			EditorView.contentAttributes.of({ 'aria-label': opts.label }),
			EditorView.updateListener.of((u) => {
				if (u.docChanged) opts.hooks.change(u.view);
				if (u.selectionSet || u.focusChanged) opts.hooks.select(u.view);
				if (u.geometryChanged || u.heightChanged || u.viewportChanged) opts.hooks.geometry();
			})
		]
	});
	if (Object.keys(opts.decided).length) view.dispatch({ effects: decidedEffect.of(opts.decided) });
	return view;
}

export const setDecided = (view: EditorView, decided: Record<string, number>) =>
	view.dispatch({ effects: decidedEffect.of({ ...decided }) });

export const setResolved = (view: EditorView, resolved: string[]) => view.dispatch({ effects: resolvedEffect.of([...resolved]) });

export const setCurrent = (view: EditorView, key: string | null) => view.dispatch({ effects: currentEffect.of(key) });

export const setCommentable = (view: EditorView, on: boolean) => view.dispatch({ effects: commentableEffect.of(on) });

export const setMarkChanges = (view: EditorView, on: boolean) => view.dispatch({ effects: markChangesEffect.of(on) });

export const setReadonly = (view: EditorView, readonly: boolean) =>
	view.dispatch({ effects: editable.reconfigure(editableExt(readonly)) });

/** Every note's current range, after the edits so far. */
export const noteRanges = (view: EditorView) => view.state.field(rangesField);

/** Sets a comment's or thread's range by its key, or drops it with null. */
export const setCommentRange = (view: EditorView, key: string, range: Range | null) =>
	view.dispatch({ effects: commentRangeEffect.of({ key, range }) });

/** Every comment's and thread's current range, after the edits so far. */
export const commentRanges = (view: EditorView) => view.state.field(commentRangesField);

/** The viewport y of the top of the visual line holding `pos`: its drawn text when drawn, else the line's estimated block. */
export function lineTop(view: EditorView, pos: number): number {
	const at = Math.min(Math.max(pos, 0), view.state.doc.length);
	return view.coordsAtPos(at)?.top ?? view.documentTop + view.lineBlockAt(at).top;
}

/** Replaces a note's anchored text and moves its anchor onto the new text. */
export function replaceNoteText(view: EditorView, id: string, text: string) {
	const r = view.state.field(rangesField)[id];
	if (!r) return;
	view.dispatch({ changes: { from: r[0], to: r[1], insert: text }, effects: rangeEffect.of({ id, range: [r[0], r[0] + text.length] }) });
}

/** Scrolls the window so `pos` sits below the sticky header, then puts the caret there or selects `to`. */
export function jumpTo(view: EditorView, pos: number, to = pos) {
	const top = window.scrollY + view.documentTop + view.lineBlockAt(pos).top - 140;
	const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
	window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
	view.dispatch({ selection: { anchor: pos, head: to } });
	view.focus();
}

/** The last outline heading whose line has scrolled above `limit` pixels from the viewport top. */
export function headingAbove(view: EditorView, positions: number[], limit: number): number | null {
	let cur: number | null = null;
	for (const pos of positions) {
		if (pos > view.state.doc.length) break;
		if (view.documentTop + view.lineBlockAt(pos).top < limit) cur = pos;
		else break;
	}
	return cur;
}
