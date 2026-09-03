package com.asphodel.forgebridge;

import forge.CardStorageReader;
import forge.ImageKeys;
import forge.StaticData;
import forge.card.CardType;
import forge.game.card.CardUtil;
import forge.item.PaperCard;
import forge.util.FileSection;
import forge.util.FileUtil;
import forge.util.Lang;
import forge.util.Localizer;
import forge.ai.AiProfileUtil;

import java.nio.file.Files;
import java.nio.file.Path;
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
        return card;
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
