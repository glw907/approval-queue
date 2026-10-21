<!-- @component
The work of a blueprint review: what the reader is deciding and how to change the plan, as two
closed rows, then the blueprint file in the document editor with its notes inline. The file is the
real one in the session's worktree, so every pause in typing commits it there.
-->
<script lang="ts">
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import DocEditor from './DocEditor.svelte';
	import PacketIcon from './PacketIcon.svelte';

	interface Props {
		review: DocReview;
		/** The blueprint's path in its worktree; the bar shows the file name. */
		file: string;
		/** No edits are taken, as while a decision is held or once the item is decided. */
		readonly: boolean;
	}

	let { review, file, readonly }: Props = $props();
</script>

<details class="bg bg-first">
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">What you’re deciding.</span> Whether this plan makes the right page: the right reader, the right order, and the right things said.</span>
	</summary>
	<div class="body">
		<p>Approving lets drafter write the page from this file. You’ll read the draft next, on the page review screen.</p>
		<p>You aren’t checking facts against the code. A fresh agent did that, and the author fixed what it found or disputed it. The notes show where that changed the plan.</p>
	</div>
</details>
<details class="bg">
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">How to change it.</span> It’s the blueprint file itself. Type anywhere, and each pause saves it.</span>
	</summary>
	<div class="body">
		<p>
			Each <code>##</code> heading is a section, and the italic line under it says what the section does for the reader. Each bullet
			is a point the page will make. A <code>:::row</code> block is one troubleshooting row. The small <code>:fact[…]</code> tag ties
			a line to the fact behind it, so leave it on the line it came with.
		</p>
		<p>Each save is a commit in the session’s worktree. Ctrl+Z undoes, F8 moves to the next call for you, and Ctrl+Enter approves.</p>
	</div>
</details>

<DocEditor {review} file={file.split('/').pop() ?? file} label="Blueprint, markdown" {readonly} />

<style>
	code {
		font-family: var(--font-mono);
		font-size: 0.86em;
	}
</style>
