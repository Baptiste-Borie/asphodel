# Revue d'une partie Forge réelle — 0.1.34

Les scènes déterministes de `review:looks` couvrent la disposition mais ne testent pas les enchaînements d'une vraie partie. La commande `npm --prefix desktop run review:forge` lance l'application de production avec son backend, son Java et son Forge embarqués.

## Déroulement

- Profil temporaire distinct de l'installation habituelle. Les decks sont les fixtures moteur Krenko/Ghalta, graine 42, mode numérique.
- Reprise de la partie par l'interface de production après lancement. Une capture n'est prise qu'une fois sa file de présentation au repos et le même identifiant de décision affiché que celui transmis par le backend.
- Driver exploratoire : conserve la main initiale, privilégie un terrain puis un sort proposé, limite les répétitions, choisit parmi les options exactes. Les valeurs utilisent l'intervalle fourni. Il ne prétend pas être un bon joueur.
- Les boutons de priorité disponibles sont réellement cliqués ; les autres choix passent par l'API normale. Le rapport distingue `ui_click` et `api` : les choix API ne valident pas le parcours de clic correspondant.
- Limites : 80 décisions humaines, tour 8 ou trois minutes après démarrage. Une absence de nouvelle décision pendant 30 secondes est signalée. Un prompt non géré arrête proprement l'exploration, sans inventer de réponse, notamment pour les identités physiques.
- Captures au premier type de décision rencontré et aux changements de tour. Fin de session et revue enregistrée via les routes normales, puis fermeture de l'application et suppression du profil temporaire.

## Résultat

`desktop/review-forge/` contient `index.html`, `report.json` et les captures. Le rapport donne les décisions/transports, le dernier état moteur, la cause d'arrêt, les erreurs et la revue finale du playtest. Un arrêt aux limites est une exploration bornée, pas une partie terminée naturellement. Aucun minimum de couverture combat ou ciblage n'est garanti par la graine.

Fermer l'application habituelle, installer/construire cette version pour préparer `desktop/runtime`, puis lancer la commande. La première initialisation Java et les présentations peuvent prendre du temps ; le script affiche un progrès toutes les dix décisions. Après un échec, le rapport reste exploitable et peut être zippé séparément.

## Vérification de préparation

Syntaxe du script, construction frontend et quatre tests du choix exploratoire : choix exacts, garde-fou de répétition, valeurs bornées, aucun Keep/Finish/identité physique inventé. Le runtime Forge n'est pas disponible dans l'environnement de préparation ; la partie réelle doit être exécutée sur la machine de l'utilisateur. Ce patch fournit le parcours, il ne revendique pas encore une exécution Forge réussie.
