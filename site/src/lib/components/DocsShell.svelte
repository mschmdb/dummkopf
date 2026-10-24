<script lang="ts">
	import type { Snippet } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import FolderGit2 from '@lucide/svelte/icons/folder-git-2';
	import SquareTerminal from '@lucide/svelte/icons/square-terminal';
	import { navigation, type Heading } from '#lib/content/index.js';

	let { headings = [], children }: { headings?: Heading[]; children: Snippet } = $props();
	const toc = $derived(headings.filter((heading) => heading.depth <= 3));
	const ICONS = { Docs: BookOpen, Commands: SquareTerminal, Project: FolderGit2 } as const;
	const currentLabel = $derived(
		navigation.flatMap((group) => group.items).find((item) => item.href === page.url.pathname)?.label ?? 'Menu'
	);

	// On small screens the navigation starts closed, so the page content comes first.
	let open = $state(false);
	afterNavigate(() => {
		open = false;
	});
</script>

<div class="grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)_12rem]">
	<nav aria-label="Documentation" class="text-sm lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:max-h-[calc(100vh-var(--header-height)-3rem)] lg:self-start lg:overflow-y-auto">
		<button
			type="button"
			class="flex h-11 w-full items-center justify-between gap-2 rounded-md border border-rule px-3 text-ink lg:hidden"
			aria-expanded={open}
			aria-controls="docs-nav"
			onclick={() => (open = !open)}
		>
			<span><span class="text-ink-subtle">Docs menu:</span> {currentLabel}</span>
			<ChevronDown size={18} aria-hidden="true" class={open ? 'rotate-180' : ''} />
		</button>
		<div id="docs-nav" class="{open ? 'block' : 'hidden'} mt-4 lg:mt-0 lg:block">
			{#each navigation as group (group.title)}
				{@const Icon = ICONS[group.title as keyof typeof ICONS]}
				<h2 class="mt-6 mb-2 flex items-center gap-2 px-2 text-sm font-semibold text-ink first:mt-0">
					{#if Icon}<Icon size={16} aria-hidden="true" class="text-ink-subtle" />{/if}
					{group.title}
				</h2>
				<ul class="space-y-1">
					{#each group.items as item (item.href)}
						{@const current = page.url.pathname === item.href}
						<li>
							<a
								href={item.href}
								aria-current={current ? 'page' : undefined}
								class="block rounded-sm px-2 py-1.5 {current ? 'bg-accent-soft font-medium text-ink' : 'text-ink-muted hover:text-ink'}"
								>{item.label}</a
							>
						</li>
					{/each}
				</ul>
			{/each}
		</div>
	</nav>

	<article class="min-w-0">
		{@render children()}
	</article>

	{#if toc.length > 1}
		<nav aria-label="On this page" class="hidden text-sm lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:block lg:self-start">
			<h2 class="mb-2 text-sm font-semibold text-ink">On this page</h2>
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
