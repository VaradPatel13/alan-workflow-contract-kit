import { run } from "./main";

const code = await run(process.argv);
process.exitCode = code;