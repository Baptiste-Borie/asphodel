# Asphodel — refonte UI progressive

Direction retenue avec Baptiste : interface blanche, nette et professionnelle ; police sans-serif lisible ; bleu encre posé. Le caractère doit surtout venir des finitions et de la fluidité. Éviter les titres littéraires, les grands headers, le beige/écru et les décors RP.

## Patch 16 / 0.1.19 — table du builder

- Header de 48 px et barre d’outils de 36 px ; actions principales visibles, actions secondaires dans le menu.
- Actions de sélection dans un espace réservé ; table stable lors des sélections.
- Recherche et analyse à droite, avec espace réservé sur desktop ; overlay dans les fenêtres étroites.
- Focus explicite, Échap, états de sélection/déplacement/destination ; entrée de panneau à 150 ms avec respect de la réduction des animations.
- Polices système et chiffres tabulaires ; images absentes lisibles par nom/type.

Le modèle de projet, les coordonnées, les piles, les notes, l’historique, le cache et Forge ne changent pas. Aucun rangement automatique ajouté.

## Suite à valider dans l’app

1. Utiliser le builder avec de vrais decks et ajuster densité, dispositions et accès aux actions.
2. Étendre les composants visuels à la bibliothèque, aux détails de carte et aux paramètres.
3. Revoir l’interface en partie : hiérarchie plateau/décision, transitions d’état et interactions.

Ne pas copier la mise en page de la table dans toutes les vues : chaque écran doit garder l’espace nécessaire à sa tâche. Les démos sont une référence d’exploration, pas un cahier des charges figé.
