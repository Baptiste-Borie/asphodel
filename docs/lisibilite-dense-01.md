# Lisibilité des décisions et plateaux denses — 0.1.31

La revue 07 passe ses 37 captures mais montre une grille numérique trop fragmentée à 960 × 640, des permanents physiques qui masquent leurs voisins, et des consignes de ciblage normales peintes en rouge.

- Dans la direction contrastée, à 1100 px de largeur ou moins et avec plus de deux joueurs, une décision combat/cible agrandit temporairement le plateau humain. Les adversaires gardent leurs résumés et leurs piles inspectables. La vue d'ensemble revient quand la décision complexe se termine. Un focus manuel est conservé ; revenir manuellement à la vue d'ensemble désactive le focus automatique pour l'épisode courant. Le redimensionnement est pris en compte sans attendre un nouveau choix Forge.
- Les permanents physiques ont des slots carrés et des marges non négatives : cartes droites et engagées sont séparées. Les éventails de main/terrains et les groupes de jetons restent en place.
- Les consignes de ciblage et d'envoi sont neutres et lisibles. Le marqueur « Déclaré » du combat utilise une couleur claire de confirmation.
- La revue native mesure désormais les collisions entre cartes de permanents physiques ; ces collisions interrompent la revue, au même titre que les panneaux hors cadre ou les validations coupées. Elle vérifie le focus humain en petite fenêtre et son retour automatique après ciblage.

Validation : construction frontend, 424 tests unitaires, six parcours DOM combat/cible/plateau chargé dans les deux modes. Vérifications supplémentaires du focus automatique, de la sortie vers la vue d'ensemble et du respect d'un retour manuel pendant les étapes de combat. Aucun choix moteur n'est ajouté ou modifié. Le rendu des slots, les collisions et les dimensions finales restent à confirmer dans Electron via les captures natives.
