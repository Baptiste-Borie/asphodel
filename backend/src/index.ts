import { buildApp } from "./app.js";

async function start() {
  const app = await buildApp();

  try {
    await app.listen({
      port: 3000,
      host: "0.0.0.0",
    });

    console.log("Asphodel backend running on http://localhost:3000");
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
