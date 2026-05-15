# CodexChat

CodexChat is a private local web app for controlling Codex from another device on the same network. It lets you pick a folder on this Mac, start a Codex session in that folder, chat with the agent, approve tool requests, browse files, edit small text files, upload attachments, and download files.

This repo is not intended to be public-facing. Treat it as a trusted LAN tool with filesystem access.

## What It Does

- Opens a browser-based project explorer rooted at `CODEXCHAT_HOME`.
- Lets you choose a folder as the active Codex workspace.
- Starts Codex in the selected workspace when you send a message.
- Streams messages, status, and approval prompts back to the browser.
- Supports editable text-file tabs for files under the configured home.
- Uploads explorer files to the visible folder.
- Uploads chat attachments and camera screenshots to the active Codex workspace.

## Requirements

- macOS or another machine that can run the Codex CLI.
- Node.js 20 or newer.
- Codex CLI available on `PATH`.
- Phone/tablet and Mac on the same trusted network, or connected through a private tunnel such as Tailscale.

## Quick Start

From this repo:

```sh
npm run dev
```

The server prints URLs like:

```text
Mac:   http://localhost:8787
Phone: http://192.168.1.25:8787
```

Use `localhost` only on the Mac. From a phone, use the printed `Phone:` URL.

## Run Options

By default, CodexChat can browse your home directory:

```sh
npm run dev
```

To restrict file access to one folder:

```sh
CODEXCHAT_HOME=/Users/you/projects npm run dev
```

To run on a specific port:

```sh
PORT=8794 npm run dev
```

To bind only to the Mac instead of the network:

```sh
HOST=127.0.0.1 npm run dev
```

By default the app binds to `0.0.0.0` so another device on the same private network can connect.

## Phone Setup

1. Start the server on the Mac:

   ```sh
   npm run dev
   ```

2. Keep the terminal running.
3. Open the printed `Phone:` URL from your phone browser.
4. Pick a project folder in the left explorer.
5. Send a message to start Codex in that folder.

If the phone cannot connect:

- Confirm the Mac and phone are on the same Wi-Fi.
- Confirm the server was started with `HOST=0.0.0.0` or without a `HOST` override.
- Confirm macOS firewall allows incoming connections for Node.
- Try the Tailscale URL if both devices are signed in to Tailscale.

## Tailscale Access

Use this when the phone and Mac are not on the same Wi-Fi.

1. Install and sign in to Tailscale on both devices.
2. Start CodexChat:

   ```sh
   npm run dev
   ```

3. Get the Mac Tailscale IP:

   ```sh
   tailscale ip -4
   ```

4. Open:

   ```text
   http://<mac-tailscale-ip>:8787
   ```

## File Behavior

CodexChat separates explorer actions from chat attachment actions:

- Explorer `Upload` writes to the folder currently shown in the file explorer.
- Composer `File` and `Camera` attachments write to the active Codex project folder.
- Text files under `CODEXCHAT_FILE_PREVIEW_LIMIT` can be opened in editable tabs.
- Binary files and files over the preview limit are not editable in the browser.
- Downloads use the active file tab.

Useful limits:

```sh
CODEXCHAT_FILE_PREVIEW_LIMIT=1048576
CODEXCHAT_UPLOAD_LIMIT=52428800
```

## Security Notes

This app has no login screen. Anyone who can reach it on the network can browse, upload, download, edit files under `CODEXCHAT_HOME`, and send work to Codex.

Do not expose CodexChat to the public internet.

Safer operating modes:

- Restrict `CODEXCHAT_HOME` to a project folder.
- Use a trusted private Wi-Fi network.
- Use Tailscale instead of opening router ports.
- Use `HOST=127.0.0.1` when you only need access from the Mac.

## Troubleshooting

Check whether the server is healthy:

```sh
curl http://localhost:8787/api/health
```

If the browser opens but Codex does not respond:

- Confirm `codex` works in a normal terminal.
- Select a project folder before sending a prompt.
- Refresh the page after restarting the server.

If uploads go to the wrong place:

- Use explorer `Upload` for the selected explorer folder.
- Use composer `File` or `Camera` for the active Codex project folder.

If phone access fails:

- Do not use `localhost` on the phone.
- Use the printed `Phone:` URL.
- Make sure the app is listening on `0.0.0.0`.

## Development Checks

Run syntax checks:

```sh
node --check public/app.js
node --check src/server.js
```

Run the app:

```sh
npm run dev
```
