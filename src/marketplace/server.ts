import "../load-env.js";
import { buildMarketplaceApp } from "./app.js";

const { app } = await buildMarketplaceApp();
const port = Number(process.env.MARKETPLACE_PORT ?? 4242);
await app.listen({ port, host: "0.0.0.0" });
