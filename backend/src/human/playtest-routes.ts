import type { FastifyInstance, FastifyReply } from "fastify";
import type { AgentChoice } from "../agent/baseline-agent.js";
import type { DeckInput } from "../decks/deck-resolver.js";
import { ArchidektDeckSourceError } from "../decks/archidekt-deck-source.js";
import { ForgeDeckAdapterError } from "../forge/forge-deck-adapter.js";
import { PlaytestSessionError, PlaytestSessionManager } from "./playtest-session-manager.js";
import { WebHumanDecisionError } from "./web-human-decision-provider.js";

interface DeckInputBody {
  type: "fixture" | "library" | "archidekt";
  value?: string;
}
interface StartPlaytestBody {
  humanDeck: DeckInputBody;
  asphodelDeck: DeckInputBody;
  seed?: number;
}
interface SessionParams {
  sessionId: string;
}

const deckInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    type: { enum: ["fixture", "library", "archidekt"] },
    value: { type: "string", minLength: 1 },
  },
} as const;

const startPlaytestBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["humanDeck", "asphodelDeck"],
  properties: {
    humanDeck: deckInputSchema,
    asphodelDeck: deckInputSchema,
    seed: { type: "integer" },
  },
} as const;

const sessionParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sessionId"],
  properties: { sessionId: { type: "string", minLength: 1 } },
} as const;

function toDeckInput(body: DeckInputBody): DeckInput {
  if (body.type === "fixture") return { type: "fixture" };
  if (!body.value) throw new PlaytestValidationError(`"${body.type}" deck input requires a non-empty "value".`);
  return { type: body.type, value: body.value };
}

class PlaytestValidationError extends Error {
  readonly code = "INVALID_PLAYTEST_INPUT";
  constructor(message: string) {
    super(message);
  }
}

/** Every error this route surface throws carries a stable `code`; only the HTTP status differs. */
const STATUS_BY_CODE: Record<string, number> = {
  INVALID_PLAYTEST_INPUT: 400,
  INVALID_URL: 400, INVALID_HOST: 400, PRIVATE_DECK: 400, FETCH_FAILED: 502,
  INVALID_PAYLOAD: 400, INVALID_DECK_SIZE: 400, INVALID_COMMANDER_COUNT: 400,
  INVALID_FORGE_DECK: 400, UNSUPPORTED_COMMANDER_CONFIGURATION: 400,
  PLAYTEST_ALREADY_RUNNING: 409, SESSION_NOT_FOUND: 404, NOT_WAITING_FOR_HUMAN: 409, REPORT_NOT_READY: 409,
  NO_PENDING_DECISION: 409, STALE_DECISION: 409,
};

function sendPlaytestError(reply: FastifyReply, error: unknown): FastifyReply {
  const code = error instanceof PlaytestSessionError || error instanceof WebHumanDecisionError
    || error instanceof ArchidektDeckSourceError || error instanceof ForgeDeckAdapterError || error instanceof PlaytestValidationError
    ? error.code : null;
  const message = error instanceof Error ? error.message : "Unexpected playtest error.";
  const status = code ? (STATUS_BY_CODE[code] ?? 400) : 500;
  return reply.code(status).send({ error: code ?? "INTERNAL_ERROR", message });
}

/** Thin HTTP boundary over PlaytestSessionManager. No game logic here — every route only reads/mutates the manager's already-isolated state. */
export function registerPlaytestRoutes(app: FastifyInstance, manager: PlaytestSessionManager): void {
  app.post<{ Body: StartPlaytestBody }>(
    "/playtests",
    { schema: { body: startPlaytestBodySchema } },
    async (request, reply) => {
      try {
        const result = await manager.start({
          humanDeck: toDeckInput(request.body.humanDeck),
          asphodelDeck: toDeckInput(request.body.asphodelDeck),
          ...(request.body.seed === undefined ? {} : { seed: request.body.seed }),
        });
        return reply.code(201).send(result);
      } catch (error) {
        return sendPlaytestError(reply, error);
      }
    },
  );

  // Registered before the parametric :sessionId route below; Fastify's router matches the
  // static "active" segment first regardless, but this keeps the two from ever looking ambiguous.
  app.get("/playtests/active", async () => manager.getActiveState() ?? { active: false });

  app.get<{ Params: SessionParams }>(
    "/playtests/:sessionId",
    { schema: { params: sessionParamsSchema } },
    async (request, reply) => {
      try {
        return manager.getState(request.params.sessionId);
      } catch (error) {
        return sendPlaytestError(reply, error);
      }
    },
  );

  app.post<{ Params: SessionParams; Body: AgentChoice }>(
    "/playtests/:sessionId/choice",
    { schema: { params: sessionParamsSchema } },
    async (request, reply) => {
      try {
        manager.submitChoice(request.params.sessionId, request.body);
        return { accepted: true };
      } catch (error) {
        return sendPlaytestError(reply, error);
      }
    },
  );

  app.post<{ Params: SessionParams }>(
    "/playtests/:sessionId/end",
    { schema: { params: sessionParamsSchema } },
    async (request, reply) => {
      try {
        return await manager.end(request.params.sessionId);
      } catch (error) {
        return sendPlaytestError(reply, error);
      }
    },
  );

  app.get<{ Params: SessionParams }>(
    "/playtests/:sessionId/report",
    { schema: { params: sessionParamsSchema } },
    async (request, reply) => {
      try {
        return manager.getReport(request.params.sessionId);
      } catch (error) {
        return sendPlaytestError(reply, error);
      }
    },
  );
}
