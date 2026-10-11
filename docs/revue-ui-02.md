# Revue UI 02 — table physique, 0.1.22

## Ce que montrent les captures reçues

La revue locale du 11 octobre contient 17 captures à 1366 × 768 et 960 × 640.
Le rapport ne contient aucune erreur de rendu, image indisponible ou en attente,
ni contrôle débordant horizontalement. Les illustrations du builder sont maintenant
visibles. Le contexte des cibles reste visible au-dessus de la liste.

Le panneau d’analyse élargit encore le document. La précédente correction de
largeur ne suffit donc pas. La table physique juxtapose une grande table et une
prévisualisation, mais les cartes sont coupées par leurs zones de défilement.
La saisie vocale masque l’identité du joueur ; les choix de combat et de cibles
recouvrent le plateau. Les piles publiques restent empilées verticalement.

## Changements de cette vague

- Une colonne réservée à droite contient les décisions puis la saisie vocale.
  Les tables utilisent l’espace à gauche. Sous 850 px, plateau et commandes
  occupent deux bandes distinctes.
- Les cartes et les identités prennent une taille adaptée à la hauteur disponible.
  Les piles publiques sont horizontales, à côté des terrains et des commandants.
  Les grandes tables conservent un défilement pour les états chargés.
- Le focus manuel, le retour à la vue d’ensemble et les choix Forge sont conservés.
  Les principaux libellés de vue sont français ; le HUD nomme le joueur plutôt
  que le contrôleur « External Player ».
- Le corps du builder contient son débordement. La prochaine revue liste aussi
  les éléments dépassant la fenêtre pour diagnostiquer le problème s’il persiste.
- La revue ajoute la table physique compacte, les changements de focus et les
  configurations à trois et quatre joueurs. Elle mesure les intersections entre
  plateau, décisions et voix, ainsi que les cartes de champ de bataille coupées
  verticalement. Les cartes empilées peuvent volontairement se chevaucher.

## Validation et limites

Compilation TypeScript/Vite et vérifications d’interaction DOM : combat, cibles,
choix exacts, absence de doubles soumissions et restauration après reconnexion.
Les tests natifs de combat et de cibles vérifient désormais la séparation des
zones ; la revue produit 23 captures et un rapport de géométrie.

Electron ne peut pas démarrer dans cet environnement. Ces nouveaux contrôles
natifs sont prêts mais ne sont pas exécutés ici. Le résultat visuel, la disparition
du débordement d’analyse et les configurations multijoueurs restent à vérifier
sur la prochaine revue locale. La direction artistique globale reste ouverte.
