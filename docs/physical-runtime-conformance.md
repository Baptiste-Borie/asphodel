# Physical 1v1 — audit de conformité du rendu réel

## Diagnostic vérifié

Au début de l'audit, `GET /playtests/active` renvoyait `playMode: "digital"`, tour 3.
L'inspection du navigateur sur le serveur local 5173 a relevé `class="table-root"`,
zéro `.physical-board` et deux `.table-battlefield-half`. Ce chemin monte bien Digital.
La pièce jointe contenait une analyse textuelle, pas le screenshot original : on ne peut pas
certifier que cette session était celle de cette image, mais la session locale était Digital.
Aucune action, création ou fin de partie réelle n'a été soumise pendant cet audit.

Le chemin Physical était branché, contrairement à l'hypothèse d'un composant inutilisé :
`createPlayModePicker → StartPlaytestRequest.playMode → startGame → buildGameScreen`
ou `getActivePlaytest → result.playMode → buildGameScreen`, puis
`poll / FramePlaybackQueue → paintBoard → physicalScene.render`.
Deux défauts réels subsistaient : héritage géométrique des colonnes commander/battlefield/piles,
et cartes complètes recadrées uniquement par CSS. Les tests précédents ne mesuraient pas cela.

## Corrections du chemin monté

- Physical ne monte plus les demi-plateaux ni la main globale de Digital, même cachés.
- `createPhysicalScene` demande explicitement `battlefieldStyle: 'condensed'` au renderer partagé.
  `createTableCard` sélectionne `printed`, `battlefield` ou `land`, indépendamment du layout CSS.
- Les variantes battlefield/land chargent une illustration seule : `artUri` explicite, ou variante
  Scryfall `art_crop` du même identifiant/face. Aucun fallback vers une image imprimée.
  Si une source différente ne fournit pas d'illustration, le nom reste affiché. L'inspection
  conserve l'image imprimée et les informations de carte. Rien n'est demandé pour une carte cachée.
- Chaque siège possède son en-tête identité/vie/main, sa bande de permanents, ses terrains et
  une bande de zones associant commandants et piles. La vue humaine 1v1 est une self-view de 470×142
  au maximum à la résolution testée, accessible par focus manuel.
- Le HUD nomme le mode actif. Reprendre une partie Digital ne la transforme jamais en Physical.
- Aucun changement au backend, à Forge ou au décor `physical-courtyard.css` dans cette passe.

## Tableau de conformité

| Exigence du brief | État dans le chemin Physical | Preuve ou limite |
|---|---|---|
| §2/5 : adversaire principal + self-view humaine | Corrigé et vérifié | À 1366×768 : 1306×360 contre 470×142, rapport de surface 7,04 |
| §6 : Overview / focus manuel, autres sièges vivants | Vérifié | Le focus humain persiste après changement de joueur actif et de vie adverse |
| §7 : permanents et terrains séparés | Corrigé et vérifié | Bandes distinctes, cartes principales 164 px, terrains 64 px |
| §8 : illustration sans carte imprimée sur le battlefield | Corrigé et vérifié | Aucun `.table-card-image` dans la bande ; images `.table-card-art`, chargées sans erreur avec les vraies illustrations |
| §8 : inspection complète | Conservé et vérifié | Carte imprimée dans l'inspecteur ; inspection d'une carte sans action ne soumet rien |
| §9 : états et regroupement | Conservé | Tests des groupes, 32 jetons, engagement, compteurs et expansion des choix exacts |
| §10 : mains physiques, confidentialité | Conservé | Main connue dans l'en-tête, dos seuls pour l'adversaire, interaction différée |
| §11 : bibliothèque/cimetière/exil | Corrigé et vérifié | Piles dans le siège, dos bibliothèque, carte supérieure publique, profondeur ; une zone vide reste vide et ne simule pas des cartes |
| §12 : zone de commandement et partenaires | Conservé et repositionné | Cartes réelles dans la bande de zones ; chaque commandant garde son nombre de lancements |
| §12 : coût/taxe actuelle | Limite du contrat conservée | Le coût légal vient des actions Forge ; nombre de lancements affiché, pas de taxe recalculée en frontend |
| §13 : vie ancrée au joueur | Corrigé et mesuré | Rectangle de vie entièrement inclus dans l'en-tête du siège ; aucune vie dans le rail historique |
| §13 : poison/énergie/dégâts de commandant | Non implémenté, données manquantes | Pas de champs de ressources joueur correspondants dans l'observation frontend actuelle |
| §13 : badges de rôles | Différé | Pas ajouté dans cette correction structurelle ; certains états de carte, par exemple ringBearer, existent côté bridge et demandent une intégration dédiée |
| §14–17 : tour/priorité/décision, HUD/pile/dock | Conservé | Priorité distincte de l'indicateur actif, dock d'actions, pile en overlay, mode maintenant explicite |
| §18–20 : cibles/pass/annulation | Conservé et testé | Choix Forge exacts, Pass clavier, annulation contextuelle/paiement ; auto-pass reste backend |
| §22–23 : mouvements et combat | Partiel, limites inchangées | Mouvements d'identités observées ; sélections de combat visibles ; graphe complet attaquant/bloqueur non exposé à cette vue |
| §5/28 : trois/quatre joueurs | Présentation extensible | Layout pur testé et quatre sièges testés dans les fixtures ; création de parties moteur toujours 1v1 |
| §24–27 : scène fantasy/polish | Volontairement différé dans cette passe | Aucune retouche du décor ; correction structurelle uniquement |
| §29 : informations cachées | Conservé et testé | Pas d'illustration/texte secret dans la scène, la main adverse ou les inspections |
| §30/34 : Digital, cycle de partie, Forge | Conservé | Digital garde ses deux plateaux/cartes imprimées/actions ; nouveau libellé du mode partagé. Aucun changement moteur/provider/persistance |
| §21/31 : caméra, placement libre, thèmes multiples | Hors périmètre | Inchangé |

## Vérification

Build frontend réussi et 151 tests frontend réussis. Trois scénarios navigateur :

- `physical-conformance-check.mjs` passe par le formulaire de création Physical, contrôle le POST
  choisi, les noeuds réellement montés, leurs rectangles, les images utilisées, le focus et la
  reprise ; vérifie ensuite l'isolation du rendu Digital. Réussi avec illustrations synthétiques
  distinctes des images imprimées, puis avec les vraies illustrations Scryfall et leurs dimensions
  naturelles non nulles. Résolutions 1366×768 et 1920×1080.
- `physical-redesign-check.mjs` : interactions/cibles, mains cachées, pile, inspection publique
  actualisée, partenaires, rangées chargées, reprise, mouvement réduit, combat, rapport/préparation.
- `tabletop-visual-check.mjs` : parcours Digital existant, Pass, annulation contextuelle/paiement,
  piles, inspection, reprise, changement de zone et mouvement réduit.

Les routes de partie des tests sont des fixtures : aucun match Forge Physical complet joué.
Les captures suivantes viennent de l'application montée avec ces fixtures et les vrais assets,
pas d'un composant isolé ou d'une maquette :

- [Physical 1366×768](visuals/physical-conformance-1366.png)
- [Physical 1920×1080](visuals/physical-conformance-1920.png)
