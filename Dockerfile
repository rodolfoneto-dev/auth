# ========================================================
# Dockerfile - Módulo: auth
# Modelo padrão para serviços Node.js / Express
# ========================================================

# --------------------------------------------------------
# Estágio 1: Dependências (Dependencies)
# --------------------------------------------------------
FROM node:20-alpine AS dependencies

WORKDIR /app

# Copia manifestos primeiro para aproveitar cache de camadas
COPY package.json package-lock.json ./

# Garante ferramentas de compilação C++ para módulos nativos (bcrypt) em qualquer arquitetura (x86_64 / ARM64 Ampere)
RUN apk add --no-cache python3 make g++

# Instala apenas dependências de produção de forma determinística
RUN npm ci --omit=dev

# --------------------------------------------------------
# Estágio 2: Execução (Runtime)
# --------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Define ambiente de produção e porta padrão
ENV NODE_ENV=production
ENV PORT=4000

# Copia dependências instaladas do estágio anterior
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

# Copia código-fonte da aplicação
COPY --chown=node:node . .

# Alterna para usuário não-root 'node' (nativo da imagem alpine)
USER node

# Porta documentada do serviço
EXPOSE 4000

# Verificação de saúde da aplicação via endpoint /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-4000}/health || exit 1

# Comando de inicialização
CMD ["node", "src/server.js"]
