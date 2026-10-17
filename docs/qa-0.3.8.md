# Activity, sidebar and shared coaching provider

## Changes grounded in the current app

- The calendar had a hard maximum of 22px per week and Dashboard had a 1240px cap. Remove those caps for Dashboard activity, fill the available content width, and default to the existing 52-week dataset. Keep the 13-week option. Fixed-height cells prevent the shorter range from creating a very tall graph. Narrow screens scroll within the calendar, start at recent weeks, and explain how to reach earlier weeks. Date/count labels, keyboard navigation, detail popovers and the accessible count table remain available. No activity metrics changed.
- Previously, hiding the sidebar unmounted its button and mounted another button inside the content header. Use one persistent upper-left control, independent of the sidebar. Its position and keyboard focus stay stable across open/closed states. Reserve room beside the brand, simplify the narrow rail header, and retain navigation, appearance controls and saved visibility preferences.
- Practice coaching always called local inference, while interview replies already used the enabled OpenRouter configuration and a profile-scoped macOS Keychain entry. Route coaching through that same key/model when enabled, retain local inference when disabled, and propagate cloud failures without silently switching providers. Candidate-only context and strict interview restrictions are preserved.
- Settings now names both consumers of the shared OpenRouter configuration. Hints identifies OpenRouter and its model and explains what is sent before a request. Local model setup remains optional and separately supports local transcript cleanup. Saved credentials stay in Keychain and are never returned to the question UI or saved in workspace files.

## Validation

- 54 frontend tests passed; coverage includes the cloud provider label and data-flow notice.
- All 19 browser tests passed with the real isolated native service and Docker worker. The final calendar scrolling adjustment was then rechecked against the three affected browser scenarios. Wide and narrow screenshots were inspected; the calendar fills the content width without page overflow at 2400, 1440, 760 and 390px. Toggle position/focus, both sidebar states, both ranges and visibility of recent weeks are asserted.
- All 41 native tests passed, including shared cloud selection, disabled-provider behavior, no silent local fallback, strict interview restrictions, bounded HTTP payload, bearer authentication and sanitized upstream errors. Cloud transport uses an isolated test HTTP server, not a billed live OpenRouter call.
- Native Clippy, formatting, production build, four release checks and whitespace validation passed. The existing Monaco bundle size warning remains.
