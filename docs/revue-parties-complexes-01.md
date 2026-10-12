# Revue des parties complexes — 0.1.30

La revue 06 confirme la stabilité pendant l'envoi et l'agrandissement des cartes en focus. Les validations visuelles portaient surtout sur une priorité simple ; les décisions complexes et les plateaux chargés nécessitent leur propre revue.

## Interface

Dans la direction contrastée, le panneau numérique de combat/ciblage occupe une colonne de 320 px séparée du plateau. L'ancien déplacement horizontal des panneaux centrés est annulé explicitement. Le titre et le pied de validation restent fixes ; le corps des choix défile. La liste de créatures ne crée plus une seconde scrollbar imbriquée. Les boutons de validation prennent la largeur de la colonne. Le mode physique conserve sa colonne et la commande vocale.

## Revue native

`npm --prefix desktop run review:looks` prévoit 37 captures au total si tous les scénarios réussissent, dont :

- Attaquants, attaque attribuée puis retirée, bloqueurs et bloc attribué ; validation accessible aussi à 960 × 640.
- Nombreuses cibles illustrées, recherche, choix d'une cible, destination joueur, validation réellement proposée, deux instances d'une capacité dans la pile et retour à la priorité.
- Plateau chargé dans les deux modes : par joueur 24 permanents, 18 terrains, 16 jetons identiques ; main humaine de 18 cartes. Vue d'ensemble, focus et fin du défilement.

Le rapport vérifie la géométrie de la colonne, l'absence de recouvrement du plateau/commande vocale et la visibilité des boutons de validation. Une erreur produit une capture de diagnostic et interrompt la revue, sans masquer le problème.

Les fixtures sont des DTO publics déterministes et illustrés, sans données personnelles. Leurs séquences transmettent les choix exacts déjà proposés ; elles ne prouvent ni la légalité du plateau synthétique ni le déroulement d'une vraie partie Forge. Les fixtures combat/cible existantes restent disponibles pour les tests fonctionnels.

## Validation de préparation

Construction frontend et 424 tests unitaires. Parcours DOM sur les six nouvelles combinaisons (combat, cibles et plateau chargé × numérique/physique), vérification des choix exacts et du retour à la priorité. Les limites géométriques sont vérifiées par Electron sur la machine de l'utilisateur, puis les captures doivent être examinées visuellement.
