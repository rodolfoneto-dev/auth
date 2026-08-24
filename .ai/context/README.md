# 🗺️ Memória Arquitetural & Contexto — Auth Service

Grafo de dependências e decisões de arquitetura (ADRs) do serviço de autenticação.

---

## 🏛️ Modelos de Dados & Decisões
- **Mongoose Models**: `User` (credenciais, status, refreshTokens), `Lead` (captação), `AuditLog` (trilha de auditoria).
- **ADR 001 — JWT Stateless**: Utilização de HMAC SHA-256 com claims `sub`, `role`, `status`, `iss` e `aud`.
- **ADR 002 — Refresh Token Rotation**: Rotação automática de refresh tokens com detecção de reuso indevido.
