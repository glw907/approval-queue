<!-- @component
The digest: every change that merged with no call for the reader, one claim a line, grouped by repo
with the newest first. It shows no badge and no count. A line opens (stock daisyUI `collapse`) to the
reader's note on it, the session's reply to that note, and a link to the pull request; saving a note
posts to the `note` action, and blank text removes it. The form works without script as a plain post.
-->
<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const REPLIES = { fixed: 'Fixed', filed: 'Filed', answered: 'Answered' };
	const when = (time: string) =>
		new Date(time).toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
	/** `owner/repo#12` as its repo, its number, and the pull request's address. */
	const pr = (ref: string) => {
		const [repo, n] = ref.split('#');
		return { n, href: `https://github.com/${repo}/pull/${n}` };
	};
</script>

<svelte:head><title>Merged without you · Approval Queue</title></svelte:head>

<div class="packet">
	<main id="main" tabindex="-1" class="packet-main">
		<div class="packet-body">
			<p class="kicker">No decision needed. Read when you like.</p>
			<h1 class="head"><i class="benchmark"></i>Merged without you</h1>
			<div class="prose">
				{#if data.groups.length}
					<p>These changes merged with no call for you. Each passed its checks and review. Open any line to leave a note, and the session handles it as it would a note on an approve.</p>
				{:else}
					<p>Nothing has merged without you yet.</p>
				{/if}
			</div>
			{#each data.groups as group (group.repo)}
				<section aria-labelledby="repo-{group.repo}">
					<h2 class="sec" id="repo-{group.repo}">{group.repo.split('/').pop()}</h2>
					{#each group.lines as line (line.line)}
						{@const note = line.notes[0]}
						<details class="collapse collapse-arrow" open={form?.saved === line.line || undefined}>
							<summary class="collapse-title claim">
								{line.claim}
								<span class="sub">#{pr(line.ref).n}, {line.lane === 'land' ? 'merged' : 'recorded'}, {when(line.time)}{note ? ', you left a note' : ''}</span>
							</summary>
							<div class="collapse-content">
								{#each line.replies as reply (reply.note)}
									<p class="muted">
										<b>{REPLIES[reply.outcome]}.</b>
										{reply.text}{#if reply.ref} <code>{reply.ref}</code>{/if}
									</p>
								{/each}
								<form method="POST" action="?/note" class="note-form" use:enhance={() => ({ update }) => update({ reset: false })}>
									<input type="hidden" name="line" value={line.line} />
									<label class="sr-only" for="note-{line.line}">Your note on this change</label>
									<textarea id="note-{line.line}" name="text" class="textarea w-full" rows="3" placeholder="A note for the session">{note?.text ?? ''}</textarea>
									<div class="actions">
										<button type="submit" class="btn btn-sm btn-outline">Save note</button>
										<a class="link" href={pr(line.ref).href}>Open #{pr(line.ref).n} on GitHub</a>
										{#if form?.saved === line.line}<span class="muted" role="status">Saved.</span>{/if}
										{#if form?.message}<span role="alert">{form.message}</span>{/if}
									</div>
								</form>
							</div>
						</details>
					{/each}
				</section>
			{/each}
		</div>
	</main>

	<aside class="margin" aria-label="Notes">
		<h2>Your notes</h2>
		<p class="hint">Open any line to leave a note on it. The session answers each note, and its reply shows under the line.</p>
	</aside>
</div>

<style>
	.note-form {
		margin-top: 8px;
	}
	.note-form textarea {
		font-size: 0.94rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 16px;
		margin-top: 8px;
	}
</style>
