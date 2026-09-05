import cors from "@fastify/cors";
import Fastify from "fastify";
import { AppError } from "./app-errors.js";
import type { CardProvider } from "./cards/card-provider.js";
import { ScryfallCardProvider } from "./cards/scryfall-provider.js";
import {
  createDatabase,
  type DatabaseConnection,
} from "./db/client.js";
import { parseDeckList } from "./deck-parser.js";
import { DeckService } from "./decks/deck-service.js";
import { PlaytestSessionManager } from "./human/playtest-session-manager.js";
import { registerPlaytestRoutes } from "./human/playtest-routes.js";

interface ParseDeckBody {
  text: string;
}

interface ImportDeckBody {
  name: string;
  decklist: string;
}

interface RenameDeckBody {
  name: string;
}

interface DeckParams {
  id: number;
}

export interface BuildAppOptions {
  cardProvider?: CardProvider;
  database?: DatabaseConnection;
}

const deckIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "integer", minimum: 1 },
  },
} as const;

const deckNameSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  pattern: ".*\\S.*",
} as const;

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify();
  const ownsDatabase = !options.database;
  const database = options.database ?? (await createDatabase());
  const cardProvider = options.cardProvider ?? new ScryfallCardProvider();
  const deckService = new DeckService(database.db, cardProvider);

  await app.register(cors, {
    origin: /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/,
  });

  if (ownsDatabase) {
    app.addHook("onClose", async () => {
      database.close();
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details && typeof error.details === "object"
          ? error.details
          : {}),
      });
    }

    return reply.send(error);
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

  app.get("/decks", async () => {
    return { decks: await deckService.listDecks() };
  });

  app.get<{ Params: DeckParams }>(
    "/decks/:id",
    { schema: { params: deckIdParamsSchema } },
    async (request) => deckService.getDeck(request.params.id),
  );

  app.post<{ Body: ImportDeckBody }>(
    "/decks",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "decklist"],
          properties: {
            name: deckNameSchema,
            decklist: { type: "string", minLength: 1, maxLength: 100_000 },
          },
        },
      },
    },
    async (request, reply) => {
      const deck = await deckService.createDeck(
        request.body.name.trim(),
        request.body.decklist,
      );
      return reply.code(201).send(deck);
    },
  );

  app.patch<{ Params: DeckParams; Body: RenameDeckBody }>(
    "/decks/:id",
    {
      schema: {
        params: deckIdParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: { name: deckNameSchema },
        },
      },
    },
    async (request) =>
      deckService.renameDeck(request.params.id, request.body.name.trim()),
  );

  app.delete<{ Params: DeckParams }>(
    "/decks/:id",
    { schema: { params: deckIdParamsSchema } },
    async (request, reply) => {
      await deckService.deleteDeck(request.params.id);
      return reply.code(204).send();
    },
  );

  registerPlaytestRoutes(app, new PlaytestSessionManager());

  return app;
}
