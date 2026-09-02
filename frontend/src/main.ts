import "./style.css";

type DeckSection = "commander" | "mainboard";

interface ParsedCard {
  quantity: number;
  name: string;
  section: DeckSection;
}

interface ParseIssue {
  line: number;
  content: string;
  message: string;
}

interface ParseDeckResponse {
  cards: ParsedCard[];
  issues: ParseIssue[];
  summary: {
    entries: number;
    totalCards: number;
  };
  message?: string;
}

const status = document.querySelector<HTMLSpanElement>("#backend-status");
const deckModal = document.querySelector<HTMLDialogElement>("#deck-modal");
const openDeckModalButton =
  document.querySelector<HTMLButtonElement>("#open-deck-modal");
const deckForm = document.querySelector<HTMLFormElement>("#deck-form");
const deckInput = document.querySelector<HTMLTextAreaElement>("#deck-input");
const deckResult = document.querySelector<HTMLElement>("#deck-result");
const parseDeckButton = document.querySelector<HTMLButtonElement>("#parse-deck");
const closeDeckModalButtons = document.querySelectorAll<HTMLButtonElement>(
  "#close-deck-modal, #cancel-deck-modal",
);

async function checkBackend(): Promise<void> {
  if (!status) return;

  try {
    const response = await fetch("/health");

    status.textContent = response.ok ? "Online" : "Offline";
    status.dataset.status = response.ok ? "online" : "offline";
  } catch {
    status.textContent = "Offline";
    status.dataset.status = "offline";
  }
}

void checkBackend();

openDeckModalButton?.addEventListener("click", () => {
  deckModal?.showModal();
  deckInput?.focus();
});

closeDeckModalButtons.forEach((button) => {
  button.addEventListener("click", () => {
    deckModal?.close();
  });
});

deckModal?.addEventListener("click", (event) => {
  if (event.target === deckModal) {
    deckModal.close();
  }
});

function createCardList(cards: ParsedCard[]): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "parsed-card-list";

  cards.forEach((card) => {
    const item = document.createElement("li");
    const quantity = document.createElement("span");

    quantity.className = "parsed-card-quantity";
    quantity.textContent = `${card.quantity}×`;
    item.append(quantity, document.createTextNode(card.name));
    list.append(item);
  });

  return list;
}

function renderParsedDeck(result: ParseDeckResponse): void {
  if (!deckResult) return;

  deckResult.replaceChildren();
  deckResult.className = "deck-result deck-result--success";

  const header = document.createElement("div");
  header.className = "result-header";

  const title = document.createElement("h3");
  title.textContent = "Deck reconnu";

  const total = document.createElement("span");
  total.className = "result-total";
  total.textContent = `${result.summary.totalCards} cartes`;
  header.append(title, total);

  const description = document.createElement("p");
  description.className = "result-description";
  description.textContent = `${result.summary.entries} entrées analysées avec succès.`;

  const sections = document.createElement("div");
  sections.className = "parsed-sections";

  (["commander", "mainboard"] as const).forEach((sectionName) => {
    const cards = result.cards.filter((card) => card.section === sectionName);
    if (cards.length === 0) return;

    const section = document.createElement("section");
    const sectionTitle = document.createElement("h4");
    const sectionTotal = cards.reduce((sum, card) => sum + card.quantity, 0);

    sectionTitle.textContent = `${sectionName === "commander" ? "Commander" : "Mainboard"} · ${sectionTotal}`;
    section.append(sectionTitle, createCardList(cards));
    sections.append(section);
  });

  deckResult.append(header, description, sections);
  deckResult.hidden = false;
}

function renderParseError(message: string, issues: ParseIssue[] = []): void {
  if (!deckResult) return;

  deckResult.replaceChildren();
  deckResult.className = "deck-result deck-result--error";

  const title = document.createElement("h3");
  title.textContent = "Deck non reconnu";

  const description = document.createElement("p");
  description.className = "result-description";
  description.textContent = message;
  deckResult.append(title, description);

  if (issues.length > 0) {
    const list = document.createElement("ul");
    list.className = "parse-issue-list";

    issues.forEach((issue) => {
      const item = document.createElement("li");
      const line = document.createElement("strong");
      const content = document.createElement("code");

      line.textContent = `Ligne ${issue.line} — `;
      content.textContent = issue.content || "ligne vide";
      item.append(line, document.createTextNode(issue.message), content);
      list.append(item);
    });

    deckResult.append(list);
  }

  deckResult.hidden = false;
}

deckInput?.addEventListener("input", () => {
  if (deckResult) deckResult.hidden = true;
});

deckForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = deckInput?.value.trim() ?? "";
  if (!parseDeckButton) return;

  if (text === "") {
    renderParseError("Collez une liste de deck avant de lancer l’analyse.");
    return;
  }

  parseDeckButton.disabled = true;
  parseDeckButton.textContent = "Analyse…";
  deckResult?.setAttribute("aria-busy", "true");

  try {
    const response = await fetch("/decks/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const result = (await response.json()) as ParseDeckResponse;

    if (!response.ok) {
      renderParseError(
        result.message ?? "Le backend n’a pas pu analyser cette liste.",
        result.issues,
      );
      return;
    }

    renderParsedDeck(result);
  } catch {
    renderParseError(
      "Le backend est inaccessible. Vérifiez qu’il fonctionne sur le port 3000.",
    );
  } finally {
    parseDeckButton.disabled = false;
    parseDeckButton.textContent = "Analyser le deck";
    deckResult?.removeAttribute("aria-busy");
  }
});
