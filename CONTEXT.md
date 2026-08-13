# CueCommX

CueCommX is a local-network intercom for live production teams. This context captures the live-operations terms that shape the deepest seams in the server and client modules.

## Language

**Operator session**:
One authenticated live connection for a user, carrying talk, listen, all-page, direct-call, and IFB state.
_Avoid_: websocket session, realtime connection

**Operator-session coordination**:
The server-side logic that interprets operator commands and produces live outcomes across Operator sessions.
_Avoid_: realtime service, signaling hub

**Channel chat**:
Per-channel text traffic that shares transport with live comms but is separate from Operator-session coordination.
_Avoid_: signaling, realtime coordination

## Relationships

- **Operator-session coordination** reads and updates **Operator session** state
- **Channel chat** shares transport with **Operator-session coordination** but remains a sibling concern

## Example dialogue

> **Dev:** "When an operator starts All-Page, does **Channel chat** belong in the same module?"
> **Domain expert:** "No — **Operator-session coordination** should own the live talk/listen consequences, while **Channel chat** stays a sibling concern on the same transport."

## Flagged ambiguities

- "realtime" was being used for both **Operator-session coordination** and **Channel chat** — resolved: use the more specific term for each concern.
