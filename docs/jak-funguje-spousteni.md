# Jak StartSite spouští projekty

Tenhle dokument popisuje, co se stane od kliknutí na **Spustit** po zelený stav **Běží**, pro každý typ projektu zvlášť. Na konci najdeš slabá místa a návrhy, co vylepšit.

Kód, o kterém je řeč, leží hlavně v těchto souborech:

| Soubor | Co dělá |
| --- | --- |
| `server/src/detect.ts` | pozná typ projektu podle souborů ve složce |
| `server/src/process-manager.ts` | spouští, hlídá a zastavuje procesy a kontejnery |
| `server/src/ports.ts` | zjišťuje, kdo drží port, hledá volný, zkouší spojení |
| `server/src/static-server.ts` | vestavěný server pro statické weby |
| `server/src/index.ts` | HTTP API, validace projektu při uložení |
| `desktop/.../Services/Backend.cs` | desktopová aplikace: spuštění backendu, API, živé události |

## Celkový obraz

Všechno řídí jeden Node.js proces, backend na `127.0.0.1:4500`. Desktopová aplikace, CLI i MCP server pro Claude jen volají jeho HTTP API. Proto všechny vidí stejný stav.

```
desktop / CLI / Claude (MCP)
              │  HTTP + SSE
              ▼
        backend (Node, Fastify)
              │  spawn / docker CLI
              ▼
   tvoje projekty (npm, dotnet, docker, …)
```

Desktopová aplikace backend spustí, když neběží, a znovu ho nahodí, když spadne. MCP server dělá totéž. Vypnutím aplikace projekty nevypneš, běží dál pod backendem.

## Co se stane po kliknutí na Spustit

Pořadí je pro všechny typy stejné. Liší se jen krok 6.

1. **Zámek.** Backend řadí operace nad jedním projektem za sebe, takže dvojklik na Spustit nebo souběžný start z Claude nespustí projekt dvakrát.
2. **Kontrola složky a nastavení.** Chybí složka, port kontejneru nebo příkaz? Projekt dostane stav Chyba s popisem.
3. **Závislosti.** Projekty ze seznamu „Před spuštěním zapnout“ (`dependsOn`) se spustí jako první. Backend počká, až poběží. Když některý selže, start skončí chybou a popíše, která závislost to byla. Kruhovou závislost (A potřebuje B, B potřebuje A) odmítne.
4. **Převzetí běžícího compose stacku.** Když jsi stack spustil ručně, StartSite ho převezme, místo aby hlásil obsazený port. Totéž kontroluje každých 30 sekund.
5. **Kontrola portu.** Backend přečte `netstat -ano` a zkusí port sám obsadit. Když je obsazený, zjistí přes `tasklist` název procesu a PID, najde nejbližší volný port a vrátí chybu 409 s návrhem. Aplikace pak ukáže tlačítko „Spustit na 5181“.
6. **Spuštění podle typu.** Viz další kapitola.
7. **Hlídání portu.** Každých 500 ms backend zkusí TCP spojení na `127.0.0.1` i `::1` (Vite často poslouchá jen na IPv6). Jakmile se spojí, nastaví stav Běží. Když port neodpoví v limitu, projekt zastaví a nastaví Chyba.
8. **Logy.** stdout a stderr jdou do kruhového bufferu (2000 řádků) a živě přes SSE do aplikace. Řádky s „error“, „failed“ a podobnými slovy dostanou příznak chyby.

## Typy projektů

### npm (package.json se skripty)

**Detekce:** `package.json` s aspoň jedním skriptem. Výchozí skript je první z `dev`, `start`, `serve`, `preview`. Správce balíčků určí lockfile: `pnpm-lock.yaml` znamená pnpm, `yarn.lock` yarn, jinak npm. Framework se pozná z `dependencies` a `devDependencies`.

**Příprava:** když chybí `node_modules` a projekt nemá vypnuté „Doinstalovat chybějící závislosti“, backend spustí `npm ci` (s `package-lock.json`) nebo `pnpm install` / `yarn install`. Výstup jde do logu. Limit pro port se počítá až po instalaci.

**Start:** v shellu ve složce projektu, například:

```
npm run dev -- --port 5180 --strictPort     (Vite, Astro, SvelteKit)
npm run dev -- -p 5180                      (Next.js)
npm run start                               (ostatní, jen proměnná PORT)
```

Proměnná `PORT` je nastavená vždy. Backend odstraní `NO_COLOR` a nastaví `FORCE_COLOR=1`, aby logy měly barvy.

**Limit:** 3 minuty na odpověď portu.

### .NET (ASP.NET)

**Detekce:** `.csproj` se `Sdk="Microsoft.NET.Sdk.Web"` (nebo Razor, Blazor) přímo ve složce, nebo o úroveň níž vedle `.sln` / `.slnx`.

**Start:**

```
dotnet run --project "Web/Web.csproj" --urls http://localhost:5080
```

`dotnet run` si sám udělá restore a build. Prostředí nastavíš proměnnou `ASPNETCORE_ENVIRONMENT` v nastavení projektu.

**Limit:** 5 minut, protože první build trvá.

### Statický web

**Detekce:** `index.html` ve složce a žádný `package.json` se skripty, compose ani Dockerfile.

**Start:** vestavěný server StartSite (`server/dist/static-server.js`), spuštěný stejným Node jako backend. Python ani nic dalšího nepotřebuješ. Server umí:

- `/kontakt` najde `kontakt.html`,
- rozsahy (`Range`), aby šla přehrávat videa,
- odmítne cestu mimo složku projektu (`/../`).

**Limit:** 1 minuta.

### Docker Compose

**Detekce:** `compose.yaml`, `compose.yml`, `docker-compose.yml` nebo `docker-compose.yaml`. Služba s webem je první, která má `ports`. Port v kontejneru se čte z jejího mapování.

**Start:** backend vygeneruje `data/compose/<id>.override.yml`, který přepíše porty vybrané služby na `<port>:<containerPort>` (`ports: !override`, potřebuje Compose 2.24+). Pak spustí:

```
docker compose -f docker-compose.yml -f data/compose/<id>.override.yml up -d --remove-orphans
docker compose ... logs -f --tail 50
```

Bez `-p`, takže compose použije `name:` ze souboru, `COMPOSE_PROJECT_NAME` z `.env` nebo název složky. StartSite tak sahá na stejné kontejnery a svazky (databáze) jako ty, když spouštíš compose ručně.

**Stop:** `docker compose down --remove-orphans`. Svazky zůstanou.

**Limit:** 5 minut (build image).

### Dockerfile bez compose

**Detekce:** `Dockerfile` bez compose souboru. Port v kontejneru z `EXPOSE`.

**Start:**

```
docker build -t startsite-<id> .
docker run -d --rm --name startsite-<id> -p 5191:80 -e PORT=80 startsite-<id>
docker logs -f --tail 50 startsite-<id>
```

**Stop:** `docker stop`, kontejner se díky `--rm` sám smaže.

### Vlastní příkaz (Python, PHP, cokoli)

**Detekce navrhne příkaz:**

| Ve složce | Navržený příkaz |
| --- | --- |
| `manage.py` | `python manage.py runserver 127.0.0.1:{port}` |
| `main.py` / `app.py` + FastAPI | `python -m uvicorn main:app --host 127.0.0.1 --port {port} --reload` |
| `main.py` / `app.py` + Flask | `python -m flask --app main run --port {port}` |
| `index.php` | `php -S 127.0.0.1:{port}` |

`{port}` se nahradí portem. Příkaz běží v shellu (`cmd` na Windows) ve složce projektu.

## Zastavení

| Typ | Co backend udělá |
| --- | --- |
| proces (npm, dotnet, static, vlastní) | `taskkill /PID <pid> /T /F` na celý strom procesů, pak ukončí i to, co na portu případně zůstalo |
| compose | `docker compose down --remove-orphans` |
| Dockerfile | `docker stop` |

Druhý krok u procesů řeší osiřelé `node.exe`. Když `cmd.exe` umře dřív než jeho potomci, `taskkill /T` je nenajde. Port byl před startem volný, takže to, co na něm po stopu poslouchá, patří projektu.

## Restart StartSite a osiřelé procesy

Backend si do `data/runtime.json` ukládá PID, port a kontejner každého běžícího projektu. Po startu je projde:

- proces žije a jmenuje se jako shell nebo runtime (`cmd`, `node`, `dotnet`, `python`, `php`…): převezme ho jako běžící,
- proces nežije, ale port drží takový proces: převezme ho,
- kontejner nebo compose stack běží: převezme ho a připojí logy,
- nic z toho: záznam smaže.

Převzatý proces jde zastavit, jen jeho starší výstup chybí.

## Slabá místa a návrhy na vylepšení

Seřazené od toho, co tě pravděpodobně potrápí nejdřív.

1. **Python bez virtuálního prostředí.** Příkaz běží se systémovým `python`. Když projekt používá `.venv`, závislosti nenajde. *Návrh:* při detekci najít `.venv\Scripts\python.exe` a použít ho, chybějící `.venv` založit a nainstalovat `requirements.txt`.
2. **Databáze mimo Docker.** Eliška Dumková potřebuje PostgreSQL. Když neběží, `dotnet run` spadne a StartSite jen ukáže chybu z logu. *Návrh:* typ „služba“ pro databázi (např. `postgres` v Dockeru) a použít ho jako závislost.
3. **Zdraví jen přes TCP.** Port může přijímat spojení dřív, než aplikace opravdu odpovídá (Next.js kompiluje první stránku). *Návrh:* volitelná cesta pro HTTP kontrolu, třeba `/health`, a stav Běží až po odpovědi 2xx/3xx.
4. **Instalace jen pro npm.** `dotnet restore` se děje sám, ale `composer install`, `pip install` ani `docker compose pull` se nespouští. *Návrh:* obecný krok „příprava“ s příkazem, který jde nastavit, a detekce pro další ekosystémy.
5. **Proměnné prostředí z `.env` u procesů.** Compose čte `.env` sám, npm a dotnet záleží na projektu. *Návrh:* volba „načíst .env“, která proměnné předá procesu.
6. **Monorepa.** Složka s `pnpm-workspace.yaml` nebo `turbo.json` má víc aplikací, StartSite spustí jen kořenový skript. *Návrh:* detekovat workspace a nabídnout přidání každé aplikace zvlášť.
7. **Port, který si projekt vybere sám.** Některé nástroje ignorují `--port` i `PORT` a poslouchají jinde. StartSite pak čeká na špatný port a po limitu projekt zastaví. *Návrh:* sledovat, na jakém portu nový proces začal poslouchat (netstat podle PID), a nabídnout jeho použití.
8. **Limity jsou pevné.** 3 minuty pro npm, 5 pro Docker a .NET. *Návrh:* limit jako nastavení projektu.
9. **Restart při změně souborů.** Dev servery to mají samy, ale `dotnet run` ne. *Návrh:* u .NET nabídnout `dotnet watch run`.

## Kde zasáhnout v kódu

| Chceš | Uprav |
| --- | --- |
| nový typ projektu | `ProjectKind` v `shared/src/index.ts`, detekci v `detect.ts`, `resolvedCommand` a `START_TIMEOUT_MS` v `process-manager.ts`, validaci v `index.ts` |
| krok před startem | `prepareAndSpawn` v `process-manager.ts` |
| jak se předává port | `npmPortArgs` a `resolvedCommand` v `process-manager.ts` |
| jak se pozná, že projekt běží | `healthCheck` v `process-manager.ts`, `isPortResponding` v `ports.ts` |
| zastavení | `doStop` a `killPortOwner` v `process-manager.ts` |
