# Fix des erreurs Next.js ENOENT

## Problème
Next.js génère des erreurs `ENOENT` lors de l'écriture des fichiers de build manifest dans `.next/static/development/`.

## Solution
1. Arrêter le serveur Next.js (Ctrl+C)
2. Supprimer le répertoire `.next` : `rm -rf .next`
3. Redémarrer le serveur : `npm run dev` ou `next dev`

## Si le problème persiste
- Vérifier que les permissions sont correctes sur le répertoire `.next`
- Vérifier qu'il y a assez d'espace disque
- Essayer de reconstruire : `npm run build` puis `npm run dev`





