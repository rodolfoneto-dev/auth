# 🌌 Plano Global de Evolução e Refatoração — Auth Service & Ecossistema Lumen

> **Documento de Acompanhamento Global (Checklist de Execução)**  
> **Referência:** `auth/AUTH_SERVICE_EVOLUTION_REFACT_GUIDE.md`  
> **Repositórios Impactados:** `auth`, `edge`, `academy`, `v1-portal`, `pipelines`  
> **Estimativa Total:** 35 a 50 minutos divididos em 5 macrofases.

---

## ⏱️ Estimativa por Fases

```mermaid
gantt
    title Cronograma de Execução da Evolução do Auth Service
    dateFormat  m
    axisFormat %M min

    section 1. Auth Service Core & Segurança :active, a1, 0, 18
    section 2. Edge Gateway & Contratos      :a2, 18, 26
    section 3. Academy Service Interop        :a3, 26, 32
    section 4. V1-Portal Client & UI Sync    :a4, 32, 42
    section 5. Validação Global & Pipelines  :a5, 42, 50
```

| Fase | Escopo Principal | Duração Estimada |
|---|---|:---:|
| **Fase 1 — Auth Service Core** | Normalização, Anti-Elevation, Verification Tokens, Refresh Token/Logout, Forgot/Reset Password, Padronização de Erros & OpenAPI | **15 - 20 min** |
| **Fase 2 — Edge Service (Gateway)** | Rotas proxy para `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password` | **5 - 8 min** |
| **Fase 3 — Academy Service** | Interoperabilidade de claims JWT (`sub`, `id`, `role`, `emailVerified`), testes de integração | **5 - 7 min** |
| **Fase 4 — V1-Portal (Frontend)** | Atualização do `src/lib/api.ts` (Refresh token, Logout síncrono, forgot-pwd), tipagens | **8 - 12 min** |
| **Fase 5 — Validação Global** | Execução de `npm test` em todos os repositórios e `npm run check:all` no `pipelines` | **5 - 8 min** |
| **TOTAL** | **Execução Completa em Todo o Ecossistema** | **~35 - 50 min** |

---

## 📋 Checklist Global de Execução

### 1. 🛡️ Auth Service (`/auth`)
- [ ] **1.1 Normalização de Identidade:**
  - [ ] E-mail sanitizado com `trim().toLowerCase()` em todos os fluxos (register, login, resend, reset).
- [ ] **1.2 Proteção contra Privilege Escalation no Register (`POST /auth/register`):**
  - [ ] Bloquear escolha arbitrária de `role: admin` no cadastro público.
  - [ ] Default `role: aluno` seguro com sanitização rigorosa.
- [ ] **1.3 Hashing Seguro de Senhas & Tokens:**
  - [ ] Armazenamento exclusivo de `passwordHash` (bcrypt com cost factor adequado).
  - [ ] Hashes de tokens de uso único (`emailVerificationToken`, `passwordResetToken`).
- [ ] **1.4 E-mail Verification (`GET /auth/verify-email`, `POST /auth/resend-verification`):**
  - [ ] Expiração estrita (24h) e invalidação após primeiro uso.
  - [ ] Resposta genérica em `resend-verification` para prevenção de enumeração de e-mails.
- [ ] **1.5 Sessões & Refresh Tokens (`POST /auth/refresh`, `POST /auth/logout`):**
  - [ ] Modelo de persistência e rotação de refresh tokens seguros.
  - [ ] Endpoint `POST /auth/refresh` com emissão de novo access token.
  - [ ] Endpoint `POST /auth/logout` com revogação ativa no backend.
- [ ] **1.6 Recuperação de Senha (`POST /auth/forgot-password`, `POST /auth/reset-password`):**
  - [ ] Endpoint `forgot-password` com resposta neutra anti-enumeração.
  - [ ] Endpoint `reset-password` com validação de token, alteração de hash e revogação de sessões.
- [ ] **1.7 Endpoints de Contrato (`GET /auth/validate`, `GET /auth/me`):**
  - [ ] `/auth/validate` com validação criptográfica real, claims e sanitização.
  - [ ] `/auth/me` com busca atualizada no banco de dados.
- [ ] **1.8 Padronização de Erros & OpenAPI:**
  - [ ] Formato padrão de erro `{ error: { code, message, details? } }`.
  - [ ] Atualização do Swagger/OpenAPI (`/api-docs`).
- [ ] **1.9 Suíte de Testes do Auth:**
  - [ ] Testes unitários e de integração cobrindo happy path, failure paths e security paths.

---

### 2. 🌐 Edge Service — API Gateway (`/edge`)
- [ ] **2.1 Roteamento Proxy:**
  - [ ] Mapear `POST /auth/refresh` -> `auth-service:4000/auth/refresh`.
  - [ ] Mapear `POST /auth/logout` -> `auth-service:4000/auth/logout`.
  - [ ] Mapear `POST /auth/forgot-password` -> `auth-service:4000/auth/forgot-password`.
  - [ ] Mapear `POST /auth/reset-password` -> `auth-service:4000/auth/reset-password`.
- [ ] **2.2 Headers & CORS:**
  - [ ] Propagação consistente de headers `Authorization` e tratamento de erros.
- [ ] **2.3 Testes do Gateway:**
  - [ ] Garantir 100% de aprovação nos testes unitários e de rota do `edge`.

---

### 3. 🎓 Academy Service (`/academy`)
- [ ] **3.1 Compatibilidade de JWT:**
  - [ ] Validar que `authenticate` e `optionalAuthenticate` extraem `sub` (ou `id`), `role` e `emailVerified` sem atrito.
- [ ] **3.2 Validação de Roles & Regras de Domínio:**
  - [ ] Permissões de instrutor (`professor`) e aluno (`aluno`) operando estritamente sobre as claims do token.
- [ ] **3.3 Testes do Academy:**
  - [ ] Execução da suíte completa (`npm test` / `npm run test:all`) garantindo zero regressão.

---

### 4. 💻 V1-Portal — Frontend (`/v1-portal`)
- [ ] **4.1 Cliente de API (`src/lib/api.ts`):**
  - [ ] Atualizar armazenamento de token para suportar `refreshToken` (se aplicável) e logout remoto.
  - [ ] Suporte aos novos métodos (`api.forgotPassword`, `api.resetPassword`, `api.logout`).
- [ ] **4.2 Contextos & UI:**
  - [ ] `AuthContext.tsx` integrado com a revogação de sessão remota.
  - [ ] Formulários com i18n atualizados para novas mensagens de erro padronizadas.
- [ ] **4.3 Testes do Portal:**
  - [ ] `npm run typecheck`, `npm run lint` e `npm test` 100% aprovados.

---

### 5. 🚀 Esteira Geral & Validação Final (`/pipelines`)
- [ ] **5.1 Verificação de Contratos:**
  - [ ] Rodar `npm run check:all` validando os 4 microsserviços simultaneamente.
- [ ] **5.2 Relatório Final:**
  - [ ] Resumo executivo de mudanças, segurança e compatibilidade.
