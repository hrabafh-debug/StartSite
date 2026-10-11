# StartSite

**Start, stop and monitor all your local web projects from one window, and let Claude do it for you.**

StartSite is a launcher for local development projects. Point it at a folder and it works out how to run it: an npm script, a Docker Compose stack, a Dockerfile or any shell command. You choose the port, press Start, and get a working `http://localhost:<port>` link with live logs. When you press Stop, the whole process tree goes away and the port is free again.

The same projects are available to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) through a built-in MCP server and to your terminal through the `startsite` CLI. Everyone sees the same state.

![StartSite desktop app](docs/desktop.png)

## Features

- **One click to run anything.** npm projects, Docker Compose stacks, plain Dockerfiles and custom commands.
- **Automatic detection.** Reads `package.json`, `docker-compose.yml` / `compose.yaml` and `Dockerfile`, picks the right script, framework and container port.
- **Port management.** Set a port yourself or let StartSite find a free one. Before starting, it checks the port and tells you exactly which process (name and PID) is holding it, with a free alternative one click away.
- **Real health checks.** A project is shown as running only when its port actually accepts connections, not just when the process has spawned.
- **Clean shutdown.** Stops the entire process tree on Windows, so no orphaned `node` processes keep your ports busy. Docker projects are stopped with `docker compose down` or `docker stop`.
- **Live logs.** stdout and stderr streamed in real time with ANSI colors and highlighted errors.
- **Survives restarts.** Projects keep running when you close StartSite and are picked up again on the next launch. Compose stacks you started by hand are detected and adopted.
- **Built for Claude.** An MCP server lets Claude list, add, start, stop and restart projects, read their logs and get their URLs.
- **Native desktop app** for Windows, plus a web UI and a CLI.

## Requirements

| Component | Needed for |
| --- | --- |
| [Node.js](https://nodejs.org) 20 or newer | everything |
| Windows 10/11 | the desktop app (the backend, MCP server, CLI and web UI also run on macOS and Linux) |
| [.NET 10 SDK](https://dotnet.microsoft.com) with the MAUI workload | building the desktop app |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Compose 2.24+ | Docker projects only |

## Quick start

```bash
git clone https://github.com/hrabafh-debug/StartSite.git
```

```bash
cd StartSite
```

```bash
npm install
```

```bash
npm run build
```

Then pick how you want to use it.

### Desktop app (Windows)

Install the MAUI workload once:

```bash
dotnet workload install maui-windows
```

Build the app and create shortcuts on the desktop and in the Start menu:

```bash
npm run build:desktop
```

```bash
npm run shortcut
```

Launch **StartSite** from the desktop. The app starts the backend for you.

### Web UI

```bash
npm start
```

Open http://localhost:4500.

## Using StartSite

### Adding a project

Click **Nový projekt** (New project) or press `N`, then paste a folder path or pick one with the folder dialog. StartSite detects the project type and fills in the name, script, framework and a free port. You can add environment variables before saving.

| Folder contains | Type | How it starts | How it stops |
| --- | --- | --- | --- |
| `package.json` | npm | `npm run <script>` (defaults to `dev`) | kills the whole process tree |
| `compose.yaml` / `docker-compose.yml` | compose | `docker compose up -d` | `docker compose down` |
| `Dockerfile` without compose | docker | `docker build` + `docker run -p` | `docker stop` |
| anything else | custom | your shell command; `{port}` is replaced with the port | kills the whole process tree |

Removing a project only removes it from StartSite. Your files are never touched.

### Ports

StartSite always sets the `PORT` environment variable, and passes the port the way each framework expects:

| Framework | Arguments |
| --- | --- |
| Vite, Astro, SvelteKit | `-- --port <port> --strictPort` |
| Next.js | `-- -p <port>` |
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

Register the MCP server with Claude Code:

```bash
claude mcp add startsite -- node <path-to-StartSite>/mcp/index.js
```

Verify it:

```bash
claude mcp get startsite
```

Now you can ask Claude things like *"start my blog and give me the link"* or *"why does the shop project fail to start? check the logs"*.

| Tool | Description |
| --- | --- |
| `list_projects` | all projects with status, port and URL |
| `get_project` | details of one project, including environment variables |
| `add_project` | add a folder; type and script are detected, a free port is chosen if none is given |
| `update_project` | change name, port, command, environment variables and more |
| `remove_project` | remove a project from StartSite (files stay on disk) |
| `start_project` | start and wait until the port responds; on a port conflict, returns the owner and a free port |
| `stop_project` | stop the project and free its port |
| `restart_project` | stop and start again |
| `get_logs` | the last N lines of output (default 100), without ANSI codes |
| `find_free_port` | a port not used by the system or by another project |

Projects can be referenced by name or ID, case-insensitively. If the backend is not running, the MCP server starts it.

## Command-line interface

Run it from the repository with `npx`:

```bash
npx startsite list
```

Or install the command globally:

```bash
npm link
```

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

`start` and `restart` exit with a non-zero code if the project does not come up, so they work in scripts.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `STARTSITE_PORT` | `4500` | port of the backend (used by the backend, desktop app, MCP server and CLI) |
| `STARTSITE_DATA` | `<repo>/data` | where projects, runtime state and logs are stored |
| `STARTSITE_ROOT` | location of the app | repository path for the desktop app, if the `.exe` is moved elsewhere |
| `STARTSITE_LOG` | `warn` | backend log level (`info`, `debug`, ...) |

The backend can also be started on another port with `npm start -- --port 4700`.

## How it works

StartSite is a small Node.js backend (Fastify) that owns all processes. The desktop app, the web UI, the CLI and the MCP server are thin clients of its HTTP API, which is why they always agree on what is running.

- **Health checks.** After starting, StartSite probes the port on `127.0.0.1` and `::1` until it accepts a TCP connection. Projects that do not respond within 3 minutes (5 for Docker) are stopped and marked as failed.
- **Process cleanup.** Stopping kills the whole process tree (`taskkill /T /F` on Windows, process groups elsewhere). Anything still listening on the project's port afterwards is stopped too, because the port was verified as free before the start.
- **Restarts.** PIDs, ports and containers of running projects are stored in `data/runtime.json`. On startup, StartSite checks them against reality, adopts what is still running and drops stale entries.
- **Docker Compose.** Stacks run under their default project name, so StartSite uses the same containers and volumes as running `docker compose` yourself. Ports are overridden with a generated file in `data/compose/`; your compose files are never modified.
- **Storage.** Projects are stored in `data/projects.json` with atomic writes. A JSON file was chosen over SQLite because the data set is small, it is easy to back up and edit, and it avoids native modules that need build tools on Windows.
- **Logs.** The last 2000 lines per project are kept in memory and streamed to clients over Server-Sent Events.

<details>
<summary><strong>HTTP API reference</strong></summary>

All endpoints are served at `http://127.0.0.1:4500`. `:ref` is a project ID or name.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | health check |
| GET | `/api/projects` | list projects |
| POST | `/api/projects` | add `{ path, name?, kind?, script?, command?, port?, containerPort?, service?, env? }` |
| GET | `/api/projects/:ref` | project details |
| PATCH | `/api/projects/:ref` | update a project |
| DELETE | `/api/projects/:ref` | remove a project |
| POST | `/api/projects/:ref/start` | start, body `{ port?, wait? }`; a taken port returns `409` with `owner` and `suggestedPort` |
| POST | `/api/projects/:ref/stop` | stop |
| POST | `/api/projects/:ref/restart` | restart |
| GET | `/api/projects/:ref/logs?limit=100&plain=1` | read logs |
| DELETE | `/api/projects/:ref/logs` | clear logs |
| POST | `/api/detect` | detect a folder, body `{ path }` |
| GET | `/api/ports/free?start=5100` | find a free port |
| GET | `/api/ports/:port` | who is using a port |
| GET | `/api/events` | Server-Sent Events stream of project states and log lines |

</details>

## Security

StartSite runs commands on your machine, so it is locked down to local use:

- The backend listens on `127.0.0.1` only.
- Requests with a `Host` or `Origin` other than localhost are rejected, so a website open in your browser cannot use the API (including through DNS rebinding).
- There is no authentication. Do not expose the port to a network.

## Troubleshooting

**The port is in use.** StartSite shows which process holds it. Stop that process or click the suggested free port.

**The backend does not start.** Check `data/server.log`. Make sure `npm run build` has been run and that nothing else uses port 4500 (or set `STARTSITE_PORT`).

**The desktop app closes right after launch.** See `%LOCALAPPDATA%\StartSite\crash.log`.

**Docker projects fail with "Docker neběží".** Start Docker Desktop. Port overrides need Docker Compose 2.24 or newer.

**A Vite or Next.js project starts on a different port.** Check that the framework was detected correctly in the project settings; the "Jiný" (other) option only sets the `PORT` variable.

## Development

```bash
npm run dev
```

Runs the backend with `tsx watch` and the web UI with Vite on port 4501 (proxying `/api` to the backend).

```bash
npm run typecheck
```

```
shared/    shared types and HTTP client
server/    Fastify backend: processes, ports, logs, API
mcp/       MCP server (stdio), entry point mcp/index.js
cli/       the startsite command
web/       web UI (Vite, React, Tailwind)
desktop/   desktop app (.NET MAUI)
scripts/   desktop and Start menu shortcuts
examples/  sample projects: a Vite app, an nginx compose stack and a Dockerfile
```

The sample projects are a quick way to try StartSite: `examples/vite-app` needs `npm install` once, the other two need Docker.

## Status

StartSite is a personal tool under active development. The interface is in Czech, and the desktop app is Windows only.
