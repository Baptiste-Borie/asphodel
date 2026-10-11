# Stabilité et focus — 0.1.29

La revue native 05 confirme que la priorité compacte et les résumés adverses fonctionnent. Elle révèle toutefois que le plateau récupère sa colonne latérale pendant une requête, puis s'élargit de nouveau, et que le message d'attente reste sombre. Les cartes en focus ne profitent pas assez de la surface agrandie.

- La disposition de la décision est désormais un état de présentation explicite (`compact` ou `rail`). La décision générique choisit le mode après filtrage des actions. Un message temporaire garde le mode précédent ; un nouveau prompt combat, cible, valeur ou carte retrouve sa colonne. Cette disposition ne modifie aucun choix Forge.
- Le message d'envoi est traduit en français et peint en texte clair, dans la même barre que la priorité.
- Le focus utilise la largeur du plateau et le nombre réel de groupes rendus pour ajuster la taille des permanents (78–164 px). Les groupes de jetons comptent comme des slots. La main grandit aussi ; un plateau chargé garde un défilement horizontal et une taille minimale lisible.
- La revue native retient une réponse pour comparer les rectangles du plateau avant et pendant l'envoi, puis mesure la taille d'une carte en focus sur la fixture peu chargée. Les cartes cachées restent gérées par les composants existants.

Validation : construction frontend et suite unitaire, parcours DOM de priorité retenue et double clic, focus/résumé et inspection, combat et ciblage dans les deux modes, mouvement réduit. La géométrie CSS et la fluidité doivent être confirmées dans la revue Electron de l'utilisateur.
