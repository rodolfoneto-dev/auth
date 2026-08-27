#!/usr/bin/env node
require('dotenv').config({ quiet: true });
// Em servidores MCP com transporte stdio, stdout é exclusivo do protocolo JSON-RPC.
// Qualquer log deve ir para stderr para não corromper o parser do cliente MCP.
console.log = console.error;
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { swaggerMarkdown, swaggerSpec } = require('../../src/config/swagger');

// Inicializa servidor MCP
const server = new McpServer({
  name: 'auth-service-mcp',
  version: '1.0.0',
});

// ==========================================
// Resources: Exposição de Documentação & Contratos
// ==========================================

// Resource: Contrato em Markdown completo (atualizado dinamicamente)
server.registerResource(
  'auth-contract-markdown',
  'auth://contract.md',
  {
    title: 'Contrato da API Auth (Markdown)',
    description:
      'Documentação completa de endpoints, payloads, respostas e fluxos de e-mail do serviço de autenticação para IAs e desenvolvedores.',
    mimeType: 'text/markdown',
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: swaggerMarkdown,
      },
    ],
  })
);

// Resource: Especificação OpenAPI em JSON (atualizada dinamicamente)
server.registerResource(
  'auth-contract-json',
  'auth://openapi.json',
  {
    title: 'Especificação OpenAPI do Auth (JSON)',
    description: 'Schema OpenAPI 3.0 estruturado em JSON com todos os endpoints, schemas e segurança.',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: JSON.stringify(swaggerSpec, null, 2),
      },
    ],
  })
);

// ==========================================
// Tools: Ferramentas de IA para Desenvolvimento e Testes
// ==========================================

// Tool 1: Gerar token JWT de desenvolvimento (com controle de role e emailVerified)
server.registerTool(
  'auth_generate_dev_token',
  {
    description:
      'Gera um token JWT válido assinado com o JWT_SECRET do projeto para simular usuários autenticados (aluno, professor, admin) e status de e-mail (verificado ou pendente) durante desenvolvimento e testes de outros módulos (academy, adm, comms, etc.).',
    inputSchema: {
      userId: z.string().optional().describe('ID do usuário (opcional, padrão: dev_user_mock_123)'),
      role: z
        .enum(['aluno', 'professor', 'admin'])
        .default('aluno')
        .describe('Papel do usuário no sistema'),
      emailVerified: z
        .boolean()
        .default(true)
        .describe('Status de confirmação do e-mail do usuário'),
      expiresIn: z.string().default('7d').describe('Tempo de expiração (ex: 1h, 7d)'),
    },
  },
  async ({ userId = 'dev_user_mock_123', role = 'aluno', emailVerified = true, expiresIn = '7d' }) => {
    try {
      const secret = process.env.JWT_SECRET || 'dev_secret_jwt';
      const token = jwt.sign(
        {
          sub: userId,
          id: userId,
          name: role === 'professor' ? 'Teacher Sarah Jenkins' : role === 'admin' ? 'Master Admin' : 'Lucas Silva (Aluno Demo)',
          email: `${role}@upexperience.com.br`,
          role,
          emailVerified,
        },
        secret,
        { expiresIn }
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                role,
                userId,
                emailVerified,
                token,
                authorizationHeader: `Bearer ${token}`,
                instructions: `Use no header HTTP: Authorization: Bearer ${token}`,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Erro ao gerar token: ${err.message}` }],
      };
    }
  }
);

// Tool 2: Validar e inspecionar qualquer token JWT
server.registerTool(
  'auth_validate_token',
  {
    description:
      'Valida a assinatura de um token JWT e decodifica o payload ({ id, role, emailVerified, exp }) utilizando a chave JWT_SECRET configurada.',
    inputSchema: {
      token: z.string().describe('Token JWT (com ou sem prefixo Bearer)'),
    },
  },
  async ({ token }) => {
    try {
      const rawToken = token.startsWith('Bearer ') ? token.slice(7) : token;
      const secret = process.env.JWT_SECRET || 'dev_secret_jwt';
      const decoded = jwt.verify(rawToken, secret);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                valid: true,
                payload: decoded,
                expiresAt: new Date(decoded.exp * 1000).toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                valid: false,
                error:
                  err.name === 'TokenExpiredError'
                    ? 'Token expirado'
                    : 'Token inválido ou assinatura incorreta',
                details: err.message,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
);

// Tool 3: Gerar link/token de confirmação de e-mail para testes
server.registerTool(
  'auth_create_email_verification_link',
  {
    description: 'Gera um token de uso único de 64 caracteres hex e monta o link de teste para /auth/verify-email?token=...',
    inputSchema: {
      baseUrl: z.string().optional().describe('URL base do servidor (opcional, padrão: http://localhost:4000)'),
    },
  },
  async ({ baseUrl = 'http://localhost:4000' }) => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const verifyUrl = `${baseUrl}/auth/verify-email?token=${rawToken}`;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              rawToken,
              tokenHash,
              verifyUrl,
              testCommand: `curl "${verifyUrl}"`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 4: Obter matriz de regras e permissões (RBAC) dos papéis
server.registerTool(
  'auth_get_role_permissions',
  {
    description:
      'Retorna a tabela de papéis do sistema (aluno, professor, admin) e suas respectivas permissões em cada módulo da plataforma.',
    inputSchema: {},
  },
  async () => {
    const roles = {
      aluno: {
        description: 'Estudante padrão',
        modules: {
          academy: ['assistir_aulas', 'fazer_provas', 'baixar_certificados'],
          game: ['jogar', 'acumular_pontos'],
          comms: ['ler_avisos'],
        },
      },
      professor: {
        description: 'Instrutor e gestor de conteúdo',
        modules: {
          academy: ['criar_cursos', 'publicar_aulas', 'avaliar_provas'],
          comms: ['enviar_comunicados'],
        },
      },
      admin: {
        description: 'Administrador do sistema',
        modules: {
          adm: ['gerenciar_usuarios', 'gerenciar_financeiro', 'auditar_logs'],
          ops: ['gerenciar_infra', 'monitorar_servicos'],
          all: ['acesso_total'],
        },
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(roles, null, 2),
        },
      ],
    };
  }
);

// Inicia transporte stdio
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Erro ao iniciar MCP server:', err);
    process.exit(1);
  });
}

module.exports = { server, run };
