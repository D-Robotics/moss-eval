# Release checklist

- [ ] Clean checkout, locked `npm ci` at root and `app/`.
- [ ] Schema/syntax, core units, artifact compatibility, adapter conformance and grader controls pass.
- [ ] Sandbox, IPC, renderer injection, path escape and cancellation security tests pass.
- [ ] Gated calibration has zero reference false negatives and zero negative-control false positives.
- [ ] Candidate comparison is green, gated coverage is at least 95%, safety violations are zero, invalid trials are at most 2%.
- [ ] Source commit, immutable image digest, application/core version and build provenance are complete.
- [ ] NSIS and portable outputs build; packaged smoke confirms resource lookup, worker files, user-data writes and canonical reader.
- [ ] `checksums.sha256` is generated and verified before publication.

Do not publish when any item is incomplete. CI enforces the automatable subset; a release owner records the clean Windows verification and signs off the remaining provenance checks.
