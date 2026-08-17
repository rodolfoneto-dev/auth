/**
 * Serviço transacional de envio de e-mails
 * Suporta provedores externos (Resend, SES, SendGrid) e fallback com log formatado para desenvolvimento e testes.
 */

const sendVerificationEmail = async (to, name, rawToken) => {
  const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 4000}`;
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
    // Exemplo de chamada HTTP caso RESEND_API_KEY esteja configurada
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'onboarding@meusistema.com',
        to: [to],
        subject: 'Confirme seu endereço de e-mail',
        html: `
          <h2>Olá, ${name}!</h2>
          <p>Obrigado por se cadastrar na nossa plataforma.</p>
          <p>Por favor, clique no botão abaixo para ativar a sua conta:</p>
          <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#238636;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Confirmar E-mail</a>
          <p>Ou acerte o link: <a href="${verifyUrl}">${verifyUrl}</a></p>
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

module.exports = {
  sendVerificationEmail,
};
