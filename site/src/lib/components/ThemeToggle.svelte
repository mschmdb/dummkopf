<script lang="ts">
	import { onMount } from 'svelte';
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
	class="rounded-md border border-rule px-3 py-1.5 text-sm text-ink-muted hover:border-rule-strong hover:text-ink"
	aria-pressed={theme === 'dark'}
	onclick={toggle}
>
	Dark mode
</button>
