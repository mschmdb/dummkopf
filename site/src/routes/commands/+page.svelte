<script lang="ts">
	import DocsShell from '#lib/components/DocsShell.svelte';
	import { commands, globalOptions } from '#lib/content/index.js';
	import Seo from '#lib/components/Seo.svelte';
</script>

<Seo kind="collection" name="Commands" />

<DocsShell>
	<h1 class="text-3xl font-semibold tracking-tight">Commands</h1>
	<p class="mt-4 text-ink-muted">Taken from the CLI's own help, so this page always matches the released version.</p>
	<dl class="mt-8 divide-y divide-rule border-y border-rule">
		{#each commands as command (command.name)}
			<div class="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]">
				<dt><a href="/commands/{command.name}" class="font-mono text-accent underline-offset-4 hover:underline">{command.name}</a></dt>
				<dd class="text-ink-muted">{command.purpose}</dd>
			</div>
		{/each}
	</dl>
	<h2 class="mt-10 text-xl font-semibold">Global options</h2>
	<dl class="mt-4 space-y-3">
		{#each globalOptions as option (option.name)}
			<div>
				<dt class="font-mono text-sm">{option.name}</dt>
				<dd class="text-ink-muted">{option.help}</dd>
			</div>
		{/each}
	</dl>
</DocsShell>
