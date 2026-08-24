# ⚡ Workflows & AI Reviewers — Auth Service

Automações acionadas em Pull Requests e rotinas de CI/CD para o Auth Service.

---

## 🤖 Workflows Configurados
1. **`pr-security-audit.yml`**: Análise estática com IA de novas rotas em busca de middlewares de autenticação esquecidos.
2. **`rfc-compliance-check.yml`**: Garantir que todas as respostas de erro retornem no formato canônico RFC 7807 (`{ error: { code, message, details } }`).
