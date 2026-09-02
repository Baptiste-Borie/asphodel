import { createDatabase } from "./client.js";

const database = await createDatabase();
database.close();

console.log("Migrations SQLite appliquées.");
