<!-- @component
The empty state, shown when `/` finds nothing waiting. It counts 30 seconds with Keep focused,
then calls `window.close()`, which works only while the tab holds one history entry; every
navigation in the desk replaces its entry for that reason. The saved `desk.autoClose` setting
turns the count off.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { startHold } from '#lib/hold.ts';

	const SECONDS = 30;

	let phase = $state<'counting' | 'kept' | 'off' | 'closing'>('counting');
	let secs = $state(SECONDS);
	let autoClose = $state(true);
	let keep = $state<HTMLButtonElement>();
	let hold: { cancel: () => void } | null = null;

	function stop(message: string, next: 'kept' | 'off') {
		hold?.cancel();
		hold = null;
		phase = next;
		desk.announce(message);
	}

	function start() {
		secs = SECONDS;
		phase = 'counting';
		desk.announce(
			`Nothing waiting. This tab closes in ${SECONDS} seconds. Press Escape or Keep this tab open to stop it.`
		);
		hold = startHold(SECONDS * 1000, {
			tick: (left) => (secs = left),
			fire: () => {
				phase = 'closing';
				window.close();
			}
		});
		keep?.focus();
	}

	onMount(() => {
		try {
			autoClose = localStorage.getItem('desk.autoClose') !== 'off';
		} catch {
			// Without storage the setting stays on.
		}
		if (autoClose) start();
		else phase = 'off';
		return () => hold?.cancel();
	});

	function saveAutoClose() {
		try {
			localStorage.setItem('desk.autoClose', autoClose ? 'on' : 'off');
		} catch {
			// The toggle still holds for this page.
		}
		if (!autoClose && phase === 'counting') stop('Auto-close is off. This tab stays open.', 'off');
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && phase === 'counting') stop('This tab stays open.', 'kept');
	}
</script>

<svelte:document onkeydown={onKeydown} />

<main id="main" tabindex="-1" class="relative isolate flex flex-1 items-start px-5 pt-16 lg:px-8">
	<div class="max-w-[60ch]">
		<h1 class="desk-title text-[1.6rem] leading-tight"><i class="site-benchmark"></i>Nothing waiting</h1>
		<p class="mt-2">
			Every waiting session has its answer.
			{#if phase === 'counting'}
				This tab closes in
				<span class="countdown font-semibold">
					<span style="--value:{secs};" aria-hidden="true">{secs}</span>
				</span>
				<span class="sr-only">{secs}</span> s.
			{:else if phase === 'closing'}
				Closing this tab.
			{:else if phase === 'off'}
				Auto-close is off. This tab stays open.
			{:else}
				This tab stays open.
			{/if}
		</p>
		<div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
			{#if phase === 'counting'}
				<button
					type="button"
					class="btn btn-sm btn-ghost -ml-3"
					bind:this={keep}
					onclick={() => stop('This tab stays open.', 'kept')}
				>
					Keep this tab open <kbd class="kbd kbd-xs desk-kbd">Esc</kbd>
				</button>
			{/if}
			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<input
					type="checkbox"
					class="toggle toggle-sm toggle-primary"
					bind:checked={autoClose}
					onchange={saveAutoClose}
				/>
				Close when empty
			</label>
		</div>
		<p class="desk-muted mt-8 text-sm">New items open in their own tab.</p>
	</div>
</main>
