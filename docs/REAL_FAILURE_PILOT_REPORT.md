# Real failure Pilot report

- Corpus: `moss-real-agent-failures@0.2.0-development`
- Development dataset: `moss-real-failure-pilot@0.2.0-development`
- Accepted source-backed mechanisms: 21
- Explicit rejections: 3
- Accepted, reproduced, minimized, promoted, and calibrated: 21
- Strata: 2 Agent behavior, 19 Agent Harness
- Control executions: 126
- Positive false-negative rate: 0
- Negative false-positive rate: 0
- Execution-error rate: 0
- Registry technical gate: pass
- Corpus digest: `2505aa6c8ee97746d66aad2024a6de18cd46654bbc5d670025a35f187b01b214`
- Development dataset digest: `3640d069ee46175993206e5ad39a9ccbf57e4640d8f4431bbe7f718b599adb70`
- Frozen protocol digest: `9d013f1e318d14dfb40d0b0ef31cd43bbf946b216c6481adf1d0feeb2531e9cc`
- Accepted-case target: 20–50; achieved
- MOSS source: `D-Robotics/moss@73b8556c3238a0a4ef8e7e4f29d79b945923f978`
- MOSS development run: 20/21 full Trial pass, 21/21 outcome pass, 21/21 valid telemetry
- Native MOSS tools: 114 calls, 0 execution failures, L3 trace coverage 21/21
- Cost/latency: USD 0.11451087 total, P50 16.072 s, P95 28.323 s
- Remaining MOSS failure: one task exceeded the 100,000 input-token budget after producing the correct outcome
- Release status: blocked

This is one attempt per task, so the displayed pass@k and pass^k values are mathematically the same as pass@1; they are not evidence of repeated-run stability. Release blockers are intentional: the Oracles are public, independent human review is absent, the Claude/Codex diagnostics are not protocol-comparable, and no genuine private hidden bundle exists. The digests above are content-derived; current machine-readable artifacts remain authoritative if content changes.
