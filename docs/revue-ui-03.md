# Revue UI 03 — lisibilité et scènes peuplées, 0.1.23

## Résultat observé du patch 20

Les 23 captures de la revue reçue le 11 octobre ne présentent aucune erreur de
rendu, aucun débordement horizontal du document ou des contrôles, aucune image
indisponible ou en attente. Les mesures ne trouvent aucune intersection entre
plateau, décisions et saisie vocale, ni carte de champ de bataille coupée
verticalement dans les scènes physiques à deux, trois et quatre joueurs.

L’inspection visuelle confirme la séparation des espaces et la correction du
débordement d’analyse. Elle montre aussi des noms trop tronqués sur les petites
cartes, des libellés de piles qui se touchent et un mélange français/anglais.
Les scènes de combat utilisent des noms factices et aucune présentation
illustrée : elles testent correctement les cas de secours, mais ne suffisent pas
pour juger le rendu d’une table peuplée.

## Changements de cette vague

- Les cartes de prévisualisation sont plus larges, avec un recadrage moins haut.
  Les noms utilisent deux lignes et les statistiques occupent un coin séparé.
  Le survol et l’inspection donnent toujours accès à la carte complète.
- Chaque pile publique affiche son nom et son nombre sur deux lignes distinctes.
  Les libellés, phases usuelles, identités, commandes vocales et contrôles de pile
  sont français. Les noms des cartes et le texte du moteur restent tels quels.
  Les phases inconnues conservent un libellé lisible plutôt que disparaître.
- La revue conserve ses scènes sans images et ajoute trois captures peuplées :
  table physique, focus sur le joueur et table numérique. Elles utilisent les
  illustrations du catalogue fourni, des terrains engagés, des commandants, une
  main visible du joueur et des mains adverses masquées.
- Ces scènes restent des fixtures de présentation. Elles ne prétendent pas être
  des parties Forge légales ni tester les règles. Le fournisseur de présentations
  ne retourne que les noms demandés par l’application.

## Validation

Les 423 tests unitaires frontend passent, ainsi que la compilation TypeScript/Vite.
Les contrôles DOM de combat et de ciblage vérifient les choix exacts, les doubles
soumissions, la reconnexion et les identités masquées. Les nouvelles scènes
peuplées passent les contrôles DOM de présentation illustrée, d’inspection des
zones publiques, de focus et de soumission exacte d’une seule action.

La revue native produit désormais 26 captures. Elle doit encore être exécutée
sur la machine locale : cet environnement ne permet pas de démarrer Electron.
Le nouveau rendu n’est donc pas encore validé visuellement. Les illustrations
dépendent de leur disponibilité pendant la revue ; son rapport distingue les
images en attente et indisponibles.

La disposition physique est maintenant étayée par les captures reçues. La
composition numérique et la direction artistique générale restent à travailler ;
des métriques sans erreur ne prouvent pas à elles seules un résultat professionnel.
