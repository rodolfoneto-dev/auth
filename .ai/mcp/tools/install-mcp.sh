#!/usr/bin/env bash
# ==============================================================================
# Script de Instalação e Registro Automático do MCP - Auth Service
# Compatível com Unix / Linux (Antigravity, Claude, Codex, Cursor, Windsurf, Cline)
# ==============================================================================

set -euo pipefail

# Cores e Estilos para Saída Verbosa
COLOR_RESET="\033[0m"
COLOR_BOLD="\033[1m"
COLOR_BLUE="\033[38;5;39m"
COLOR_GREEN="\033[38;5;42m"
COLOR_YELLOW="\033[38;5;214m"
COLOR_RED="\033[38;5;196m"
COLOR_CYAN="\033[38;5;45m"
COLOR_MUTED="\033[38;5;244m"

log_info()    { echo -e "  ${COLOR_CYAN}ℹ${COLOR_RESET} $1"; }
log_success() { echo -e "  ${COLOR_GREEN}✔${COLOR_RESET} ${COLOR_BOLD}$1${COLOR_RESET}"; }
log_skip()    { echo -e "  ${COLOR_YELLOW}↷ [SKIP]${COLOR_RESET} $1 ${COLOR_MUTED}($2)${COLOR_RESET}"; }
log_error()   { echo -e "  ${COLOR_RED}✖ [ERRO]${COLOR_RESET} $1"; }

# 1. Resolução dos Caminhos
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_SERVER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_DIR="$(cd "${MCP_SERVER_DIR}/../.." && pwd)"
SERVER_JS_PATH="${MCP_SERVER_DIR}/server.js"
SERVER_NAME="auth-service"

echo -e "\n${COLOR_BLUE}${COLOR_BOLD}╔══════════════════════════════════════════════════════════════════════╗${COLOR_RESET}"
echo -e "${COLOR_BLUE}${COLOR_BOLD}║          MCP Installer: Auth Service (${SERVER_NAME})             ║${COLOR_RESET}"
echo -e "${COLOR_BLUE}${COLOR_BOLD}╚══════════════════════════════════════════════════════════════════════╝${COLOR_RESET}\n"

log_info "Servidor MCP Alvo: ${COLOR_BOLD}${SERVER_JS_PATH}${COLOR_RESET}"

# Verifica se o arquivo server.js existe
if [[ ! -f "${SERVER_JS_PATH}" ]]; then
  log_error "Arquivo server.js não foi encontrado em: ${SERVER_JS_PATH}"
  exit 1
fi

# Verifica se o Node.js está instalado
if ! command -v node &> /dev/null; then
  log_error "Node.js não foi encontrado no PATH do sistema. Instale o Node.js v18+ primeiro."
  exit 1
fi

NODE_VERSION=$(node -v)
log_info "Node.js detectado: ${COLOR_BOLD}${NODE_VERSION}${COLOR_RESET}\n"

# Contadores de execução
TOTAL_CONFIGURED=0
TOTAL_SKIPPED=0

# ==============================================================================
# Função Helper: Atualiza ou Cria JSON de Configuração MCP com Segurança
# ==============================================================================
configure_mcp_json() {
  local target_app="$1"
  local config_file="$2"
  local check_dir="$3"

  # Verifica se o diretório da aplicação existe no sistema
  if [[ ! -d "${check_dir}" && ! -f "${config_file}" ]]; then
    log_skip "${target_app}" "Diretório ${check_dir} não encontrado"
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + 1))
    return 0
  fi

  log_info "Configurando ${COLOR_BOLD}${target_app}${COLOR_RESET} em: ${COLOR_MUTED}${config_file}${COLOR_RESET}"

  # Cria diretório pai se não existir
  mkdir -p "$(dirname "${config_file}")"

  # Cria backup de segurança se o arquivo já existir
  if [[ -f "${config_file}" ]]; then
    local backup_file="${config_file}.bak.$(date +%Y%m%d_%H%M%S)"
    cp "${config_file}" "${backup_file}"
    log_info "Backup criado: ${COLOR_MUTED}${backup_file}${COLOR_RESET}"
  fi

  # Injeção e merge do servidor usando script Node.js para garantir integridade do JSON
  node -e '
    const fs = require("fs");
    const filePath = process.argv[1];
    const serverName = process.argv[2];
    const serverPath = process.argv[3];
    const serviceDir = process.argv[4];

    let jwtSecret = process.env.JWT_SECRET || "";
    const envFile = require("path").join(serviceDir, ".env");
    if (!jwtSecret && fs.existsSync(envFile)) {
      const match = fs.readFileSync(envFile, "utf-8").match(/^JWT_SECRET=["'\''"]?([^"'\''\r\n]+)["'\''"]?/m);
      if (match) jwtSecret = match[1];
    }

    let config = { mcpServers: {} };
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8").trim();
        if (raw) config = JSON.parse(raw);
      } catch (err) {
        console.error("Aviso: JSON existente continha erros. Criando nova estrutura limpa.");
      }
    }

    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      config.mcpServers = {};
    }

    config.mcpServers[serverName] = {
      command: "node",
      args: [serverPath],
      env: {
        PORT: "4000",
        JWT_SECRET: jwtSecret,
        APP_URL: "http://localhost:4000"
      }
    };

    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  ' "${config_file}" "${SERVER_NAME}" "${SERVER_JS_PATH}" "${SERVICE_DIR}"

  log_success "${target_app} configurado com sucesso!"
  TOTAL_CONFIGURED=$((TOTAL_CONFIGURED + 1))
}

# ==============================================================================
# Varredura de Ferramentas Suportadas (Unix/Linux)
# ==============================================================================

echo -e "${COLOR_BOLD}1. Verificando Antigravity / Gemini CLI (agy):${COLOR_RESET}"
configure_mcp_json "Antigravity Global Config" \
  "${HOME}/.gemini/config/mcp_config.json" \
  "${HOME}/.gemini"

configure_mcp_json "Antigravity CLI Local Config" \
  "${HOME}/.gemini/antigravity-cli/mcp_config.json" \
  "${HOME}/.gemini/antigravity-cli"

echo -e "\n${COLOR_BOLD}2. Verificando Claude (Desktop & Code):${COLOR_RESET}"
configure_mcp_json "Claude Desktop (Linux)" \
  "${HOME}/.config/Claude/claude_desktop_config.json" \
  "${HOME}/.config/Claude"

configure_mcp_json "Claude Code CLI" \
  "${HOME}/.claude.json" \
  "${HOME}/.claude"

echo -e "\n${COLOR_BOLD}3. Verificando Codex / OpenAI CLI:${COLOR_RESET}"
configure_mcp_json "Codex CLI (~/.codex)" \
  "${HOME}/.codex/mcp.json" \
  "${HOME}/.codex"

configure_mcp_json "Codex XDG (~/.config/codex)" \
  "${HOME}/.config/codex/mcp.json" \
  "${HOME}/.config/codex"

echo -e "\n${COLOR_BOLD}4. Verificando Cursor IDE:${COLOR_RESET}"
configure_mcp_json "Cursor Global Config" \
  "${HOME}/.cursor/mcp.json" \
  "${HOME}/.cursor"

configure_mcp_json "Cursor XDG Config" \
  "${HOME}/.config/Cursor/mcp.json" \
  "${HOME}/.config/Cursor"

echo -e "\n${COLOR_BOLD}5. Verificando Windsurf / Codeium:${COLOR_RESET}"
configure_mcp_json "Windsurf Cascade" \
  "${HOME}/.codeium/windsurf/mcp_config.json" \
  "${HOME}/.codeium/windsurf"

echo -e "\n${COLOR_BOLD}6. Verificando Extensões VS Code (Cline & Roo Code):${COLOR_RESET}"
configure_mcp_json "Cline VS Code Extension" \
  "${HOME}/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json" \
  "${HOME}/.config/Code/User/globalStorage/saoudrizwan.claude-dev"

configure_mcp_json "Roo Code VS Code Extension" \
  "${HOME}/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/cline_mcp_settings.json" \
  "${HOME}/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline"

# ==============================================================================
# Resumo Final
# ==============================================================================
echo -e "\n${COLOR_BLUE}${COLOR_BOLD}══════════════════════════════════════════════════════════════════════${COLOR_RESET}"
echo -e "${COLOR_BOLD}Resumo da Instalação:${COLOR_RESET}"
echo -e "  - Ambientes Configurados: ${COLOR_GREEN}${COLOR_BOLD}${TOTAL_CONFIGURED}${COLOR_RESET}"
echo -e "  - Ambientes Ignorados (não instalados): ${COLOR_YELLOW}${COLOR_BOLD}${TOTAL_SKIPPED}${COLOR_RESET}"
echo -e "\n${COLOR_GREEN}${COLOR_BOLD}✔ Instalação finalizada!${COLOR_RESET} O MCP '${SERVER_NAME}' está pronto para uso.\n"
