<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { NAV, SITE } from '#lib/site.js';

	let { children } = $props();
</script>

<a
	href="#main"
	class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-bg-elevated focus:px-3 focus:py-2"
>
	Skip to content
</a>

<header class="sticky top-0 z-40 border-b border-rule bg-bg/95 backdrop-blur" style="height: var(--header-height)">
	<div class="mx-auto flex h-full max-w-6xl items-center justify-between gap-4 px-4">
		<a href="/" class="font-mono text-lg font-semibold text-ink">{SITE.name}</a>
		<nav aria-label="Main" class="flex items-center gap-4 text-sm">
			{#each NAV as item (item.href)}
				<a
					href={item.href}
					class="text-ink-muted hover:text-ink"
					aria-current={page.url.pathname === item.href ? 'page' : undefined}>{item.label}</a
				>
			{/each}
			<a href={SITE.repo} class="text-ink-muted hover:text-ink">GitHub</a>
			<ThemeToggle />
		</nav>
	</div>
</header>

<main id="main" tabindex="-1" class="mx-auto max-w-6xl px-4 py-10">
	{@render children()}
</main>

<footer class="border-t border-rule">
	<div class="mx-auto max-w-6xl px-4 py-6 text-sm text-ink-subtle">
		MIT licensed. Made by <a href="https://schmidbauer.dev" class="underline hover:text-ink">Matze Schmidbauer</a>.
	</div>
</footer>
