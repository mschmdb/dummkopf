import { error } from "@sveltejs/kit";
import { docs } from "#lib/content/index.js";

export const entries = () => docs.map((page) => ({ slug: page.slug }));

export function load({ params }) {
  const page = docs.find((item) => item.slug === params.slug);
  if (!page) error(404, "Not found");
  return { page };
}
