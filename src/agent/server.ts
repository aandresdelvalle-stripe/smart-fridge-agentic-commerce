import "../load-env.js";
import { buildAgentApp } from "./app.js";

const { app } = await buildAgentApp();
const port = Number(process.env.AGENT_PORT ?? 4243);
await app.listen({ port, host: "0.0.0.0" });
