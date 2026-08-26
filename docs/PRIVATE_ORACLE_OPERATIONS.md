# Private Oracle operations

Private release Oracles are optional user-supplied assets. They must never be committed, packaged, copied into an Agent workspace, or written to ordinary run artifacts. Public development evaluation remains usable without them, but the formal release gate stays closed.

## Private layout

Keep the bundle outside the repository, or under the ignored path `.moss-eval/private-oracles/<bundle-id>/`:

```text
private-oracles/<bundle-id>/
  bundle.json
  cases/
    <private-case-directory>/
      verify.mjs
      ...private fixtures...
```

`bundle.json` is private and maps task IDs to verifier entry points:

```json
{
  "schema_version": "1.0",
  "cases": [
    { "task_id": "real-example", "oracle": "cases/example/verify.mjs" }
  ]
}
```

Each verifier receives `<copied-workspace> <task-id> --json` and prints one final JSON line shaped as `{"decision":"pass|fail","reasons":[]}`. It executes only after the Agent has exited, against a temporary copy of the trial workspace, with credential-like environment variables removed. The copy is deleted after grading.

## Freeze and execute

Use a secret salt of at least 16 characters; do not store it in shell history or reports:

```powershell
$env:MOSS_EVAL_HIDDEN_SALT = '<secret release salt>'
node bin/moss-eval.mjs hidden-manifest --bundle D:\private\moss-oracles --salt-env MOSS_EVAL_HIDDEN_SALT --output D:\private\release\hidden-manifest.json
node bin/moss-eval.mjs hidden-run --bundle D:\private\moss-oracles --salt-env MOSS_EVAL_HIDDEN_SALT --trials D:\private\release\trials.json --expected-manifest D:\private\release\hidden-manifest.json --output D:\private\release\hidden-receipt.json
```

`trials.json` contains only task/workspace mappings: `{"records":[{"task_id":"real-example","workspace":"D:\\...\\workspace"}]}`. The public receipt contains the salted bundle digest, task decisions, timing, and source workspace digests. It never contains private paths, filenames, expected outputs, salt, or Oracle source.

## Release rules

- A synthetic CI fixture proves execution, isolation, nondisclosure, and fail-closed behavior; it is never valid release evidence.
- A real release needs a trusted private bundle, a passing hidden receipt, a separate leak audit, and detached approvals by two distinct people.
- Any bundle content or salt change changes the bundle digest and invalidates prior sign-offs.
- Run `npm run hidden:contract` and `npm run release:isolation` before packaging. Formal release execution must also scan tracked files, packaged resources, Agent workspaces, and exported run artifacts against the private bundle identities.
