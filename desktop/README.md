# Asphodel Desktop 0.1.3

Desktop wrapper around the existing TypeScript/Vite frontend, Node backend and pinned Forge bridge. No stack migration. Launch Asphodel, choose a saved deck, play locally, close the application. The packaged app includes Chromium/Node, Java and Forge's resources; no terminal, Node installation, Java installation or remote server is needed to run it.

## Install the current checkout on Ubuntu (patch 02)

Close Asphodel, then from the repository root:

```sh
npm --prefix desktop run install:local
```

This rebuilds the desktop runtime using the existing Forge JAR, creates `desktop/release/Asphodel-0.1.3-amd64.deb` on a normal x64 PC, checks its version/architecture and bundled components, then uses `sudo apt-get install --reinstall` to install it. Compilation runs as your normal user; sudo is requested only for the package installation. The command requires the same build dependencies and Forge resources as the existing desktop build.

Afterwards, open **Asphodel** from Ubuntu's application menu and pin it to your dock if desired. The package installs the app in `/opt/Asphodel`, the desktop entry `Asphodel.desktop`, the existing icon and the `asphodel` command. This launch uses the installed app, independent of the checkout, and needs no local server command. The normal desktop settings, fullscreen preference and Quitter button remain available.

To update after a new patch/pull, close Asphodel and run the same command again. Decks, cached images, drafts and display settings remain in the existing `~/.config/Asphodel` profile; the package contains no home-directory files. Package removal (`sudo apt-get remove asphodel-desktop`) leaves this profile in place. Backup/restore is available in settings; abrupt-crash recovery still depends on a persisted draft.

To build without installing, use `npm --prefix desktop run dist:deb`, then `npm --prefix desktop run check:package`. A downloaded `.deb` can also be installed with `sudo apt install ./Asphodel-0.1.3-amd64.deb` from the directory containing it. The `.deb` is the recommended installation format for Ubuntu; AppImage remains available through `dist`.

## Automated Linux packages

The Desktop workflow now runs for relevant changes on `main`, matching pull requests, manual dispatch, and `v*` tags. A release tag must equal the desktop version (for example `v0.1.3`); both package files must agree. A newer run on the same ref cancels an obsolete build.

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
