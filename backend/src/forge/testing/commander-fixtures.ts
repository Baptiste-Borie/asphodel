import type { ForgeDeckSpec } from "../forge-protocol.js";

// Printed, singleton creature fixtures. Native Forge supplies every runtime rule.
// Exported so other tests can build their own near-singleton decks from proven-real card names
// (e.g. a V2g Physical Companion candidate-pool stress test) without re-verifying resolution.
export const red = [
  "Balduvian Barbarians", "Barbarian Horde", "Bird Maiden", "Boggart Brute",
  "Borderland Minotaur", "Brazen Scourge", "Breakneck Berserker", "Canyon Minotaur",
  "Cobblebrute", "Cyclops of One-Eyed Pass", "Defiant Khenra", "Deranged Whelp",
  "Desert Drake", "Dwarven Trader", "Falkenrath Reaver", "Fearless Halberdier",
  "Feral Maaka", "Frenzied Raptor", "Goblin Assailant", "Goblin Bully",
  "Goblin Cavaliers", "Goblin Chariot", "Goblin Hero", "Goblin Piker",
  "Goblin Roughrider", "Goblin Sky Raider", "Goblin Trailblazer", "Gore Swine",
  "Gray Ogre", "Havoc Devils", "Highland Giant", "Hill Giant", "Hostile Minotaur",
  "Hulking Bugbear", "Hulking Devil", "Hurloon Minotaur", "Hyena Pack", "Incurable Ogre",
  "Lagac Lizard", "Lightning Elemental", "Lizard Warrior", "Lowland Giant", "Minotaur Warrior",
  "Mons's Goblin Raiders", "Mountain Bandit", "Needlepeak Spider", "Nest Robber",
  "Nimble Birdsticker", "Ogre Resister", "Ogre Warrior", "Onakke Ogre", "Orazca Raptor",
  "Pensive Minotaur", "Pyromantic Pilgrim", "Raging Bull", "Raging Cougar", "Raging Goblin",
];
export const green = [
  "Alpine Grizzly", "Argothian Swine", "Axebane Beast", "Balduvian Bears", "Barbary Apes",
  "Bear Cub", "Broodhunter Wurm", "Brushstrider", "Canopy Spider", "Centaur Courser",
  "Charging Badger", "Cloudcrown Oak", "Colossadactyl", "Colossodon Yearling", "Cylian Elf",
  "Defiant Elf", "Elvish Ranger", "Elvish Warrior", "Forest Bear", "Garruk's Companion",
  "Giant Mantis", "Giant Spider", "Gnarled Mass", "Gnottvold Recluse", "Golden Bear",
  "Goliath Beetle", "Gorilla Warrior", "Grappler Spider", "Grazing Whiptail", "Greenwood Sentinel",
  "Grizzly Bears", "Harrier Naga", "Hitchclaw Recluse", "Kalonian Tusker", "Leatherback Baloth",
  "Magnigoth Sentry", "Moon Sprite", "Mosscoat Goriak", "Murasa Brute", "Nessian Courser",
  "Nettle Swine", "Norwood Archers", "Norwood Ranger", "Orazca Frillback", "Order of the Sacred Bell",
  "Pygmy Razorback", "Rib Cage Spider", "Rowan Treefolk", "Rumbling Baloth", "Runeclaw Bear",
  "Scryb Sprites", "Southern Elephant", "Spiked Baloth", "Spined Karok", "Sporecap Spider",
  "Swordwise Centaur", "Tajuru Snarecaster",
];
// A third singleton pool, for a 3-player fixture (see `thirdCommanderFixture`) — kept separate from
// `commanderFixtures()`'s own 2-tuple return type so every existing 2-deck caller is untouched.
export const blue = [
  "Aarakocra Sneak", "Aberrant Researcher", "Abhorrent Oculus", "Aboleth Spawn", "Academy Drake",
  "Academy Elite", "Academy Loremaster", "Academy Researchers", "Academy Wall", "Acquisition Octopus",
  "Advanced Hoverguard", "Aegis Sculptor", "Aegis Turtle", "Aerial Guide", "Aerie Worshippers",
  "Aeromoeba", "Aeronaut Tinkerer", "Aether Adept", "Aether Channeler", "Aether Figment",
  "Aether Swooper", "Aether Theorist", "Aetherplasm", "Agent of Kotis", "Agent of Raffine",
  "Air Marshal", "Alluring Siren", "Amoeboid Changeling", "Amphin Cutthroat", "Amphin Mutineer",
  "Amphin Pathmage", "Ancient Crab", "Animating Faerie", "Anthroplasm", "Aphetto Alchemist",
  "Aphetto Grifter", "Aphetto Runecaster", "Apprentice Sorcerer", "Apprentice Wizard", "Aquamoeba",
  "Aquamorph Entity", "Aquatic Alchemist", "Aquus Steed", "Arcane Artisan", "Arcane Investigator",
  "Archaeomancer", "Archaeomender", "Archivist", "Archivist of Gondor", "Archmage Emeritus",
  "Arctic Aven", "Arctic Merfolk", "Argent Sphinx", "Armguard Familiar", "Armored Skaab",
  "Armored Whirl Turtle", "Artificer's Assistant",
];
function deck(commander: string, land: string, creatures: string[]): ForgeDeckSpec {
  if (creatures.length !== 57 || new Set(creatures).size !== 57) throw new Error("Invalid singleton fixture");
  return { name: `${commander} 100-card controller validation`, cards: [
    { name: commander, quantity: 1, section: "commander" },
    { name: land, quantity: 42, section: "mainboard" },
    ...creatures.map((name) => ({ name, quantity: 1, section: "mainboard" as const })),
  ] };
}
export const commanderFixtures = (): [ForgeDeckSpec, ForgeDeckSpec] => [
  deck("Krenko, Tin Street Kingpin", "Mountain", red),
  deck("Ghalta, Primal Hunger", "Forest", green),
];
/** The third seat for a 3-player fixture: `[...commanderFixtures(), thirdCommanderFixture()]`. */
export const thirdCommanderFixture = (): ForgeDeckSpec => deck("Talrand, Sky Summoner", "Island", blue);
