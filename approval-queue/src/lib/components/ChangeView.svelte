<!-- @component
The work of a change review: a code PR that also edits blueprints and pages, read-only. The PR line
(its head, its checks), what the reader is deciding and how to read the documents as two closed
rows, the screen's place bar, then each changed document in the document editor with its own
comment margin and its own diff behind a row, and last the code diff as the PR screen shows it.
No text is saved: the PR's author edits, and the comments and a send-back note go to that author.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
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
		/** The sticky place bar, which sits between the rows and the first document. */
		place: Snippet;
	}

	let { data, reviews, place }: Props = $props();

	const KIND = { blueprint: 'Blueprint', page: 'Page' };
	const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
	const word = (n: number) => WORDS[n] ?? String(n);
	const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	/**
	 * The pull request's checks as one sentence, with the numbers spelled out as the ledes spell them.
	 * A failure outranks a running check, which outranks a skip; `some` names k of the n checks and
	 * picks the verb's number, so every count reads right ("Its one check", "Both of its checks").
	 */
	const checks = $derived.by(() => {
		const { failed, pending, skipped, rows } = data.checks;
		const n = rows.length;
		if (n === 0) return 'It runs no checks.';
		const some = (k: number, one: string, many: string) => {
			const who =
				k === n
					? n === 1
						? 'Its one check'
						: n === 2
							? 'Both of its checks'
							: `All ${word(n)} of its checks`
					: `${capital(word(k))} of its ${word(n)} checks`;
			return `${who} ${k === 1 ? one : many}`;
		};
		if (failed) return `${some(failed, 'failed', 'failed')}.`;
		if (pending) return `${some(pending, 'is still running', 'are still running')}.`;
		if (skipped === n) return `${some(n, 'was skipped', 'were skipped')}.`;
		if (skipped) return `${some(n - skipped, 'passed', 'passed')}, and ${word(skipped)} ${skipped === 1 ? 'was' : 'were'} skipped.`;
		return `${some(n, 'passed', 'passed')}.`;
	});
	const name = (path: string) => path.split('/').pop() ?? path;
</script>

<p class="bg bg-first bg-flat prline">
	<span class="lead">Pull request {#if data.link}<a href={data.link.url} target="_blank" rel="noopener noreferrer">{data.ref}</a>{:else}{data.ref}{/if}.</span>
	{#if data.head}It was at commit <code>{data.head.slice(0, 9)}</code> when this change was queued.{/if} {checks}
</p>
<details class="bg">
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">What you’re deciding.</span> Whether the pull request, including its edits to blueprints and pages, is ready to merge.</span>
	</summary>
	<div class="body">
		<p>{#if data.head}The queue read these documents at commit <code>{data.head.slice(0, 9)}</code>, and your approval covers that commit only. {/if}If the pull request gains a commit before you approve, the change comes back for a new approval.</p>
		<p>You aren’t checking facts against the code. The notes show where a fact check changed a document.</p>
	</div>
</details>
<details class="bg">
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">How to read it.</span> Each document appears as it reads after the change, with the edited lines marked.</span>
	</summary>
	<div class="body">
		<p>Each document’s changes are in its Diff disclosure. You can’t edit the documents here. To ask for an edit, select the text, and a comment box opens beside it. Your comments go to the change’s author with your decision.</p>
	</div>
</details>

{@render place()}

{#each data.docs as doc, i (doc.path)}
	<section class="sec" id="doc-{i}" aria-labelledby="doc-{i}-h">
		<h2 id="doc-{i}-h">{name(doc.path)}</h2>
		<p class="sl">{KIND[doc.kind]} · <code>{doc.path}</code></p>
		{#if doc.file}
			<Disclosure name="Diff" summaryHtml="+{doc.file.adds} −{doc.file.dels}." wide>
				<DiffTable file={doc.file} />
			</Disclosure>
		{/if}
		<DocEditor
			review={reviews[i]}
			file={name(doc.path)}
			label="{KIND[doc.kind]} {name(doc.path)}, read only"
			kindWord={doc.kind}
			yaml={/\.ya?ml$/.test(doc.path)}
		/>
	</section>
{/each}

<section class="sec" id="code" aria-labelledby="code-h">
	<h2 id="code-h">Code changes</h2>
	<p class="sl">The rest of the pull request, as the pull request screen shows it.</p>
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
