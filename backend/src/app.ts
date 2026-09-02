import cors from "@fastify/cors";
import Fastify from "fastify";
import { parseDeckList } from "./deck-parser.js";

interface ParseDeckBody {
  text: string;
}

export function buildApp() {
  const app = Fastify();

  void app.register(cors, {
    origin: "http://localhost:5173",
  });

  app.get("/health", async () => {
    return {
      status: "ok",
      project: "asphodel",
    };
  });

  app.post<{ Body: ParseDeckBody }>(
    "/decks/parse",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["text"],
          properties: {
            text: { type: "string", minLength: 1, maxLength: 100_000 },
          },
        },
      },
    },
    async (request, reply) => {
      const result = parseDeckList(request.body.text);

      if (result.issues.length > 0) {
        return reply.code(422).send({
          error: "INVALID_DECK_FORMAT",
          message: "Certaines lignes de la liste ne respectent pas le format attendu.",
          ...result,
        });
      }

      return result;
    },
  );

  return app;
}
