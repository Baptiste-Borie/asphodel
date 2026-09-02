CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scryfall_id` text NOT NULL,
	`oracle_id` text,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`mana_cost` text,
	`mana_value` real DEFAULT 0 NOT NULL,
	`type_line` text NOT NULL,
	`oracle_text` text,
	`colors` text NOT NULL,
	`color_identity` text NOT NULL,
	`image_uri` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_scryfall_id_unique` ON `cards` (`scryfall_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cards_normalized_name_unique` ON `cards` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `deck_entries` (
	`deck_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`section` text NOT NULL,
	PRIMARY KEY(`deck_id`, `card_id`, `section`),
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deck_entries_quantity_positive" CHECK("deck_entries"."quantity" > 0),
	CONSTRAINT "deck_entries_section_valid" CHECK("deck_entries"."section" in ('commander', 'mainboard'))
);
--> statement-breakpoint
CREATE INDEX `deck_entries_deck_id_index` ON `deck_entries` (`deck_id`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
