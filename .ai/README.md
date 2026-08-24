# 🧠 Auth Service — Camada AI-Native (`.ai/`)

Estrutura de governança e inteligência artificial para o microsserviço de autenticação e gestão de identidades.

---

## 📂 Estrutura de Pastas

| Diretório | Finalidade |
| :--- | :--- |
| **`agents/`** | Subagentes especializados (ex: `@AuthSecurityAuditor` para varredura de JWT e auditoria RBAC). |
| **`evals/`** | Suítes de avaliação automatizada (*LLM-as-a-judge*) para testar segurança, expiração de sessões e rate limits. |
| **`context/`** | Memória arquitetural, grafo de dependências e decisões de design (ADRs) do serviço de Auth. |
| **`workflows/`** | Workflows e scripts de revisão de PRs focados em segurança e conformidade RFC 7807. |
| **`generators/`** | Geradores de dados sintéticos e personas de teste (Alunos, Professores, Admins). |
| **`mcp/`** | Servidor nativo Model Context Protocol (`auth-service-mcp`) e ferramentas JSON-RPC. |
