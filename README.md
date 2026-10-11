# StartSite

**Start, stop and monitor all your local web projects from one window, and let Claude do it for you.**

StartSite is a native Windows app for running local development projects. Point it at a folder and it works out how to run it: an npm script, an ASP.NET app, a static site, a Docker Compose stack, a Dockerfile or any shell command. You choose the port, press Start, and get a working `http://localhost:<port>` link with live logs. When you press Stop, the whole process tree goes away and the port is free again.

The same projects are available to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) through a built-in MCP server and to your terminal through the `startsite` CLI. Everyone sees the same state.

![StartSite](docs/desktop.png)

## Install

1. Download **StartSite-win-Setup.exe** from the [latest release](https://github.com/hrabafh-debug/StartSite/releases/latest).
2. Run it. StartSite installs for your user only (no admin rights) and adds shortcuts to the desktop and the Start menu.
3. Launch StartSite. When a new version is out, the app shows a banner with **Update and restart**.

Everything StartSite needs is bundled, including Node.js. You only need the tools your own projects use: Node.js for npm projects, the .NET SDK for ASP.NET, Docker Desktop for Docker projects.

Windows may show a SmartScreen warning because the installer is not code-signed. Click **More info** and **Run anyway**.

## Features

- **One click to run anything.** npm, pnpm and yarn projects, ASP.NET (`dotnet run`), static HTML sites, Django, FastAPI, Flask, PHP, Docker Compose stacks, Dockerfiles and custom commands.
- **Automatic detection.** Reads `package.json`, lockfiles, `.csproj`, `index.html`, `manage.py`, `requirements.txt`, `docker-compose.yml` and `Dockerfile`, then picks the right command, framework and port.
- **Complete start.** Installs missing `node_modules` before the first run, and starts dependencies first (for example the API before the frontend) and waits until they are up.
- **Port management.** Set a port yourself or let StartSite find a free one. Before starting, it checks the port and tells you exactly which process (name and PID) holds it, with a free alternative one click away.
- **Real health checks.** A project counts as running only when its port accepts connections.
- **Clean shutdown.** Stops the entire process tree, so no orphaned `node` processes keep your ports busy. Docker projects stop with `docker compose down` or `docker stop`.
- **Live logs** with ANSI colors and highlighted errors.
- **Survives restarts.** Projects keep running when you close StartSite and are picked up again on the next launch. Compose stacks you started by hand are detected and adopted.
- **Built for Claude.** The MCP server lets Claude list, add, start, stop and restart projects, read their logs and get their URLs.
- **Czech and English** interface, light and dark theme, resizable project list, keyboard shortcuts.

## Using StartSite

### Adding a project

Click **New project** or press `N`, then paste a folder path or pick one with the folder dialog. StartSite detects the project type and fills in the name, command and a free port. You can add environment variables and choose projects to start first.

| Folder contains | Type | How it starts | How it stops |
| --- | --- | --- | --- |
| `package.json` with scripts | npm | `npm run <script>` (or pnpm / yarn by lockfile), installs missing `node_modules` first | kills the whole process tree |
| web `.csproj` | .NET | `dotnet run --project <csproj> --urls http://localhost:<port>` | kills the whole process tree |
| `index.html` only | static | StartSite's built-in static server | kills the process |
| `manage.py`, FastAPI, Flask, `index.php` | command | a suggested command, editable | kills the whole process tree |
| `compose.yaml` / `docker-compose.yml` | compose | `docker compose up -d` | `docker compose down` |
| `Dockerfile` without compose | docker | `docker build` + `docker run -p` | `docker stop` |
| anything else | command | your shell command; `{port}` is replaced with the port | kills the whole process tree |

Removing a project only removes it from StartSite. Your files are never touched.

### Ports

StartSite always sets the `PORT` environment variable, and passes the port the way each tool expects:

| Tool | How the port is passed |
| --- | --- |
| Vite, Astro, SvelteKit | `-- --port <port> --strictPort` |
| Next.js | `-- -p <port>` |
| ASP.NET | `--urls http://localhost:<port>` |
| Docker Compose | the selected service is mapped to `<port>:<containerPort>` |
| Dockerfile | `-p <port>:<containerPort>` (container port from `EXPOSE`) |

If the port is taken, StartSite shows the process holding it and offers to start on the next free port.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | search projects |
| `N` | new project |
| `S` | start or stop the selected project |
| `↑` `↓` | select a project |
| `Esc` | close the form or clear the search |

## Using StartSite with Claude

When the project list is empty, or when you add a new project, StartSite shows the exact command to register its MCP server, with the right paths for your machine:

```bash
claude mcp add startsite -- "<StartSite>/backend/node/node.exe" "<StartSite>/backend/mcp/index.js"
```

Then ask Claude things like *"import all the projects you work on with me into StartSite"*, *"start my blog and give me the link"* or *"why does the shop fail to start? check the logs"*.

| Tool | Description |
| --- | --- |
| `list_projects` | all projects with status, port and URL |
| `get_project` | details of one project, including environment variables |
| `add_project` | add a folder; type and command are detected, a free port is chosen if none is given |
| `update_project` | change name, port, command, dependencies, environment variables and more |
| `remove_project` | remove a project from StartSite (files stay on disk) |
| `start_project` | start (with dependencies) and wait until the port responds; on a port conflict, returns the owner and a free port |
| `stop_project` | stop the project and free its port |
| `restart_project` | stop and start again |
| `get_logs` | the last N lines of output (default 100), without ANSI codes |
| `find_free_port` | a port not used by the system or by another project |

## Command-line interface

```bash
startsite list                          # all projects with status and URL
startsite add ./my-site --port 5180     # add a project
startsite start "My Site"               # start and wait for the port
startsite start my-site --port 5181     # start on another port
startsite logs my-site -n 50            # last 50 lines
startsite logs my-site -f               # follow logs live
startsite restart my-site
startsite stop my-site
startsite port 5200                     # find a free port from 5200
```

In an installed copy, run it as `"<StartSite>\backend\node\node.exe" "<StartSite>\backend\cli\bin\startsite.js" list`. From the repository, use `npx startsite`.

## How it works

StartSite has two parts. A small Node.js backend (Fastify, on `127.0.0.1:4500`) owns all processes. The desktop app, the MCP server and the CLI talk to its HTTP API, which is why they always agree on what is running. The desktop app starts the backend when it is not running and restarts it if it crashes.

Projects are stored in `%LOCALAPPDATA%\StartSiteData` in an installed copy (`data/` in the repository), so updates never touch them.

For the details of how each project type starts, stops and gets adopted after a restart, read [docs/jak-funguje-spousteni.md](docs/jak-funguje-spousteni.md) (in Czech).

## Security

StartSite runs commands on your machine, so it is locked down to local use:

- The backend listens on `127.0.0.1` only.
- Requests with a `Host` or `Origin` other than localhost are rejected, so a website open in your browser cannot use the API.
- There is no authentication. Do not expose the port to a network.

## Troubleshooting

**The port is in use.** StartSite shows which process holds it. Stop that process or click the suggested free port.

**The app closes right after launch.** See `%LOCALAPPDATA%\StartSiteData\crash.log`.

**The backend does not start.** See `server.log` in the data folder.

**Docker projects fail with "Docker neběží".** Start Docker Desktop. Port overrides need Docker Compose 2.24 or newer.

**A project starts on a different port.** Check the framework in the project settings. "Other" only sets the `PORT` variable.

## Development

Requirements: Node.js 20+, .NET 10 SDK with `dotnet workload install maui-windows`.

```bash
npm install
```

```bash
npm run build
```

```bash
npm run build:desktop
```

```bash
npm run shortcut
```

`build:desktop` builds the app into `desktop/publish`, `shortcut` creates desktop and Start menu shortcuts to it. In development the app finds the backend in the repository and stores data in `data/`.

### Releasing an update

```bash
npm run release -- -Version 0.3.0
```

This builds the TypeScript packages, publishes the desktop app, bundles the backend, MCP server and CLI with esbuild, adds `node.exe`, checks that the bundled backend starts and creates a Velopack installer and update package in `artifacts/releases`. Add `-Upload` with a `GITHUB_TOKEN` that can write to the repository to publish it as a GitHub release. Installed copies pick it up automatically.

```
shared/    shared types and HTTP client
server/    Fastify backend: processes, ports, logs, API, static server
mcp/       MCP server (stdio)
cli/       the startsite command
desktop/   desktop app (.NET MAUI)
scripts/   release and shortcut scripts
examples/  sample projects: a Vite app, an nginx compose stack and a Dockerfile
docs/      documentation
```
