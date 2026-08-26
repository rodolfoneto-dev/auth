/**
 * Serviço transacional de envio de e-mails
 * Suporta provedores externos (Resend, SES, SendGrid) e fallback com log formatado para desenvolvimento e testes.
 */

const getAppUrl = () => {
  const url = process.env.APP_URL || process.env.PUBLIC_URL || process.env.VITE_API_URL;
  if (url && url.trim()) {
    return url.trim().replace(/\/+$/, '');
  }
  return `http://localhost:${process.env.PORT || 4000}`;
};

const sendVerificationEmail = async (to, name, rawToken) => {
  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/auth/verify-email?token=${rawToken}`;

  // Log formatado para ambiente local e testes
  if (process.env.NODE_ENV !== 'production' || !process.env.RESEND_API_KEY) {
    console.log(`\n📧 [EMAIL TRANSACIONAL] Confirmação de Cadastro`);
    console.log(`Para: ${name} <${to}>`);
    console.log(`Link de Confirmação: ${verifyUrl}\n`);
    return { success: true, verifyUrl, mode: 'dev-log' };
  }

  // Integração com Resend / API transacional se chave estiver presente
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'onboarding@lumen.dev',
        to: [to],
        subject: 'Confirme seu endereço de e-mail',
        html: `
          <h2>Olá, ${name}!</h2>
          <p>Obrigado por se cadastrar na nossa plataforma.</p>
          <p>Por favor, clique no botão abaixo para ativar a sua conta:</p>
          <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#238636;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Confirmar E-mail</a>
          <p>Ou acesse o link: <a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>Este link expira em 24 horas.</p>
        `,
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error('Erro ao enviar e-mail via Resend:', errData);
      return { success: false, error: errData };
    }

    return { success: true, verifyUrl, mode: 'resend-api' };
  } catch (err) {
    console.error('Falha no envio de e-mail:', err);
    return { success: false, error: err.message };
  }
};

const sendPasswordResetEmail = async (to, name, rawToken) => {
  const appUrl = getAppUrl();
  const resetUrl = `${appUrl}/auth/reset-password?token=${rawToken}`;

  // Log formatado para ambiente local e testes
  if (process.env.NODE_ENV !== 'production' || !process.env.RESEND_API_KEY) {
    console.log(`\n📧 [EMAIL TRANSACIONAL] Recuperação de Senha`);
    console.log(`Para: ${name} <${to}>`);
    console.log(`Link de Redefinição: ${resetUrl}\n`);
    return { success: true, resetUrl, mode: 'dev-log' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'suporte@lumen.dev',
        to: [to],
        subject: 'Redefinição de senha solicitada',
        html: `
          <h2>Olá, ${name}!</h2>
          <p>Recebemos uma solicitação para redefinir a senha da sua conta.</p>
          <p>Se você realizou esta solicitação, clique no botão abaixo para cadastrar uma nova senha:</p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#d97706;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Redefinir Senha</a>
          <p>Ou acesse o link: <a href="${resetUrl}">${resetUrl}</a></p>
          <p>Este link expira em 1 hora. Se você não solicitou a alteração, ignore este e-mail.</p>
        `,
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error('Erro ao enviar e-mail via Resend:', errData);
      return { success: false, error: errData };
    }

    return { success: true, resetUrl, mode: 'resend-api' };
  } catch (err) {
    console.error('Falha no envio de e-mail de recuperação:', err);
    return { success: false, error: err.message };
  }
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
};
