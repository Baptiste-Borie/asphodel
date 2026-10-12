# Rangées de permanents et badges — 0.1.32

La revue 08 confirme le focus contextuel et la séparation des permanents physiques. Les plateaux chargés restent cependant une longue rangée défilante, avec de la hauteur disponible et des badges concurrents sur les cartes.

- Un champ de bataille de plus de huit groupes affichés est identifié comme dense par le renderer existant. Aucun changement du regroupement ou des références moteur.
- En direction contrastée, le plateau numérique en focus et le plateau physique principal utilisent une grille de rangées pour les permanents condensés. La taille est bornée à 88 px en numérique et 80 px en physique ; le défilement devient vertical. Les aperçus, mains, terrains et présentation en cartes imprimées conservent leur disposition.
- Les mêmes statistiques, quantités et compteurs publics sont recopiés dans une bande non interactive du slot, sous la carte. Cette bande reste droite quand la carte est engagée. Les badges originaux restent disponibles pour les autres thèmes et leur suivi de mise à jour. Aucune donnée cachée n'est ajoutée, aucun choix de jeu ne passe par cette bande.
- Le mode dense accepte les rangées partiellement visibles à la frontière du défilement vertical. Cette exception ne concerne que les grilles denses : les autres cartes continuent d'être contrôlées pour leur hauteur. Les collisions entre cartes restent contrôlées.
- La revue native confirme la présence de plusieurs rangées et l'absence de débordement horizontal du champ de bataille dense agrandi. La capture de fin de défilement montre maintenant les dernières rangées et la fin de la main.

Validation de préparation : construction, suite frontend de 424 tests, parcours DOM combat/ciblage/plateau chargé dans les deux modes. La grille CSS, les bandes de badges et la lisibilité restent à vérifier sur les captures Electron de l'utilisateur.
