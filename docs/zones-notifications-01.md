# Zones et notifications — 0.1.27

La revue native 03 a confirmé la lisibilité du tour, mais révélé un recouvrement
main/terrains à quatre joueurs, des titres coupés pendant le défilement et un
bandeau recouvrant la carte révélée. Les métriques précédentes ne couvraient pas
ces cas. Ce patch agit sur la structure des sièges, pas uniquement les couleurs.

- Main et terrains sont dans deux cellules d'une bande personnelle dédiée.
- Les titres sont des éléments fixes extérieurs aux conteneurs de cartes défilants.
- Les commandants conservent leurs cartes imprimées et un nom séparé ; les autres
  permanents restent condensés, avec inspection complète et noms accessibles.
- Le focus conserve un siège principal et une colonne de sièges secondaires.
- Les annonces de tour sont dans l'en-tête, à l'écart de la révélation centrale.
- Les boutons désactivés sont atténués par leur surface, sans effacer leur texte.
- L'historique numérique occupe le bas de la colonne des commandes.

L'ancienne apparence et la piste lumineuse gardent leurs placements grâce à des
conteneurs display:contents. Les rendus de cartes, décisions exactes, focus et
transitions d'état utilisent les composants existants. La table physique reçoit
seulement les finitions partagées des notifications et boutons.

La revue native comprend désormais dix captures, dont le retour de focus et le
focus à quatre joueurs. Des mesures supplémentaires contrôlent la séparation
main/terrains et l'organisation des notifications pendant la séquence d'images.
Le rendu Electron reste à examiner : les tests DOM ne mesurent pas la géométrie.
