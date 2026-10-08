# Asphodel Desktop 0.1.16

Desktop wrapper around the existing TypeScript/Vite frontend, Node backend and pinned Forge bridge. No stack migration. Launch Asphodel, choose a saved deck, play locally, close the application. The packaged app includes Chromium/Node, Java and Forge's resources; no terminal, Node installation, Java installation or remote server is needed to run it.

## Install the current checkout on Ubuntu (patch 02)

Close Asphodel, then from the repository root:

```sh
npm --prefix desktop run install:local
```

This rebuilds the desktop runtime using the existing Forge JAR, creates `desktop/release/Asphodel-0.1.16-amd64.deb` on a normal x64 PC, checks its version/architecture and bundled components, then uses `sudo apt-get install --reinstall` to install it. Compilation runs as your normal user; sudo is requested only for the package installation. The command requires the same build dependencies and Forge resources as the existing desktop build.

Afterwards, open **Asphodel** from Ubuntu's application menu and pin it to your dock if desired. The package installs the app in `/opt/Asphodel`, the desktop entry `Asphodel.desktop`, the existing icon and the `asphodel` command. This launch uses the installed app, independent of the checkout, and needs no local server command. The normal desktop settings, fullscreen preference and Quitter button remain available.

To update after a new patch/pull, close Asphodel and run the same command again. Decks, cached images, drafts and display settings remain in the existing `~/.config/Asphodel` profile; the package contains no home-directory files. Package removal (`sudo apt-get remove asphodel-desktop`) leaves this profile in place. Backup/restore is available in settings; abrupt-crash recovery still depends on a persisted draft.

To build without installing, use `npm --prefix desktop run dist:deb`, then `npm --prefix desktop run check:package`. A downloaded `.deb` can also be installed with `sudo apt install ./Asphodel-0.1.16-amd64.deb` from the directory containing it. The `.deb` is the recommended installation format for Ubuntu; AppImage remains available through `dist`.

## Automated Linux packages

The Desktop workflow now runs for relevant changes on `main`, matching pull requests, manual dispatch, and `v*` tags. A release tag must equal the desktop version (for example `v0.1.11`); both package files must agree. A newer run on the same ref cancels an obsolete build.

CI runs the existing desktop/window/artwork/runtime checks, builds versioned AppImage and Debian packages, and checks that the `.deb` contains the launcher, icon, frontend, backend dependencies, seed library, Java and Forge. Successful packages appear in the workflow's **Artifacts**, under `Asphodel-Desktop-Linux-<commit>`. Building does not automatically publish a release or install an updater.

## Build on Linux

Prerequisites for **building**: Node 22.16+ (Node 24 LTS recommended), a JDK 17+ with `jlink`, and the normal Electron Linux libraries. These are not prerequisites for the person using the finished app. Build on the platform you intend to run.

```sh
npm --prefix backend ci
npm --prefix frontend ci
./scripts/forge-build.sh
npm --prefix desktop ci

# Optional: download illustrations for the bundled deck library before building.
npm --prefix desktop run cache-art

npm --prefix desktop run dev
```

To make an AppImage and a Debian package:

```sh
npm --prefix desktop run dist
```

Outputs are in `desktop/release/`. Double-click the AppImage (make it executable first if necessary), or install the `.deb` and launch Asphodel from the applications menu. `npm --prefix desktop run pack` makes an unpacked runnable application for inspection. Set `ASPHODEL_JAVA_HOME` to the JDK directory if Java isn't on your PATH. The existing web/dev scripts remain available.

## Local data and offline scope

- The seed library is copied **once** on first launch. User changes live in Electron's `userData` directory (usually `~/.config/Asphodel` on Linux); subsequent builds do not replace them. Use **Paramètres → Ouvrir mes données** to find the decks, search index, cached artwork, reports and `desktop.log`.
- Drafts and spatial table layouts in `localStorage` use the stable `asphodel://app` origin. The internal backend picks a free loopback port; port changes do not reset these drafts.
- Saved decks and fixture games run offline. Existing card metadata is read from the deck database before consulting Scryfall. Unknown token presentation is optional and never blocks the game.
- Scryfall's joined recto-verso names are resolved through Forge's actual card faces, including Avatar Aang. Cards genuinely absent from the pinned Forge version still need a compatible engine update.
- Artwork is saved to disk on first successful download, then reused offline, including after restarting the app. The HTTPS handler keeps the original image URLs and serves them from this cache; downloads use a separate Chromium session with system networking support. Failures appear in the terminal and `desktop.log`. `cache-art` seeds the package's artwork cache for all cards in the bundled library. Missing uncached images require a connection; the card's textual presentation remains available.
- Complete card search and importing new cards require the Scryfall snapshots. When `backend/data/scryfall-oracle-cards.jsonl.gz` and `backend/data/scryfall-default-cards.jsonl.gz` exist during the build, they are bundled and copied once into the app's data directory. You can also copy them into that directory later, then restart Asphodel. Without Default Cards, search reports a catalogue-unavailable message.
- Archidekt URL imports need internet. Voice is optional and still requires the existing Whisper/FFmpeg setup and models. This milestone does not add cloud sync, mobile distribution or a campaign.
- Desktop data is independent of the web checkout after its initial seed. Copying a newer seed into a release is not a synchronisation mechanism.

## Verification

```sh
npm --prefix desktop test
npm --prefix desktop run smoke:runtime
npm --prefix desktop run smoke
# In a headless Linux CI machine:
xvfb-run -a npm --prefix desktop run smoke
```

The smoke check uses a disposable data directory and verifies first launch, image display and disk reuse after an offline restart, persistent deck changes and localStorage across a restart, real Forge gameplay, and quitting during an active game. Native window checks require an environment which allows Electron's Unix sockets/display connections.

The runtime check uses Electron's bundled Node with external networking disabled and verifies the actual emitted backend and bundled Java runtime. The GitHub Actions Desktop workflow runs both checks, then provides the AppImage and Debian package as build artifacts.

The window is sandboxed with no Node access. The local server listens only on `127.0.0.1`, uses an ephemeral port and rejects requests without a random token held by the main process. Navigation remains inside Asphodel; external links open in the system browser. The backend closes the active Forge JVM and SQLite connections when the app quits.

Next work should improve distribution, recovery, the builder and play experience within the existing engine.

## Display controls (patch 01)

First launch opens fullscreen, with no native application menu. **Paramètres** in the app navigation switches between fullscreen and a window; **F11** does the same, including while the settings dialog is open. The selected mode is stored atomically in `userData/display-preferences.json` and restored on launch. Escape closes dialogs without changing the display preference. **Quitter** uses the existing backend shutdown/report flow. **Ouvrir mes données** is now in settings. These controls are hidden in the web version.

The sandboxed CommonJS preload exposes only specific app commands and subscriptions. The main process accepts them only from the app window's main frame at `asphodel://app`. Node integration stays disabled. Development tools remain accessible with Ctrl+Shift+I in unpackaged builds.

After applying the patch to an already built checkout, run `npm --prefix desktop run build` to refresh the bundled frontend, then launch as usual. The existing Forge JAR is sufficient; there is no Forge source change in this patch.

`npm --prefix desktop run smoke:window` tests the real Electron window and compiled frontend against a disposable catalogue without Java/Forge. It covers default fullscreen, the absent menu after Alt, settings and F11, preferences across restarts, text editing, isolation of another window and the Quitter command. It requires an available display (or Xvfb) and Electron's normal IPC support.

## Reliable builder persistence (patch 03)

Deck contents, empty categories, cuts, selected card metadata, stable entry/group ids, card positions, zones and camera now share a versioned builder snapshot. A `deck_projects` SQLite table is added by the normal migration on launch; saved snapshots and gameplay deck entries are updated in the same transaction. Existing deck ids/cards remain unchanged. The first opening of an older deck imports its local `asphodel.deck-table.v1.<id>` layout; that key is retained for rollback.

Every completed edit writes a local recovery journal before the 700 ms API debounce. Empty sheets are valid saved projects. An outstanding journal appears at startup with **Reprendre les brouillons**; it is never silently applied over the database. Confirmed journals are removed to avoid accumulating full card snapshots in browser storage. Corrupt journals are reported and kept untouched. An API failure offers **Réessayer** in both builders. An acknowledgement for an older edit never marks a newer edit saved.

The 0.1.6 hotfix releases close-guard listeners using the captured WebContents reference, without accessing the already destroyed native window. It also drains a pending close request if the window is destroyed, without opening a save-failure dialog on that window.

Quitter and the native close button keep the renderer/backend alive while pending saves drain. A failed or unresponsive save offers staying in the app or explicitly quitting anyway. Abrupt kills/power loss cannot run this handshake; recovery depends on the browser having persisted its local journal. Storage/quota errors are reported, rather than claiming a crash-proof guarantee. Full library backup/restore and text export are described below (patch 04).

Reinstall locally after applying this patch:

```sh
npm --prefix desktop run install:local
```

This update adds a table; it does not delete existing deck data.

## Portable library and text export (patch 04)

In **Paramètres → Bibliothèque et sauvegardes**, use **Sauvegarder ma bibliothèque** to choose a `.asphodel.json` file. Pending edits in open tables are flushed first. The versioned JSON contains all saved decks (including old imports and empty projects), game quantities/commanders, full builder snapshots, empty categories, candidates, cuts, selected printing/face metadata, table positions/zones/camera, pending recovery journals, legacy table layouts, Selection, approved voice vocabulary and the display mode. Invalid/unreadable draft strings are preserved instead of silently discarded.

The archive is limited to 64 MiB, with 4 MiB of renderer storage. It contains neither image bytes nor the bulk/search catalogue, Java/Forge, models, active game sessions or diagnostic report files. Durable playtest reviews and their frozen lists are included. A fresh/offline profile can restore the cards and decks without resolving their names on the network; image availability still depends on that profile's existing cache or a later download. The format version is checked separately from the application version.

**Choisir une sauvegarde…** validates the file and shows its date, deck names/count and draft count. **Restaurer cette sauvegarde…** requires a native confirmation and replaces the library rather than merging it. End an active game first. Before replacing anything, Asphodel creates an exact safety copy of the current library/storage/display in `userData/backups/avant-restauration-*.asphodel.json`; opening the data folder gives access to these files. They can be restored through the same chooser. No safety-copy write means no replacement.

Decks/cards/projects are restored in a single SQLite transaction and deck ids/timestamps are retained. A failed transaction leaves the old library intact. An on-disk `pending-library-restore.json` intent makes an interrupted restore retryable before any renderer table is mounted. The renderer applies only known library storage keys, flushes Chromium storage and acknowledges the intent; only then is it removed. A quota/storage error shows a blocking retry/quit screen, so an old table cannot overwrite the restored library. Restoring reloads the app view, not the Electron process.

**Exporter** in Builder V1, or **Table tools → Exporter le deck** in V2, opens a selectable text preview with copy and save-to-`.txt` actions. Default output uses `Commander` and `Mainboard`, aggregates a card appearing in several categories and excludes candidates/cuts. It round-trips through Asphodel's text importer. Optional `Maybeboard` output is intended for destinations that recognize that section; Asphodel's current plain-text importer supports only Commander/Mainboard. Printing metadata is retained by the full archive; text export contains names and quantities.

No new database migration is required. Rebuild/install with `npm --prefix desktop run install:local` after applying the patch.


## Builder undo/redo (patch 05)

**Annuler / Rétablir** are available in both Builder V1 and Table V2. Use Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo. Text inputs, selects, editable content and open modal dialogs retain their own keyboard behavior. Buttons show the next action in their tooltip and disable when no action is available.

Each open deck has one history shared across the two builders and retained when switching decks. It covers additions, candidates, cuts/restores, quantities, category changes/order, deck names, triage, batch inclusion/exclusion and table card/zone edits. Quantity fields accept integers from 1 to 999. A drag with many pointer movements records one action on release; Escape, pointer cancellation, lost capture or window blur restores the start of an unfinished gesture. Undo during a gesture cancels that gesture first. Closing/saving during a gesture checkpoints its current position before flushing persistence.

Undo restores entry/group/zone identities, printing/face metadata and geometry together with deck membership. Camera pan/zoom and selection changes are outside history, so undo does not move the viewport. Default zone identities are established once when opening a sheet, before recording V1 actions. No automatic rearrangement of existing cards is introduced.

History keeps up to 100 actions per deck, evicting older actions beyond an estimated 32 MiB of snapshot/card JSON. Repeated card metadata is shared between snapshots; the current state is always retained. A new edit after undo discards the redo branch; a no-op edit or a view switch does not. History is kept only for the current app session: restarting or restoring a backup starts a fresh history. Deck deletion is still a separately confirmed action.

The resulting state after undo/redo uses the normal recovery journal, SQLite save and native close handshake. A save acknowledgement for an earlier edit cannot overwrite a newer undo. Portable backups retain the resulting deck/table state, not the undo stack. There is no database or Forge migration in this patch.

The frontend tests cover immutable snapshots, batched gestures, cancellation, independent histories, memory limits, metadata/identity retention and undo during an in-flight save. The desktop smoke adds native category undo/redo, keyboard zone undo/redo, shared V1/V2 history and exact zone identities before immediate close/restart. Native smoke still requires an Electron-capable display and the built Forge runtime.


## Named piles and adjustable zones (patch 06)

In **Table V2**, select at least two cards with Shift+click, a lasso or Ctrl/Cmd+A, then choose **Créer une pile** in the selection bar and give it a name. The new pile starts collapsed. Its header shows the total quantity; its tooltip distinguishes cards included in the deck. Drag the grip/header to move all members together. **Déplier / Réduire** switches between a compact stack and a fan, wrapping after eight entries. Name changes, expansion, grouping and gestures use the shared undo/redo history.

Use the pile's **☷** button to select every member for inclusion/exclusion or adding cards to another pile. The selection bar's **Ajouter à une pile…** joins the selected entries to an existing pile. To extract a card, select it individually and drag it; Escape puts it back with its original position, membership and layer. **Dissoudre** removes the pile container and leaves its cards in a usable fan. None of these commands changes Commander/mainboard/candidate membership or quantities. A basic land with quantity 37 remains one entry representing 37 cards, not 37 independent table objects.

Zone headers now provide **↔ Ajuster**, **▦ Ranger**, a lock and delete. Drag **↘** at the bottom right to resize; focused handles also accept arrow keys (10 units, or 50 with Shift). Resizing switches to a manual frame and never moves cards. **↔** explicitly returns to automatic fitting. **▦** arranges that zone's members into a grid, keeping piles intact as units and leaving other zones alone. No grid/fan repacking runs on a normal refresh or reopening the app.

A locked zone keeps its frame fixed: moving, resizing, renaming, arrangement and deletion are disabled until unlocking. Its cards remain movable and membership counts remain current. Unlocking preserves the previous manual/automatic sizing mode. Each completed drag/resize is one undo action; Escape, lost pointer capture and window blur cancel an unfinished gesture. The final pointer-up position is included.

Piles are optional additive fields in the existing version-1 project JSON; zone sizing and lock flags are optional too. Old projects and backups load unchanged, retaining their card coordinates. Stable pile IDs and ordered entry IDs survive save/restart, recovery journals, undo/redo and full library backup/restore. V1 cuts or merged entries remove dead pile references without repacking surviving cards. The result remains a normal playable deck. No SQLite or Forge migration is needed.

Validation covers a 200-entry table, mixed included/candidate quantities, grouping/fans/extraction/dissolution, cancellation, exact history states, manual/locked frames, explicit arrangement, old-file compatibility and rejected malformed references. SQLite tests reopen a database containing the new objects; offline library restoration includes piles and locked frames. The native desktop smoke exercises the real seeded deck and restarts after pile edits, in addition to manual-frame/lock undo/redo. It requires a display and the built Forge runtime; a DOM event test does not replace native visual verification.

Rebuild/install after applying with `npm --prefix desktop run install:local`.

## Table notes and full inspection (patch 07)

**+ Note** creates a free annotation at the center of the view. Creating a note centers it at a readable zoom, so typing remains usable on a distant overview. Select one card and choose **+ Note liée**, or add a note from its inspector, to attach an annotation to its stable entry id. Linked coordinates are offsets: notes follow their card during card, pile and zone moves. Drag a note by its header to adjust the offset, choose Sable/Sauge/Lavande, detach it without changing its visible position, or delete it. If V1 cuts/removes the entry, its note becomes a free annotation at the same position. Undo restores the original link.

Text is journalled on every input; one editing session creates one history action. Escape while typing cancels that session, and Escape during a drag cancels the gesture. Closing or switching views checkpoints the latest text before the normal save handshake. Notes are additive fields in the existing version-1 workspace; old projects, SQLite snapshots, recovery journals and full library backups use the same path. Up to 500 notes of 4000 characters are allowed per project.

Inspect a selected card with **Inspecter**, **I**, or double click. Both V1 and V2 share the full inspector: saved Oracle text, mana value, type, colors, power/toughness or loyalty when available, printing identity and related cards. Missing artwork retains a textual presentation. Saved double-faced artwork can be flipped without a catalog; missing faces and alternative printings are enriched from the local catalog when available, preserving the saved illustration.

Changing the edition selector is a read-only preview. **Conserver cette illustration** saves the complete printing identity (set, collector number, language, rarity, image and both faces), with undo/redo and restart persistence. Quantity, include/set-aside and linked-note actions are also accessible in the inspector. Inspection/enrichment alone never modifies the deck. The available editions depend on the installed catalog, and no live rules update or external card database is required to inspect saved data.


## Deck artwork preparation and cache management (patch 08)

**Préparer hors ligne** in Builder V1, or **Table tools → Préparer hors ligne** in V2, checks the chosen illustrations already on disk before downloading. The optional checkbox includes candidates and cuts. Only the selected printing and its saved faces are requested; quantities and repeated image URLs do not multiply downloads. The preview uses approximately 100 KB per missing image, explicitly an estimate rather than a storage guarantee. Opening the preview alone starts no network download.

Starting a preparation protects those images and runs at most two downloads concurrently, spaced by 150 ms. Progress distinguishes available images, active requests and cards without usable artwork. Pause/cancel stops launching new requests; already started requests can finish (20-second network timeout). Close the dialog to continue in the background. Quitting pauses the job, and **Reprendre les images manquantes** retries only uncached images after restarting. An unavailable face or a failed HTTP response leaves the job visibly incomplete, never marked ready.

**Paramètres → Images et hors-ligne** shows writable cache usage, protected/reclaimable bytes, bundled artwork and prepared decks. The default limit is 1 GiB, adjustable from 50 MiB to 10 GiB. Automatic eviction removes the oldest unprotected files only. Protected artwork exceeding a smaller requested limit causes an explicit error instead of deleting it; a full cache/disk pauses preparation. Unchecking **Garder hors ligne** or removing a preparation makes its files eligible for the explicit cleanup. Neither action deletes deck metadata, notes or printing choices. Bundled seed illustrations are read-only and excluded from the writable limit.

Cached images are stored atomically in the existing `card-art` directory. Retention, quota and the resumable job live in `userData/artwork-library.json`. Corrupt retention metadata preserves all existing files and blocks cleanup/preparation; an explicit reset keeps a rescue copy before rebuilding settings. Full library archives still omit image bytes and these PC-specific cache settings. Preparing again updates a deck's requested illustrations after edits; newly added cards are not silently predownloaded.

This patch prepares **images already described by the deck**. It does not install the full card catalog, download every printing or add extension updates. Those catalog operations remain a separate milestone. Rebuild/install with `npm --prefix desktop run install:local`.

Validation includes quota/retention, recto-verso restart, pause/cancel/resume, partial retries, shared foreground downloads, invalid responses and damaged metadata. The native desktop smoke additionally prepares both faces through the actual preload, restarts with downloads disabled and checks protected cleanup. Running that smoke still requires an Electron-capable display and the built Forge runtime.


## Catalog installation, updates and extension artwork (patch 09)

In **Paramètres → Catalogue et extensions**, **Vérifier les mises à jour** explicitly requests the Oracle Cards and Default Cards JSONL metadata. The screen shows the active snapshot date, last check/error, catalog and staging space, available disk space, compressed download bytes, verification and indexing progress. No catalog network request starts merely by opening settings or launching the app. Desktop card resolution now reports a missing catalog instead of silently starting an unmanaged bulk download. The existing web provider retains its previous behavior.

**Installer le catalogue / Préparer la mise à jour** downloads a version into a new directory. The two gzip JSONL files are streamed to `.part` files, with bounded sizes, idle timeout and a checked ETag/Range resume. A server returning a full response instead of a range safely restarts that file. Pause, cancellation and quitting interrupt both the download and its verification worker. Completed bytes survive a pause/restart; invalid gzip/schema never reaches installation. An unavailable server or full disk leaves a visible, retryable pause and preserves the active catalog.

A separate utility process validates both compressed files and builds the derived SQLite search index. The currently running backend continues reading its old catalog throughout. Only a complete candidate switches `userData/data/catalog-current.json` through an atomic rename. **Relancer pour utiliser ce catalogue** uses the normal builder save/close handshake before relaunching; choosing to stay after a failed save cancels that relaunch. The next process receives the new bulk/index paths before loading the backend. No deck database or project migration is required, and deck printing choices, notes, quantities and cached artwork are not rewritten.

Versions live in `userData/data/catalogs/<generation>/`, with `catalog-info.json`; the resumable operation is in `catalog-download.json`. A separate previous manifest and previous files provide recovery if the current pointer is unreadable or incomplete. **Libérer les versions anciennes** removes only unreferenced generation directories, preserving the active, latest, previous and pending versions. Legacy bulk files remain supported and are retained. The cache limit from patch 08 governs artwork, not bulk files or indexes; catalog storage is shown separately. Full library archives still omit these PC-specific files.

After activating a catalog, choose its extension and **Préparer les images de cette extension**. The list and image URLs come from the installed local index: every printing in the selected extension, with distinct face images and URL deduplication, not just the one representative printing used in normal search. The preview shows existing/missing images and an approximate size before an explicit start. The existing patch-08 queue supplies progress, pause/resume/cancel, protection and quota. Prepared extensions appear in the same retention list as prepared decks. Catalog installation itself downloads no images. Repeating a preparation after an update adds missing art; opening the extension selector never silently downloads a set.

Validation uses synthetic snapshots for real gzip validation and SQLite index/search, isolated old/new catalogs, partial HTTP resume, ignored ranges, failed validation/activation, cancellation, restart recovery, cleanup protection and trusted IPC. The native desktop smoke installs a small synthetic catalog through the actual utility process, restarts offline, enumerates both faces of an extension and proves a failed check keeps search usable. Native Electron checks and live Scryfall downloads require an appropriate desktop/network environment.

Rebuild/install with `npm --prefix desktop run install:local` after applying this patch. Then check/install from settings, wait for **Catalogue prêt**, relaunch and choose one small extension to test offline image preparation.

## Manual multiple roles (patch 10.1, version 0.1.10)

Use **Tags** on the table selection, or **Modifier les tags** in the card inspector. A multi-card selection supports mixed checkboxes: check to add a role to every selected card, uncheck to remove it. The built-in manual template (Ramp, Pioche, Interaction, Protection, Récursion, Fin de partie) is editable; create, rename or delete tags, write their definitions and set optional personal quantity targets. **Enregistrer** commits the whole dialog as one undoable action; cancel or Escape leaves the deck untouched. Manage the deck's definitions and targets from **Tags et cibles** in V1 or **Gérer les tags** in the table tools / Analyse.

Tags are independent of categories, zones and piles. They apply to all copies of a named card inside this deck, retain chosen printing metadata, follow moves and remain attached to candidates or cuts for a later restoration. Analyse and the V1 statistics show counts per role (including commanders and quantities); candidates and cuts are excluded. Roles may overlap without increasing the actual deck size. No automatic assignment or recommended target is imposed. Commander legality, mana-source analysis and starting hands belong to subsequent patches.

The optional `tags` field is added to the existing version-1 project snapshot. No SQLite migration, catalogue rebuild or dependency installation is required. Old projects stay valid, retain their layout and receive no roles until an explicit edit. Tags round-trip through saved projects, local recovery drafts and portable library backups. Each deck has its own definitions; reusable cross-deck templates are a later improvement. Old application versions do not know how to edit this field: back up the library before downgrading rather than saving tagged decks with an earlier version.

## Commander construction checks (patch 10.2, version 0.1.11)

**Analyse** on Table V2, and the V1 statistics area, now report deck size (exactly 100, including commanders), commander eligibility/pairing, color identity, cumulative duplicates with recognized exceptions, and Commander legality statuses. Results are advisory: editing, saving and playing remain available. Every issue explains the reason and links to the saved card inspector. Candidates and cuts never enter these checks. Quantity, membership and undo/redo changes update the diagnosis immediately.

Checks follow the [official Comprehensive Rules effective 2026-09-25](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt), notably 903 and 702.124. Supported commander cases include legendary creatures/Vehicles, Spacecraft with power/toughness data, explicit commander permissions and Grist, the Hunger Tide. Recognized pairs include Partner, reciprocal Partner with, matching Character select / Father & son / Friends forever / Survivors (including old Friends forever wording), Choose a Background and Doctor’s companion. Only the front grants commander eligibility; color identity uses the stored combined identity including both faces and hybrid/Phyrexian costs. Basic land types impose their colors separately. Basic and Snow basic lands, named unlimited-copy clauses (e.g. Rat Colony), and named up-to-number clauses (e.g. nine Nazgûl or seven Seven Dwarves) are recognized.

**Vérifier avec le catalogue local** explicitly reads current rule facts for included card names from the installed search index, in bounded batches of 120. It uses a parameterized exact name lookup, prefers English printings, downloads nothing and does not modify decks, quantities, tags, layout or chosen art. The first explicit lookup may build a missing derived search index from the existing bulk file. Completed results remain available if a later request fails; a retry clears the error. Progress updates only the analysis panel and cannot interrupt a table gesture. A card absent from the catalog retains its saved facts.

Data gaps use **À vérifier**, not a confident legal/illegal verdict. Pre-game chosen colors, unfamiliar construction clauses, unrecognized partner variants, incomplete texts or Spacecraft power/toughness data need a manual review. Oracle ids group identities shared by the local index; rare interchangeable names with different ids are outside the automatic check. Companion restrictions, Commander Draft, Brawl, Duel Commander and custom house rules are not covered. Legality statuses reflect the saved/local snapshot and do not claim live ban-list freshness; update the catalog when needed.

No project-format or user SQLite migration, dependency additions, automatic networking or persisted metadata replacement. Local verification facts are session-only and per deck: after restarting, saved facts are immediately usable and explicit verification can be repeated. Existing tags and backups keep their exact format.

References for special cases: [Doctor Who mechanics](https://magic.wizards.com/en/news/feature/magic-the-gathering-doctor-who-mechanics), [Eldraine release notes](https://magic.wizards.com/en/news/feature/throne-eldraine-release-notes-2019-09-20), [LOTR release notes](https://media.wizards.com/2023/downloads/LTR_Release_Notes/EN_MTGLTR_ReleaseNotes_20230508.pdf), [Modern Horizons 2 release notes](https://media.wizards.com/2021/downloads/MH2_Release_Notes/EN_MTGMH2_FAQ_06022021.pdf).


## Mana demand and sources (patch 10.3, version 0.1.12)

**Analyse** in Table V2 and the V1 statistics area now compare printed spell-cost symbols with potential mana sources. The six rows distinguish W/U/B/R/G and required colorless C. Library demand and commander demand are separate; quantities count, candidates and cuts do not. Mandatory pips are distinct from hybrid, two-brid and Phyrexian options. Generic mana, variables and snow are reported separately. Flexible choices overlap and are never arbitrarily split between colors. A missing cost is unknown; an explicitly empty printed cost creates no pips and does not imply normal castability.

Source columns count cards, not mana units: direct lands, other direct permanent sources and recognizable conditional/restricted sources. A dual land appears in both color rows but remains one land; Sol Ring contributes one potential colorless permanent source, not two mana sources. Basic land types supply their intrinsic colors; Wastes needs its explicit production text. Commander-color production (Command Tower wording) uses the designated commanders' combined identity, and stays unknown when it requires an unresolved pregame choice. Land arrival is shown separately as always tapped, conditional or not determined. Other permanent producers must first be cast/played and may have summoning sickness; no turn-by-turn availability is asserted.

**Sources et conditions** lists each recognized or unresolved source with its restrictions and a saved-card inspector button. Additional activation costs, sacrifice/life costs and recognized usage restrictions are conditional, not unrestricted fixing. Rituals and indirect nonpermanent access are excluded from permanent source totals. Fetchlands, token creation, triggered/dynamic production, complex filters and incomplete texts remain review items without invented colors. All multiple-faced cards are excluded from quantified demand/production until face/layout metadata can model their actual options; front-face land count is shown without adding a back land as a second card. Snow production and alternate casting costs are not simulated. Missing direct sources yield an advisory, not a legality verdict or a recommended ratio.

The existing explicit **Vérifier avec le catalogue local** button updates both Commander checks and this mana analysis. The bounded facts response now includes optional `manaCost` from the existing index payload. Old responses without that field fall back to saved costs; explicit null stays unknown. No search-index schema change/rebuild, project or SQLite migration, dependency, automatic network request or persisted deck/art replacement is introduced. Catalog progress/results refresh analysis alone, keeping ongoing card gestures intact. Facts remain session-only; failed checks retain the last complete snapshot.

Validation covers symbol parsing, quantity/membership, partner colors, direct and conditional production, snow basics/Wastes, tapped/check/shock lands, malformed costs, quoted abilities, multi-face exclusions, read-only catalog overrides, inspector links and actual V1/V2 DOM events. Frontend, backend and emitted desktop backend builds are checked. Native Electron rendering/launch still requires validation on the user's PC.

References: [Scryfall card fields](https://github.com/scryfall/api-types/blob/main/src/objects/Card/CardFields.ts), [Zendikar Rising mechanics](https://magic.wizards.com/en/news/feature/zendikar-rising-mechanics-2020-09-01), and the Comprehensive Rules linked above. Probabilistic starting hands remain the next roadmap milestone.


## Opening hands and playtest failure diagnostics (patch 10.4, version 0.1.13)

**Mains de départ** is available in Table V2 and Builder V1. It opens an isolated snapshot of the deck's included mainboard: quantities and chosen printing/face metadata remain intact, while commanders, candidates and cuts stay out of the library. Trials do not write projects, trigger catalog lookups, alter history or call Forge. The displayed commander list remains separate. Close and reopen to use later edits. Tiny unfinished libraries are allowed with an explicit warning; empty libraries, invalid quantities or more than 5,000 cards are rejected before allocating copies.

The trial uses a seeded xorshift32 sequence and Fisher-Yates shuffle with rejection sampling for bounded indexes. The same seed, rule mode, snapshot order and action sequence reproduce the same hands. **Nouvelle main** reshuffles the full original snapshot without a mulligan penalty; **Rejouer cette graine** restarts the sequence. This is a deterministic manual experiment, not a statistical probability estimator or an engine game seed.

Choose **Multijoueur** (first mulligan free) or **Duel** (no free mulligan). Each London mulligan reshuffles the whole original library and offers up to seven cards. Keeping requires selecting the correct number of bottom cards; their click order is their order beneath the undrawn library. The zero-card keep is supported and no further mulligan is offered at that limit. Draw is disabled until keeping, then reveals the actual next card until exhaustion. Only saved Oracle text/manual tags and front-face land counts are shown: no mana/effect/turn/tutor simulation, special pregame card rules, automatic keep decision or probability is claimed. References: [London mulligan](https://magic.wizards.com/en/news/announcements/london-mulligan-2019-06-03), Comprehensive Rules 103.5 and 103.5c.

A failed playtest now preserves a bounded **Diagnostic du playtest**: session, selected deck names, mode, seed, error code, failing bridge request, exception detail and up to four recent explicit `Forge bridge request failed:` stderr lines when available (including cleanup faults, not all necessarily the primary fault). General stderr, request payloads and observations/hidden game state are never dumped. Runner/aggregate wrappers are traversed with bounds to recover the original Forge fault instead of a secondary cancellation failure. Old failure states still render with unavailable details noted. **Copier le diagnostic** uses the clipboard on an explicit click and falls back to selecting a read-only textarea. Existing New Playtest remains available; failed sessions stop their bridge, and synchronous bridge/client setup also cleans up before rejecting.

This is a diagnostic improvement for the reported generic `The Forge bridge could not process the request` failure. The specific installed-app crash has NOT been reproduced or claimed fixed: the user's deck, current Forge runtime and its concrete exception are required to confirm its cause. No Java source/JAR change, engine rules change, migration or dependency is introduced. Reinstall normally; if the error recurs, copy the new diagnostic for a focused engine fix.

Validation includes pure shuffle/mulligan conservation and replay, ordered bottoming, exhaustion, immutable art/roles, bounded allocation, real child stdio with a scripted bridge, failed-session restart/cleanup, wrapped/cyclic errors, restricted diagnostics and actual builder dialog events. Native Electron rendering and real Forge playtests remain to validate on the PC.


## Patch 11 — versions et comparaison (0.1.16)

- **Versions**, accessible dans Builder V1 et Table V2, conserve un instantané nommé du projet : cartes, quantités, commandants, candidats, cuts V1, éditions et faces choisies, tags/cibles, table, piles, zones, notes et caméra.
- Les instantanés sont indépendants des modifications suivantes, intégrés à SQLite, aux brouillons de récupération et aux sauvegardes exportées. Les anciens projets sans versions restent lisibles ; aucune migration SQL supplémentaire.
- Comparaison d’une référence avec le travail actuel ou une autre version. Quantités agrégées par nom normalisé et section, commandants distingués, candidats et cuts hors des totaux joués. Un déplacement entre catégories ne devient pas un ajout/retrait. Les changements de tags, de table, de rangement et d’illustration sont signalés séparément.
- Repères : nombre de cartes jouées, terrains d’après les types enregistrés, valeur de mana moyenne hors terrains, comptes des tags manuels. Pas de verdict de puissance ni de probabilité de victoire.
- **Essayer ses mains** ouvre un essai isolé de la référence, avec les règles et limites du patch 10.4.
- **Créer un deck séparé** copie la référence dans une nouvelle identité de projet, sans remplacer l’original ni recopier ses versions. Après enregistrement, ce deck se sélectionne dans Play comme les autres decks de la bibliothèque.
- **Restaurer la référence** demande une confirmation dans le dialogue et conserve automatiquement le travail précédent dans une version « Avant restauration N », ou réutilise une version strictement identique. Undo/Redo peut annuler/rétablir le contenu restauré, sans supprimer les versions conservées. La restauration charge le cadrage enregistré ; comme ailleurs, Undo ne rembobine pas la caméra.
- Limites : 20 versions par projet, noms distincts de 1–80 caractères, limite globale existante de 4 millions de caractères JSON (travail + versions). Pas d’élagage automatique des versions. Une restauration sans place pour protéger le travail échoue sans modifier le deck : supprimer explicitement une ancienne version ou créer un deck séparé.
- L’enregistrement suit l’autosauvegarde habituelle ; refermer le dialogue pour vérifier « Enregistré ». Une suppression confirmée retire la référence, pas le travail actuel. Pas de branchement/fusion ni de comparaison de résultats de parties dans ce patch.

### Correction du lancement Forge installé

Le diagnostic `start_external_match / INTERNAL_ERROR / StorageReaderFolder.ctor() error, Directory can't be created` vient de l’initialisation des éditions. Le bridge fournit à `StaticData` le chemin `res/asphodel-empty-custom-editions` ; Forge épinglé crée un `CardEdition.Reader` pour ce dossier et tente `mkdirs()` s’il manque. Une application installée sous `/opt` ou un AppImage monté ne peut pas créer ce dossier dans ses ressources.

Le build prépare désormais ce répertoire sans édition personnalisée, avec un fichier `asphodel-directory.marker` pour empêcher electron-builder d’omettre le dossier vide. Forge ignore ce fichier : son lecteur d’éditions ne lit que les noms terminant par `.txt`. La vérification du `.deb` exige le dossier et son marqueur avant toute installation privilégiée. Le runtime smoke vérifie aussi sa présence avant de démarrer le worker, puis conserve son test de vraie partie hors ligne. Le JAR et les règles Forge ne changent pas : aucune reconstruction Maven requise. Réinstaller le nouveau paquet, puis réessayer la partie ; conserver le diagnostic si une autre erreur apparaît.

Validation : tests frontend, persistance API/SQLite, export/restauration de sauvegardes et tests desktop ; contrôles DOM des deux builders, des versions, restauration/Undo, copie indépendante et mains d’une référence. Les tests de paquet fabriquent de vrais petits `.deb` et rejettent le dossier manquant. Le runtime Forge complet et Electron natif doivent être vérifiés sur une machine disposant du JAR et des ressources (absents de cet environnement).


### Correctif 11.1 — conserver le dossier Forge dans le paquet

Le premier patch 11 créait le dossier vide lors du build, mais electron-builder ne le copiait pas dans les ressources. L’installation s’arrêtait donc avec « Paquet incomplet » avant de modifier l’application installée.

Le fichier marqueur conserve désormais le dossier à travers le packaging. Le test de régression utilise electron-builder 26.15.3 et sa vraie copie `extraResources` : l’ancien dossier vide disparaît, le dossier contenant le marqueur reste présent. Une distribution Electron factice évite de télécharger ou lancer Chromium ; ce test vérifie le packaging, pas une partie Forge. Les tests de vrais petits `.deb` rejettent aussi un paquet dont seul le marqueur manque.

Appliquer ce correctif après le patch 11 déjà appliqué, puis relancer `npm --prefix desktop run install:local`. Version conservée : 0.1.16, puisque la précédente installation avait été interrompue. Pas de reconstruction Java ni de modification des decks.


## Playtest notebook (patch 12, version 0.1.16)

**Tester ce deck** opens the existing game setup with the current builder deck selected; **Versions → Jouer cette référence** selects a named version without restoring it over the working deck. Pending builder edits must save successfully before handing over. Opponents, seed and digital/physical mode remain selectable; an active game must end before preparing another. The backend resolves the library deck and its historical identity in one read, then stores the exact commander/mainboard list sent to Forge. Candidates and cuts are excluded. Later edits, reference deletion, deck deletion and renames never change the played list.

After completion, voluntary stop or failure, the end screen opens **Bilan de l’essai**. It retains the outcome when Forge supplied one, turn reached, opponents, mode, seed, selected version, and up to 1,000 of the existing public event messages. This is a public event journal, not a complete replay or a record of hidden hands. Write a general note and mark played cards **À garder / À retester / À couper** with a reason. **Enregistrer le bilan** saves explicitly; normal desktop shutdown also flushes open edited reviews and refuses to quit if a save fails. A stale editor cannot overwrite a newer revision. Discarding unsaved feedback when leaving a review requires confirmation.

**Mes essais** filters the notebook by the builder project's stable identity. **Carnet d’essais** in game setup also retrieves trials whose original deck was deleted, and fixture/Archidekt trials. Lists paginate 50 at a time. Trials existing only as old debug report files are not retroactively imported. **Retour à la table avec ces retours** saves feedback and copies it into existing table notes: card notes attach to matching current entries, absent cards receive free notes, and quantities are never changed. Repeating the explicit import updates its notes rather than duplicating them, and the entire operation can be undone/redone. A table remains limited to 500 notes, 4,000 characters each; longer general feedback stays complete in the notebook and becomes an excerpt on the table.

A normal SQLite migration adds `playtest_reviews`, independently of deck deletion. Full library backup/restore includes reviews; old archives without this additive field still restore correctly. A recorded running trial recovered after restart or restoration is marked interrupted rather than pretending its game resumed. Raw diagnostic `summary.md`/`decisions.json` files retain their existing role, with a session suffix preventing two same-minute trials from overwriting one another. Actual game execution and Commander rules continue to use the existing Forge bridge.

## Party presentation (patch 13)

**Rythme des parties** is available before starting a playtest, inside the in-game ⋮ menu, and in desktop **Paramètres**. Choose **Rapide**, **Normal** or **Posé**. Important actions receive approximately 1, 3.5 or 5.5 seconds of reading time respectively; major phase banners, smaller actions and card movements follow the same profile. Normal preserves the existing rhythm. Changing speed applies to subsequent actions; the reading pause already underway finishes normally.

**Réduire les animations des parties** keeps the card identities, captions, board state and reading pauses, while removing movement and fades. The operating system's reduced-motion setting is also respected. Changing this preference cancels active decorative movements and cleans up their temporary cards.

When public actions are being presented, **Rattraper l’affichage** appears on the table and in the menu with the number of pending steps. It interrupts only presentation waits and animations. Every received frame is still painted in order and its event remains in the recent history; no choice is submitted, no turn is passed and the engine is not accelerated. The current human decision appears only after the queue drains. The next batch uses the selected rhythm again. Leaving a game cancels its presentation timers so an old session cannot paint over the next one.

The settings are saved on the stable renderer origin and included in portable library backups. An older backup restores Normal and the default motion preference. If renderer storage is unavailable, the settings still apply to the current session, with an explicit message and retry button. Backup/restore first flushes pending deck and playtest-review edits.

No Forge rebuild, database migration or new dependency is needed. Checks cover corrupt/unavailable storage, persistence, backup replacement, speed changes, all three importance tiers, catch-up during phase/card waits, frame order/deduplication, decision gating and old-session cancellation. The native window and desktop smoke scripts additionally check settings across restart and portable restoration; these scripts require an Electron-capable environment.
