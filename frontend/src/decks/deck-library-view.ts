import { apiRequest, ApiError } from "../api/api-client.js";
import { element } from "../dom.js";

type DeckSection = "commander" | "mainboard";

interface DeckSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  totalCards: number;
  commander: {
    name: string;
    imageUri: string | null;
  } | null;
}

interface DeckCard {
  id: number;
  scryfallId: string;
  oracleId: string | null;
  name: string;
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  oracleText: string | null;
  colors: string[];
  colorIdentity: string[];
  imageUri: string | null;
  quantity: number;
  section: DeckSection;
}

interface DeckDetail {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  totalCards: number;
  cards: DeckCard[];
}

/** Wires the existing Deck Library screen (unchanged behavior from before V2e) and returns the controls the app shell's nav needs. */
export function initDeckLibraryView() {
  const libraryView = element<HTMLElement>("#library-view");
  const detailView = element<HTMLElement>("#detail-view");
  const deckLibrary = element<HTMLElement>("#deck-library");
  const libraryFeedback = element<HTMLParagraphElement>("#library-feedback");
  const deckDetail = element<HTMLElement>("#deck-detail");
  const deckModal = element<HTMLDialogElement>("#deck-modal");
  const deckForm = element<HTMLFormElement>("#deck-form");
  const deckNameInput = element<HTMLInputElement>("#deck-name");
  const deckInput = element<HTMLTextAreaElement>("#deck-input");
  const importFeedback = element<HTMLElement>("#import-feedback");
  const saveDeckButton = element<HTMLButtonElement>("#save-deck");

  let currentDeck: DeckDetail | null = null;

  function showLibrary(): void {
    currentDeck = null;
    detailView.hidden = true;
    libraryView.hidden = false;
  }

  function showLibraryFeedback(message: string): void {
    libraryFeedback.textContent = message;
    libraryFeedback.hidden = false;
  }

  function createImageFallback(name: string): HTMLDivElement {
    const fallback = document.createElement("div");
    fallback.className = "card-image-fallback";
    fallback.textContent = name.slice(0, 1).toUpperCase();
    return fallback;
  }

  function createCardImage(name: string, imageUri: string | null, className: string): HTMLElement {
    if (!imageUri) return createImageFallback(name);

    const image = document.createElement("img");
    image.className = className;
    image.src = imageUri;
    image.alt = `Illustration de ${name}`;
    image.loading = "lazy";
    image.addEventListener("error", () => image.replaceWith(createImageFallback(name)));
    return image;
  }

  function formatDate(date: string): string {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(date));
  }

  function createDeckTile(deck: DeckSummary): HTMLButtonElement {
    const tile = document.createElement("button");
    tile.className = "deck-tile";
    tile.type = "button";
    tile.addEventListener("click", () => void openDeck(deck.id));

    const visual = document.createElement("div");
    visual.className = "deck-tile-visual";
    visual.append(
      createCardImage(deck.commander?.name ?? deck.name, deck.commander?.imageUri ?? null, "deck-cover-image"),
    );

    const cardCount = document.createElement("span");
    cardCount.className = "deck-count";
    cardCount.textContent = `${deck.totalCards} cartes`;
    visual.append(cardCount);

    const information = document.createElement("div");
    information.className = "deck-tile-information";

    const name = document.createElement("h2");
    name.textContent = deck.name;

    const commander = document.createElement("p");
    commander.className = "deck-commander-name";
    commander.textContent = deck.commander?.name ?? "Commander non renseigné";

    const date = document.createElement("p");
    date.className = "deck-date";
    date.textContent = `Mis à jour le ${formatDate(deck.updatedAt)}`;

    information.append(name, commander, date);
    tile.append(visual, information);
    return tile;
  }

  function renderEmptyLibrary(): void {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";

    const mark = document.createElement("div");
    mark.className = "empty-state-mark";
    mark.textContent = "+";

    const title = document.createElement("h2");
    title.textContent = "Votre bibliothèque est vide";

    const description = document.createElement("p");
    description.textContent = "Importez une decklist pour créer votre premier deck persistant.";

    const button = document.createElement("button");
    button.className = "primary-button";
    button.type = "button";
    button.textContent = "Importer mon premier deck";
    button.addEventListener("click", openImportModal);

    emptyState.append(mark, title, description, button);
    deckLibrary.append(emptyState);
  }

  async function loadDecks(): Promise<void> {
    libraryFeedback.hidden = true;
    deckLibrary.className = "deck-library deck-library--loading";
    deckLibrary.textContent = "Chargement de la bibliothèque…";

    try {
      const result = await apiRequest<{ decks: DeckSummary[] }>("/decks");
      deckLibrary.replaceChildren();
      deckLibrary.className = "deck-library";

      if (result.decks.length === 0) {
        renderEmptyLibrary();
        return;
      }

      result.decks.forEach((deck) => deckLibrary.append(createDeckTile(deck)));
    } catch (error) {
      deckLibrary.replaceChildren();
      deckLibrary.className = "deck-library";
      showLibraryFeedback(error instanceof Error ? error.message : "Impossible de charger la bibliothèque.");
    }
  }

  function createVisualCard(card: DeckCard): HTMLElement {
    const item = document.createElement("article");
    item.className = "visual-card";

    const visual = document.createElement("div");
    visual.className = "visual-card-image-wrap";
    visual.append(createCardImage(card.name, card.imageUri, "visual-card-image"));

    const quantity = document.createElement("span");
    quantity.className = "visual-card-quantity";
    quantity.textContent = `${card.quantity}×`;
    visual.append(quantity);

    const information = document.createElement("div");
    information.className = "visual-card-information";

    const name = document.createElement("h3");
    name.textContent = card.name;
    name.title = card.name;

    const type = document.createElement("p");
    type.textContent = card.typeLine;
    type.title = card.typeLine;

    information.append(name, type);
    item.append(visual, information);
    return item;
  }

  function createDeckSection(titleText: string, cards: DeckCard[], featured = false): HTMLElement {
    const section = document.createElement("section");
    section.className = featured ? "card-section card-section--featured" : "card-section";

    const heading = document.createElement("div");
    heading.className = "section-heading";

    const title = document.createElement("h2");
    title.textContent = titleText;

    const count = document.createElement("span");
    count.textContent = `${cards.reduce((sum, card) => sum + card.quantity, 0)} cartes`;
    heading.append(title, count);

    const grid = document.createElement("div");
    grid.className = "visual-card-grid";
    cards.forEach((card) => grid.append(createVisualCard(card)));
    section.append(heading, grid);
    return section;
  }

  function renderDeckDetail(deck: DeckDetail): void {
    currentDeck = deck;
    deckDetail.replaceChildren();

    const heading = document.createElement("div");
    heading.className = "detail-heading";

    const titleGroup = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = `${deck.totalCards} cartes · créé le ${formatDate(deck.createdAt)}`;
    const title = document.createElement("h1");
    title.textContent = deck.name;
    titleGroup.append(eyebrow, title);

    const actions = document.createElement("div");
    actions.className = "detail-actions";

    const renameButton = document.createElement("button");
    renameButton.className = "secondary-button";
    renameButton.type = "button";
    renameButton.textContent = "Renommer";
    renameButton.addEventListener("click", () => void renameCurrentDeck());

    const deleteButton = document.createElement("button");
    deleteButton.className = "danger-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Supprimer";
    deleteButton.addEventListener("click", () => void deleteCurrentDeck());

    actions.append(renameButton, deleteButton);
    heading.append(titleGroup, actions);

    const commanderCards = deck.cards.filter((card) => card.section === "commander");
    const mainboardCards = deck.cards.filter((card) => card.section === "mainboard");

    deckDetail.append(heading);
    if (commanderCards.length > 0) deckDetail.append(createDeckSection("Commander", commanderCards, true));
    if (mainboardCards.length > 0) deckDetail.append(createDeckSection("Mainboard", mainboardCards));
  }

  async function openDeck(id: number): Promise<void> {
    libraryView.hidden = true;
    detailView.hidden = false;
    deckDetail.className = "detail-loading";
    deckDetail.textContent = "Chargement du deck…";

    try {
      const deck = await apiRequest<DeckDetail>(`/decks/${id}`);
      deckDetail.className = "";
      renderDeckDetail(deck);
    } catch (error) {
      deckDetail.className = "page-feedback";
      deckDetail.textContent = error instanceof Error ? error.message : "Impossible d’ouvrir ce deck.";
    }
  }

  async function renameCurrentDeck(): Promise<void> {
    if (!currentDeck) return;

    const name = window.prompt("Nouveau nom du deck", currentDeck.name)?.trim();
    if (!name || name === currentDeck.name) return;

    try {
      const deck = await apiRequest<DeckDetail>(`/decks/${currentDeck.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      renderDeckDetail(deck);
      await loadDecks();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Le renommage a échoué.");
    }
  }

  async function deleteCurrentDeck(): Promise<void> {
    if (!currentDeck) return;
    if (!window.confirm(`Supprimer définitivement « ${currentDeck.name} » ?`)) return;

    try {
      await apiRequest<null>(`/decks/${currentDeck.id}`, { method: "DELETE" });
      showLibrary();
      await loadDecks();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "La suppression a échoué.");
    }
  }

  function openImportModal(): void {
    importFeedback.hidden = true;
    deckModal.showModal();
    deckNameInput.focus();
  }

  function closeImportModal(): void {
    if (!saveDeckButton.disabled) deckModal.close();
  }

  function renderImportError(error: ApiError): void {
    importFeedback.replaceChildren();
    importFeedback.className = "import-feedback import-feedback--error";

    const title = document.createElement("h3");
    title.textContent = "Import impossible";
    const message = document.createElement("p");
    message.textContent = error.message;
    importFeedback.append(title, message);

    const items = [
      ...(error.payload.issues?.map((issue) => `Ligne ${issue.line} : ${issue.message} (${issue.content})`) ?? []),
      ...(error.payload.cardNames?.map((cardName) => `Carte introuvable : ${cardName}`) ?? []),
    ];

    if (items.length > 0) {
      const list = document.createElement("ul");
      items.forEach((item) => {
        const line = document.createElement("li");
        line.textContent = item;
        list.append(line);
      });
      importFeedback.append(list);
    }

    importFeedback.hidden = false;
  }

  deckForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = deckNameInput.value.trim();
    const decklist = deckInput.value.trim();
    if (!name || !decklist) return;

    importFeedback.className = "import-feedback import-feedback--loading";
    importFeedback.textContent = "Résolution des cartes avec Scryfall et enregistrement…";
    importFeedback.hidden = false;
    saveDeckButton.disabled = true;
    saveDeckButton.textContent = "Import en cours…";

    try {
      const deck = await apiRequest<DeckDetail>("/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, decklist }),
      });

      deckForm.reset();
      deckModal.close();
      await loadDecks();
      await openDeck(deck.id);
    } catch (error) {
      renderImportError(error instanceof ApiError ? error : new ApiError({ message: "Le backend est inaccessible." }));
    } finally {
      saveDeckButton.disabled = false;
      saveDeckButton.textContent = "Importer et enregistrer";
    }
  });

  document.querySelectorAll<HTMLButtonElement>("[data-open-import]").forEach((button) =>
    button.addEventListener("click", openImportModal));
  element<HTMLButtonElement>("#close-deck-modal").addEventListener("click", closeImportModal);
  element<HTMLButtonElement>("#cancel-deck-modal").addEventListener("click", closeImportModal);
  element<HTMLButtonElement>("#back-to-library").addEventListener("click", showLibrary);

  deckModal.addEventListener("click", (event) => {
    if (event.target === deckModal) closeImportModal();
  });

  void loadDecks();

  return { showLibrary };
}
