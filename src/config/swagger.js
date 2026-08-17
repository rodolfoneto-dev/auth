const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Auth Service API',
      version: '1.0.0',
      description:
        'Documentação e contrato da API de autenticação e autorização (JWT e RBAC) para consumo dos demais microsserviços da plataforma.',
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 4000}`,
        description: 'Servidor Local',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Insira o token JWT no formato: Bearer <seu_token>',
        },
      },
    },
  },
  apis: ['./src/routes/*.js', './src/server.js'],
};

const swaggerSpec = swaggerJSDoc(options);

// Helper para extrair exemplos de schemas OpenAPI
const extractExamples = (schema) => {
  const result = {};
  if (!schema || !schema.properties) return result;
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.example !== undefined) {
      result[key] = prop.example;
    } else if (prop.properties) {
      result[key] = extractExamples(prop);
    } else {
      result[key] = prop.type === 'number' ? 0 : prop.type === 'boolean' ? true : 'string';
    }
  }
  return result;
};

// Gera documentação em Markdown estruturado para consumo por IAs e desenvolvedores
const generateMarkdownDocs = (spec) => {
  let md = `# ${spec.info.title} (v${spec.info.version})\n\n`;
  md += `${spec.info.description}\n\n`;
  md += `**Base URL:** \`${spec.servers[0]?.url || 'http://localhost:4000'}\`  \n`;
  md += `**Autenticação:** Header \`Authorization: Bearer <token_jwt>\`\n\n`;
  md += `---\n\n`;
  md += `## Endpoints da API\n\n`;

  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, details] of Object.entries(methods)) {
      const verb = method.toUpperCase();
      md += `### \`${verb} ${path}\` - ${details.summary || ''}\n\n`;
      if (details.description) {
        md += `${details.description}\n\n`;
      }

      if (details.security && details.security.length > 0) {
        md += `🔒 **Requer Autenticação:** Sim (Bearer JWT)\n\n`;
      } else {
        md += `🔓 **Autenticação:** Rota Pública\n\n`;
      }

      // Request Body
      if (details.requestBody && details.requestBody.content) {
        md += `#### Corpo da Requisição (Body)\n\n`;
        const jsonContent = details.requestBody.content['application/json'];
        if (jsonContent && jsonContent.schema) {
          const schema = jsonContent.schema;
          const required = schema.required || [];
          if (schema.properties) {
            md += `| Campo | Tipo | Obrigatório | Descrição / Exemplo |\n`;
            md += `| :--- | :--- | :--- | :--- |\n`;
            for (const [prop, propDetails] of Object.entries(schema.properties)) {
              const isReq = required.includes(prop) ? '**Sim**' : 'Não';
              const type = propDetails.type || 'string';
              const ex = propDetails.example ? `Ex: \`${propDetails.example}\`` : '';
              const enumVals = propDetails.enum ? `Valores: [${propDetails.enum.join(', ')}]` : '';
              const desc = [propDetails.description, enumVals, ex].filter(Boolean).join(' - ');
              md += `| \`${prop}\` | \`${type}\` | ${isReq} | ${desc || '-'} |\n`;
            }
            md += `\n`;
          }
        }
      }

      // Responses
      if (details.responses) {
        md += `#### Respostas (HTTP Status)\n\n`;
        md += `| Status | Descrição | Exemplo de Retorno |\n`;
        md += `| :--- | :--- | :--- |\n`;
        for (const [status, resp] of Object.entries(details.responses)) {
          let exampleStr = '-';
          if (resp.content && resp.content['application/json']) {
            const respSchema = resp.content['application/json'].schema;
            if (respSchema && respSchema.properties) {
              exampleStr = `\`${JSON.stringify(extractExamples(respSchema))}\``;
            }
          }
          md += `| **${status}** | ${resp.description || '-'} | ${exampleStr} |\n`;
        }
        md += `\n---\n\n`;
      }
    }
  }

  return md;
};

// Gera página HTML moderna para visualizar o Markdown
const renderMarkdownViewerHtml = (markdownContent) => {
  const escapedMarkdown = JSON.stringify(markdownContent);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auth API - Markdown Docs</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-bright: #f0f6fc;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --code-bg: #1f242c;
      --table-header: #21262d;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.6;
      padding: 40px 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 32px 40px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .header-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
      gap: 12px;
    }
    .nav-links {
      display: flex;
      gap: 12px;
    }
    .btn {
      background: #238636;
      color: #ffffff;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover { background: #2ea043; }
    .btn-secondary {
      background: #21262d;
      color: var(--text-bright);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { background: #30363d; }
    #content h1, #content h2, #content h3, #content h4 {
      color: var(--text-bright);
      margin-top: 24px;
      margin-bottom: 12px;
    }
    #content h1 { font-size: 28px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    #content h2 { font-size: 22px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
    #content h3 { font-size: 18px; color: var(--accent); }
    #content p { margin-bottom: 16px; }
    #content code {
      font-family: 'Fira Code', monospace;
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
      color: #79c0ff;
    }
    #content pre {
      background: var(--code-bg);
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      margin-bottom: 16px;
      border: 1px solid var(--border);
    }
    #content pre code {
      background: none;
      padding: 0;
      color: var(--text);
    }
    #content table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 14px;
    }
    #content th, #content td {
      border: 1px solid var(--border);
      padding: 10px 12px;
      text-align: left;
    }
    #content th {
      background-color: var(--table-header);
      color: var(--text-bright);
      font-weight: 600;
    }
    #content tr:nth-child(even) { background-color: rgba(255,255,255,0.02); }
    #content hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 28px 0;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #238636;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
    }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-actions">
      <div class="nav-links">
        <a href="/docs" class="btn btn-secondary">⚡ Swagger Interativo</a>
        <a href="/docs.json" class="btn btn-secondary" target="_blank">📋 JSON Spec</a>
        <a href="/docs.md" class="btn btn-secondary" target="_blank">📝 Raw .MD</a>
      </div>
      <button class="btn" id="copyBtn" onclick="copyMarkdown()">📋 Copiar Markdown para Prompt IA</button>
    </div>
    <div id="content"></div>
  </div>
  <div id="toast" class="toast">Markdown copiado para a área de transferência!</div>

  <script>
    const markdown = ${escapedMarkdown};
    document.getElementById('content').innerHTML = marked.parse(markdown);

    function copyMarkdown() {
      navigator.clipboard.writeText(markdown).then(() => {
        const toast = document.getElementById('toast');
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
      });
    }
  </script>
</body>
</html>`;
};

const swaggerMarkdown = generateMarkdownDocs(swaggerSpec);
const swaggerMarkdownHtml = renderMarkdownViewerHtml(swaggerMarkdown);

module.exports = {
  swaggerUi,
  swaggerSpec,
  swaggerMarkdown,
  swaggerMarkdownHtml,
};
