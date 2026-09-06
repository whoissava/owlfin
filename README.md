# Owlfin

Tre personalizzazioni indipendenti per il client web Jellyfin, ognuna
attivabile/disattivabile separatamente dalla pagina di configurazione:

- **Barra dei generi** (`categories.js`) -- barra orizzontale filtrabile al
  tocco, con griglia poster dei film per genere, ordinati per data di uscita.
- **Righe per studio/piattaforma** (`studio.js`) -- righe espandibili per
  Apple TV+, Prime Video, Hulu, Netflix, HBO Max, Disney+, Pixar e Adult Swim.
- **Prossimo episodio** (`nextepisode.js` + Sonarr) -- su una pagina di
  dettaglio serie/stagione, mostra "Prossimo episodio il ..." leggendo la
  data dalla tua istanza Sonarr.

Nessuno script è stato riscritto -- sono i tuoi originali (o, per Sonarr,
scritto seguendo l'architettura che avevi già scelto: la tua istanza Sonarr
come fonte, niente API key esposta lato client).

Si è chiamato prima `CategoriesBrowser`, poi `OwlPlugin`; da questa versione
(1.3.0.0) è `Owlfin` ovunque -- namespace, assembly, nome plugin, endpoint
API, marcatori degli script. Nessun cambio funzionale, solo il nome.

## Migrazione dalla vecchia installazione manuale

**Se hai già installato una versione precedente a mano** (cartella
`/var/lib/jellyfin/plugins/CategoriesBrowser/`), rimuovila prima di
installare questa -- stesso GUID, ma cartella e nome file diversi, quindi
Jellyfin le tratterebbe come due plugin distinti se restano entrambe:

```bash
sudo systemctl stop jellyfin
sudo rm -rf /var/lib/jellyfin/plugins/CategoriesBrowser
sudo systemctl start jellyfin
```

Poi installa Owlfin con uno dei due metodi sotto.

## Come funziona "Prossimo episodio"

A differenza delle prime due funzioni (puro JS lato client), questa ha
anche un pezzo server-side, perché la chiave API di Sonarr non deve mai
finire nel browser:

1. Configuri URL e API key di Sonarr nella pagina di configurazione del
   plugin (salvate lato server, nel config di Jellyfin).
2. `nextepisode.js`, quando sei su una pagina serie/stagione, prende il
   TVDB id dell'item (via API di Jellyfin) e chiama
   `GET /Owlfin/Sonarr/NextEpisode/{tvdbId}` -- un endpoint del plugin
   stesso, autenticato con la tua sessione Jellyfin.
3. `Api/SonarrController.cs` (server-side) interroga `/api/v3/series` sulla
   tua Sonarr con l'API key, cerca la serie per TVDB id (o per titolo se
   manca), e restituisce solo la data del prossimo episodio -- mai la
   chiave, mai altri dati.
4. La lista serie di Sonarr viene cachata 10 minuti in memoria, per non
   martellare Sonarr ad ogni apertura di pagina.

**Nota sui selettori CSS**: `nextepisode.js` cerca `.itemMiscInfo`,
`.nameContainer`, `.detailPagePrimaryContainer` o `.detailPageWrapper` come
punto di aggancio (in quest'ordine). Se col tuo tema (es. ElegantFin
personalizzato) il testo non compare dove vuoi, il posto giusto da
modificare è la funzione `getAnchor()` in cima a `Web/nextepisode.js`.

## Requisiti

- .NET SDK 9.0
- Plugin **File Transformation** installato e caricato
- Jellyfin 10.11.x (`targetAbi: 10.11.0.0`)
- Per "Prossimo episodio": un'istanza Sonarr raggiungibile dal server
  Jellyfin, con la relativa API key (Sonarr -> Impostazioni -> Generale)

## Installazione classica (manuale)

```bash
dotnet publish Jellyfin.Plugin.Owlfin.csproj -c Release -o bin/publish

sudo mkdir -p /var/lib/jellyfin/plugins/Owlfin
sudo cp bin/publish/Jellyfin.Plugin.Owlfin.dll meta.json /var/lib/jellyfin/plugins/Owlfin/
sudo chown -R jellyfin:jellyfin /var/lib/jellyfin/plugins/Owlfin
sudo systemctl restart jellyfin
```

## Installazione da catalogo (repository Gitea)

Questo è il modo per farlo comparire in Dashboard -> Plugins come un plugin
"vero", con versione e aggiornamenti tracciati, installandolo da un link
manifest invece di copiare file a mano.

### 1. Pubblica il codice su Gitea

```bash
cd Owlfin
git init
git add .
git commit -m "Owlfin 1.3.0.0"
git branch -M main
git remote add origin http://<GITEA_URL>/<utente>/owlfin.git
git push -u origin main
```

(`<GITEA_URL>` e `<utente>` sono i tuoi -- crea prima il repository vuoto
"owlfin" dall'interfaccia web di Gitea, senza README/licenza, altrimenti
il primo push viene rifiutato per storie divergenti.)

### 2. Genera il pacchetto + manifest con jprm

```bash
pip install jprm --break-system-packages   # se non l'hai già
./build.sh --repo http://<GITEA_URL>/<utente>/owlfin/raw/branch/main/repo
```

Questo compila il plugin, crea `repo/manifest.json` e
`repo/owlfin/owlfin_1.3.0.0.zip`. L'URL passato a `--repo` è dove *finirà*
per essere raggiungibile una volta pushato -- Gitea serve i file di un repo
via `raw/branch/<branch>/<path>`, esattamente come GitHub.

### 3. Committa e pusha anche il pacchetto generato

```bash
git add repo/
git commit -m "Pacchetto 1.3.0.0"
git push
```

### 4. Aggiungi il repository in Jellyfin

Dashboard -> Plugins -> Repositories -> **+** -> incolla:

```
http://<GITEA_URL>/<utente>/owlfin/raw/branch/main/repo/manifest.json
```

Poi Catalog -> General -> **Owlfin** -> Install -> riavvia Jellyfin.

### Aggiornamenti futuri

Ogni volta che cambi qualcosa: bump della versione in `build.yaml` (e
`meta.json`, `.csproj`), poi ripeti i passi 2 e 3. Jellyfin vedrà la nuova
versione nel manifest e offrirà l'update dalla Dashboard, senza bisogno di
ricopiare nulla a mano.

## Verifica

```bash
journalctl -u jellyfin -b --no-pager | grep -i owlfin
curl -s http://localhost:8096/web/index.html | grep -o 'plugin="Owlfin-[A-Za-z]*"'
```
La seconda riga deve elencare uno script per ogni funzione abilitata
(`Owlfin-Categories`, `Owlfin-Studio`, `Owlfin-Sonarr`).

Per "Prossimo episodio" specificamente, apri una pagina serie/stagione nel
browser, poi controlla la console sviluppatore (F12 -> Network o Console)
per la chiamata a `/Owlfin/Sonarr/NextEpisode/...` e la sua risposta.

## Config page

Dashboard -> Plugins -> Owlfin: tre checkbox indipendenti (una per
funzione) più URL e API key di Sonarr. Riavvia Jellyfin dopo aver cambiato
qualsiasi opzione.

## Struttura del progetto

```
Plugin.cs                            classe principale (Guid, Name, config page)
Configuration/PluginConfiguration.cs toggle + URL/API key Sonarr
Configuration/configPage.html         pagina di configurazione (italiano)
Services/StartupTask.cs              registra la patch presso File Transformation
Helpers/TransformationPatches.cs     il callback: inserisce gli script abilitati
Model/PatchRequestPayload.cs         forma del payload di File Transformation
Api/SonarrController.cs              proxy server-side verso Sonarr (chiave mai al client)
Web/categories.js                    script barra generi, originale
Web/studio.js                        script righe studio, originale
Web/nextepisode.js                   script prossimo episodio
meta.json / build.yaml               metadati plugin (install manuale / jprm)
build.sh                             jprm build, --install o --repo <url>
```
