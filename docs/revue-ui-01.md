# Revue UI 01 — 11 octobre 2026

Source : revue Electron exécutée localement par Baptiste ; 17 captures, 1366×768 et 960×640, aucun problème JavaScript rapporté. Les situations de jeu sont des fixtures publiques : elles ne prouvent pas le déroulement d’une vraie partie Forge.

## Constats et première correction / 0.1.21

- Le rapport signale un débordement horizontal dans l’analyse du builder. Le panneau reçoit des contraintes de taille explicites et ses tables conservent leur propre zone de défilement. À confirmer par les métriques natives suivantes.
- Les premières captures présentent des cartes sans illustration et presque sans texte ; les illustrations apparaissent dans la capture finale. C’est un chargement encore en cours, pas une preuve de cache cassé. Le builder affiche désormais nom/type et état de chargement avant l’image, puis un état indisponible en cas d’échec.
- La revue attend désormais brièvement les images visibles et compte les images en attente séparément. Un test d’illustrations réussies/absentes reste nécessaire : zéro image cassée ne signifie pas que tout a chargé.
- Le contexte des cibles est partiellement coupé au-dessus du compteur. Les titres et le contexte ne doivent pas se compresser dans le flex vertical ; seule la liste d’options absorbe la réduction d’espace. À confirmer sur les prochaines captures.

## Prochaines priorités visuelles et UX

1. Mode physique : plateau principal, zones et panneau de décision entrent en concurrence ; plusieurs barres de défilement coupent les cartes. Recomposer la place dédiée au joueur physique et aux adversaires, puis vérifier focus manuel et décisions avant/après. Ne pas masquer arbitrairement des zones ou des choix.
2. Vue par catégories : deux grands titres identiques et une douzaine d’actions simultanées retardent l’accès aux cartes. Réunir l’identité du deck et réserver les actions secondaires dans un menu cohérent avec la table.
3. Jeu : typographie minuscule sur les zones, contraste insuffisant de certains repères et anglais/français mélangés. Clarifier joueur actif, priorité, phase et prochaine action ; unifier les libellés authored sans modifier les textes Oracle/choix Forge.
4. Préparation : le lancement exige de descendre sous les réglages de rythme et la graine technique. Faire passer choix des decks/mode/lancement avant les réglages avancés.
5. Identité : les captures confirment une interface fonctionnelle de logiciel, mais pas encore le rendu de jeu recherché. La palette claire n’est pas validée. Construire l’identité autour d’une composition en partie maîtrisée, pas d’un nouveau remplacement automatique des couleurs.

## Boucle de travail

Les captures et métriques initiales sont le point de comparaison. Corriger une interaction cohérente, lancer les vérifications de comportement, puis comparer les captures suivantes. Une capture meilleure ne vaut pas validation de toutes les interactions ; un test automatisé vert ne vaut pas validation esthétique.
