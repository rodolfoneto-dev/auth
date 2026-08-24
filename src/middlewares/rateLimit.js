/**
 * Rate Limiting Middleware simples e robusto em memória
 * Projetado para mitigar ataques de força bruta em rotas sensíveis de autenticação.
 */

const createRateLimiter = ({
  windowMs = 15 * 60 * 1000, // 15 minutos padrão
  max = 100,                 // Máximo de requisições por janela
  message = 'Muitas requisições. Por favor, tente novamente mais tarde.',
} = {}) => {
  const requests = new Map();

  // Limpeza periódica a cada 5 minutos
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of requests.entries()) {
      if (now - data.startTime > windowMs) {
        requests.delete(ip);
      }
    }
  }, 5 * 60 * 1000);

  // Evita que o timer segure o encerramento do processo em testes
  if (interval.unref) {
    interval.unref();
  }

  return (req, res, next) => {
    // Não aplica rate limit em testes unitários para não afetar execuções em lote
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const record = requests.get(ip);

    if (!record || now - record.startTime > windowMs) {
      requests.set(ip, {
        count: 1,
        startTime: now,
      });
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', max - 1);
      return next();
    }

    record.count += 1;
    const remaining = Math.max(0, max - record.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (record.count > max) {
      const retryAfter = Math.ceil((record.startTime + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: {
          code: 'TOO_MANY_REQUESTS',
          message,
        },
      });
    }

    next();
  };
};

// Limitadores específicos por criticidade
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 tentativas de login/registro a cada 15 min por IP
  message: 'Muitas tentativas de autenticação. Tente novamente em 15 minutos.',
});

const recoveryLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10, // 10 solicitações de redefinição de senha / reenvio por hora
  message: 'Limite de solicitações de recuperação atingido. Tente novamente mais tarde.',
});

module.exports = {
  createRateLimiter,
  authLimiter,
  recoveryLimiter,
};
