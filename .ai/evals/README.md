# 🧪 Evals & Benchmarks — Auth Service

Suítes de avaliação automatizada com LLM-as-a-judge e testes de regressão de segurança.

---

## 🎯 Cenários de Avaliação
1. **Privilege Escalation**: Testar se um payload com `role: 'admin'` enviado no `/auth/register` é rejeitado e forçado para `aluno`.
2. **Session Hijacking / Replay**: Validar se refresh tokens revogados são sumariamente rejeitados.
3. **Password Policy**: Verificar conformidade de senhas fortes e hash bcrypt com salt mínimo de 10 rounds.
