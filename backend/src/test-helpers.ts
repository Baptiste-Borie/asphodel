import type { CardProvider, ResolvedCard } from "./cards/card-provider.js";
import { VoiceTranscriptionError } from "./app-errors.js";
import { createDatabase } from "./db/client.js";
import type { TranscriptionContext, VoiceTranscriptionService } from "./voice/voice-transcription-service.js";

export class FakeCardProvider implements CardProvider {
  readonly calls: string[] = [];
  readonly printingCalls: string[] = [];

  constructor(
    private readonly missingNames = new Set<string>(),
    /** key: `${setCode.toLowerCase()}/${collectorNumber}` -> the card name that printing resolves to. */
    private readonly printings = new Map<string, string>(),
  ) {}

  async findByExactName(name: string): Promise<ResolvedCard | null> {
    this.calls.push(name);
    if (this.missingNames.has(name)) return null;
    return this.synthesizeCard(name);
  }

  async findBySetAndCollector(setCode: string, collectorNumber: string): Promise<ResolvedCard | null> {
    const key = `${setCode.toLowerCase()}/${collectorNumber}`;
    this.printingCalls.push(key);
    const name = this.printings.get(key);
    return name ? this.synthesizeCard(name) : null;
  }

  private synthesizeCard(name: string): ResolvedCard {
    const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

    return {
      scryfallId: `scryfall-${slug}`,
      oracleId: `oracle-${slug}`,
      name,
      manaCost: name === "Mountain" ? null : "{1}{R}",
      manaValue: name === "Mountain" ? 0 : 2,
      typeLine: name === "Mountain" ? "Basic Land — Mountain" : "Creature",
      oracleText: null,
      colors: name === "Mountain" ? [] : ["R"],
      colorIdentity: ["R"],
      imageUri: `https://cards.example/${slug}.jpg`,
    };
  }
}

export async function createTestDatabase() {
  return createDatabase("file::memory:");
}

/** Never shells out to whisper.cpp — keeps voice route tests fast and hermetic, same spirit as FakeCardProvider not calling Scryfall. */
export class FakeVoiceTranscriptionService implements VoiceTranscriptionService {
  readonly calls: Array<{ audio: Buffer; extension: string; context: TranscriptionContext | undefined }> = [];

  constructor(
    private readonly transcript: string = "je passe la priorité",
    private readonly shouldFail = false,
  ) {}

  async transcribe(audio: Buffer, extension: string, context?: TranscriptionContext): Promise<string> {
    this.calls.push({ audio, extension, context });
    if (this.shouldFail) throw new VoiceTranscriptionError();
    return this.transcript;
  }
}
