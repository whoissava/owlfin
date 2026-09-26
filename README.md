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
| **Top 10 tendenze** | Banner in cima alla Home con i 10 titoli più popolari del momento, con badge "In libreria" e link diretto ai titoli presenti sul server (richiede API key TMDB) |
| **Di Tendenza Ora** | Sezione orizzontale in Home con card backdrop dei titoli TMDB presenti in libreria. Tocco normale apre il dettaglio Jellyfin, long press avvia il trailer italiano su YouTube direttamente nella card (richiede API key TMDB) |

---

## Requisiti

- Jellyfin 10.11.x o 12.0.x
- Plugin [File Transformation](https://github.com/nicknick85/jellyfin-plugin-file-transformation) installato e attivo
- *(opzionale)* Istanza Sonarr raggiungibile dal server, per la funzione "Prossimo episodio"
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
- Inserisci la API key TMDB per le funzioni "Top 10 tendenze" e "Di Tendenza Ora"

> Riavvia Jellyfin dopo aver modificato qualsiasi impostazione.

---

## Aggiornamenti

Le nuove versioni compaiono automaticamente in `Dashboard → Plugin` non appena vengono pubblicate — nessuna azione manuale richiesta.

---

## Crediti

Due delle funzionalità di questo plugin sono basate sul lavoro disponibile su [github.com/Snook-sudo](https://github.com/Snook-sudo).
