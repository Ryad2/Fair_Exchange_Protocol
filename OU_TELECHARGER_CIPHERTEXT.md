# Où télécharger le ciphertext ?

## Réponse courte
Le ciphertext est **automatiquement récupéré depuis le serveur** via l'API `/api/files/{contractId}` dans l'interface web.

## Détails

### 1. Où est stocké le ciphertext ?
Le ciphertext est stocké côté serveur dans le dossier `uploads/` avec le nom :
- **Fichier :** `file_{contractId}.enc`
- **Chemin :** `{UPLOADS_PATH}/file_{contractId}.enc`

### 2. Comment récupérer le ciphertext dans l'interface ?

#### Option A : Récupération automatique (recommandé)
Dans `OngoingContractModal.tsx`, la fonction `getLargeData()` récupère automatiquement le ciphertext :

```typescript
// Ligne 1107-1119
ct = hex_to_bytes(
    (
        await (
            await fetch(`/api/files/${id}`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            })
        ).json()
    ).file
);
```

**L'API `/api/files/{id}` :**
- Retourne le fichier `file_{id}.enc` en format hexadécimal
- Le fichier est stocké côté serveur lors de la création du contrat

#### Option B : Sélection manuelle (déconseillé)
L'interface propose aussi de sélectionner manuellement un fichier chiffré, mais **C'EST DANGEREUX** car :
- Si le vendor sélectionne un mauvais fichier, la dispute échouera
- Il faut utiliser **exactement** le même ciphertext que celui du commitment

```typescript
// Ligne 1099-1101
if (confirm("Do you want to select the encrypted file (ciphertext) ?")) {
    ct_file = await openFile();
}
```

### 3. Dans le code de la dispute

Quand le vendor calcule les preuves (`clickSendProofs`), la fonction `getLargeData()` est appelée :

1. **Si l'utilisateur confirme :** sélection manuelle du fichier (⚠️ risque d'erreur)
2. **Si l'utilisateur annule :** récupération automatique depuis `/api/files/${id}` ✅

### 4. Recommandation

**Pour éviter les erreurs, toujours utiliser la récupération automatique :**
- Quand l'interface demande "Do you want to select the encrypted file (ciphertext)?"
- **Répondre NON** pour utiliser le ciphertext du serveur
- **Répondre OUI seulement** si vous êtes sûr d'avoir le bon fichier

### 5. Emplacement sur le serveur

Le ciphertext est stocké dans :
```
{projet}/src/app/uploads/file_{contractId}.enc
```

L'API `/api/files/{id}` :
- Lit ce fichier depuis le serveur
- Le retourne en format hexadécimal
- Le code frontend le convertit en `Uint8Array` pour les calculs

### 6. Pourquoi c'est important ?

Le ciphertext utilisé dans la dispute **DOIT être identique** à celui utilisé pour générer le commitment. Si le vendor utilise un ciphertext différent :
- Les preuves ne vérifieront pas
- La dispute échouera même si les fichiers plaintext sont identiques
- Le vendor perdra la dispute incorrectement

**Conclusion :** Utiliser toujours la récupération automatique depuis l'API plutôt que la sélection manuelle.


