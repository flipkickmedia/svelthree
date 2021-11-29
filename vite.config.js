import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import sveltePreprocess from "svelte-preprocess"

export default defineConfig({
	plugins: [
		svelte({
			preprocess: sveltePreprocess(),
			// see https://github.com/sveltejs/vite-plugin-svelte/blob/93ca647767c683d9f8996e670ae5c1b8171adc21/packages/vite-plugin-svelte/src/utils/options.ts#L260
			hot: {
				acceptAccessors: true
			}
		})
	]
})
