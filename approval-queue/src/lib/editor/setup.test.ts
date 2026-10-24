import { EditorState } from '@codemirror/state';
import { getChunks, uncollapseUnchanged, unifiedMergeView } from '@codemirror/merge';
import { describe, expect, it } from 'vitest';
import { collapsedStart } from './setup.ts';

const lines = (n: number, edit?: [number, string]) =>
	Array.from({ length: n }, (_, i) => (edit && edit[0] === i ? edit[1] : `line ${i + 1}`)).join('\n');

const amend = (approved: string, current: string) =>
	EditorState.create({
		doc: current,
		extensions: unifiedMergeView({ original: approved, mergeControls: false, collapseUnchanged: { margin: 3, minSize: 4 } })
	});

describe('the amend review', () => {
	const approved = lines(40);
	const current = lines(40, [19, 'line 20, reworded']);

	it('finds one changed chunk, at the reworded line', () => {
		const state = amend(approved, current);
		const chunks = getChunks(state)?.chunks ?? [];
		expect(chunks).toHaveLength(1);
		expect(state.doc.lineAt(chunks[0].fromB).text).toBe('line 20, reworded');
	});

	it('folds the unchanged runs more than three lines from the change, and no others', () => {
		const state = amend(approved, current);
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
		let state = amend(approved, current);
		const start = collapsedStart(state, state.doc.line(5).from);
		expect(start).not.toBeNull();
		state = state.update({ effects: uncollapseUnchanged.of(start as number) }).state;
		expect(collapsedStart(state, state.doc.line(5).from)).toBeNull();
		expect(collapsedStart(state, state.doc.line(30).from)).not.toBeNull();
	});

	it('folds nothing in a state with no merge view', () => {
		expect(collapsedStart(EditorState.create({ doc: lines(40) }), 0)).toBeNull();
	});
});
