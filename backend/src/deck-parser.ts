export const deckSections = ["commander", "mainboard"] as const;

export type DeckSection = (typeof deckSections)[number];

export interface ParsedCard {
  quantity: number;
  name: string;
  section: DeckSection;
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

// Groupe 1 : la quantité. Groupe 2 : le nom complet de la carte.
const cardLinePattern = /^(\d+)\s*x\s+(.+)$/i;

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
    const name = match[2]?.trim() ?? "";

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

    cards.push({ quantity, name, section: currentSection });
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
