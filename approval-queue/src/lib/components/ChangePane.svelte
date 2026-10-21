<!-- @component
The review pane of a change review: the calls for the reader across every changed document (open ones
amber, decided ones green with their outcome), the corrections already made, and the documents and the
code diff as links. A call's link moves its document's editor to the note's line rather than following a
fragment, since the editor renders only the lines near the viewport.
-->
<script lang="ts">
	import { isCall } from '#lib/editor/notes.ts';
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import PaneList, { type PaneItem } from './frame/PaneList.svelte';
	import PaneSection from './frame/PaneSection.svelte';

	interface Props {
		reviews: DocReview[];
		/** The changed documents' paths, in the same order as `reviews`. */
		paths: string[];
		/** Whether the PR changed any code outside the documents. */
		hasCode: boolean;
	}

	let { reviews, paths, hasCode }: Props = $props();

	const callItems = $derived<PaneItem[]>(
		reviews.flatMap((review) =>
			review.calls.map((n) => {
				const picked = review.decided[n.id];
				const done = picked === undefined ? null : (n.choices?.[picked]?.done ?? 'Settled');
				return {
					href: `#note-${n.id}`,
					label: n.title,
					what: done ?? (n.kind === 'question' ? 'A question from the author' : 'A dispute between the author and the fact check'),
					dot: done === null ? 'call' : 'done'
				} satisfies PaneItem;
			})
		)
	);
	const fixItems = $derived<PaneItem[]>(
		reviews.flatMap((review) =>
			review.notes
				.filter((n) => !isCall(n))
				.map((n) => ({ href: `#note-${n.id}`, label: n.title, what: 'Already fixed by the author', dot: 'fix' }) satisfies PaneItem)
		)
	);
	const docItems = $derived<PaneItem[]>([
		...paths.map((path, i) => ({
			href: `#doc-${i}`,
			label: path.split('/').pop() ?? path,
			what: reviews[i].notes.length ? `${reviews[i].notes.length} ${reviews[i].notes.length === 1 ? 'note' : 'notes'}` : 'No notes'
		})),
		...(hasCode ? [{ href: '#code', label: 'Code changes' }] : [])
	]);

	/** A call's link moves the editor that holds the note instead of changing the fragment. */
	function follow(e: MouseEvent) {
		const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href^="#note-"]') : null;
		if (!link) return;
		const id = (link.getAttribute('href') ?? '').slice('#note-'.length);
		const owner = reviews.find((r) => r.notes.some((n) => n.id === id));
		if (!owner) return;
		owner.jumpToNote(id);
		e.preventDefault();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: a delegated click on the links, which already fire click on Enter -->
<div class="contents-wrap" onclick={follow}>
	<PaneSection title="Calls for you"><PaneList items={callItems} empty="No calls in this review." /></PaneSection>
	{#if fixItems.length}<PaneSection title="Corrected by the fact check"><PaneList items={fixItems} /></PaneSection>{/if}
	<PaneSection title="In this change" contents><PaneList items={docItems} /></PaneSection>
</div>

<style>
	.contents-wrap {
		display: contents;
	}
</style>
