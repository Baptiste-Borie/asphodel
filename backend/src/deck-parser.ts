export const deckSections = ["commander", "mainboard"] as const;

export type DeckSection = (typeof deckSections)[number];

export interface ParsedCard {
  quantity: number;
  name: string;
  section: DeckSection;
  /** Optional printing identity ("(DMU) 225" style export suffix) — present only when the line named one. */
  setCode?: string;
  /** A string, never a number: collector numbers are not guaranteed to be purely numeric ("123a", "★12"). */
  collectorNumber?: string;
}

export interface ParseIssue {
  line: number;
  content: string;
  message: string;
}

export interface ParsedDeck {
  cards: ParsedCard[];
  issues: ParseIssue[];
  summary: {
    entries: number;
    totalCards: number;
  };
}

const sectionByHeading: Record<string, DeckSection> = {
  commander: "commander",
  mainboard: "mainboard",
};

// Groupe 1 : la quantité. Groupe 2 : le reste de la ligne (nom, éventuellement suivi de l'empreinte).
// Le "x" est optionnel : "1x Sol Ring" et "1 Sol Ring" sont tous deux acceptés.
const cardLinePattern = /^(\d+)\s*x?\s+(.+)$/i;
// Empreinte optionnelle façon export ("Nom (DMU) 225") : groupe 1 = nom, groupe 2 = code d'édition,
// groupe 3 = numéro de collection (chaîne : "225", "123a", "★12"... jamais un entier supposé).
const printingSuffixPattern = /^(.+)\(([A-Za-z0-9]+)\)\s*(\S+)$/;

export function parseDeckList(text: string): ParsedDeck {
  const cards: ParsedCard[] = [];
  const issues: ParseIssue[] = [];
  let currentSection: DeckSection | undefined;

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();

    // Les lignes vides servent uniquement à aérer la liste.
    if (line === "") return;

    const section = sectionByHeading[line.toLowerCase()];

    if (section) {
      currentSection = section;
      return;
    }

    if (!currentSection) {
      issues.push({
        line: index + 1,
        content: line,
        message: "La carte doit être placée sous Commander ou Mainboard.",
      });
      return;
    }

    const match = cardLinePattern.exec(line);

    if (!match) {
      issues.push({
        line: index + 1,
        content: line,
        message: "Format attendu : quantité x nom de la carte (exemple : 1x Sol Ring).",
      });
      return;
    }

    const quantity = Number(match[1]);
    let name = match[2]?.trim() ?? "";
    let setCode: string | undefined;
    let collectorNumber: string | undefined;

    // Only strips a trailing "(SET) NUMBER" when the whole shape matches cleanly and leaves a
    // non-empty name — an unclosed/incomplete suffix is kept as plain (harmless) name text rather
    // than rejected, since it is not actually ambiguous with any real quantity/name issue below.
    const printingMatch = printingSuffixPattern.exec(name);
    if (printingMatch) {
      const candidateName = printingMatch[1]!.trim();
      if (candidateName !== "") {
        name = candidateName;
        setCode = printingMatch[2]!.toLowerCase();
        collectorNumber = printingMatch[3]!;
      }
    }

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      issues.push({
        line: index + 1,
        content: line,
        message: "La quantité doit être un entier supérieur à zéro.",
      });
      return;
    }

    if (name === "") {
      issues.push({
        line: index + 1,
        content: line,
        message: "Le nom de la carte est obligatoire.",
      });
      return;
    }

    cards.push({
      quantity, name, section: currentSection,
      ...(setCode !== undefined && collectorNumber !== undefined ? { setCode, collectorNumber } : {}),
    });
  });

  if (cards.length === 0 && issues.length === 0) {
    issues.push({
      line: 1,
      content: "",
      message: "La liste ne contient aucune carte.",
    });
  }

  return {
    cards,
    issues,
    summary: {
      entries: cards.length,
      totalCards: cards.reduce((total, card) => total + card.quantity, 0),
    },
  };
}
