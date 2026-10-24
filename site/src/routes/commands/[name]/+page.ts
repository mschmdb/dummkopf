import { error } from "@sveltejs/kit";
import { commands } from "#lib/content/index.js";

export const entries = () => commands.map((command) => ({ name: command.name }));

export function load({ params }) {
  const command = commands.find((item) => item.name === params.name);
  if (!command) error(404, "Not found");
  return { command };
}
