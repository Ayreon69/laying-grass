# Laying Grass

**Plante tes plaques, arrache celles des autres, fais pousser le plus grand carré.**

👉 **Jouer : https://laying-grass.onrender.com** (la première ouverture peut prendre jusqu'à une minute, le temps que le serveur gratuit se réveille)

Jeu de placement multijoueur en ligne, à jouer entre amis depuis un navigateur, sur téléphone ou ordinateur, sans compte ni installation.
D'après *Laying Grass*, l'épreuve de *The Devil's Plan* (saison 1, Netflix). Création de fans, non officielle, avec ses propres visuels.

## Règles en bref

- De 2 à 8 jardiniers, chacun sur le même terrain et avec sa couleur. Chacun commence avec **3 graines**, **1 bon** et une première touffe d'une case.
- **À ton tour, tu poses la plaque du tour** : la file est publique, et tout le monde voit les suivantes. On peut la tourner et la retourner.
- Elle doit **toucher ton gazon par un côté**, et ne toucher **aucun gazon adverse par un côté** (les coins, oui). Si elle ne tient nulle part, ou si le temps s'écoule, elle est perdue.
- **Un bon** permet de prendre l'une des cinq plaques suivantes. Celles qu'on saute repartent en bout de file. Sans bon, l'échange coûte 1 graine. Les bons s'achètent et se donnent : tout se négocie à voix haute.
- **Les cases spéciales** s'activent quand on les entoure sur leurs quatre côtés : un bon, une graine, une **pierre** à poser sur une case libre (n'importe qui peut la retirer pendant son tour, pour 1 graine) ou un **arrachage** (on prend une plaque d'un autre pour la replanter chez soi). Une plaque posée dessus les fait disparaître, sans effet.
- Après la dernière manche, chacun à son tour peut acheter des **mottes d'une case**, à 1 graine pièce.
- **On compte** : un carré plein de 5 × 5 ne change rien, chaque case de côté en plus rapporte 1 graine, chaque case en moins en coûte 1. Le plus grand carré de la table touche une **prime de 3 graines**. S'il y a égalité, elle se partage si elle se divise juste. Sinon, personne ne la touche.
- Le plus de graines gagne. En cas d'égalité, le plus grand carré passe devant.

Les règles viennent des récapitulatifs de l'émission (NamuWiki, Dexerto), pas d'un livret.

Sont des choix de ce jeu :

- **Le terrain suit le nombre de joueurs** : 12 + 2 × joueurs de côté, soit environ cent cases chacun, de 16 × 16 à 28 × 28. L'émission se joue à neuf, sur 30 × 30.
- **La longueur est réglable** : 6 manches, ou 9 comme dans l'émission.
- **Les cases spéciales et la file changent à chaque partie**, au hasard, sans être imprimées d'avance.
- **Les graines servent de monnaie et de score**, et le départ est fixé à 3 graines et 1 bon.
- **La première plaque peut entourer une case spéciale**, comme n'importe quelle autre.
- **La première touffe et les cases entourées ne s'arrachent pas**, et une plaque arrachée sans place pour la replanter est perdue.
- **Aucune aide au calcul** : aucune taille de carré n'est affichée pendant la partie. Ce qui est légal se voit, parce que c'est la règle. Le terrain porte un repère discret toutes les 5 cases, comme les points d'un goban. Les carrés ne s'annoncent qu'à la révélation finale.
- **Le temps par geste est réglable** par l'hôte (sans limite, 45, 90 ou 120 secondes). À l'approche de la fin, une plaque déjà bien placée est posée d'office, pour ne pas perdre une plaque à une fraction de seconde près. Un joueur absent plus de 20 secondes est remplacé par le pilote automatique jusqu'à son retour.

## Les bots

Ici, rien n'est caché : ils voient ce que tout le monde voit. Leur faiblesse vient d'un coup d'œil imparfait, et leur niveau varie d'un bot à l'autre.

- Ils visent un carré encore possible et le remplissent sans y laisser de trous.
- Ils gardent leurs bons pour un vrai gain, et les plus agressifs gênent celui qui mène.
- Le pilote automatique joue comme eux, sans chercher à gêner personne.

`npx tsx test/sim.ts 100` mesure leur force. Un bot contre une table de jardiniers qui posent au hasard (la place moyenne compte 1 pour le premier), sur 40 parties :

| Joueurs | Plaques (9 manches) | Calcul par geste | Pire geste | Carré moyen | Place du bot | Premier |
|---|---|---|---|---|---|---|
| 2 | 18 | 4,3 ms | 29 ms | 4,81 | 1,02 | 98 % |
| 3 | 27 | 4,5 ms | 15 ms | 4,79 | 1,00 | 100 % |
| 4 | 36 | 4,9 ms | 16 ms | 4,92 | 1,48 | 83 % |
| 5 | 45 | 5,6 ms | 19 ms | 4,76 | 1,60 | 85 % |
| 6 | 54 | 6,1 ms | 21 ms | 4,75 | 1,35 | 93 % |
| 8 | 72 | 7,7 ms | 25 ms | 4,71 | 1,75 | 88 % |

Entre bots, les carrés font surtout de 4 à 6 cases de côté, comme dans l'émission.

## Fonctionnalités

- Tables privées avec code à 4 lettres, lien d'invitation, partage natif et QR code
- Partie contre 1 à 7 bots en un clic
- Une pépinière : des plaques de gazon tondu sur une terre sombre, chaque jardinier a sa couleur et son motif, dessinés pour ce jeu
- Sur téléphone, on glisse la plaque du doigt, un tap l'amène à l'endroit voulu, un autre sur la plaque la tourne ; sur ordinateur, elle suit la souris, avec la molette et le clic droit
- Ce qui est légal s'affiche sur le terrain, et le bouton dit pourquoi une pose est refusée
- La file des plaques reste sous les yeux, avec les cinq que tu peux prendre
- Loupe sur les grands terrains, proposée dès que les cases deviennent petites
- Les graines et les bons volent vers ceux qui les reçoivent, la plaque arrachée part du terrain de sa victime
- Toucher un jardinier ouvre sa fiche : acheter un bon, en donner un
- La révélation finale va du plus petit carré au plus grand, puis les comptes détaillés, les victoires de la soirée et la revanche en un clic
- Réactions, règles consultables en jeu
- Reprise automatique après une coupure, pilote automatique, spectateurs
- Sons synthétisés et vibrations, animations réduites si le système le demande

## Développement

```bash
npm install
npm run dev:server   # serveur temps réel sur http://localhost:3230
npm run dev:client   # interface sur http://localhost:5202
npm test             # pose, bons, cases spéciales, pierres, arrachage, comptes
npm run build && npm run e2e   # parties complètes avec de vrais clients connectés
npx tsx test/sim.ts 100        # force des bots : 100 parties par configuration
```

`LG_FAST=1` accélère les bots et les chronos (tests locaux uniquement).

## Architecture

- `shared/` : contrat client/serveur (`protocol.ts`), les 96 plaques (`shapes.ts`) et les règles du terrain (`board.ts`), communes au client et au serveur
- `server/` : Express + Socket.IO, moteur de partie (`game.ts`), bots (`bots.ts`), table et minuteries (`room.ts`). Le serveur fait autorité : le client propose une pose, le serveur la vérifie
- `client/` : React + Vite + Framer Motion. Le terrain est dans `components/Field.tsx`, les gestes de pose dans `lib/planter.ts`, la table dans `screens/Table.tsx`, le dévoilement dans `screens/Final.tsx`
- Déploiement : un seul service Node (`npm ci && npm run build`, puis `npm start`)
