# Runtime Topology

Purpose: keep `pi-agent-config` understandable as it scales.

## Layered architecture

```mermaid
flowchart TD
  U[Operator] --> P[pictl target/slice launcher]
  P --> S[Slice manifest]
  S --> R[Pi runtime]

  R --> E1[guardrails]
  R --> E2[profiles]
  R --> E3[visibility]
  R --> E4[subagent]
  R --> E5[orchestration]
  R --> E6[bootstrap]
  R --> E7[organic-workflows]
  R --> E8[ops-watchdog + handoff]

  E5 --> A[admission controller]
  E5 --> G[adaptive governor]
  E5 --> D[delegation runner]
  E6 --> D
  E4 --> D

  D --> C[(child pi runs)]
  A --> L[(admission log)]
  E3 --> V[(visibility log)]
  E8 --> O[(ops/watchdog logs)]
```

## Orchestration critical path

```mermaid
sequenceDiagram
  participant User
  participant Orchestration
  participant Admission
  participant Runner as Delegation Runner
  participant Child as Child pi

  User->>Orchestration: /team or /pipeline
  Orchestration->>Admission: preflightRun(runId, idempotencyKey, depth, slots)
  Admission-->>Orchestration: allow/deny
  alt allowed
    Orchestration->>Runner: execute agent step(s)
    Runner->>Child: spawn bounded delegated run
    Child-->>Runner: output + health
    Runner-->>Orchestration: result
    Orchestration->>Admission: endRun(...)
  else denied
    Orchestration-->>User: fail-closed guard message
  end
```

## Design rule

- Keep extension entrypoints thin.
- Move policy/logic to testable modules.
- Preserve one explicit control point per risk domain (admission, governor, health, logging).
