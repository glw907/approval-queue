import { EditorState } from '@codemirror/state';
import { getChunks, uncollapseUnchanged, unifiedMergeView } from '@codemirror/merge';
import { describe, expect, it } from 'vitest';
import { collapsedStart, collapsedStarts } from './setup.ts';

const lines = (n: number, edit?: [number, string]) =>
	Array.from({ length: n }, (_, i) => (edit && edit[0] === i ? edit[1] : `line ${i + 1}`)).join('\n');

const merged = (base: string, current: string) =>
	EditorState.create({
		doc: current,
		extensions: unifiedMergeView({ original: base, mergeControls: false, collapseUnchanged: { margin: 3, minSize: 4 } })
	});

describe('the merge view', () => {
	const original = lines(40);
	const current = lines(40, [19, 'line 20, reworded']);

	it('finds one changed chunk, at the reworded line', () => {
		const state = merged(original, current);
		const chunks = getChunks(state)?.chunks ?? [];
		expect(chunks).toHaveLength(1);
		expect(state.doc.lineAt(chunks[0].fromB).text).toBe('line 20, reworded');
	});

	it('folds the unchanged runs more than three lines from the change, and no others', () => {
		const state = merged(original, current);
		const at = (n: number) => state.doc.line(n).from;
		expect(collapsedStart(state, at(1))).toBe(at(1));
		expect(collapsedStart(state, at(16))).toBe(at(1));
		expect(collapsedStart(state, at(17))).toBeNull();
		expect(collapsedStart(state, at(20))).toBeNull();
		expect(collapsedStart(state, at(23))).toBeNull();
		expect(collapsedStart(state, at(24))).toBe(at(24));
		expect(collapsedStart(state, at(40))).toBe(at(24));
	});

	it('opens a run with the start it reports', () => {
		let state = merged(original, current);
		const start = collapsedStart(state, state.doc.line(5).from);
		expect(start).not.toBeNull();
		state = state.update({ effects: uncollapseUnchanged.of(start as number) }).state;
		expect(collapsedStart(state, state.doc.line(5).from)).toBeNull();
		expect(collapsedStart(state, state.doc.line(30).from)).not.toBeNull();
	});

	it('lists every fold, and opening them all leaves none', () => {
		let state = merged(original, current);
		const starts = collapsedStarts(state);
		expect(starts).toEqual([state.doc.line(1).from, state.doc.line(24).from]);
		state = state.update({ effects: starts.map((s) => uncollapseUnchanged.of(s)) }).state;
		expect(collapsedStarts(state)).toEqual([]);
	});

	it('folds nothing in a state with no merge view', () => {
		expect(collapsedStart(EditorState.create({ doc: lines(40) }), 0)).toBeNull();
	});
});
