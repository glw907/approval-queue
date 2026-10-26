<!-- @component
The work of a docs review: the pull request row (number, branch, head, checks) and its body, the
diff since the last send-back or approval when there is one, the code diff without the pages, the
screen's place bar, then each changed page in the document editor against its merge-base text, with
its own comment margin. The page files are the real ones in the session's worktree, so every pause
in typing commits that page there, alone; a page whose file is gone from the worktree shows the
copy that was queued, read only, with a notice.

`reviews` holds one `DocReview` per entry of `data.pages`, in the same order. The panel owns them,
since its decision bar and outline read them too.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { filesLine } from '#lib/packet-view.ts';
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import Disclosure from './Disclosure.svelte';
	import DocEditor from './DocEditor.svelte';
	import FilesDiff from './FilesDiff.svelte';

	type Docs = Extract<PageData, { kind: 'docs' }>;

	interface Props {
		data: Docs;
		/** One review per page in `data.pages`, in the same order. */
		reviews: DocReview[];
		/** The sticky place bar, which sits between the code diff and the first page. */
		place: Snippet;
	}

	let { data, reviews, place }: Props = $props();

	const name = (path: string) => path.split('/').pop() ?? path;
	const count = (n: number) => n.toLocaleString('en-US');

	/** The totals `FilesDiff` shows for a set of file groups. */
	const totalsOf = (groups: Docs['groups']) => {
		const files = groups.flatMap((g) => g.files);
		return {
			files: files.length,
			adds: files.reduce((n, f) => n + f.adds, 0),
			dels: files.reduce((n, f) => n + f.dels, 0)
		};
	};
</script>

<p class="bg bg-first bg-flat prline">
	<span class="lead">Pull request <a href={data.link.url} target="_blank" rel="noopener noreferrer">{data.ref}<span class="sr-only"> (opens in a new tab)</span></a>.</span>
	Branch <code>{data.link.head}</code> into <code>{data.link.base}</code>.
	{#if data.head}It was at commit <code>{data.head.slice(0, 9)}</code> when this review was queued, and your approval covers only that commit.{/if}
	{data.checks.rows.length ? `Checks: ${data.checks.text}.` : 'It runs no checks.'}
</p>
<Disclosure name="Pull request body" summaryHtml="What the author wrote for the pull request.">
	<div class="desk-md">{@html data.bodyHtml}</div>
</Disclosure>

{#each [{ id: 'since-sent-back', title: 'Since you sent it back', verb: 'sent back', diff: data.since }, { id: 'since-approved', title: 'Since you approved', verb: 'approved', diff: data.approved }] as since (since.id)}
	{#if since.diff}
		<section class="sec" id={since.id} aria-labelledby="{since.id}-h">
			<h2 id="{since.id}-h">{since.title}</h2>
			{#if 'groups' in since.diff}
				<p class="sl">{filesLine(since.diff.groups)}.</p>
				<FilesDiff groups={since.diff.groups} totals={totalsOf(since.diff.groups)} focusKey={false} />
			{:else}
				<p class="bg bg-flat">The commit you {since.verb} is no longer in this branch, so only the full diff follows.</p>
			{/if}
		</section>
	{/if}
{/each}

<section class="sec" id="code" aria-labelledby="code-h">
	<h2 id="code-h">Code changes</h2>
	{#if data.groups.length}
		<p class="sl">The pull request without its pages: {count(data.totals.files)} {data.totals.files === 1 ? 'file' : 'files'}.</p>
		<FilesDiff groups={data.groups} totals={data.totals} />
	{:else}
		<p class="bg bg-flat">No code changed; every file in this pull request is a page below.</p>
	{/if}
</section>

{@render place()}

{#each data.pages as page, i (page.path)}
	<section class="sec" id="doc-{i}" aria-labelledby="doc-{i}-h">
		<h2 id="doc-{i}-h">{name(page.path)}</h2>
		<p class="sl"><code>{page.path}</code>{#if page.from}, renamed from <code>{page.from}</code>{/if}</p>
		{#if page.missing}
			<div role="status" class="alert alert-warning alert-soft">
				<span>The queue can no longer read <code>{page.path}</code> from the worktree’s latest commit. The editor shows the copy that was queued, and you can’t edit or comment on it. Send the review back to have the author restore it.</span>
			</div>
		{/if}
		<DocEditor
			review={reviews[i]}
			file={name(page.path)}
			label="Page {name(page.path)}, markdown"
			kindWord="page"
			base={page.base}
			level={4}
		/>
	</section>
{/each}

<style>
	code {
		font-family: var(--font-mono);
		font-size: 0.86em;
		overflow-wrap: anywhere;
	}
	.prline {
		max-width: 56ch;
	}
	.prline a {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
