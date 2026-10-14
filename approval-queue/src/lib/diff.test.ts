import { describe, expect, it } from 'vitest';
import { classify, classifyDiff, fileGroups } from './diff.ts';

describe('classify', () => {
	it.each([
		['+x', 'added'],
		['-x', 'removed'],
		['@@ -1 +1 @@', 'hunk'],
		['diff --git a/x b/x', 'file'],
		['+++ b/x', 'file'],
		['--- a/x', 'file'],
		[' x', 'context']
	] as const)('labels %s as %s', (line, kind) => {
		expect(classify(line)).toBe(kind);
	});
});

describe('fileGroups', () => {
	const diff = [
		'diff --git a/README.md b/README.md',
		'index 1..2 100644',
		'--- a/README.md',
		'+++ b/README.md',
		'@@ -1,2 +1,2 @@',
		' keep',
		'-old',
		'+new',
		'diff --git a/src/new.ts b/src/new.ts',
		'new file mode 100644',
		'--- /dev/null',
		'+++ b/src/new.ts',
		'@@ -0,0 +1,2 @@',
		'+one',
		'+two',
		'diff --git a/src/gone.ts b/src/gone.ts',
		'deleted file mode 100644',
		'--- a/src/gone.ts',
		'+++ /dev/null',
		'@@ -1 +0,0 @@',
		'-bye',
		'diff --git a/src/two.ts b/src/two.ts',
		'--- a/src/two.ts',
		'+++ b/src/two.ts',
		'@@ -1,2 +1,2 @@',
		' a',
		'-b',
		'+B',
		'@@ -10,2 +12,3 @@ fn',
		' x',
		'+y',
		' z',
		'diff --git a/img/pic.png b/img/pic.png',
		'new file mode 100644',
		'Binary files /dev/null and b/img/pic.png differ',
		'diff --git a/lib/old.ts b/lib/moved.ts',
		'similarity index 100%',
		'rename from lib/old.ts',
		'rename to lib/moved.ts'
	].join('\n');

	const groups = fileGroups(diff);
	const all = groups.flatMap((g) => g.files);
	const file = (path: string) => all.find((f) => f.path === path)!;

	it('groups by first path segment in path order, root files under Repository root', () => {
		expect(groups.map((g) => g.name)).toEqual(['Repository root', 'img', 'lib', 'src']);
		expect(groups[3].files.map((f) => f.path)).toEqual(['src/gone.ts', 'src/new.ts', 'src/two.ts']);
	});

	it('counts adds and dels and sets status', () => {
		expect(file('README.md')).toMatchObject({ adds: 1, dels: 1 });
		expect(file('README.md').status).toBeUndefined();
		expect(file('src/new.ts')).toMatchObject({ adds: 2, dels: 0, status: 'new' });
		expect(file('src/gone.ts')).toMatchObject({ adds: 0, dels: 1, status: 'deleted' });
		expect(file('src/two.ts')).toMatchObject({ adds: 2, dels: 1 });
	});

	it('numbers lines on each side from the hunk headers', () => {
		const rows = file('src/two.ts').rows;
		expect(rows[0]).toMatchObject({ kind: 'hunk' });
		expect(rows[1]).toMatchObject({ kind: 'context', oldLine: 1, newLine: 1 });
		expect(rows[2]).toMatchObject({ kind: 'del', oldLine: 2 });
		expect(rows[3]).toMatchObject({ kind: 'add', newLine: 2 });
		expect(rows[4]).toMatchObject({ kind: 'hunk' });
		expect(rows[5]).toMatchObject({ kind: 'context', oldLine: 10, newLine: 12 });
		expect(rows[6]).toMatchObject({ kind: 'add', newLine: 13 });
		expect(rows[7]).toMatchObject({ kind: 'context', oldLine: 11, newLine: 14 });
	});

	it('lists a binary file with no rows and counts of 0', () => {
		expect(file('img/pic.png')).toMatchObject({ adds: 0, dels: 0, rows: [] });
	});

	it('names a rename by its b side', () => {
		expect(file('lib/moved.ts')).toMatchObject({ adds: 0, dels: 0, rows: [] });
	});
});

describe('classifyDiff', () => {
	it('labels each line and keeps its text', () => {
		expect(classifyDiff('+a\n b')).toEqual([
			{ kind: 'added', text: '+a' },
			{ kind: 'context', text: ' b' }
		]);
	});
});
