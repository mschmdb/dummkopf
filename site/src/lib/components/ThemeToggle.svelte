<script lang="ts">
	import { onMount } from 'svelte';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { applyTheme, resolveTheme, THEME_STORAGE_KEY, type Theme } from '#lib/theme/theme.js';

	let theme = $state<Theme>('light');

	onMount(() => {
		let stored: string | null = null;
		try {
			stored = localStorage.getItem(THEME_STORAGE_KEY);
		} catch {
			// Private mode.
		}
		theme = resolveTheme(stored, matchMedia('(prefers-color-scheme: dark)').matches);
	});

	function toggle(): void {
		theme = theme === 'dark' ? 'light' : 'dark';
		applyTheme(theme);
	}
</script>

<button
	type="button"
	class="inline-flex size-10 items-center justify-center rounded-md text-ink-muted hover:bg-bg-elevated hover:text-ink"
	aria-label="Dark mode"
	title="Dark mode"
	aria-pressed={theme === 'dark'}
	onclick={toggle}
>
	{#if theme === 'dark'}
		<Sun size={18} aria-hidden="true" />
	{:else}
		<Moon size={18} aria-hidden="true" />
	{/if}
</button>
