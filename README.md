# Owlfin

Personalizzazioni indipendenti per il client web di Jellyfin, ognuna attivabile e disattivabile separatamente dalla pagina di configurazione del plugin.

---

## Funzionalità

| Funzione | Descrizione |
|---|---|
| **Barra dei generi** | Barra orizzontale filtrabile con griglia poster per genere, ordinati per data di uscita |
| **Righe per studio/piattaforma** | Righe espandibili per studio e piattaforma (Netflix, Prime, Apple TV+...) |
| **Prossimo episodio** | Mostra *"Prossimo episodio il ..."* sulle pagine serie/stagione, leggendo la data da Sonarr |
| **Selettore stagioni** | Selettore stagioni con griglia episodi a scorrimento, segno automatico puntate precedenti e pulsante "Segna stagione come vista" |
| **Chat** | Chat generale tra tutti gli utenti del server, accessibile dal menu laterale |
| **Di Tendenza Ora** | Sezione orizzontale in Home con card backdrop dei titoli TMDB presenti in libreria. Tocco normale apre il dettaglio Jellyfin, long press avvia il trailer italiano su YouTube direttamente nella card (richiede API key TMDB) |
| **Griglia poster in ricerca** | Sostituisce i suggerimenti di ricerca con una griglia di locandine casuali dalla libreria |
| **Scopri (JellyTok)** | Feed a schermo intero di trailer. Tab **Libreria**: titoli casuali presenti sul server, a blocchi di 20, con preferiti (doppio tocco) e filtro Film/Serie. Tab **Richiedi**: titoli di tendenza non ancora in libreria, richiedibili con un tocco via Seerr. Voce nel menu laterale |
| **Calendario uscite** | Calendario a vetro con le uscite di film e serie, passate, di oggi e future, in vista **Calendario** (mese + elenco del giorno) o **Agenda** (elenco per giorno). Filtro **Globali** (TMDB, con le date italiane) o **Richieste** (calendari di Radarr e Sonarr) e filtro Film/Serie. Ogni uscita mostra locandina, trama, generi, durata e voto; un tocco apre la scheda con il pulsante per aprire il titolo in Jellyfin se è già in libreria. Voce nel menu laterale |

---

## Requisiti

- Jellyfin 10.11.x o 12.0.x
- Plugin [File Transformation](https://github.com/nicknick85/jellyfin-plugin-file-transformation) installato e attivo
- *(opzionale)* Istanza Sonarr raggiungibile dal server, per la funzione "Prossimo episodio"
- *(opzionale)* Istanza Radarr raggiungibile dal server, per le uscite dei film richiesti nel calendario (le serie usano Sonarr)
- *(opzionale)* Seerr, Jellyseerr o Overseerr raggiungibile dal server, per la tab "Richiedi" di JellyTok
- *(opzionale)* API key TMDB gratuita, per le funzioni "Top 10 tendenze" e "Di Tendenza Ora"

---

## Installazione

Vai su `Dashboard → Plugin → Repository → +` e incolla l'URL corretto per la tua versione:

| Versione Jellyfin | URL Repository |
|---|---|
| 10.11.x | `https://raw.githubusercontent.com/whoissava/owlfin/main/10.11/manifest.json` |
| 12.0.x | `https://raw.githubusercontent.com/whoissava/owlfin/main/12.0/manifest.json` |

Poi `Catalogo → General → Owlfin → Installa` e riavvia Jellyfin.

---

## Configurazione

`Dashboard → Plugin → Owlfin`

- Attiva o disattiva ogni funzione con le relative checkbox
- Inserisci URL e API key di Sonarr per la funzione "Prossimo episodio"
- Inserisci URL e API key di Radarr (e di Sonarr) per le uscite "Richieste" del calendario
- Inserisci la API key TMDB per le funzioni "Top 10 tendenze" e "Di Tendenza Ora"

> Riavvia Jellyfin dopo aver modificato qualsiasi impostazione.

---

## Aggiornamenti

Le nuove versioni compaiono automaticamente in `Dashboard → Plugin` non appena vengono pubblicate — nessuna azione manuale richiesta.

---

## Crediti

Due delle funzionalità di questo plugin sono basate sul lavoro disponibile su [github.com/Snook-sudo](https://github.com/Snook-sudo).
