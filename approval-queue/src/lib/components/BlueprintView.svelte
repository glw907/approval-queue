<!-- @component
The work of a blueprint review: what the reader is deciding and how to change the plan, as two
closed rows, then the screen's place bar, then the blueprint file in the document editor with its
comment margin beside it. The file is the real one in the session's worktree, so every pause in
typing commits it there.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import DocEditor from './DocEditor.svelte';
	import PacketIcon from './PacketIcon.svelte';

	interface Props {
		review: DocReview;
		/** The blueprint's path in its worktree; the bar shows the file name. */
		file: string;
		/** The sticky place bar, which sits between the rows and the editor. */
		place: Snippet;
		/** The approved text this file amends; set, the editor shows the diff since it. */
		amend?: string;
	}

	let { review, file, place, amend }: Props = $props();
	const name = $derived(file.split('/').pop() ?? file);
</script>

<details class="bg bg-first">
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">What you’re deciding.</span> Whether this blueprint describes the page its reader needs, in the order they need it.</span>
	</summary>
	<div class="body">
		<p>Approving lets drafter write the page from this file. The draft comes back to you on the page review screen.</p>
		<p>You aren’t checking facts against the code. A fresh agent checked each claim, and the author fixed or disputed every finding. The notes mark where a finding changed the blueprint.</p>
	</div>
</details>
<details class="bg">
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">How to change it.</span> The editor below shows the blueprint file. Type anywhere, and the file saves each time you pause.</span>
	</summary>
	<div class="body">
		<p>
			Each <code>##</code> heading is a section, and the italic line under it says what the section does for the reader. Each bullet
			is a point the page makes. A <code>:::row</code> block is one troubleshooting row. The <code>:fact[…]</code> tag ties
			a line to the fact behind it, so leave it on the line it came with.
		</p>
		<p>
			To ask the author for a change instead of making it, select the text, and a comment box opens beside it. To edit the selected
			text instead, press Escape. Your comments go to the author with your decision.
		</p>
		<p>Each save is a commit in the session’s worktree. Ctrl+Z undoes, F8 moves to the next call for you, and Ctrl+Enter approves.</p>
	</div>
</details>

{@render place()}

<DocEditor {review} {amend} file={name} label={amend === undefined ? `Blueprint ${name}` : `Blueprint ${name}, changes since the approved version`} kindWord="blueprint" yaml={/\.ya?ml$/.test(file)} />

<style>
	code {
		font-family: var(--font-mono);
		font-size: 0.86em;
	}
</style>
