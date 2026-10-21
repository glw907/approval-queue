<!-- @component
The review pane of a document review: the calls for the reader (open ones amber, decided ones
green with their outcome), the corrections already made, the document's outline with a dot on each
section that holds an open call or a correction, and the switch that marks changed lines. Every
link moves the editor to its line rather than following a fragment, since the editor renders only
the lines near the viewport.
-->
<script lang="ts">
	import { codeSpans } from '#lib/editor/inline.ts';
	import { isCall } from '#lib/editor/notes.ts';
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import PaneList, { type PaneItem } from './frame/PaneList.svelte';
	import PaneSection from './frame/PaneSection.svelte';

	interface Props {
		review: DocReview;
		/** The corrections section's title, such as "Corrected by the fact check". */
		correctionsTitle: string;
		/** The line under an open call, by note kind. */
		callWhat?: { decide: string; question: string };
		/** The line under a correction. */
		correctionWhat?: string;
	}

	let {
		review,
		correctionsTitle,
		callWhat = { decide: 'A dispute between the author and the fact check', question: 'A question from the author' },
		correctionWhat = 'Fixed by the author'
	}: Props = $props();

	const callItems = $derived<PaneItem[]>(
		review.calls.map((n) => {
			const picked = review.decided[n.id];
			const done = picked === undefined ? null : (n.choices?.[picked]?.done ?? 'Settled');
			return {
				href: `#note-${n.id}`,
				label: n.title,
				what: done ?? (n.kind === 'question' ? callWhat.question : callWhat.decide),
				dot: done === null ? 'call' : 'done'
			};
		})
	);
	const fixItems = $derived<PaneItem[]>(
		review.notes.filter((n) => !isCall(n)).map((n) => ({ href: `#note-${n.id}`, label: n.title, what: correctionWhat, dot: 'fix' }))
	);

	/** Numbered `##` and `###` headings, each marked when an open call or a correction starts in its section. */
	const entries = $derived.by(() => {
		const hs = review.headings;
		let major = 0;
		let minor = 0;
		return hs.map((h, i) => {
			if (h.level === 2) {
				major++;
				minor = 0;
			} else minor++;
			const end = hs[i + 1]?.pos ?? Infinity;
			const inside = review.notes.filter((n) => {
				const at = review.starts[n.id];
				return at !== null && at !== undefined && at >= h.pos && at < end && (!isCall(n) || review.decided[n.id] === undefined);
			});
			const mark = inside.some(isCall) ? 'call' : inside.length ? 'fix' : null;
			return { ...h, n: h.level === 2 ? `${major}` : `${major}.${minor}`, mark };
		});
	});

	/** A pane link moves the editor instead of changing the fragment; the frame closes its drawer. */
	function follow(e: MouseEvent) {
		const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
		if (!link) return;
		const href = link.getAttribute('href') ?? '';
		if (href.startsWith('#note-')) review.jumpToNote(href.slice('#note-'.length));
		else if (href.startsWith('#line-')) review.jumpToPos(Number(href.slice('#line-'.length)));
		else return;
		e.preventDefault();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: a delegated click on the links, which already fire click on Enter -->
<div class="contents-wrap" onclick={follow}>
	<PaneSection title="Calls for you"><PaneList items={callItems} empty="No calls in this review." /></PaneSection>
	{#if fixItems.length}<PaneSection title={correctionsTitle}><PaneList items={fixItems} /></PaneSection>{/if}
	<PaneSection title="Contents" contents>
		<ol>
			{#each entries as h (h.pos)}
				<li>
					<a
						href="#line-{h.pos}"
						class={[h.level === 3 && 'l3', review.current === h.pos && 'cur']}
						aria-current={review.current === h.pos ? 'location' : undefined}
						title={h.text.replace(/`/g, '')}
					>
						<span class="n">{h.n}</span>
						<span class="t">{#each codeSpans(h.text) as span, i (i)}{#if span.code}<code>{span.text}</code>{:else}{span.text}{/if}{/each}</span>
						{#if h.mark === 'call'}<span class="mk" role="img" aria-label="open call"></span>
						{:else if h.mark === 'fix'}<span class="mk fix" role="img" aria-label="correction"></span>{/if}
					</a>
				</li>
			{/each}
		</ol>
	</PaneSection>
	<label class="rv-toggle"><input type="checkbox" bind:checked={review.markChanges} /> Mark the lines you changed</label>
</div>

<style>
	.contents-wrap {
		display: contents;
	}
	.mk.fix {
		background: var(--color-info);
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.86em;
	}
	.rv-toggle {
		font-size: 0.92rem;
		color: var(--color-muted);
		display: flex;
		gap: 8px;
		align-items: center;
		cursor: pointer;
	}
	.rv-toggle input {
		accent-color: var(--color-primary);
	}
</style>
