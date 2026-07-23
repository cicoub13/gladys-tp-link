# TP-Link Kasa

Contrôlez vos prises, interrupteurs et ampoules connectés **TP-Link Kasa** depuis
Gladys, sur votre réseau local. L'intégration s'exécute dans son propre conteneur
et communique avec vos appareils via le protocole LAN Kasa classique.

## Appareils pris en charge

| Appareil                | Fonctionnalité          |
| ----------------------- | ----------------------- |
| Prises et interrupteurs | Marche/Arrêt (`switch`) |
| Ampoules                | Marche/Arrêt (`light`)  |

Les autres types TP-Link sont détectés lors d'un scan et signalés dans les logs,
mais ne sont pas publiés car ils n'ont pas encore de fonctionnalité contrôlable.

> **Local uniquement, protocole historique.** Cette intégration utilise le
> protocole LAN Kasa classique. Les firmwares Kasa récents qui n'exposent que le
> protocole chiffré KLAP ne sont pas pris en charge.

## Comment fonctionne la découverte

Les appareils Kasa ne répondent qu'à une **sonde de découverte active**, et
l'intégration s'exécute dans un conteneur isolé qui ne peut pas diffuser sur
votre réseau. Le scan est donc **médié par Gladys** : l'intégration forge la
requête de découverte Kasa chiffrée, le cœur de Gladys (qui, lui, est sur votre
réseau domestique) la diffuse en broadcast et relaie les réponses des appareils.
Vous ne saisissez aucune adresse IP — le scan trouve vos appareils, et l'adresse
IP depuis laquelle chacun a répondu est mémorisée pour le piloter ensuite.

Attribuez à vos appareils Kasa une **réservation DHCP** sur votre routeur afin
que leur adresse IP reste stable ; si elle change, un nouveau scan récupère
automatiquement la nouvelle adresse.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Choisissez un **Intervalle de rafraîchissement** — la fréquence
   d'interrogation de chaque appareil pour rafraîchir son état (par défaut :
   toutes les minutes). Enregistrez.
3. Ouvrez l'onglet **Découverte** et cliquez sur **scanner** : vos appareils
   Kasa apparaissent.
4. Cliquez sur **créer** pour ceux que vous souhaitez ajouter. Ils apparaissent
   dans l'onglet **Appareils** avec une commande Marche/Arrêt.

Relancez un scan à tout moment lorsque vous ajoutez un nouvel appareil.

## Dépannage

- **Un appareil n'apparaît pas au scan.** Vérifiez qu'il est allumé et sur le
  même réseau/sous-réseau que votre hôte Gladys, puis relancez un scan. Seuls les
  appareils Kasa au protocole classique répondent (voir ci-dessous).
- **Un appareil apparaît mais ne change jamais d'état.** Son firmware ne parle
  peut-être que le protocole KLAP récent, non pris en charge.
- **Besoin de plus de détails ?** L'intégration journalise tout ce qu'elle fait.
  Consultez les logs de l'intégration depuis l'interface Gladys (ou `docker logs`
  sur l'hôte) avec `LOG_LEVEL=debug` pour le détail complet.
