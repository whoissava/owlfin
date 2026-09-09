# Owlfin

Tre personalizzazioni indipendenti per la home e le pagine dettaglio del
client web Jellyfin, ognuna attivabile/disattivabile separatamente:

- **Barra dei generi** — barra orizzontale filtrabile, con griglia poster
  dei film per genere, ordinati per data di uscita.
- **Righe per studio/piattaforma** — righe espandibili per diversi studi
- **Prossimo episodio** — su una pagina di dettaglio serie/stagione,
  mostra "Prossimo episodio il ..." leggendo la data dalla tua istanza
  Sonarr (chiave API mai esposta al browser).

## Requisiti

- Jellyfin 10.11.x
- Plugin File Transformation installato e caricato
- Per "prossimo episodio": un'istanza Sonarr raggiungibile dal server
  Jellyfin, con relativa API key (Sonarr → Impostazioni → Generale)

## Installazione

Dashboard → Plugins → Repositories → + → incolla:

**Jellyfin 12.0.x**

Dashboard → Plugins → Repositories → + → incolla:

https://raw.githubusercontent.com/whoissava/owlfin/main/12.0/manifest.json

**Jellyfin 11.0.x**

https://raw.githubusercontent.com/whoissava/owlfin/main/10.11/manifest.json

Poi Catalog → General → Owlfin → Install → riavvia Jellyfin.

## Configurazione

Dashboard → Plugins → Owlfin: tre checkbox indipendenti (una per
funzione) più URL e API key di Sonarr. Riavvia Jellyfin dopo aver
cambiato qualsiasi opzione.

## Aggiornamenti e info

Le nuove versioni compaiono automaticamente in Dashboard → Plugins una
volta pubblicate nel manifest — nessuna azione manuale richiesta.






CREDITI

2 funzioni su 3 provengono dalle repo di  https://github.com/Snook-sudo, senza la sua repo non sarebbe stato possibile integrare queste sue funzioni.
