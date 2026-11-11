<!-- @component
One fold of the packet page: a stock daisyUI `collapse` on a native `details`, with a title and a sentence
that says what is inside. Its body renders only once opened, so a file's diff loads when its row is
opened; an `eager` fold keeps its text on the page while closed. Each time it opens it posts its name
to the page's `fold` action, which appends to the fold log; the post is best effort and never blocks
the reader. `open` is bindable so a link can open it.
-->
<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';

	interface Props {
		/** The name the fold log records. */
		name: string;
		title: Snippet;
		/** The closed line under the title. */
		sub?: Snippet;
		/** Classes for the `collapse` element, such as `deep` for the bordered deep dive. */
		variant?: string;
		/** Classes for the summary, such as `claim` for a claim's reading-size title. */
		titleClass?: string;
		id?: string;
		open?: boolean;
		/** Render the body while closed too, so its text is on the page for a note to anchor to. A diff stays lazy. */
		eager?: boolean;
		children: Snippet;
	}

	let { name, title, sub, variant = '', titleClass = '', id, open = $bindable(false), eager = false, children }: Props = $props();

	function toggled(e: Event & { currentTarget: HTMLDetailsElement }) {
		open = e.currentTarget.open;
		if (!open) return;
		const body = new FormData();
		body.set('fold', name);
		void fetch(`${page.url.pathname}?/fold`, { method: 'POST', body, headers: { accept: 'application/json', 'x-sveltekit-action': 'true' } }).catch(() => {});
	}
</script>

<details class={['collapse collapse-arrow', variant]} {id} {open} ontoggle={toggled}>
	<summary class={['collapse-title', titleClass]}>{@render title()}{#if sub}<span class="sub">{@render sub()}</span>{/if}</summary>
	<div class="collapse-content">
		{#if open || eager}{@render children()}{/if}
	</div>
</details>
