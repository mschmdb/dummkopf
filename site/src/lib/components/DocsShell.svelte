<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { navigation, type Heading } from '#lib/content/index.js';

	let { headings = [], children }: { headings?: Heading[]; children: Snippet } = $props();
	const toc = $derived(headings.filter((heading) => heading.depth <= 3));
</script>

<div class="grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)_12rem]">
	<nav aria-label="Documentation" class="text-sm lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:max-h-[calc(100vh-var(--header-height)-3rem)] lg:self-start lg:overflow-y-auto">
		{#each navigation as group (group.title)}
			<h2 class="mt-6 mb-2 font-mono text-xs tracking-wide text-ink-subtle uppercase first:mt-0">{group.title}</h2>
			<ul class="space-y-1">
				{#each group.items as item (item.href)}
					{@const current = page.url.pathname === item.href}
					<li>
						<a
							href={item.href}
							aria-current={current ? 'page' : undefined}
							class="block rounded-sm px-2 py-1 {current ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:text-ink'}"
							>{item.label}</a
						>
					</li>
				{/each}
			</ul>
		{/each}
	</nav>

	<article class="min-w-0">
		{@render children()}
	</article>

	{#if toc.length > 1}
		<nav aria-label="On this page" class="hidden text-sm lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:block lg:self-start">
			<h2 class="mb-2 font-mono text-xs tracking-wide text-ink-subtle uppercase">On this page</h2>
			<ul class="space-y-1">
				{#each toc as heading (heading.id)}
					<li class={heading.depth === 3 ? 'pl-3' : ''}>
						<a href="#{heading.id}" class="text-ink-muted hover:text-ink">{heading.text}</a>
					</li>
				{/each}
			</ul>
		</nav>
	{/if}
</div>
