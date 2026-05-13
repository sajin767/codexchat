# CodexChat

Local phone chat bridge for Codex in this folder.

## Run

```sh
npm run dev
```

Open the printed `Phone:` URL on your phone while it is on the same Wi-Fi as the Mac.

## Notes

- The app binds to `0.0.0.0` so your phone can reach the Mac over the LAN.
- Your phone cannot use the Mac service through `localhost`; use the printed LAN IP URL.
- Chat state and permission grants are session-only. Restarting the server clears them.
- `Always` approves matching Codex permission prompts only for the current Codex session.
