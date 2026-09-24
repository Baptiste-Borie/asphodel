-- drizzle-kit generated a table-rebuild (the PK gained `category`) whose INSERT...SELECT reads
-- `category`/`category_position` off the *old* table — columns that don't exist there yet. Add
-- them first so the rebuild below has something to select.
ALTER TABLE `deck_entries` ADD `category` text DEFAULT 'Mainboard' NOT NULL;--> statement-breakpoint
ALTER TABLE `deck_entries` ADD `category_position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deck_entries` (
	`deck_id` integer NOT NULL,
	`card_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`section` text NOT NULL,
	`category` text DEFAULT 'Mainboard' NOT NULL,
	`category_position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`deck_id`, `card_id`, `section`, `category`),
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deck_entries_quantity_positive" CHECK("__new_deck_entries"."quantity" > 0),
	CONSTRAINT "deck_entries_section_valid" CHECK("__new_deck_entries"."section" in ('commander', 'mainboard'))
);
--> statement-breakpoint
INSERT INTO `__new_deck_entries`("deck_id", "card_id", "quantity", "section", "category", "category_position") SELECT "deck_id", "card_id", "quantity", "section", "category", "category_position" FROM `deck_entries`;--> statement-breakpoint
DROP TABLE `deck_entries`;--> statement-breakpoint
ALTER TABLE `__new_deck_entries` RENAME TO `deck_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `deck_entries_deck_id_index` ON `deck_entries` (`deck_id`);