// Runs the CLI from its TypeScript sources, without a build. Node strips the types.
import { main } from "../src/main.ts";

process.exitCode = main(process.argv.slice(2));
