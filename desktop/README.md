# Asphodel Desktop 0.1

Desktop wrapper around the existing TypeScript/Vite frontend, Node backend and pinned Forge bridge. No stack migration. Launch Asphodel, choose a saved deck, play locally, close the application. The packaged app includes Chromium/Node, Java and Forge's resources; no terminal, Node installation, Java installation or remote server is needed to run it.

## Build on Linux

Prerequisites for **building**: Node 22.5+, a JDK 17+ with `jlink`, and the normal Electron Linux libraries. These are not prerequisites for the person using the finished app. Build on the platform you intend to run.

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

The sandboxed CommonJS preload exposes only four specific commands and a display-state subscription. The main process accepts them only from the app window's main frame at `asphodel://app`. Node integration stays disabled. Development tools remain accessible with Ctrl+Shift+I in unpackaged builds.

After applying the patch to an already built checkout, run `npm --prefix desktop run build` to refresh the bundled frontend, then launch as usual. The existing Forge JAR is sufficient; there is no Forge source change in this patch.

`npm --prefix desktop run smoke:window` tests the real Electron window and compiled frontend against a disposable catalogue without Java/Forge. It covers default fullscreen, the absent menu after Alt, settings and F11, preferences across restarts, text editing, isolation of another window and the Quitter command. It requires an available display (or Xvfb) and Electron's normal IPC support.
