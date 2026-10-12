# Finitions des badges — 0.1.33

La revue 09 confirme les rangées, les groupes et l'absence de collisions, mais les statistiques sous les grandes cartes sont trop petites et un plateau physique peu chargé défile verticalement à 960 × 640.

- Police des statistiques/quantités proportionnelle à la carte, de 11 à 16 px. Compteurs à 10 px.
- Réserve verticale de 26 px par défaut ; une seconde ligne (44 px au total) n'est réservée que lorsqu'un compteur public existe réellement dans le slot.
- Espacement vertical du champ de bataille physique principal peu chargé réduit à 8 px.
- L'étiquette de relation de combat est replacée sur la carte, au-dessus de l'illustration, pour ne pas recouvrir les chiffres sous le permanent.
- La revue Electron mesure la police des statistiques en focus et vérifie explicitement l'absence de défilement vertical du petit plateau physique de combat.

Construction frontend et application exacte du patch vérifiées. Cette passe modifie uniquement CSS et mesures de revue ; les comportements de choix et le regroupement ne sont pas modifiés. La vérification visuelle reste à effectuer avec les captures natives.
