# Central conversation archive — user projects

This folder is the central index for durable records of project-related conversations, instructions, decisions, corrections, approvals, and voice-message transcripts/summaries.

## Scope requested by the user
The user has explicitly requested that **all conversations between the user and ChatGPT, across all chats and projects, be documented in GitHub**, so prior decisions can be retrieved instead of asking the user to repeat them.

Known project repositories:
- **AGOR / “גורשה”** (project name as dictated in the latest conversation): `beeberr/stock-scannet-pro`, archive under `new/AGOR-17-stages-archive/`.
- **איזון עדין**: `beeberr/Izunadin-`.
- **Stock Scanner Pro**: `beeberr/stock-scannet-pro`.
- A similarly named repository `beeberr/stock-scanner-pro` exists, but the active Stock Scanner project was previously identified as `stock-scannet-pro`. Do not write to the similarly named repository unless the user explicitly redirects.

## Critical limitation — no automatic background capture
GitHub updates happen only when an available tool is invoked during a conversation. The assistant cannot continuously monitor every chat in the background, cannot see chats that are not in its available context, and cannot promise that every word in every future conversation is automatically copied to GitHub without an explicit archive action.

Operational rule: when a conversation contains project instructions, decisions, corrections, approvals, deliverables, or voice-message content and the relevant GitHub connector is available, the assistant should write a dated log to the relevant project archive during that conversation, then fetch the file again to verify the saved content. If the connector is unavailable or the conversation is not accessible, state that limitation rather than pretending it was archived.

## What to preserve
- User's exact instructions and important wording, not merely assistant summaries.
- Decisions, approvals, rejected options, corrections, unresolved questions, and next steps.
- Voice messages: transcript or faithful summary; original audio only if actual audio bytes are available and committed.
- Images and documents: actual files where technically possible, plus source/credit and verification state.
- Links to related project records, so a future conversation can recover context.

## Verification standard
A record is “saved” only after the GitHub write succeeds and a subsequent fetch confirms the file contents. An image/audio/document is “saved” only if its actual bytes exist in the repository and can be opened. A link or filename alone is not proof.

## Archive locations
- AGOR / “גורשה”: [AGOR 17-stage archive](../new/AGOR-17-stages-archive/README.md)
- איזון עדין: [Izunadin repository](https://github.com/beeberr/Izunadin-)
- Stock Scanner: [Stock Scanner Pro repository](https://github.com/beeberr/stock-scannet-pro)

## Current log
- [2026-11-10 — user's global archiving requirement](2026-11-10.md)
