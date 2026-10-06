# Asphodel Desktop 0.1.8

Desktop wrapper around the existing TypeScript/Vite frontend, Node backend and pinned Forge bridge. No stack migration. Launch Asphodel, choose a saved deck, play locally, close the application. The packaged app includes Chromium/Node, Java and Forge's resources; no terminal, Node installation, Java installation or remote server is needed to run it.

## Install the current checkout on Ubuntu (patch 02)

Close Asphodel, then from the repository root:

```sh
npm --prefix desktop run install:local
```

This rebuilds the desktop runtime using the existing Forge JAR, creates `desktop/release/Asphodel-0.1.8-amd64.deb` on a normal x64 PC, checks its version/architecture and bundled components, then uses `sudo apt-get install --reinstall` to install it. Compilation runs as your normal user; sudo is requested only for the package installation. The command requires the same build dependencies and Forge resources as the existing desktop build.

Afterwards, open **Asphodel** from Ubuntu's application menu and pin it to your dock if desired. The package installs the app in `/opt/Asphodel`, the desktop entry `Asphodel.desktop`, the existing icon and the `asphodel` command. This launch uses the installed app, independent of the checkout, and needs no local server command. The normal desktop settings, fullscreen preference and Quitter button remain available.

To update after a new patch/pull, close Asphodel and run the same command again. Decks, cached images, drafts and display settings remain in the existing `~/.config/Asphodel` profile; the package contains no home-directory files. Package removal (`sudo apt-get remove asphodel-desktop`) leaves this profile in place. Backup/restore is available in settings; abrupt-crash recovery still depends on a persisted draft.

To build without installing, use `npm --prefix desktop run dist:deb`, then `npm --prefix desktop run check:package`. A downloaded `.deb` can also be installed with `sudo apt install ./Asphodel-0.1.8-amd64.deb` from the directory containing it. The `.deb` is the recommended installation format for Ubuntu; AppImage remains available through `dist`.

## Automated Linux packages

The Desktop workflow now runs for relevant changes on `main`, matching pull requests, manual dispatch, and `v*` tags. A release tag must equal the desktop version (for example `v0.1.8`); both package files must agree. A newer run on the same ref cancels an obsolete build.

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

The archive is limited to 64 MiB, with 4 MiB of renderer storage. It contains neither image bytes nor the bulk/search catalogue, Java/Forge, models, playtest sessions or reports. A fresh/offline profile can restore the cards and decks without resolving their names on the network; image availability still depends on that profile's existing cache or a later download. The format version is checked separately from the application version.

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
