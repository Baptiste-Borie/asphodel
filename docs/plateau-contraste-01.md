# Plateau contrasté — 0.1.25

La piste contrastée est retenue comme base à développer, pas comme DA définitive.
Ce patch se concentre sur la table : nouvelles proportions à deux joueurs, main
plus grande, zones de terrains et permanents, cadres de cartes, engagement sans
compression des permanents et défilement plus discret. Les quatre joueurs sont
organisés en grille ; le focus conserve tous les sièges et leurs interactions.

Le système de transitions existant reste la source des déplacements de cartes.
Il reçoit un retour visuel sur les changements publics de PV et de joueur actif
et une transition courte de focus numérique. Aucun effet initial sur une reprise
de partie, aucune répétition sur des observations identiques ; réduction des
mouvements et rattrapage annulent les effets. Aucune bibliothèque supplémentaire.

Revue native : huit captures et douze images d'un changement d'état synthétique
(main vers plateau, engagement, PV et tour). Les métriques numériques contrôlent
les intersections de permanents et de la colonne de décisions. Les mains et piles
peuvent se recouvrir intentionnellement. Ces fixtures ne valident pas les règles
Forge et les tests DOM ne remplacent pas l'examen du rendu Electron.
