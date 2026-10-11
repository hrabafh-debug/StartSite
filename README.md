# StartSite

Lokální spouštěč webů a aplikací. Projekt (npm, Docker Compose, Dockerfile nebo vlastní příkaz) přidáš cestou ke složce, nastavíš port a spouštíš ho jedním tlačítkem. Dostaneš odkaz `http://localhost:<port>` a živé logy. Stejné projekty ovládá Claude přes MCP server a ty z terminálu přes CLI `startsite`.

Hlavní rozhraní je desktopová aplikace pro Windows v .NET MAUI. Stejný stav ukazuje i webové rozhraní na http://localhost:4500.

![StartSite](docs/desktop.png)

## Požadavky

- Node 20 nebo novější
- Windows 11 (backend, MCP a CLI fungují i na macOS a Linuxu)
- Pro desktopovou aplikaci .NET 10 SDK s MAUI workloadem: `dotnet workload install maui-windows`
- Docker Desktop, jen pro Docker projekty

## Desktopová aplikace

```bash
npm run build
```

```bash
npm run build:desktop
```

```bash
npm run shortcut
```

`build:desktop` sestaví `desktop/publish/StartSite.exe`, `shortcut` na něj vytvoří zástupce na ploše a v nabídce Start.

- Při spuštění aplikace najde repo (podle umístění `.exe`, nebo proměnné `STARTSITE_ROOT`) a spustí Node backend na pozadí, když neběží. Když backend za běhu spadne, spustí ho znovu.
- Zavření aplikace projekty ani backend nezastaví, takže je Claude přes MCP dál vidí a ovládá.
- Běží jen jedna instance; další spuštění přenese do popředí okno, které už běží.
- Složku projektu jde vybrat systémovým dialogem.
- Motiv se přepíná ikonou v hlavičce (podle systému, světlý, tmavý).
- Pády se zapisují do `%LOCALAPPDATA%\StartSite\crash.log`.

Zdrojáky jsou v `desktop/StartSite.Desktop/`: `Services/Backend.cs` (spouštění backendu, HTTP API, SSE), `ViewModels/ViewModels.cs`, `Views/MainPage.xaml`.

## Instalace

```bash
npm install
```

```bash
npm run build
```

`npm run build` sestaví sdílené typy, backend, MCP server, CLI a frontend. Bez buildu MCP ani CLI nenajdou zkompilované soubory.

## Spuštění

```bash
npm start
```

Otevři http://localhost:4500. Backend poslouchá jen na `127.0.0.1` a servíruje i frontend.

Jiný port nastavíš parametrem `--port` nebo proměnnou `STARTSITE_PORT`:

```bash
npm start -- --port 4700
```

MCP server a CLI čtou port jen z `STARTSITE_PORT`, takže při jiném portu ji nastav i pro ně.

Vývoj s hot reloadem (backend přes `tsx watch`, frontend přes Vite na portu 4501 s proxy na `/api`):

```bash
npm run dev
```

## Registrace MCP pro Claude Code

```bash
claude mcp add startsite -- node C:/Users/hraba/Projekty/StartSite/mcp/index.js
```

Obecně `claude mcp add startsite -- node <cesta-k-repu>/mcp/index.js`. Kontrola:

```bash
claude mcp get startsite
```

Má hlásit `Status: Connected`. Když backend neběží, MCP server ho sám spustí na pozadí (výstup jde do `data/server.log`). UI i Claude tak pracují se stejným stavem.

| Nástroj | Co dělá |
| --- | --- |
| `list_projects` | seznam projektů se stavem, portem a URL |
| `get_project` | detail včetně env proměnných |
| `add_project` | přidá složku, typ a skript pozná sám, bez portu vybere volný |
| `update_project` | změní název, port, příkaz, env... |
| `remove_project` | odebere záznam, soubory na disku nechá |
| `start_project` | spustí a počká, až port odpovídá; při obsazeném portu vrátí, kdo ho drží, a volný port |
| `stop_project` | zastaví celý strom procesů nebo kontejnery |
| `restart_project` | stop a start |
| `get_logs` | posledních N řádků (parametr `lines`, výchozí 100), bez ANSI barev |
| `find_free_port` | volný port, který nepoužívá systém ani jiný projekt |

Každý nástroj vrací stav a URL. Projekt jde zadat názvem i ID, na velikosti písmen nezáleží (`Demo Vite`, `demo-vite`, `DEMO-VITE`).

## CLI

Z repa přes `npx`:

```bash
npx startsite list
```

Globálně (jednou, z kořene repa):

```bash
npm link
```

Příklady:

```bash
startsite list
startsite add C:/projekty/muj-web --port 5180
startsite start "Demo Vite"
startsite start demo-vite --port 5181
startsite logs demo-vite -n 50
startsite logs demo-vite -f
startsite restart demo-vite
startsite stop demo-vite
startsite port 5200
```

`start` a `restart` čekají, až port odpovídá, a když se to nepovede, vrátí nenulový exit kód. Při obsazeném portu vypíšou PID a název procesu a navrhnou volný port.

## Jak to funguje

### Typy projektů

| Ve složce | Typ | Start | Stop |
| --- | --- | --- | --- |
| `package.json` | npm | `npm run <skript>`, výchozí `dev` | `taskkill /T /F` na celý strom |
| `compose.yaml` / `docker-compose.yml` | compose | `docker compose up -d` | `docker compose down` |
| `Dockerfile` bez compose | docker | `docker build` + `docker run -d --rm -p` | `docker stop` |
| cokoli jiného | příkaz | tvůj příkaz v shellu, `{port}` se nahradí | `taskkill /T /F` |

### Předávání portu

- Vždy env `PORT`.
- Vite, Astro, SvelteKit: `npm run dev -- --port <port> --strictPort`.
- Next.js: `npm run dev -- -p <port>`.
- Framework se pozná z `dependencies` a `devDependencies` v `package.json`.
- Compose: StartSite vygeneruje `data/compose/<id>.override.yml`, který přepíše porty vybrané služby na `<port>:<containerPort>` (`ports: !override`, potřebuje Compose 2.24+). Port v kontejneru čte z compose souboru.
- Dockerfile: `-p <port>:<containerPort>`, port v kontejneru čte z `EXPOSE`. Když ho nenajde, formulář si o něj řekne.

### Stavy

`zastaveno`, `startuje`, `běží`, `chyba`. „Běží“ se nastaví až ve chvíli, kdy port přijme TCP spojení. Zkouší `127.0.0.1` i `::1`, protože Vite často poslouchá jen na IPv6. Když port neodpoví do 3 minut (Docker 5 minut), projekt se zastaví a dostane stav chyba.

Před startem StartSite ověří, že port je volný (`netstat -ano` a zkušební bind). Když ne, vrátí PID a název procesu (`tasklist`) a navrhne volný port.

### Úklid procesů

- Stop zabije celý strom procesů (`taskkill /PID <pid> /T /F`). Když na portu i potom něco poslouchá, ukončí i to: port byl před startem volný, takže patří projektu.
- PID, port a jména kontejnerů běžících projektů se ukládají do `data/runtime.json`. Po restartu StartSite z nich ověří skutečný stav: běžící procesy a kontejnery převezme (jdou zastavit), neplatné záznamy smaže.
- Vypnutí StartSite projekty nezastaví.

### Úložiště: JSON, ne SQLite

Projekty jsou v `data/projects.json` a zapisují se atomicky (temp soubor a `rename`, zápisy jdou za sebou). JSON proto, že:

- projektů bude desítky, ne tisíce, a celý seznam se vejde do paměti,
- `better-sqlite3` je nativní modul a na Windows s novým Node často chybí předkompilovaná binárka, takže `npm install` chce Visual Studio Build Tools,
- soubor jde přečíst, ručně upravit a zálohovat.

### Logy

Každý projekt drží posledních 2000 řádků stdout a stderr v paměti. UI je dostává živě přes Server-Sent Events (`/api/events`), ANSI barvy převádí na HTML přes `ansi_up` a řádky s chybou zvýrazní. CLI a MCP dostávají text bez ANSI.

## HTTP API

Vše na `http://127.0.0.1:4500`. `:ref` je ID nebo název.

| Metoda | Cesta | Popis |
| --- | --- | --- |
| GET | `/api/health` | kontrola, že backend běží |
| GET | `/api/projects` | seznam |
| POST | `/api/projects` | přidání `{ path, name?, kind?, script?, command?, port?, containerPort?, service?, env? }` |
| GET | `/api/projects/:ref` | detail |
| PATCH | `/api/projects/:ref` | úprava |
| DELETE | `/api/projects/:ref` | odebrání záznamu |
| POST | `/api/projects/:ref/start` | start, tělo `{ port?, wait? }`; obsazený port vrátí `409` s `owner` a `suggestedPort` |
| POST | `/api/projects/:ref/stop` | stop |
| POST | `/api/projects/:ref/restart` | restart |
| GET | `/api/projects/:ref/logs?limit=100&plain=1` | logy |
| DELETE | `/api/projects/:ref/logs` | smazání logů |
| POST | `/api/detect` | rozpoznání složky `{ path }` |
| GET | `/api/ports/free?start=5100` | volný port |
| GET | `/api/ports/:port` | kdo drží port |
| GET | `/api/events` | SSE stream stavů a logů |

API odmítá požadavky s jiným `Host` nebo `Origin` než localhost, aby cizí web otevřený v prohlížeči nemohl spouštět příkazy.

## Ovládání UI

| Klávesa | Akce |
| --- | --- |
| `/` | hledání |
| `N` | nový projekt |
| `S` | start nebo stop vybraného projektu |
| šipky | výběr projektu |
| `Esc` | zavře formulář nebo vyčistí hledání |

## Struktura

```
shared/   typy a HTTP klient (spustí backend, když neběží)
server/   Fastify backend, správa procesů, porty, logy
mcp/      MCP server (stdio), vstup mcp/index.js
cli/      příkaz startsite
web/      Vite + React + Tailwind
desktop/  desktopová aplikace (.NET MAUI), sestavení v desktop/publish (není v gitu)
scripts/  install-shortcut.ps1 pro zástupce na ploše a v nabídce Start
examples/ vite-app, nginx-compose, dockerfile-app na vyzkoušení
data/     projects.json, runtime.json, server.log (není v gitu)
```

## Ukázky

`examples/vite-app` potřebuje jednou `npm install` ve své složce, Docker ukázky běžící Docker.

```bash
npx startsite add C:/Users/hraba/Projekty/StartSite/examples/vite-app --name "Demo Vite" --port 5180
```

```bash
npx startsite start "Demo Vite"
```
