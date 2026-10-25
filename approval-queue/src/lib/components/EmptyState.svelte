<!-- @component
The empty state, shown when `/` finds nothing waiting. It counts 30 seconds with Keep focused,
then calls `window.close()`, which works only while the tab holds one history entry; every
navigation in the desk replaces its entry for that reason. The saved `desk.autoClose` setting
turns the count off, and turning it back on restarts the count. The countdown line shows only once
the saved setting is read, so no frame says the tab closes when auto-close is off. The page
unmounts it when an item arrives, which cancels the count.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { startHold } from '#lib/hold.ts';

	const SECONDS = 30;

	let phase = $state<'counting' | 'kept' | 'off' | 'closing'>('counting');
	let secs = $state(SECONDS);
	let autoClose = $state(true);
	/** The saved setting is read, so the countdown line can say what will happen. */
	let ready = $state(false);
	let keep = $state<HTMLButtonElement>();
	let hold: { cancel: () => void } | null = null;

	async function stop(message: string, next: 'kept' | 'off') {
		hold?.cancel();
		hold = null;
		phase = next;
		desk.announce(message);
		// Keep unmounts as the count ends, so focus would otherwise fall to the body.
		await tick();
		if (document.activeElement === document.body) document.getElementById('main')?.focus();
	}

	function start(focusKeep = true) {
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
		// A script focus draws no ring when the last focus was not a keyboard focus, and the ring is the cue.
		if (focusKeep) keep?.focus({ focusVisible: true });
	}

	onMount(() => {
		try {
			autoClose = localStorage.getItem('desk.autoClose') !== 'off';
		} catch {
			// Without storage the setting stays on.
		}
		if (autoClose) start();
		else phase = 'off';
		ready = true;
		return () => hold?.cancel();
	});

	function saveAutoClose() {
		try {
			localStorage.setItem('desk.autoClose', autoClose ? 'on' : 'off');
		} catch {
			// The toggle still holds for this page.
		}
		if (!autoClose && phase === 'counting') stop('Auto-close is off. This tab stays open.', 'off');
		// The reader is on the toggle, so the restart leaves focus there.
		else if (autoClose && phase !== 'counting' && phase !== 'closing') start(false);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && phase === 'counting') stop('This tab stays open.', 'kept');
	}
</script>

<svelte:head><title>Nothing waiting · Approval Queue</title></svelte:head>
<svelte:document onkeydown={onKeydown} />

<main id="main" tabindex="-1" class="relative isolate flex flex-1 items-start px-5 pt-16 lg:px-8">
	<div class="max-w-[60ch]">
		<h1 class="desk-title text-[1.6rem] leading-tight"><i class="site-benchmark"></i>Nothing waiting</h1>
		<p class="mt-2">
			Every waiting session has its answer.
			{#if !ready}
				<!-- Nothing yet: the saved setting decides what to say. -->
			{:else if phase === 'counting'}
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
		<p class="desk-muted mt-8 text-sm">New items open in this tab.</p>
	</div>
</main>
