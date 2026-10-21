<!-- @component
The work of a change review: a code PR that also edits blueprints and pages, read-only. The PR line
(its head, its checks), what the reader is deciding and how to read the documents as two closed
rows, then each changed document in the document editor with its notes inline and its own diff
behind a row, and last the code diff as the PR screen shows it. Nothing here is saved: the PR's
author edits, and a send-back goes to that author with a note.
-->
<script lang="ts">
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import DiffTable from './DiffTable.svelte';
	import DocEditor from './DocEditor.svelte';
	import Disclosure from './Disclosure.svelte';
	import FilesDiff from './FilesDiff.svelte';
	import PacketIcon from './PacketIcon.svelte';

	interface Props {
		data: Extract<PageData, { kind: 'change' }>;
		/** One review per document in `data.docs`, in the same order. */
		reviews: DocReview[];
	}

	let { data, reviews }: Props = $props();

	const KIND = { blueprint: 'Blueprint', page: 'Page' };
	const checks = $derived.by(() => {
		const { passed, failed, pending, rows } = data.checks;
		if (rows.length === 0) return 'No checks.';
		if (failed > 0) return `${failed} of ${rows.length} failed.`;
		if (pending > 0) return `${pending} of ${rows.length} pending.`;
		return `All ${passed} passed.`;
	});
	const name = (path: string) => path.split('/').pop() ?? path;
</script>

<p class="bg bg-first bg-flat prline">
	<span class="lead">Pull request.</span>
	{#if data.link}<a href={data.link.url} target="_blank" rel="noopener noreferrer">{data.ref}</a>{:else}{data.ref}{/if}, head
	<code>{data.head.slice(0, 9)}</code> when queued. Checks: {checks}
</p>
<details class="bg">
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">What you’re deciding.</span> Whether this pull request can merge with the blueprints and pages it edits.</span>
	</summary>
	<div class="body">
		<p>Approving names the pull request’s head when you approve, so a commit added afterward needs a new approval.</p>
		<p>You aren’t checking facts against the code. The notes show where a fact check changed a document.</p>
	</div>
</details>
<details class="bg">
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">How to read it.</span> Each document is shown as it is after the change, with the lines the change edited marked.</span>
	</summary>
	<div class="body">
		<p>The diff of each document is behind its own row. The documents take no edits here: send the change back with a note, and its author makes them.</p>
	</div>
</details>

{#each data.docs as doc, i (doc.path)}
	<section class="sec" id="doc-{i}" aria-labelledby="doc-{i}-h">
		<h2 id="doc-{i}-h">{name(doc.path)}</h2>
		<p class="sl">{KIND[doc.kind]} · <code>{doc.path}</code></p>
		{#if doc.file}
			<Disclosure name="Diff" summaryHtml="+{doc.file.adds} −{doc.file.dels}." wide>
				<DiffTable file={doc.file} />
			</Disclosure>
		{/if}
		<DocEditor review={reviews[i]} file={name(doc.path)} label="{KIND[doc.kind]}, read only" readonly />
	</section>
{/each}

<section class="sec" id="code" aria-labelledby="code-h">
	<h2 id="code-h">Code changes</h2>
	<p class="sl">The rest of the pull request, as the PR screen shows it.</p>
	{#if data.groups.length}
		<FilesDiff groups={data.groups} totals={data.totals} />
	{:else}
		<p class="bg bg-flat">No code changed; every file in this pull request is a document above.</p>
	{/if}
</section>

<style>
	code {
		font-family: var(--font-mono);
		font-size: 0.86em;
		overflow-wrap: anywhere;
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
