const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const app = express();
app.use(express.json());

// ============================================================
// CONFIGURAÇÃO — preencha com suas variáveis de ambiente
// ============================================================
const CONFIG = {
  BOT_TOKEN:  process.env.BOT_TOKEN,
  GUILD_ID:   process.env.GUILD_ID,
  TAXA_GGMAX: 0.1299, // Diamante 12,99%
  PORTA:      process.env.PORT || 3000,
};

// IDs dos canais (preenchidos automaticamente na 1ª execução)
let CANAIS = {
  vendas:       null,
  perguntas:    null,
  intervencoes: null,
  lucros:       null,
};

// Estatísticas acumuladas em memória
let STATS = {
  totalVendas:       0,
  totalFaturado:     0,
  totalTaxas:        0,
  totalLucro:        0,
  totalPerguntas:    0,
  totalIntervencoes: 0,
  historico:         [], // últimas 10 vendas
};

// ============================================================
// CLIENT DISCORD
// ============================================================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  await criarCanais();
});

async function criarCanais() {
  const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
  if (!guild) return console.error('❌ GUILD_ID inválido.');

  // Categorias
  let catGGMAX = guild.channels.cache.find(c => c.name === '📦・ggmax' && c.type === 4);
  if (!catGGMAX) catGGMAX = await guild.channels.create({ name: '📦・ggmax', type: 4 });

  let catFin = guild.channels.cache.find(c => c.name === '💰・financeiro' && c.type === 4);
  if (!catFin) catFin = await guild.channels.create({ name: '💰・financeiro', type: 4 });

  // Canais
  CANAIS.vendas       = (await obterOuCriar(guild, '💸・vendas',          catGGMAX.id)).id;
  CANAIS.perguntas    = (await obterOuCriar(guild, '❓・perguntas',        catGGMAX.id)).id;
  CANAIS.intervencoes = (await obterOuCriar(guild, '🚨・intervencoes',     catGGMAX.id)).id;
  CANAIS.lucros       = (await obterOuCriar(guild, '📊・resumo-de-lucros', catFin.id  )).id;

  console.log('✅ Canais prontos!');
}

async function obterOuCriar(guild, nome, parentId) {
  const existente = guild.channels.cache.find(c => c.name === nome);
  if (existente) return existente;
  return guild.channels.create({ name: nome, type: 0, parent: parentId });
}

// ============================================================
// CÁLCULO DE LUCRO
// ============================================================
function calcular(precoVenda, custoCard) {
  const recebido = precoVenda * (1 - CONFIG.TAXA_GGMAX);
  const taxa     = precoVenda * CONFIG.TAXA_GGMAX;
  const lucro    = custoCard ? recebido - custoCard : null;
  const margem   = lucro && custoCard ? (lucro / custoCard) * 100 : null;
  return { recebido, taxa, lucro, margem };
}

function brl(v)  { return `R$ ${Number(v).toFixed(2).replace('.', ',')}` }
function pct(v)  { return `${Number(v).toFixed(1).replace('.', ',')}%` }
function agora() { return new Date().toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) }

// ============================================================
// EMBEDS
// ============================================================
function embedVenda(d) {
  const preco  = parseFloat(d.preco  || d.valor || d.amount || 0);
  const custo  = parseFloat(d.custo  || 0);
  const { recebido, taxa, lucro, margem } = calcular(preco, custo || null);

  // Atualiza stats
  STATS.totalVendas++;
  STATS.totalFaturado += preco;
  STATS.totalTaxas    += taxa;
  if (lucro) STATS.totalLucro += lucro;
  STATS.historico.push({ produto: d.produto || d.title || 'N/A', preco, recebido, lucro, data: agora() });
  if (STATS.historico.length > 10) STATS.historico.shift();

  const embed = new EmbedBuilder()
    .setColor(0x2ECC71)
    .setTitle('💸  Nova Venda Confirmada!')
    .addFields(
      { name: '🛒 Produto',        value: d.produto || d.title || 'N/A',     inline: true  },
      { name: '🆔 Pedido',         value: String(d.pedido_id || d.id || '—'), inline: true  },
      { name: '👤 Comprador',      value: d.comprador || d.buyer || '—',      inline: true  },
      { name: '💵 Valor da venda', value: brl(preco),                          inline: true  },
      { name: '📉 Taxa GGMAX',     value: `${brl(taxa)} (12,99%)`,             inline: true  },
      { name: '📤 Você recebe',    value: `**${brl(recebido)}**`,              inline: true  },
    );

  if (lucro !== null) {
    embed.addFields({ name: '✅ Lucro líquido', value: `**${brl(lucro)}** (${pct(margem)})`, inline: false });
  } else {
    embed.addFields({ name: '💡 Dica', value: 'Informe o campo `custo` no webhook para calcular o lucro líquido.', inline: false });
  }

  embed.setFooter({ text: `GGMAX Bot • ${agora()}` }).setTimestamp();
  return embed;
}

function embedPergunta(d) {
  STATS.totalPerguntas++;
  return new EmbedBuilder()
    .setColor(0x3498DB)
    .setTitle('❓  Nova Pergunta Recebida')
    .addFields(
      { name: '👤 Usuário',  value: d.usuario  || d.user    || '—', inline: true  },
      { name: '🛒 Produto',  value: d.produto  || d.title   || '—', inline: true  },
      { name: '💬 Pergunta', value: d.mensagem || d.message || '—', inline: false },
    )
    .setFooter({ text: `GGMAX Bot • ${agora()}` }).setTimestamp();
}

function embedIntervencao(d) {
  STATS.totalIntervencoes++;
  return new EmbedBuilder()
    .setColor(0xE74C3C)
    .setTitle('🚨  Intervenção no Pedido!')
    .setDescription('Um pedido está com problema e pode precisar de mediação.')
    .addFields(
      { name: '🆔 Pedido',    value: String(d.pedido_id || d.id || '—'), inline: true  },
      { name: '👤 Comprador', value: d.comprador || d.buyer  || '—',     inline: true  },
      { name: '🛒 Produto',   value: d.produto   || d.title  || '—',     inline: true  },
      { name: '⚠️ Motivo',    value: d.motivo    || d.reason || '—',     inline: false },
    )
    .setFooter({ text: `GGMAX Bot • ${agora()}` }).setTimestamp();
}

function embedResumoLucros() {
  const lucroMedio = STATS.totalVendas > 0 ? STATS.totalLucro / STATS.totalVendas : 0;

  const embed = new EmbedBuilder()
    .setColor(0xF39C12)
    .setTitle('📊  Resumo de Lucros — Atualizado')
    .addFields(
      { name: '📦 Total de vendas',    value: String(STATS.totalVendas),          inline: true },
      { name: '💵 Total faturado',     value: brl(STATS.totalFaturado),            inline: true },
      { name: '📉 Total taxas GGMAX',  value: brl(STATS.totalTaxas),              inline: true },
      { name: '✅ Lucro líquido total',value: `**${brl(STATS.totalLucro)}**`,      inline: true },
      { name: '📈 Lucro médio/venda',  value: brl(lucroMedio),                    inline: true },
      { name: '❓ Perguntas',          value: String(STATS.totalPerguntas),        inline: true },
      { name: '🚨 Intervenções',       value: String(STATS.totalIntervencoes),     inline: true },
    );

  if (STATS.historico.length > 0) {
    const lista = [...STATS.historico].reverse().slice(0, 5)
      .map(v => `• **${v.produto}** — ${brl(v.preco)} → recebe **${brl(v.recebido)}**${v.lucro ? ` · lucro **${brl(v.lucro)}**` : ''}`)
      .join('\n');
    embed.addFields({ name: '🕐 Últimas vendas', value: lista, inline: false });
  }

  return embed.setFooter({ text: `GGMAX Bot • ${agora()}` }).setTimestamp();
}

// ============================================================
// ENVIO PARA CANAL
// ============================================================
async function enviar(canalId, embed) {
  try {
    const canal = await client.channels.fetch(canalId);
    await canal.send({ embeds: [embed] });
  } catch (e) {
    console.error('Erro ao enviar embed:', e.message);
  }
}

// ============================================================
// ROTAS WEBHOOK
// ============================================================

// A GGMAX pode enviar tudo numa rota só — detectamos pelo tipo
app.post('/webhook', async (req, res) => {
  const d = req.body;
  console.log('📩 Webhook recebido:', JSON.stringify(d));

  const tipo = (d.tipo || d.type || d.event || '').toLowerCase();

  if (tipo.includes('venda') || tipo.includes('sale') || tipo.includes('order')) {
    await enviar(CANAIS.vendas,  embedVenda(d));
    await enviar(CANAIS.lucros,  embedResumoLucros());
  } else if (tipo.includes('pergunta') || tipo.includes('question')) {
    await enviar(CANAIS.perguntas, embedPergunta(d));
  } else if (tipo.includes('interven') || tipo.includes('dispute') || tipo.includes('problem')) {
    await enviar(CANAIS.intervencoes, embedIntervencao(d));
  } else {
    // Sem tipo definido — tenta deduzir pelo conteúdo
    if (d.preco || d.valor || d.amount) {
      await enviar(CANAIS.vendas, embedVenda(d));
      await enviar(CANAIS.lucros, embedResumoLucros());
    } else if (d.mensagem || d.message) {
      await enviar(CANAIS.perguntas, embedPergunta(d));
    } else if (d.motivo || d.reason) {
      await enviar(CANAIS.intervencoes, embedIntervencao(d));
    } else {
      console.warn('⚠️ Evento não identificado:', d);
    }
  }

  res.json({ ok: true });
});

// Rotas individuais (caso a GGMAX permita URL por evento)
app.post('/webhook/venda',       async (req, res) => { const d = req.body; await enviar(CANAIS.vendas, embedVenda(d)); await enviar(CANAIS.lucros, embedResumoLucros()); res.json({ ok: true }); });
app.post('/webhook/pergunta',    async (req, res) => { const d = req.body; await enviar(CANAIS.perguntas, embedPergunta(d)); res.json({ ok: true }); });
app.post('/webhook/intervencao', async (req, res) => { const d = req.body; await enviar(CANAIS.intervencoes, embedIntervencao(d)); res.json({ ok: true }); });

// Health check
app.get('/', (req, res) => res.json({ status: 'online', uptime: process.uptime(), stats: STATS }));

// ============================================================
// START
// ============================================================
app.listen(CONFIG.PORTA, () => console.log(`🌐 Servidor rodando na porta ${CONFIG.PORTA}`));
client.login(CONFIG.BOT_TOKEN);
