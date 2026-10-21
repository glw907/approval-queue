<!-- @component
A list of links into the work, for the review pane: each row a status dot, a label, and an optional
second line saying where it stands. With `numbered` it is the outline form, a number and one-line
label per row. Renders `empty` instead when there are no items.
-->
<script lang="ts" module>
	export interface PaneItem {
		/** An in-page anchor, `#ask-1`; following it closes the pane drawer. */
		href: string;
		label: string;
		/** The label as inline HTML the server rendered from Markdown, shown in place of `label`. */
		labelHtml?: string;
		/** The line under the label. */
		what?: string;
		/** `call` is open and amber, `fix` is a correction, `done` is settled. */
		dot?: 'call' | 'fix' | 'done';
		/** The outline form's number column. */
		n?: number | string;
		/** A dot at the row's far edge, marking an open call inside an outline section. */
		mark?: 'call';
		/** Indents the row one level, for a subsection. */
		sub?: boolean;
	}
</script>

<script lang="ts">
	interface Props {
		items: PaneItem[];
		/** What to say when `items` is empty. */
		empty?: string;
		numbered?: boolean;
	}

	let { items, empty, numbered = false }: Props = $props();
</script>

{#if items.length}
	<svelte:element this={numbered ? 'ol' : 'ul'}>
		{#each items as item (item.href)}
			<li>
				<a href={item.href} class={[item.sub && 'l3']}>
					{#if numbered}
						<span class="n">{item.n}</span><span class="t">{item.label}</span>
						{#if item.mark}<span class="mk" role="img" aria-label="open call"></span>{/if}
					{:else}
						{#if item.dot}<span class="dot {item.dot}" aria-hidden="true"></span>{/if}
						<span
							>{#if item.labelHtml}{@html item.labelHtml}{:else}{item.label}{/if}{#if item.what}<span class="what">{item.what}</span>{/if}</span
						>
					{/if}
				</a>
			</li>
		{/each}
	</svelte:element>
{:else if empty}
	<p class="rv-none">{empty}</p>
{/if}
