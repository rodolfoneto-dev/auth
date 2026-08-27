# RFC-CHAT-001 — Inclusão do claim `name` no payload JWT do `auth-service`

| Campo | Valor |
| :--- | :--- |
| **Solicitante** | IBM Bob (DevOps Senior) — equipe `chat-service` |
| **Destinatário** | Tech Lead — responsável pelo `auth-service` |
| **Serviço afetado** | `auth-service` (:4000) |
| **Serviço dependente** | `chat-service` (:4003) |
| **Data** | 2026-08 |
| **Status** | 🟡 **Aguardando Aprovação** |
| **Prioridade** | 🔴 **Bloqueante** — impede início da implementação dos Mongoose Models |

---

## 1. Contexto e Motivação

Durante a fase de análise e testes de integração do `chat-service`, foi identificado que o payload JWT emitido pelo `auth-service` após login (`POST /auth/login`) e refresh (`POST /auth/refresh`) **não inclui o campo `name`** do usuário.

> **Problema:** O `chat-service` precisa do nome do usuário para popular os campos `senderName` (em `Message`) e `participants[].name` (em `Room`) de forma segura e sem chamadas extras de rede. Sem esse campo no JWT, não há fonte confiável do nome no momento do handshake Socket.io.

### Payload JWT atual (confirmado em staging)

```json
// Decodificação do token real — POST /auth/login staging
{
  "sub": "6a8f61c8c0b59c2c23d2c542",
  "id": "6a8f61c8c0b59c2c23d2c542",
  "role": "aluno",
  "status": "active",
  "emailVerified": true,
  "iss": "auth-service",
  "aud": "platform",
  "iat": 1787784965,
  "exp": 1787788565
  // ← sem "name", sem "email"
}
```

---

## 2. Alteração Solicitada

Incluir o campo `name` (e opcionalmente `email`) no payload JWT em todos os pontos de emissão do token.

### Payload JWT solicitado

```json
{
  "sub": "6a8f61c8c0b59c2c23d2c542",
  "id": "6a8f61c8c0b59c2c23d2c542",
  "name": "Lucas Silva (Aluno Demo)",   // ← NOVO
  "email": "aluno@upexperience.com.br",  // ← NOVO (opcional mas recomendado)
  "role": "aluno",
  "status": "active",
  "emailVerified": true,
  "iss": "auth-service",
  "aud": "platform",
  "iat": 1787784965,
  "exp": 1787788565
}
```

### Pontos de emissão afetados no `auth-service`

| Endpoint | Método | Emite token? | Precisa incluir `name`? |
| :--- | :---: | :---: | :---: |
| `/auth/login` | `POST` | Sim — access token | 🔴 **Sim** |
| `/auth/register` | `POST` | Sim — access token | 🔴 **Sim** |
| `/auth/refresh` | `POST` | Sim — novo access token | 🔴 **Sim** |
| `/auth/validate` | `GET` | Não emite, valida | Não |
| `/auth/me` | `GET` | Não emite, retorna user | Não |

---

## 3. Como o `chat-service` usa esse campo

O `name` do JWT será lido uma única vez no handshake do Socket.io e armazenado em `socket.user`:

```javascript
// src/middleware/auth.middleware.js — chat-service
io.use((socket, next) => {
  const decoded = jwt.verify(rawToken, JWT_SECRET);
  socket.user = {
    id:    decoded.sub || decoded.id,
    name:  decoded.name || 'Usuário',  // ← usa o claim JWT
    role:  decoded.role || 'aluno',
    email: decoded.email,
  };
  next();
});
```

E será persistido nos models Mongoose:

```javascript
// Model: Room — participants
participants: [{
  userId:      "6a8f61c8...",
  name:        "Lucas Silva (Aluno Demo)",  // ← vem de decoded.name
  role:        "aluno",
  unreadCount: 0,
}]

// Model: Message
{
  senderId:   "6a8f61c8...",
  senderName: "Lucas Silva (Aluno Demo)",  // ← vem de decoded.name
  senderRole: "aluno",
  content:    "Olá teacher!",
}
```

---

## 4. Análise de Impacto da Alteração

> **Impacto mínimo no auth-service:** A alteração é aditiva — adiciona um campo ao payload sem remover nenhum existente. Todos os clientes que já consomem o JWT continuam funcionando sem modificação.

| Serviço / Componente | Impacto | Ação necessária |
| :--- | :---: | :--- |
| `auth-service` (emissão) | 🟡 **Modificação** | Incluir `name` (e `email`) no `jwt.sign()` |
| `v1-portal` (frontend) | 🟢 **Zero impacto** | Pode ler `decoded.name` do token — melhoria de UX |
| `academy-service` | 🟢 **Zero impacto** | Nenhuma — campo adicional ignorado |
| `genai-service` | 🟢 **Zero impacto** | Nenhuma — campo adicional ignorado |
| `chat-service` | 🔵 **Dependente** | Usa `decoded.name` no handshake e nos models |
| Tamanho do JWT | 🟢 **Negligível** | ~30–50 bytes extras no Base64 — imperceptível |

---

## 5. Alternativas Avaliadas e Descartadas

| Opção | Descrição | Por que descartada |
| :--- | :--- | :--- |
| **A** — Frontend envia o nome no payload | `send_message: { content, senderName: "Lucas" }` | Cliente controla o próprio nome — risco de spoofing. Inaceitável para produção. |
| **B** — Buscar nome via `GET /auth/me` no handshake | Chamada HTTP ao auth-service a cada conexão Socket.io | Latência extra no handshake, dependência de rede síncrona, ponto de falha. Inadequado para WebSocket de baixa latência. |
| **C** — `POST /chat/rooms/direct` recebe `targetName` do cliente | Frontend passa `{ targetUserId, targetName, targetRole }` | Resolve apenas a criação de sala, não o `senderName` de cada mensagem. |
| **D** — Incluir `name` no JWT *(escolhida)* | `auth-service` inclui `name` no payload | 🟢 **Aprovada** — fonte única de verdade, sem latência, sem spoofing. |

---

## 6. Considerações de Segurança

> **Aviso:** O JWT é assinado (HS256) mas não criptografado. O campo `name` ficará visível em Base64 no cliente. Isso é aceitável — `name` é dado não sensível. **Nunca incluir senha, CPF ou dados sensíveis no payload JWT.**

| Risco | Avaliação | Mitigação |
| :--- | :---: | :--- |
| Nome falso no token | Baixo | Token é assinado — alteração invalida a assinatura |
| Nome desatualizado (usuário mudou o nome) | Baixo | Token expira em 1h (staging: 1h). Próximo login atualiza. |
| Aumento de tamanho do token | Negligível | ~50 bytes extras em Base64 — sem impacto prático |

---

## 7. Checklist de Implementação (`auth-service`)

- [ ] Localizar a função de geração de token no `auth-service` (provavelmente em `src/utils/token.js` ou `src/routes/auth.js`)
- [ ] Adicionar `name: user.name` (e opcionalmente `email: user.email`) no objeto passado para `jwt.sign()`
- [ ] Garantir que os 3 endpoints emissores (`/login`, `/register`, `/refresh`) usem a mesma função de geração
- [ ] Atualizar os testes do auth-service para validar presença de `name` no payload decodificado
- [ ] Fazer deploy em staging e confirmar via `POST /auth/login` + decodificação do token
- [ ] Comunicar ao time do chat-service que a alteração está disponível em staging

---

## 8. Critério de Aceite

Após o deploy no staging, o seguinte comando deve retornar `name` no payload decodificado:

```powershell
# Login no staging
$r = Invoke-RestMethod -Uri "https://upexperience.vibecodia.com.br/auth/login" `
     -Method POST -ContentType "application/json" `
     -Body '{"email":"aluno@upexperience.com.br","password":"senhaSegura123@"}'

# Decodificar payload JWT
$payload = $r.token.Split('.')[1]
$padded = $payload.PadRight($payload.Length + (4 - $payload.Length % 4) % 4, '=')
[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($padded)) | ConvertFrom-Json

# Esperado após a alteração:
# name  : Lucas Silva (Aluno Demo)   ← NOVO
# email : aluno@upexperience.com.br  ← NOVO
# sub   : 6a8f61c8c0b59c2c23d2c542
# role  : aluno
```

---

## 9. Aprovação

- **Solicitante:** IBM Bob (DevOps Senior) — `chat-service team`
- **Aprovação:** Tech Lead — `auth-service owner`
