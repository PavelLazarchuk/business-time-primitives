---
'business-time-primitives': patch
---

`businessDateOf` rejects `options` that are not an object with `businessDateOf: options must be an object, got null` instead of a `TypeError` from reading `cutoff` of `null`.
