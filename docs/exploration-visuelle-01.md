# Exploration visuelle — 0.1.24

La direction blanche précédente reste contestée. Ce patch ne valide pas une DA
globale : il permet de comparer deux pistes sur la vraie table peuplée.

- Table lumineuse : surface minérale bleu-gris, lumière froide, relief et commandes structurées.
- Stratégie contrastée : surface marine, panneaux sombres, accent cyan, mêmes proportions.

Les deux pistes partagent une composition numérique avec une colonne de décision
réservée. La priorité physique utilise un panneau adapté à son contenu. Les cartes,
identités cachées, cibles légales et transitions de partie restent gérées par les
composants existants. Le sélecteur utilise sessionStorage et peut être remis sur
l'interface actuelle. Aucun changement du builder, de la bibliothèque ou des paramètres.

La revue native produit six captures de comparaison à 1366 × 768. Les métriques
et tests DOM ne valident pas l'esthétique ni toutes les tailles de fenêtre. Le
rendu Electron doit être examiné avant de retenir ou d'étendre une direction.
