# Guia de Integração e Autenticação Entre Módulos

Este documento define o contrato de autenticação e autorização do microsserviço `auth` para todos os outros módulos do ecossistema (`academy`, `adm`, `comms`, `genai`, `game`, `site`, `edge`, `ops`, `portal`).

---

## 1. Visão Geral da Arquitetura

O serviço `auth` atua como o **Provedor de Identidade (IdP)** da plataforma. Ele é o único serviço que:
- Armazena credenciais e gera hashes de senha com `bcrypt`.
- Emite tokens JWT autenticados após login ou registro.

Todos os outros microsserviços operam de forma **Stateless (sem estado)**, validando os tokens emitidos pelo `auth` sem necessidade de consultar o banco de dados de usuários a cada requisição.

---

## 2. Padrão do Token JWT

- **Algoritmo:** HMAC-SHA256 (`HS256`)
- **Assinatura:** Baseada na chave secreta compartilhada `JWT_SECRET`
- **Validade:** 7 dias (`expiresIn: '7d'`)
- **Header HTTP esperado:** `Authorization: Bearer <token>`

### Estrutura do Payload:
```json
{
  "id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "role": "aluno",
  "emailVerified": true,
  "iat": 1786930000,
  "exp": 1787534800
}
```

### Papéis Suportados (RBAC):
| Papel | Descrição | Exemplos de Uso nos Módulos |
| :--- | :--- | :--- |
| `aluno` | Usuário final padrão | Visualizar aulas (`academy`), jogar (`game`), emitir certificados |
| `professor` | Criador e gestor de conteúdo | Criar cursos/provas (`academy`), publicar comunicados (`comms`) |
| `admin` | Acesso administrativo irrestrito | Gestão financeira, banimento (`adm`), infraestrutura (`ops`) |

---

## 3. Como os Outros Módulos Devem Consumir o Auth

Existem duas abordagens possíveis para os outros módulos validarem a sessão:

### Abordagem A: Validação Local Stateless (Recomendada - Alta Performance)
Os módulos secundários validam a assinatura do JWT localmente com `jsonwebtoken` e a variável `JWT_SECRET`.
- **Latência:** `0ms` (sem tráfego de rede entre microsserviços).
- **Resiliência:** Se o microsserviço `auth` estiver fora do ar, os outros módulos continuam autenticando requisições normalmente.

#### Código para replicar nos outros módulos (`src/middlewares/auth.js`):
```javascript
const jwt = require('jsonwebtoken');

// 1. Valida autenticação (Token JWT válido e não expirado)
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido ou formato inválido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: decoded.id,
      role: decoded.role,
      emailVerified: decoded.emailVerified,
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado' });
    }
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// 2. Valida autorização por perfil (RBAC)
const checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado para o seu perfil' });
    }

    next();
  };
};

// 3. Exige confirmação de e-mail ativa
const requireEmailVerified = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }

  if (!req.user.emailVerified) {
    return res.status(403).json({
      error: 'Confirmação de e-mail obrigatória. Por favor, verifique sua caixa de entrada.',
    });
  }

  next();
};

module.exports = { authenticate, checkRole, requireEmailVerified };
```

---

### Abordagem B: Validação via Chamada HTTP Centralizada
Se um microsserviço em outra linguagem ou um API Gateway precisar validar o token via rede:

- **Endpoint:** `GET /auth/validate`
- **Header:** `Authorization: Bearer <token>`
- **Resposta Sucesso (200):**
  ```json
  {
    "valid": true,
    "user": {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "role": "professor"
    }
  }
  ```
- **Resposta Erro (401):**
  ```json
  {
    "error": "Token expirado"
  }
  ```

---

## 4. Exemplos de Proteção de Rotas nos Módulos

### No módulo `academy`:
```javascript
const express = require('express');
const { authenticate, checkRole } = require('./middlewares/auth');
const router = express.Router();

// Qualquer usuário autenticado (aluno, professor, admin)
router.get('/lessons/:id', authenticate, lessonController.getLesson);

// Apenas professores e admins podem publicar conteúdo
router.post('/courses', authenticate, checkRole('professor', 'admin'), courseController.create);
```

### No módulo `adm`:
```javascript
// Apenas administradores
router.delete('/users/:id', authenticate, checkRole('admin'), adminController.banUser);
```

---

## 5. Variáveis de Ambiente Necessárias nos Outros Módulos

Cada repositório que validar tokens deve conter no seu `.env`:

```env
JWT_SECRET=mesma_chave_secreta_definida_no_auth
```
