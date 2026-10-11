# Asphodel — refonte globale / 0.1.20

Direction retenue avec Baptiste : blanc neutre, surfaces froides, bleu encre et sans-serif. Le caractère vient de la densité, des interactions et des finitions ; pas de décor RP, de beige ni de titres littéraires.

## Parcours

La bibliothèque devient l’entrée du builder et le point de retour depuis la navigation principale. Elle réunit création, import, recherche dans les decks et ouverture des projets. Un deck s’ouvre directement sur la table ; la vue par catégories reste accessible dans son menu. Le catalogue conserve son onglet et ses filtres.

## Interface commune

- Header compact, titres contextuels et navigation Bibliothèque / Jouer / Microphone.
- Bibliothèque, catalogue, catégories, table libre, analyse, mains de départ et versions partagent les mêmes surfaces, textes, bordures et états d’action.
- Préparation de partie, jeu numérique et compagnon physique utilisent le même langage visuel. Les cartes, zones et interactions de jeu restent identifiables ; attaque, blocage et erreurs conservent des couleurs sémantiques.
- Paramètres, imports, inspection et autres dialogues adoptent le thème clair.
- Focus visible, transitions courtes, chiffres tabulaires et respect des animations réduites.

Les jetons communs sont définis dans `frontend/src/styles/asphodel-theme.css`. Les ajustements de disposition et de finition se trouvent dans `app-refit.css`, chargé après les composants. Les règles locales utilisent ces jetons pour éviter plusieurs palettes concurrentes.

## Validation

Les tests frontend et desktop vérifient les modèles et les comportements existants. Le smoke builder couvre les interactions de la table et le parcours bibliothèque → deck ; les contrôles natifs doivent être exécutés dans un environnement disposant d’un affichage Electron. La géométrie du jeu et les contrats Forge ne sont pas modifiés.
