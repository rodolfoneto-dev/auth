# Auth Service

Microsserviço de autenticação (Node.js, Express e MongoDB via Mongoose).

---

## Pré-requisitos

- **Node.js**: v20+
- **npm**: v10+
- **Docker** e **Docker Compose**

---

## Configuração do Ambiente

Copie o arquivo de exemplo e preencha as variáveis de ambiente necessárias:

```bash
cp .env.example .env
```

Variáveis esperadas no `.env`:

| Variável | Descrição | Exemplo |
| :--- | :--- | :--- |
| `PORT` | Porta HTTP da aplicação | `4000` |
| `MONGO_URI` | URI de conexão do MongoDB Atlas | `mongodb+srv://...` |
| `JWT_SECRET` | Chave secreta para assinatura dos tokens JWT | `sua_chave_secreta` |

---

## Execução Local (Node.js)

### 1. Instalar dependências
```bash
npm install
```

### 2. Rodar testes
- **Testes Unitários (sem necessidade de banco ativo):**
  ```bash
  npm test
  ```
- **Testes de Integração (requer MongoDB ativo):**
  ```bash
  npm run test:integration
  ```
- **Todos os testes:**
  ```bash
  npm run test:all
  ```

### 3. Iniciar servidor
```bash
node src/server.js
```
O servidor aguardará a conexão com o MongoDB antes de abrir a porta HTTP (`PORT`).

---

## Documentação Interativa da API (Swagger / OpenAPI)

Com o servidor rodando, acesse no navegador:
- **URL Swagger UI:** [http://localhost:4000/docs](http://localhost:4000/docs)
- **JSON OpenAPI (Spec para IAs / Ferramentas):** [http://localhost:4000/docs.json](http://localhost:4000/docs.json)

Contém o contrato completo, payloads de requisição, exemplos e testes interativos para:
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/validate` (autenticado)
- `GET /auth/me` (autenticado)


---

## Execução com Docker

### Usando Docker Compose (Recomendado)

**Subir o container em background (com build):**
```bash
docker compose up -d --build
```

**Verificar status e logs:**
```bash
docker compose ps
docker compose logs -f auth
```

**Testar healthcheck:**
```bash
curl http://localhost:4000/health
```
Resposta esperada:
```json
{"status":"ok"}
```

**Parar os containers:**
```bash
docker compose down
```

---

### Usando Docker CLI diretamente

**1. Build da imagem:**
```bash
docker build -t auth-service .
```

**2. Executar o container:**
```bash
docker run -d \
  --name auth-service \
  -p 4000:4000 \
  --env-file .env \
  auth-service
```

---

## Pipelines de CI (GitHub Actions)

### 1. `CI` ([`.github/workflows/ci.yml`](.github/workflows/ci.yml))
- Executa testes unitários isolados (`npm test`).
- Valida o build da imagem de produção via Docker Buildx.

### 2. `Integration & Mock DB Tests` ([`.github/workflows/mock.yml`](.github/workflows/mock.yml))
- Sobe um container de serviço do MongoDB (`mongo:7`) nativo no GitHub Actions.
- Executa `npm run test:integration` contra o banco em container para validar operações reais de persistência (`user.save()`, hash do bcrypt no banco, índices únicos).
