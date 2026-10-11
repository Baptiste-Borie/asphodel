# Composition de jeu — 0.1.28

La revue native `asphodel-revue-looks-04.zip` montre une séparation des zones réussie, mais une colonne largement vide pour une seule priorité et des aperçus à quatre joueurs avec plusieurs défilements imbriqués.

## Changements

- Dans la table numérique contrastée, une décision contenant seulement le bouton de priorité devient une barre inférieure compacte. Le plateau récupère la largeur de la colonne. Les combats, cibles et autres décisions conservent leur espace latéral.
- À deux joueurs, la moitié humaine reçoit un peu plus de hauteur. À trois joueurs, les deux adversaires partagent la rangée supérieure et la table humaine prend toute la rangée inférieure. À quatre joueurs, la grille reste disponible.
- En focus, les autres joueurs deviennent des résumés publics : vie, commandant, nombre de permanents/terrains et taille de main. Le bouton « Agrandir » restitue leur plateau complet et fonctionne au clavier. Cimetière et exil restent inspectables directement. Aucun choix de jeu n'est envoyé par ce bouton.
- Les plaques de vie sont bornées à leur colonne pour éviter de recouvrir les titres. Les boutons de décision désactivés ont une couleur explicite qui gagne sur les anciennes règles partagées.
- La colonne physique passe à 300 px, en conservant la commande vocale et les décisions.

La sélection et les actions des cartes, les choix Forge, les mains cachées et les préférences de mouvement restent gérés par les composants existants. Un résumé n'expose que des nombres publics, jamais le contenu d'une main adverse.

## Vérifications

Construction frontend, suite unitaire et parcours DOM : priorité exacte et protection contre le double clic, mise à jour des compteurs, focus depuis le résumé, retour à la vue d'ensemble et inspection du cimetière sans choix de jeu. Parcours combat et ciblage dans les deux modes ; mouvements réduits.

`npm --prefix desktop run review:looks` capture désormais explicitement une priorité pendant une réponse retenue par la fixture pour mesurer le contraste désactivé. Les mesures attendent la fin des animations finies avant les captures statiques. La revue ajoute les collisions plaque/titre et le débordement des résumés.

Le rendu Electron doit être confirmé sur la machine de l'utilisateur : l'environnement de préparation ne permet pas de lancer la fenêtre native. Cette passe ne constitue pas une validation définitive de la direction artistique.
