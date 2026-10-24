<script lang="ts">
	// Adds a copy button to every code block on the page, after each navigation. Copies the code as written,
	// without the visual line wraps. The status line announces the result to screen readers.
	import { afterNavigate } from '$app/navigation';

	let status = $state('');

	function enhance(): void {
		for (const pre of document.querySelectorAll<HTMLPreElement>('main pre')) {
			if (pre.parentElement?.classList.contains('code-copy')) continue;
			const wrapper = document.createElement('div');
			wrapper.className = 'code-copy';
			pre.replaceWith(wrapper);
			wrapper.append(pre);
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'code-copy-button';
			button.textContent = 'Copy';
			button.setAttribute('aria-label', 'Copy code');
			button.addEventListener('click', async () => {
				try {
					await navigator.clipboard.writeText(pre.innerText.replace(/\n$/, ''));
					button.textContent = 'Copied';
					status = 'Code copied to the clipboard.';
				} catch {
					button.textContent = 'Failed';
					status = 'Copying failed. Select the code and copy it by hand.';
				}
				setTimeout(() => (button.textContent = 'Copy'), 2000);
			});
			wrapper.append(button);
		}
	}

	afterNavigate(() => enhance());
</script>

<p class="sr-only" role="status" aria-live="polite">{status}</p>
