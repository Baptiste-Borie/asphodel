import { ArchidektDeckSource, ArchidektDeckSourceError } from "./decks/archidekt-deck-source.js";
import { registerDeckLabRoutes } from "./cards/deck-lab-routes.js";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
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
import { CardPresentationService, MAX_CARD_PRESENTATION_NAMES } from "./cards/card-presentation-service.js";
import type { VoiceTranscriptionService } from "./voice/voice-transcription-service.js";
import { WhisperTranscriptionService } from "./voice/whisper-transcription-service.js";
import { registerVoiceRoutes } from "./voice/voice-routes.js";

interface CardPresentationBody {
  names: string[];
}

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

interface UpdateDeckCardsBody {
  groups: {
    name: string;
    section: "commander" | "mainboard" | "maybeboard";
    entries: { name: string; quantity: number }[];
  }[];
}

interface DeckParams {
  id: number;
}

export interface BuildAppOptions {
  cardProvider?: CardProvider;
  database?: DatabaseConnection;
  archidektSource?: ArchidektDeckSource;
  voiceTranscriptionService?: VoiceTranscriptionService;
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
  const deckService = new DeckService(database.db, cardProvider, options.archidektSource);
  const cardPresentationService = new CardPresentationService(cardProvider);
  const voiceTranscriptionService = options.voiceTranscriptionService ?? new WhisperTranscriptionService();

  await app.register(cors, {
    origin: /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/,
  });
  await app.register(multipart);
  registerDeckLabRoutes(app);

  if (ownsDatabase) {
    app.addHook("onClose", async () => {
      database.close();
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ArchidektDeckSourceError) {
      return reply.code(error.code === 'FETCH_FAILED' ? 502 : 400).send({ error: error.code, message: error.message });
    }
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

  app.post<{ Body: { url: string } }>("/decks/import/archidekt", {
    schema: { body: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } } } },
  }, async (request, reply) => reply.code(201).send(await deckService.importArchidektDeck(request.body.url)));

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

  // Deck Lab's Builder auto-save: replaces a deck's full card list in one shot — structured groups,
  // not decklist text, so the Builder's manual categories (not just commander/mainboard) survive.
  app.put<{ Params: DeckParams; Body: UpdateDeckCardsBody }>(
    "/decks/:id/cards",
    {
      schema: {
        params: deckIdParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["groups"],
          properties: {
            groups: {
              type: "array",
              maxItems: 60,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "section", "entries"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 60 },
                  section: { type: "string", enum: ["commander", "mainboard", "maybeboard"] },
                  entries: {
                    type: "array",
                    maxItems: 300,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["name", "quantity"],
                      properties: {
                        name: { type: "string", minLength: 1, maxLength: 200 },
                        quantity: { type: "integer", minimum: 1, maximum: 999 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request) => deckService.updateDeckCards(request.params.id, request.body.groups),
  );

  app.delete<{ Params: DeckParams }>(
    "/decks/:id",
    { schema: { params: deckIdParamsSchema } },
    async (request, reply) => {
      await deckService.deleteDeck(request.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: CardPresentationBody }>(
    "/cards/presentation",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["names"],
          properties: {
            names: {
              type: "array",
              maxItems: MAX_CARD_PRESENTATION_NAMES,
              items: { type: "string", minLength: 1, maxLength: 200 },
            },
          },
        },
      },
    },
    async (request) => ({ cards: await cardPresentationService.resolveMany(request.body.names) }),
  );

  registerPlaytestRoutes(app, new PlaytestSessionManager());
  registerVoiceRoutes(app, voiceTranscriptionService);

  return app;
}
