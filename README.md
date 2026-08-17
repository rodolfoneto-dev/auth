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
Executa os testes automatizados com Jest e Supertest (não depende do MongoDB ativo para o healthcheck):
```bash
npm test
```

### 3. Iniciar servidor
```bash
node src/server.js
```
O servidor aguardará a conexão com o MongoDB antes de abrir a porta HTTP (`PORT`).

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

## Pipeline de CI (GitHub Actions)

O arquivo [`.github/workflows/ci.yml`](.github/workflows/ci.yml) é executado automaticamente a cada `push` e `pull_request` direcionados às branches `main` e `master`.

### Etapas do Pipeline:

1. **Job `test` (Testes Unitários e Integração):**
   - Faz checkout do código.
   - Configura o Node.js na versão 20 (com cache do npm).
   - Executa `npm ci` para instalar dependências exatas.
   - Roda `npm test` para validar os endpoints (ex.: `/health`).

2. **Job `docker` (Validação do Build Docker):**
   - Depende do sucesso do job `test`.
   - Inicializa o Docker Buildx.
   - Executa um build de teste da imagem usando o [`Dockerfile`](Dockerfile) multi-stage (`push: false`).
   - Garante que nenhuma alteração de código ou dependência quebrou a construção do container de produção.
