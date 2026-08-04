# Safe Exam — Technical Documentation

This directory contains the full technical documentation for the **Safe Exam** online examination system.

## Index

| Document | Contents |
|---|---|
| [architecture.md](architecture.md) | System architecture, tech stack, request flow, data flow |
| [data-model.md](data-model.md) | Database schema, tables, indexes, integrity guarantees |
| [authentication.md](authentication.md) | Custom auth, bcrypt + JWT, session lifecycle |
| [exam-workflow.md](exam-workflow.md) | Exam lifecycle: start, autosave, submit, grading algorithm |
| [risk-scoring-algorithm.md](risk-scoring-algorithm.md) | Proctoring engine, event metrics, risk formula & thresholds |
| [security-model.md](security-model.md) | RLS, SECURITY DEFINER, column-level revokes, invariants |
| [api-reference.md](api-reference.md) | All RPC functions + typed client API |
| [deployment.md](deployment.md) | Setup, env vars, deployment to Supabase + Netlify |
| [scalability.md](scalability.md) | Capacity targets, bottlenecks, optimization roadmap for 1k–10k students |
| [faq.md](faq.md) | Common questions and operational notes |

## Quick facts

- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS + shadcn/ui + TanStack Query
- **Backend:** Supabase (PostgreSQL + PostgREST), Edge Functions
- **Auth:** custom bcrypt + HS256 JWT, signed with the project JWT secret
- **Grading & risk scoring:** server-side only, in `SECURITY DEFINER` Postgres functions
- **Proctoring:** client detects events, server assigns immutable risk points
- **Live monitoring:** teacher pages poll every 5s via React Query

See the top-level [README.md](../README.md) for a product overview and quick start.
