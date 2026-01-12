# Explication: Quel fichier est utilisé dans la dispute ?

## Fichier utilisé actuellement

Le fichier utilisé pour toutes les opérations de dispute (réponses, opinions, preuves) est:

**`src/app/uploads/file_${contractId}.enc`**

Ce fichier est récupéré automatiquement via l'API `/api/files/${contractId}`.

## Pourquoi la sélection manuelle a été désactivée ?

J'ai désactivé la sélection manuelle de fichiers pour garantir la cohérence dans la dispute:

1. **Cohérence avec le commitment**: Le vendor et le buyer DOIVENT utiliser exactement le même ciphertext que celui utilisé pour créer le commitment initial
2. **Éviter les erreurs**: Si un utilisateur sélectionne un fichier différent par erreur, la dispute échouera car les preuves ne correspondront pas au commitment
3. **Sécurité**: Le fichier stocké sur le serveur est celui qui correspond au commitment, donc c'est la source de vérité

## Comment le fichier est stocké ?

Le fichier est stocké lorsque le vendor crée le contrat (endpoint `PUT /api/precontracts`):
- Le ciphertext est enregistré dans `src/app/uploads/file_${id}.enc`
- Ce fichier est ensuite utilisé pour toutes les opérations de dispute

## Si vous voulez réactiver la sélection manuelle

Si vous voulez quand même permettre la sélection manuelle (avec un avertissement), je peux réactiver cette fonctionnalité. Cependant, cela peut causer des problèmes si l'utilisateur sélectionne un mauvais fichier.

### Options:
1. **Garder le comportement actuel** (recommandé): Toujours utiliser le fichier depuis l'API
2. **Réactiver avec avertissement**: Permettre la sélection mais avec un avertissement clair
3. **Hybride**: Utiliser l'API par défaut, mais permettre de sélectionner un fichier local si nécessaire

Quelle option préférez-vous ?


