# CodexChat

Local phone browser and chat bridge for Codex projects on this Mac.

## Run

```sh
npm run dev
```

Open the printed `Phone:` URL on your phone while it is on the same Wi-Fi as the Mac.

By default CodexChat browses your home folder. To constrain it to a different startup home:

```sh
CODEXCHAT_HOME=/path/to/home npm run dev
```

## Access From Another Device

### Same Wi-Fi

1. Start the app on the Mac:

   ```sh
   npm run dev
   ```

2. Open the printed `Phone:` URL from your phone or tablet, for example:

   ```text
   http://192.168.1.25:8787
   ```

### Tailscale

Use Tailscale when the phone and Mac are not on the same Wi-Fi.

1. Install and sign in to Tailscale on the Mac and the device you want to use.
2. Start CodexChat on the Mac:

   ```sh
   npm run dev
   ```

3. Find the Mac Tailscale IP:

   ```sh
   tailscale ip -4
   ```

4. Open the app from the other device:

   ```text
   http://<mac-tailscale-ip>:8787
   ```

Example:

```text
http://100.64.12.34:8787
```

Keep this on a private network. CodexChat can browse, upload, download, and edit files under `CODEXCHAT_HOME`, so do not expose it directly to the public internet.

### SSH Tunnel

If SSH is available, tunnel the app instead of exposing the port:

```sh
ssh -L 8787:localhost:8787 user@mac-host
```

Then open:

```text
http://localhost:8787
```

## Setup Evidence

Screenshot captured from the running setup:

![CodexChat setup screenshot](Screenshot_20260515_103031_Brave.jpg)

## Notes

- The app binds to `0.0.0.0` so your phone can reach the Mac over the LAN.
- Your phone cannot use the Mac service through `localhost`; use the printed LAN IP URL.
- The file browser cannot leave the configured `CODEXCHAT_HOME`.
- Text previews under the configured size limit can be edited from the browser.
- Use `Use as project` on any folder to make that folder the Codex working directory.
- Chat state and permission grants are session-only. Restarting the server clears them.
- Switching projects clears the active in-memory chat and starts a fresh Codex session.
- `Always` approves matching Codex permission prompts only for the current Codex session.
