# Atomic Chat

<p align="center">
  <a href="https://github.com/edarkea/atomic-chat">
    <img src="assets/branding/atomic-chat-logo.svg" alt="Atomic Chat logo" width="160">
  </a>
</p>

<p align="center"><strong>A retro-futuristic XMPP desktop messenger</strong></p>
<p align="center"><em>Connect. Communicate. Stay Atomic.</em></p>
<p align="center">Created by Edinson Ayui</p>

<p align="center">
  <a href="https://github.com/edarkea/atomic-chat/releases/latest"><img src="https://img.shields.io/github/v/release/edarkea/atomic-chat?display_name=tag&sort=semver" alt="Latest stable release"></a>
  <a href="https://github.com/edarkea/atomic-chat/actions/workflows/ci-tests.yml"><img src="https://github.com/edarkea/atomic-chat/actions/workflows/ci-tests.yml/badge.svg?branch=main" alt="Focused CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/edarkea/atomic-chat" alt="MIT License"></a>
  <a href="https://github.com/edarkea/atomic-chat/releases/latest"><img src="https://img.shields.io/badge/Windows-x64-0078D6?logo=windows&logoColor=white" alt="Windows x64"></a>
  <a href="https://github.com/edarkea/atomic-chat/releases/latest"><img src="https://img.shields.io/badge/Linux-x64-FCC624?logo=linux&logoColor=111111" alt="Linux x64"></a>
</p>

## About

Atomic Chat is a desktop XMPP messaging client built with Angular, TypeScript and Electron. It is designed for XMPP/Openfire deployments and has a retro-futuristic interface inspired by terminal-era science fiction.

The project is conceptually informed by classic Spark workflows, but it is an independent application with its own implementation, visual identity and distribution. Atomic Chat is not an official Spark, Ignite Realtime or Fallout project, and does not claim affiliation with their names or trademarks.

### Resumen en español

Atomic Chat es un cliente de mensajería XMPP para escritorio, desarrollado con Angular, TypeScript y Electron. Ofrece conversaciones individuales, contactos, presencia, historial local y herramientas de administración del cliente, con soporte condicionado para salas MUC y actualizaciones controladas.

## Features

### Implemented

- XMPP authentication and connection management for Openfire-compatible deployments.
- One-to-one conversations, contact roster loading and contact search.
- Presence and connection-state reporting, including recovery and disconnect states.
- Local SQLite history for incoming and outgoing messages.
- Message search in the current conversation and across local conversation history.
- Message dates, local times and chronological day separation.
- Emoji picker and multiline message composition.
- File transfer management with guarded previews for supported image content.
- Theme Studio, the Atomic theme and persisted custom themes.
- Preferences, connection profiles and guarded credential handling through Electron Main and operating-system secure storage.
- Local sticker library and sticker-pack organization.

### Available with explicit limitations

- MUC support currently covers discovery, entry/exit and participant state for the supported flow. Room creation, moderation, invitations, passwords, private room messages, automatic rejoin/forwarding, files and persistent MUC history are not complete.
- Sticker assets can be organized locally and received sticker messages can be displayed or saved. Sending stickers remains disabled and must not be considered an available chat feature.
- The updater infrastructure can check public GitHub Releases and lets the user control download and installation. Installed-update end-to-end validation, signing and target-platform compatibility remain pending.
- Interoperability evidence is limited to the tested Openfire/Spark environment; compatibility with every XMPP server or extension is not claimed.

## Downloads

Stable downloads are published on the [latest GitHub Release](https://github.com/edarkea/atomic-chat/releases/latest) when available:

- **Windows x64:** NSIS `.exe` installer.
- **Linux x64:** `.deb` package.
- **Linux x64:** `.AppImage` package.

macOS and other architectures are not distributed by the current build configuration.

## Architecture

```text
Angular Renderer → Restricted Preload API → Electron Main → XMPP / SQLite / Secure Storage
```

The Renderer does not access Node.js, SQLite, credentials or the XMPP socket directly. Electron Main owns the XMPP connection and persistence, validates IPC requests, and uses restricted Preload APIs to expose only the operations required by the UI. Credentials are handled in Main and protected with operating-system secure storage.

## Development

The project files are at the repository root. Use Node.js and npm versions compatible with the `packageManager` field in `package.json`.

Install dependencies and create a local configuration from the safe template:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit `.env` with a test XMPP/Openfire account. The template contains placeholders only; never commit `.env`, real passwords or production credentials.

```env
ATOMIC_XMPP_SERVICE=xmpp.example.test
ATOMIC_XMPP_DOMAIN=example.test
ATOMIC_XMPP_PORT=5222
ATOMIC_XMPP_TRANSPORT=starttls
ATOMIC_XMPP_USERNAME=test-user
ATOMIC_XMPP_PASSWORD=replace-with-synthetic-password
ATOMIC_XMPP_ALLOW_INSECURE_TLS=false
```

Useful project commands:

```powershell
npm run build
npm run electron
npm run typecheck
npm run test:ci:focused
```

`npm run electron` launches the desktop application using the local `.env`. Focused CI tests are intentionally separate from the historical P0, Openfire integration and load suites.

## Documentation, limitations and roadmap

See [Desktop profile, background mode and version updates](docs/desktop-background-and-updates.md) for the new preferences, tray menu, login/chat update controls and validation results.

See [CI, builds and updates](docs/ci-cd-and-updates.md) for the current release controls, dependency-security notes, manual build workflow and updater status.

The main operational limitations are conditional MUC authorization, disabled sticker sending, incomplete installed-updater E2E validation, target-platform packaging/signing checks and dependence on the configured XMPP server's authentication, roster, presence, file-transfer and MUC capabilities.

## Credits and license

**Created and maintained by Edinson Ayui**

**Copyright © 2026 Edinson Ayui**

**Licensed under the [MIT License](LICENSE).**
