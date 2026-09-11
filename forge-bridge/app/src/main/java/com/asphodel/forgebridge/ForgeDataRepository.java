package com.asphodel.forgebridge;

import forge.CardStorageReader;
import forge.ImageKeys;
import forge.StaticData;
import forge.card.CardRules;
import forge.card.CardType;
import forge.game.card.CardUtil;
import forge.item.PaperCard;
import forge.util.FileSection;
import forge.util.FileUtil;
import forge.util.Lang;
import forge.util.Localizer;
import forge.ai.AiProfileUtil;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.Normalizer;
import java.util.List;
import java.util.Map;

final class ForgeDataRepository {
    static final String ASSETS_PROPERTY = "asphodel.forge.assets";

    private static ForgeDataRepository instance;

    private final Path assetsDirectory;
    private final StaticData staticData;

    private ForgeDataRepository(Path assetsDirectory) {
        this.assetsDirectory = assetsDirectory;
        initializeLanguage();
        initializeDynamicGameData();
        initializeHeadlessImageKeys();
        AiProfileUtil.loadAllProfiles(path("ai").toString());

        CardStorageReader cardReader = new CardStorageReader(
                path("cardsfolder").toString(),
                CardStorageReader.ProgressObserver.emptyObserver,
                true
        );
        CardStorageReader tokenReader = new CardStorageReader(
                path("tokenscripts").toString(),
                CardStorageReader.ProgressObserver.emptyObserver,
                false
        );

        this.staticData = new StaticData(
                cardReader,
                tokenReader,
                null,
                null,
                directory("editions"),
                directory("asphodel-empty-custom-editions"),
                directory("blockdata"),
                directory("setlookup"),
                "Latest Art All Editions",
                true,
                false,
                false,
                false
        );
    }

    static synchronized ForgeDataRepository instance() {
        if (instance == null) {
            String configuredPath = System.getProperty(ASSETS_PROPERTY);
            if (configuredPath == null || configuredPath.isBlank()) {
                throw new IllegalStateException(
                        "Missing -D" + ASSETS_PROPERTY + "=/path/to/vendor/forge/forge-gui/res"
                );
            }
            Path assets = Path.of(configuredPath).toAbsolutePath().normalize();
            if (!Files.isDirectory(assets)) {
                throw new IllegalStateException("Forge assets directory does not exist: " + assets);
            }
            instance = new ForgeDataRepository(assets);
        }
        return instance;
    }

    PaperCard requireCard(String name) {
        PaperCard card = findCard(name);
        if (card == null) {
            throw new IllegalArgumentException("Forge card script could not be loaded: " + name);
        }
        return card;
    }

    PaperCard findCard(String name) {
        PaperCard card = staticData.getCommonCards().getCard(name);
        if (card == null) {
            staticData.attemptToLoadCard(name);
            card = staticData.getCommonCards().getCard(name);
        }
        if (card == null && containsNonAscii(name)) {
            card = loadCardWithDiacriticFallback(name);
        }
        return card;
    }

    /**
     * Fallback for cards whose display name carries a diacritic that vendor Forge's own
     * {@code CardStorageReader.transformName} (pinned revision {@code
     * 6356c1ad565029c82513c96e42ad5492c1b09c4e}, not modified here) fails to fold to its base
     * ASCII letter when deriving a script filename from a queried name: it replaces the whole
     * diacritic character with its own underscore instead, e.g. "Barad-dûr" transforms to
     * "barad_d_r", while the real vendor file on disk is "barad_dur.txt" — so {@link
     * StaticData#attemptToLoadCard} silently fails to find a card script that is present and
     * correct; only the filename derivation is wrong. Every other vendor Forge card-lookup path
     * (editions, deck legality, {@code CardRules} parsing) already keys off the exact accented
     * display name and works fine — this is purely a lazy-lookup filename-guessing gap.
     *
     * <p>This resolves the name the way vendor Forge's own {@code cardsfolder} naming convention
     * actually works everywhere else (diacritics folded to their base letter, e.g. "Lim-Dûl" →
     * {@code lim_dul}): fold the queried name's diacritics, use its first letter to pick the same
     * cardsfolder subdirectory vendor Forge would, and scan that directory's scripts for an exact
     * {@code Name:<queried name>} first line. A match is parsed with vendor Forge's own {@link
     * CardRules.Reader} — the exact parser {@code CardStorageReader} itself uses — then registered
     * into the exact same {@code StaticData} common-card pool via its own public {@code
     * CardDb.loadCard}, so the resulting {@link PaperCard} is indistinguishable from one Forge
     * found on its own. No vendor file is touched, no Magic rule is reimplemented, and nothing
     * about the pinned Forge revision changes: this only replicates, in bridge code, a folding
     * rule vendor Forge's own filenames already follow.</p>
     */
    private PaperCard loadCardWithDiacriticFallback(String name) {
        String folded = foldDiacritics(name);
        if (folded.isEmpty() || !Character.isLetterOrDigit(folded.charAt(0))) {
            return null;
        }
        String firstLetter = String.valueOf(Character.toLowerCase(folded.charAt(0)));
        File[] candidates = path("cardsfolder", firstLetter).toFile()
                .listFiles((dir, fileName) -> fileName.endsWith(".txt"));
        if (candidates == null) {
            return null;
        }
        String expectedFirstLine = "Name:" + name;
        for (File candidate : candidates) {
            List<String> lines = FileUtil.readAllLines(candidate, true);
            if (lines.isEmpty() || !expectedFirstLine.equals(lines.get(0))) {
                continue;
            }
            CardRules rules = new CardRules.Reader().readCard(lines, stripExtension(candidate.getName()));
            staticData.getCommonCards().loadCard(name, null, rules);
            return staticData.getCommonCards().getCard(name);
        }
        return null;
    }

    private static boolean containsNonAscii(String name) {
        for (int i = 0; i < name.length(); i++) {
            if (name.charAt(i) > 127) {
                return true;
            }
        }
        return false;
    }

    /** Strips combining diacritical marks after Unicode NFD decomposition, e.g. "Barad-dûr" -> "Barad-dur". */
    private static String foldDiacritics(String name) {
        return Normalizer.normalize(name, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
    }

    private static String stripExtension(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot < 0 ? fileName : fileName.substring(0, dot);
    }

    private void initializeLanguage() {
        Lang.createInstance("en-US");
        Localizer.getInstance().initialize("en-US", directory("languages"));
    }

    private void initializeDynamicGameData() {
        if (!CardType.Constant.LOADED.isSet()) {
            Map<String, List<String>> sections = FileSection.parseSections(
                    FileUtil.readFile(path("lists", "TypeLists.txt").toString())
            );
            for (Map.Entry<String, List<String>> section : sections.entrySet()) {
                CardType.Helper.parseTypes(section.getKey(), section.getValue());
            }
            CardType.Constant.LOADED.set();
        }

        if (CardUtil.NON_STACKING_LIST.isEmpty()) {
            for (String keyword : FileUtil.readFile(path("lists", "NonStackingKWList.txt").toString())) {
                if (keyword.length() > 1) {
                    CardUtil.NON_STACKING_LIST.add(keyword);
                }
            }
        }
    }

    private void initializeHeadlessImageKeys() {
        String unused = directory("asphodel-headless-image-cache");
        ImageKeys.initializeDirs(
                unused,
                Map.of(),
                unused,
                unused,
                unused,
                unused,
                unused,
                unused,
                unused
        );
    }

    private Path path(String first, String... more) {
        return assetsDirectory.resolve(Path.of(first, more));
    }

    private String directory(String name) {
        return path(name).toString() + java.io.File.separator;
    }
}
