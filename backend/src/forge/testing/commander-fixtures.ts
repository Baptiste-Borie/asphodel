import type { ForgeDeckSpec } from "../forge-protocol.js";

// Printed, singleton creature fixtures. Native Forge supplies every runtime rule.
const red = [
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
const green = [
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
