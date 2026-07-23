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

## Pourquoi vous devez saisir des adresses IP

L'intégration s'exécute dans un **conteneur isolé**. Depuis celui-ci, elle peut
joindre un appareil par **unicast** (une adresse IP connue), mais elle ne peut
pas recevoir les réponses par diffusion UDP sur lesquelles repose la découverte
automatique Kasa. Le seul chemin de découverte est donc la **liste d'adresses IP
configurée**.

Attribuez à vos appareils Kasa une **réservation DHCP** sur votre routeur afin
que leur adresse IP reste stable.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Dans **Adresses IP des appareils**, saisissez les IP de vos appareils,
   séparées par des virgules ou des espaces (par exemple
   `192.168.1.20, 192.168.1.21`).
3. Choisissez un **Intervalle de rafraîchissement** — la fréquence
   d'interrogation de chaque appareil pour rafraîchir son état (par défaut :
   toutes les minutes).
4. Enregistrez.
5. Ouvrez l'onglet **Découverte** et cliquez sur **scanner** : chaque IP
   configurée est sondée et les appareils joignables apparaissent.
6. Cliquez sur **créer** pour ceux que vous souhaitez ajouter. Ils apparaissent
   dans l'onglet **Appareils** avec une commande Marche/Arrêt.

## Actions

- **Tester un appareil par IP** — saisissez une adresse IP et l'intégration
  effectue un sondage unicast en direct, confirmant que l'appareil est joignable
  depuis le conteneur avant d'ajouter son IP à la configuration.

## Dépannage

- **Un appareil n'apparaît pas au scan.** Vérifiez son IP avec l'action **Tester
  un appareil par IP**. Si le test échoue, le conteneur ne peut pas joindre cette
  IP — vérifiez l'adresse, la réservation DHCP et que l'appareil est sur le même
  réseau.
- **Un appareil apparaît mais ne change jamais d'état.** Son firmware ne parle
  peut-être que le protocole KLAP récent, non pris en charge.
- **Besoin de plus de détails ?** L'intégration journalise tout ce qu'elle fait.
  Consultez les logs de l'intégration depuis l'interface Gladys (ou `docker logs`
  sur l'hôte) avec `LOG_LEVEL=debug` pour le détail complet.
