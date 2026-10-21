// The review editor: CodeMirror 6 with cairn's markdown setup (`markdown({ base: markdownLanguage })`,
// line wrapping, a highlight style), the directive marking ported from cairn-cms
// `src/lib/admin/editor-highlight.ts` (`cairnDirectivePlugin`), and review notes as block widgets
// under the line their anchor names. Each note's range is mapped through every change, so a note
// follows its line through edits.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { mount, unmount } from 'svelte';
import NoteCard from '#lib/components/NoteCard.svelte';
import { fenceScan, fenceTokens, findInlineDirectives, frontmatterSpan, type FenceScan } from './directives.ts';
import type { PlacedNote, Range } from './notes.ts';

/** What the editor reports to the screen around it. */
export interface EditorHooks {
	/** The document changed, by typing, undo, or a choice that rewrote a line. */
	change(view: EditorView): void;
	/** Ctrl+S or Cmd+S in the editor. */
	save(): void;
	/** A choice button on a note. */
	choose(id: string, index: number): void;
	reopen(id: string): void;
}

export interface EditorOptions {
	doc: string;
	notes: PlacedNote[];
	/** The text the review opened with; "Mark the lines I changed" compares each line against it. */
	original: string;
	/** The editable region's accessible name. */
	label: string;
	decided: Record<string, number>;
	readonly: boolean;
	hooks: EditorHooks;
}

const markChangesEffect = StateEffect.define<boolean>();
const decidedEffect = StateEffect.define<Record<string, number>>();
const rangeEffect = StateEffect.define<{ id: string; range: Range }>();

const markChangesField = StateField.define<boolean>({
	create: () => false,
	update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(markChangesEffect) ? e.value : acc), v)
});

const decidedField = StateField.define<Record<string, number>>({
	create: () => ({}),
	update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(decidedEffect) ? e.value : acc), v)
});

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

/** A note under its line, rendered by `NoteCard`; rebuilt only when its decided state changes. */
class NoteWidget extends WidgetType {
	private card: ReturnType<typeof mount> | null = null;

	constructor(
		readonly note: PlacedNote,
		readonly choice: number | undefined,
		readonly hooks: EditorHooks
	) {
		super();
	}

	eq(other: NoteWidget) {
		return other.note.id === this.note.id && other.choice === this.choice;
	}

	toDOM(view: EditorView) {
		const wrap = document.createElement('div');
		wrap.className = 'notewidget';
		// Opening "What changed" grows the block, and the editor only measures on its own changes.
		wrap.addEventListener('toggle', () => view.requestMeasure(), true);
		this.card = mount(NoteCard, {
			target: wrap,
			props: {
				note: this.note,
				choice: this.choice,
				onchoose: (i: number) => this.hooks.choose(this.note.id, i),
				onreopen: () => this.hooks.reopen(this.note.id)
			}
		});
		return wrap;
	}

	destroy() {
		if (this.card) unmount(this.card);
		this.card = null;
	}

	ignoreEvent() {
		return true;
	}
}

function noteDecorations(state: EditorState, notes: PlacedNote[], hooks: EditorHooks): DecorationSet {
	const ranges = state.field(rangesField);
	const decided = state.field(decidedField);
	const out = [];
	for (const note of notes) {
		const r = ranges[note.id];
		const choice = decided[note.id];
		const widget = new NoteWidget(note, choice, hooks);
		// A note whose anchor resolved to nothing sits at the top of the document, never dropped.
		if (!r || r[0] > state.doc.length) {
			out.push(Decoration.widget({ widget, block: true, side: -1 }).range(0));
			continue;
		}
		const to = Math.min(r[1], state.doc.length);
		out.push(Decoration.widget({ widget, block: true, side: 1 }).range(state.doc.lineAt(to).to));
		if (choice === undefined && to > r[0]) {
			out.push(Decoration.mark({ class: note.kind === 'info' ? 'cm-anchor info' : 'cm-anchor' }).range(r[0], to));
		}
	}
	return Decoration.set(out, true);
}

function notesExtension(notes: PlacedNote[], hooks: EditorHooks): Extension {
	const field = StateField.define<DecorationSet>({
		create: (state) => noteDecorations(state, notes, hooks),
		update: (v, tr) =>
			tr.docChanged || tr.effects.some((e) => e.is(decidedEffect) || e.is(rangeEffect))
				? noteDecorations(tr.state, notes, hooks)
				: v,
		provide: (f) => EditorView.decorations.from(f)
	});
	return [rangesField.init(() => Object.fromEntries(notes.map((n) => [n.id, n.range]))), decidedField, field];
}

const line = (cls: string) => Decoration.line({ class: cls });
const mark = (cls: string) => Decoration.mark({ class: cls });

/**
 * The source marking: front matter, directive fences and their content, headings, the italic
 * purpose line, inline directives, code spans, and links. The fence scan needs the whole document,
 * since a line's container can open far above it, so it is cached and rerun on a change only.
 */
function sourcePlugin(original: string) {
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
	{ tag: tags.processingInstruction, color: 'var(--color-muted)', fontWeight: '400' }
]);

const editable = new Compartment();
const editableExt = (readonly: boolean) => [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)];

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
			markdown({ base: markdownLanguage }),
			syntaxHighlighting(highlight),
			EditorView.lineWrapping,
			markChangesField,
			sourcePlugin(opts.original),
			notesExtension(opts.notes, opts.hooks),
			editable.of(editableExt(opts.readonly)),
			EditorView.scrollMargins.of(() => ({ top: 56, bottom: 140 })),
			EditorView.contentAttributes.of({ 'aria-label': opts.label }),
			EditorView.updateListener.of((u) => {
				if (u.docChanged) opts.hooks.change(u.view);
			})
		]
	});
	if (Object.keys(opts.decided).length) view.dispatch({ effects: decidedEffect.of(opts.decided) });
	return view;
}

export const setDecided = (view: EditorView, decided: Record<string, number>) =>
	view.dispatch({ effects: decidedEffect.of({ ...decided }) });

export const setMarkChanges = (view: EditorView, on: boolean) => view.dispatch({ effects: markChangesEffect.of(on) });

export const setReadonly = (view: EditorView, readonly: boolean) =>
	view.dispatch({ effects: editable.reconfigure(editableExt(readonly)) });

/** Every note's current range, after the edits so far. */
export const noteRanges = (view: EditorView) => view.state.field(rangesField);

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
