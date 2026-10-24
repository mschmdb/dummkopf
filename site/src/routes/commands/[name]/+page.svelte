<script lang="ts">
	import DocsShell from '#lib/components/DocsShell.svelte';
	import { OPTION_GROUPS } from '#lib/content/index.js';
	import Seo from '#lib/components/Seo.svelte';

	let { data } = $props();
	const command = $derived(data.command);
	const groups = $derived(
		OPTION_GROUPS.map((group) => ({ ...group, options: command.options.filter((option) => option.group === group.key) }))
			.filter((group) => group.options.length > 0 && group.key !== 'global')
	);
	const headings = $derived([
		...(command.examples.length ? [{ depth: 2, text: 'Examples', id: 'examples' }] : []),
		...(command.positionals.length ? [{ depth: 2, text: 'Arguments', id: 'arguments' }] : []),
		...groups.map((group) => ({ depth: 2, text: group.title, id: group.key }))
	]);
</script>

<Seo kind="article" section="Commands" name="rcllr {command.name}" />

<DocsShell {headings}>
	<h1 class="font-mono text-3xl font-semibold tracking-tight">rcllr {command.name}</h1>
	<p class="mt-4 text-lg text-ink-muted">{command.purpose}</p>
	<div class="code-block mt-6" aria-label="Usage">{@html command.usageHtml}</div>
	{#if command.notes}
		<p class="mt-4 whitespace-pre-line text-ink-muted">{command.notes}</p>
	{/if}

	{#if command.examples.length}
		<h2 id="examples" class="mt-10 text-xl font-semibold">Examples</h2>
		<div class="code-block mt-4">{@html command.examplesHtml}</div>
	{/if}

	{#if command.positionals.length}
		<h2 id="arguments" class="mt-10 text-xl font-semibold">Arguments</h2>
		<dl class="mt-4 space-y-3">
			{#each command.positionals as item (item.name)}
				<div><dt class="font-mono text-sm">{item.name}</dt><dd class="text-ink-muted">{item.help}</dd></div>
			{/each}
		</dl>
	{/if}

	{#each groups as group (group.key)}
		<h2 id={group.key} class="mt-10 text-xl font-semibold">{group.title}</h2>
		<dl class="mt-4 space-y-3">
			{#each group.options as option (option.name)}
				<div><dt class="font-mono text-sm">{option.name}</dt><dd class="text-ink-muted">{option.help}</dd></div>
			{/each}
		</dl>
	{/each}

	<p class="mt-10 text-sm text-ink-subtle">Global options for every command: see <a href="/commands" class="underline hover:text-ink">all commands</a>.</p>
</DocsShell>
