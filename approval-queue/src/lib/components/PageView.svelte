<!-- @component
The work of a page review: the pull request the page rides with and the head the approval will name,
what the reader is deciding and how to change the draft as two closed rows, then the page file in the
document editor with its notes inline. The file is the real one in the session's worktree, so every
pause in typing commits it there. A page queued with no readable pull request ref shows no PR line.
-->
<script lang="ts">
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import DocEditor from './DocEditor.svelte';
	import PacketIcon from './PacketIcon.svelte';

	interface Props {
		review: DocReview;
		/** The page's path in its worktree; the bar shows the file name. */
		file: string;
		/** The pull request the page merges with, and its head when the item was queued. */
		pr: { ref: string; url: string; head: string } | null;
	}

	let { review, file, pr }: Props = $props();
	const name = $derived(file.split('/').pop() ?? file);
</script>

{#if pr}
	<p class="bg bg-first bg-flat prline">
		<span class="lead">Pull request <a href={pr.url} target="_blank" rel="noopener noreferrer">{pr.ref}</a>.</span>
		{#if pr.head}It was at commit <code>{pr.head.slice(0, 9)}</code> when this page was queued, and your approval covers only that commit.{/if}
		If the pull request gains a commit before you approve, the queue refuses the approval and the page comes back to you.
	</p>
{/if}
<details class={['bg', !pr && 'bg-first']}>
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">What you’re deciding.</span> Whether this draft is ready to merge.</span>
	</summary>
	<div class="body">
		<p>
			{#if pr?.head}Approving lets the pull request merge at commit <code>{pr.head.slice(0, 9)}</code>.{:else if pr}Approving lets the pull request merge.{:else}Approving clears the page to merge.{/if}
			Read the draft for order and voice.
		</p>
		<p>You aren’t checking facts against the code. A fresh agent checked each claim, and the author fixed or disputed every finding. The notes mark where a finding changed the page.</p>
	</div>
</details>
<details class="bg">
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">How to change it.</span> The editor below shows the page file. Type anywhere, and the file saves each time you pause.</span>
	</summary>
	<div class="body">
		<p>
			Each save is a commit in the session’s worktree. The <code>:fact[…]</code> tag ties a line to
			the fact behind it, so leave it on the line it came with. Ctrl+Z undoes, F8 moves to the next call for you, and Ctrl+Enter
			approves.
		</p>
	</div>
</details>

<DocEditor {review} file={name} label="Page {name}, markdown" />

<style>
	code {
		font-family: var(--font-mono);
		font-size: 0.86em;
	}
	.prline {
		max-width: 58ch;
	}
	.prline a {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
