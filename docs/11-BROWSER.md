# Browser Automation Architecture

## Technologies
- Playwright
- Browser Use
- computer-use integration where appropriate

## Capabilities
- navigation
- DOM/accessibility inspection
- click/type
- upload/download
- screenshots
- persistent sessions
- authentication sessions
- browser state

## Security
Browser credentials must be isolated from model context where possible.
Do not expose cookies or secrets in logs.

## Lifecycle
Create session -> execute actions -> validate state -> capture artifact -> close/persist session.

## Visual QA
Browser screenshots can be sent to a vision-capable model for UI evaluation.
