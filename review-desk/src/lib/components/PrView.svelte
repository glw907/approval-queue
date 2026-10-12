<!-- @component
A PR's body and diff. A stub until the PR view lands: it renders the body and the classified diff.
-->
<script lang="ts">
	import type { DiffLine } from '#lib/diff.ts';

	let { bodyHtml, diff }: { bodyHtml: string; diff: DiffLine[] } = $props();

	const diffClass = {
		added: 'text-success',
		removed: 'text-error',
		hunk: 'text-info',
		file: 'font-bold',
		context: ''
	};
</script>

<section class="md max-w-[72ch]">{@html bodyHtml}</section>
<pre class="my-4 overflow-x-auto bg-base-200 p-3 font-mono text-sm">{#each diff as line, i (i)}<span
			class="block {diffClass[line.kind]}">{line.text}</span
		>{/each}</pre>
