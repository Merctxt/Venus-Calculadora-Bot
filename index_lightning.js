import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  Events,
  ChannelType,
} from 'discord.js';

import dotenv from 'dotenv';
import express from 'express';
import QRCode from 'qrcode';
import fs from 'fs';
import fetch from 'node-fetch';

dotenv.config();

// Inicialização do cliente Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// EXPRESS KEEP-ALIVE
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot ativo!');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor ping ativo em http://localhost:${PORT}`);
});

// CONFIG
const OWNER_ID = '1360966433017696307';
const tax_robux = 0.0478;
const tax_gamepass = 0.04;
const PIX_KEY = process.env.PIX_KEY || 'sua_chave_pix_aqui';
const RECEIVER_NAME = 'Venus Store';
const RECEIVER_CITY = 'SAO PAULO';

// Configurações do Blink Lightning
const BLINK_CONFIG = {
  API_KEY: process.env.BLINK_API_KEY,
  BTC_WALLET_ID: process.env.BLINK_BTC_WALLET_ID,
  USD_WALLET_ID: process.env.BLINK_USD_WALLET_ID,
  SERVER_URL: process.env.BLINK_SERVER_URL || 'https://api.blink.sv/graphql'
};

// Novas configurações
const CONFIG = {
  CATEGORY_ID: process.env.CATEGORY_ID || '1398096287525634251',
  CLIENTE_ROLE_ID: process.env.CLIENTE_ROLE_ID || '1398306428044709888',
  AVALIACOES_CHANNEL_ID: process.env.AVALIACOES_CHANNEL_ID || '1398306818006057112',
  ENTREGAS_CHANNEL_ID: process.env.ENTREGAS_CHANNEL_ID || '1398306923916562453',
  LOG_VENDAS_CHANNEL_ID: process.env.LOG_VENDAS_CHANNEL_ID || '1398096288016502784',
  REACTION_EMOJIS: ['⭐', '🥰'],
  PEDIDO_TIMEOUT: 60 * 60 * 1000,
};

// Funções para gerenciar vendas
const VENDAS_FILE = './vendas.json';

function carregarVendas() {
  try {
    if (fs.existsSync(VENDAS_FILE)) {
      const data = fs.readFileSync(VENDAS_FILE, 'utf8');
      return JSON.parse(data).map(v => ({
        ...v,
        data: new Date(v.data)
      }));
    }
  } catch (error) {
    console.error('Erro ao carregar vendas:', error);
  }
  return [];
}

function salvarVendas(vendas) {
  try {
    fs.writeFileSync(VENDAS_FILE, JSON.stringify(vendas, null, 2));
  } catch (error) {
    console.error('Erro ao salvar vendas:', error);
  }
}

// Armazenar invoices temporariamente para copiar
const invoicesTemporarios = new Map();

// Carregar vendas do arquivo
let vendas = carregarVendas();

// Função para gerar payload Pix no padrão EMV
function gerarPayloadPix(chave, valor, nomeRecebedor, cidadeRecebedor, identificadorTransacao = '') {
  const formatarCampo = (id, valor) => id + String(valor.length).padStart(2, '0') + valor;
  const removerAcentos = (texto) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const nomeSanitizado = removerAcentos(nomeRecebedor).replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 25);
  const cidadeSanitizada = removerAcentos(cidadeRecebedor).replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 15);
  const txidSanitizado = (identificadorTransacao || '***').replace(/[^a-zA-Z0-9]/g, '').substring(0, 25);

  const payload = [
    formatarCampo('00', '01'),
    formatarCampo('26',
      formatarCampo('00', 'BR.GOV.BCB.PIX') +
      formatarCampo('01', chave)
    ),
    formatarCampo('52', '0000'),
    formatarCampo('53', '986'),
    formatarCampo('54', valor.toFixed(2)),
    formatarCampo('58', 'BR'),
    formatarCampo('59', nomeSanitizado),
    formatarCampo('60', cidadeSanitizada),
    formatarCampo('62',
      formatarCampo('05', txidSanitizado)
    )
  ].join('');

  const payloadComCrc = payload + '6304';
  let crc = 0xFFFF;
  for (let i = 0; i < payloadComCrc.length; i++) {
    crc ^= payloadComCrc.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++)
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  crc &= 0xFFFF;
  return payloadComCrc + crc.toString(16).toUpperCase().padStart(4, '0');
}

// Função para gerar QR Code buffer PNG
async function gerarQrCode(payloadPix) {
  try {
    return await QRCode.toBuffer(payloadPix, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 300
    });
  } catch (err) {
    console.error('Erro ao gerar QR Code:', err);
    return null;
  }
}

// Funções para integração com Blink Lightning Network
async function realizarRequisicaoBlink(query, variables = {}) {
  try {
    const response = await fetch(BLINK_CONFIG.SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': BLINK_CONFIG.API_KEY
      },
      body: JSON.stringify({
        query,
        variables
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      console.error('Erro GraphQL Blink:', data.errors);
      throw new Error(data.errors[0]?.message || 'Erro desconhecido da API Blink');
    }

    return data.data;
  } catch (error) {
    console.error('Erro na requisição Blink:', error);
    throw error;
  }
}

// Função para converter BRL para USD usando uma API de cotação
async function obterCotacaoUSD() {
  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/BRL');
    const data = await response.json();
    return data.rates.USD;
  } catch (error) {
    console.error('Erro ao obter cotação USD:', error);
    // Fallback para uma cotação aproximada
    return 0.18; // ~5.5 BRL/USD
  }
}

// Função para criar invoice Lightning usando USD wallet
async function criarInvoiceLightning(valorBRL, descricao) {
  try {
    // Converter BRL para USD
    const cotacaoUSD = await obterCotacaoUSD();
    const valorUSD = (valorBRL * cotacaoUSD).toFixed(2);
    const valorCentavos = Math.round(parseFloat(valorUSD) * 100); // Converter para centavos

    const query = `
      mutation LnUsdInvoiceCreate($input: LnUsdInvoiceCreateInput!) {
        lnUsdInvoiceCreate(input: $input) {
          invoice {
            paymentRequest
            paymentHash
            paymentSecret
            satoshis
          }
          errors {
            message
            path
          }
        }
      }
    `;

    const variables = {
      input: {
        walletId: BLINK_CONFIG.USD_WALLET_ID,
        amount: valorCentavos,
        memo: descricao || 'Venus Store - Compra de Robux'
      }
    };

    const resultado = await realizarRequisicaoBlink(query, variables);
    
    if (resultado.lnUsdInvoiceCreate.errors && resultado.lnUsdInvoiceCreate.errors.length > 0) {
      throw new Error(resultado.lnUsdInvoiceCreate.errors[0].message);
    }

    return {
      paymentRequest: resultado.lnUsdInvoiceCreate.invoice.paymentRequest,
      paymentHash: resultado.lnUsdInvoiceCreate.invoice.paymentHash,
      valorBRL: valorBRL,
      valorUSD: valorUSD
    };
  } catch (error) {
    console.error('Erro ao criar invoice Lightning:', error);
    throw error;
  }
}

// Função para verificar o status de pagamento Lightning
async function verificarPagamentoLightning(paymentHash) {
  try {
    const query = `
      query LnInvoicePaymentStatus($input: LnInvoicePaymentStatusInput!) {
        lnInvoicePaymentStatus(input: $input) {
          status
          errors {
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        paymentHash: paymentHash
      }
    };

    const resultado = await realizarRequisicaoBlink(query, variables);
    
    if (resultado.lnInvoicePaymentStatus.errors && resultado.lnInvoicePaymentStatus.errors.length > 0) {
      throw new Error(resultado.lnInvoicePaymentStatus.errors[0].message);
    }

    return resultado.lnInvoicePaymentStatus.status;
  } catch (error) {
    console.error('Erro ao verificar pagamento Lightning:', error);
    throw error;
  }
}

client.once('ready', () => {
  console.log(`✅ Bot pronto como ${client.user.tag}`);
});

// Auto-react em mensagens do canal de avaliações
client.on('messageCreate', async (message) => {
  if (message.channelId === CONFIG.AVALIACOES_CHANNEL_ID && !message.author.bot) {
    for (const emoji of CONFIG.REACTION_EMOJIS) {
      await message.react(emoji).catch(console.error);
    }
  }
});

// Handler principal de comandos e interações
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // Verificação de permissão do dono
  if (interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: '❌ Apenas o dono pode usar este comando.', ephemeral: true });
  }

  // Comando para zerar vendas
  if (interaction.commandName === 'zerar_vendas') {
    vendas = [];
    salvarVendas(vendas);
    return interaction.reply({ content: '✅ Todas as estatísticas de vendas foram zeradas.', ephemeral: true });
  }

  // Comando de vendas
  if (interaction.commandName === 'vendas') {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const vendasHoje = vendas.filter(v => v.data >= hoje);
    const vendas7Dias = vendas.filter(v => v.data >= new Date(hoje - 7 * 24 * 60 * 60 * 1000));
    const vendas30Dias = vendas.filter(v => v.data >= new Date(hoje - 30 * 24 * 60 * 60 * 1000));

    const calcularTotal = (vendasArr) => {
      return vendasArr.reduce((total, v) => total + v.preco, 0);
    };

    const embed = new EmbedBuilder()
      .setTitle('📊 Relatório de Vendas')
      .addFields(
        { name: 'Hoje', value: `R$ ${calcularTotal(vendasHoje).toFixed(2)} (${vendasHoje.length} vendas)`, inline: true },
        { name: 'Últimos 7 dias', value: `R$ ${calcularTotal(vendas7Dias).toFixed(2)} (${vendas7Dias.length} vendas)`, inline: true },
        { name: 'Últimos 30 dias', value: `R$ ${calcularTotal(vendas30Dias).toFixed(2)} (${vendas30Dias.length} vendas)`, inline: true },
        { name: 'Total Geral', value: `R$ ${calcularTotal(vendas).toFixed(2)} (${vendas.length} vendas)`, inline: false }
      )
      .setColor('#00ff99')
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Comando da calculadora
  if (interaction.commandName === 'calculadora') {
    const embed = new EmbedBuilder()
      .setColor(16752762)
      .setTitle("💰 Calculadora de Robux e Gamepass")
      .setDescription("Converta rapidamente valores de Robux ou Gamepasses para reais (R$) com base nas nossas condições exclusivas.\n\nEscolha abaixo o que deseja calcular e veja o valor atualizado!")
      .setFooter({
        text: "Vênus Community • robux seguros e baratos",
      })
      .setFields({
        name: "📦 Vantagens da Loja",
        value: "✅ Entrega rápida\n✅ Pagamento via Pix ou Bitcoin Lightning\n✅ Suporte dedicado",
        inline: false,
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('calcular_robux')
        .setLabel('Calcular Robux')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('calcular_gamepass')
        .setLabel('Calcular Gamepass')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: false
    });
  }
});

// Handler de botões e modais
client.on(Events.InteractionCreate, async interaction => {
  // Botões de calcular
  if (interaction.isButton()) {
    if (interaction.customId === 'calcular_robux' || interaction.customId === 'calcular_gamepass') {
      const modal = new ModalBuilder()
        .setCustomId(`form_${interaction.customId}`)
        .setTitle('Calculadora de Robux');

      const input = new TextInputBuilder()
        .setCustomId('valor')
        .setLabel(
          interaction.customId === 'calcular_robux'
            ? 'Valor de Robux desejado'
            : 'Quantia de robux do produto'
        )
        .setPlaceholder('Coloque apenas números!')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);

      await interaction.showModal(modal);
      return;
    }

    // Botões "Comprar"
    if (interaction.customId.startsWith('comprar_')) {
      const [_, tipo, valorStr] = interaction.customId.split('_');
      const valor = parseFloat(valorStr);

      if (isNaN(valor)) {
        return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      }

      // Criar canal de pedido
      const guild = interaction.guild;
      if (!guild) return interaction.reply({ content: '❌ Erro interno: guild não encontrada.', ephemeral: true });

      const channelName = `pedido-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
      try {
        const channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: CONFIG.CATEGORY_ID,
          permissionOverwrites: [
            {
              id: guild.roles.everyone,
              deny: ['ViewChannel'],
            },
            {
              id: interaction.user.id,
              allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
            },
            {
              id: client.user.id,
              allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
            },
            {
              id: OWNER_ID,
              allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'],
            },
          ],
          reason: 'Canal de pedido criado pelo bot',
        });

        // Timeout do canal
        setTimeout(async () => {
          const fetchedChannel = await guild.channels.fetch(channel.id).catch(() => null);
          if (fetchedChannel) {
            await fetchedChannel.send('⚠️ Tempo limite de 60 minutos atingido. O canal será excluído em 1 minuto.');
            setTimeout(() => fetchedChannel.delete('Tempo limite de pagamento atingido'), 60000);
          }
        }, CONFIG.PEDIDO_TIMEOUT);

        // Embed do pedido com opções de pagamento
        const preco = tipo === 'robux' ? (valor * tax_robux).toFixed(2) : (valor * tax_gamepass).toFixed(2);
        const embedPedido = new EmbedBuilder()
          .setTitle('🛒 Confirme seu pedido')
          .setDescription(`Pedido de **${tipo === 'robux' ? 'Robux' : 'Gamepass'}** no valor de **${valor}**`)
          .addFields(
            { name: 'Preço a pagar (R$)', value: `R$ ${preco}`, inline: true },
            { name: 'Cliente', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setColor('#00ff99')
          .setFooter({ text: 'Escolha seu método de pagamento ou cancele o pedido.' });

        const buttonsPedido = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`prosseguir_pix_${tipo}_${valor}`)
            .setLabel('💳 Pagar com PIX')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`prosseguir_lightning_${tipo}_${valor}`)
            .setLabel('⚡ Pagar com Lightning')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('cancelar')
            .setLabel('❌ Cancelar')
            .setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embedPedido], components: [buttonsPedido] });
        await interaction.reply({ content: `✅ Canal de pedido criado: ${channel}`, ephemeral: true });
      } catch (error) {
        console.error('Erro ao criar canal:', error);
        await interaction.reply({ content: '❌ Falha ao criar canal de pedido.', ephemeral: true });
      }
      return;
    }

    // Cancelar pedido
    if (interaction.customId === 'cancelar') {
      try {
        const channel = interaction.channel;
        if (!channel) return interaction.reply({ content: '❌ Canal não encontrado.', ephemeral: true });
        
        await interaction.reply({ content: '❌ Compra cancelada. Canal será excluído.', ephemeral: true });
        await channel.delete('Pedido cancelado pelo usuário');
      } catch (error) {
        console.error('Erro ao deletar canal:', error);
      }
      return;
    }

    // Prosseguir com PIX
    if (interaction.customId.startsWith('prosseguir_pix_')) {
      const [_, __, tipo, valorStr] = interaction.customId.split('_');
      const valor = parseFloat(valorStr);

      if (isNaN(valor)) {
        return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      }

      const preco = tipo === 'robux' ? valor * tax_robux : valor * tax_gamepass;
      const payloadPix = gerarPayloadPix(PIX_KEY, preco, RECEIVER_NAME, RECEIVER_CITY, `pedido${interaction.id}`);
      const qrCodeBuffer = await gerarQrCode(payloadPix);
      
      if (!qrCodeBuffer) {
        return interaction.reply({ content: '❌ Falha ao gerar QR Code.', ephemeral: true });
      }

      const embedPix = new EmbedBuilder()
        .setTitle('📲 Pagamento via PIX')
        .setDescription(`Pague o valor de R$ ${preco.toFixed(2)} usando o QR Code abaixo ou copie o código Pix.`)
        .addFields({ name: 'Código Pix (copiar e colar):', value: `\`\`\`${payloadPix}\`\`\`` })
        .setColor('#00ff99');

      const botoesPix = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`copiarpix_${interaction.id}`)
          .setLabel('📋 Copiar código Pix')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`confirmar_pix_${tipo}_${valor}`)
          .setLabel('✅ Confirmar Pagamento PIX')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`voltar_metodos_${tipo}_${valor}`)
          .setLabel('🔙 Voltar')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('cancelar')
          .setLabel('❌ Cancelar')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ 
        files: [{ attachment: qrCodeBuffer, name: 'qrcode.png' }], 
        embeds: [embedPix], 
        components: [botoesPix] 
      });
      return;
    }

    // Prosseguir com Lightning
    if (interaction.customId.startsWith('prosseguir_lightning_')) {
      const [_, __, tipo, valorStr] = interaction.customId.split('_');
      const valor = parseFloat(valorStr);

      if (isNaN(valor)) {
        return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      }

      await interaction.deferUpdate();

      try {
        const preco = tipo === 'robux' ? valor * tax_robux : valor * tax_gamepass;
        const lightningInfo = await criarInvoiceLightning(preco, `Venus Store - ${valor} ${tipo}`);
        
        // Armazenar invoice completo temporariamente
        invoicesTemporarios.set(lightningInfo.paymentHash, lightningInfo.paymentRequest);
        
        const qrCodeBuffer = await gerarQrCode(lightningInfo.paymentRequest);
        
        if (!qrCodeBuffer) {
          return interaction.editReply({ content: '❌ Falha ao gerar QR Code Lightning.', ephemeral: true });
        }

        const embedLightning = new EmbedBuilder()
          .setTitle('⚡ Pagamento via Lightning Network')
          .setDescription(`Pague o valor de R$ ${preco.toFixed(2)} (≈ $${lightningInfo.valorUSD} USD) usando sua carteira Lightning.`)
          .addFields(
            { name: 'Invoice Lightning (copiar e colar):', value: `\`\`\`${lightningInfo.paymentRequest.substring(0, 100)}...\`\`\`` },
            { name: 'Valor em BRL:', value: `R$ ${preco.toFixed(2)}`, inline: true },
            { name: 'Valor em USD:', value: `$${lightningInfo.valorUSD}`, inline: true }
          )
          .setColor('#f7931a')
          .setFooter({ text: 'Use uma carteira Lightning como Phoenix, Wallet of Satoshi, etc.' });

        const botoesLightning = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`copiarlightning_${lightningInfo.paymentHash}`)
            .setLabel('📋 Copiar Invoice')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`verificar_lightning_${tipo}_${valor}_${lightningInfo.paymentHash}`)
            .setLabel('🔍 Verificar Pagamento')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`voltar_metodos_${tipo}_${valor}`)
            .setLabel('🔙 Voltar')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('cancelar')
            .setLabel('❌ Cancelar')
            .setStyle(ButtonStyle.Danger)
        );

        await interaction.editReply({ 
          files: [{ attachment: qrCodeBuffer, name: 'lightning_qr.png' }], 
          embeds: [embedLightning], 
          components: [botoesLightning] 
        });

      } catch (error) {
        console.error('Erro ao criar invoice Lightning:', error);
        await interaction.editReply({ 
          content: `❌ Erro ao gerar invoice Lightning: ${error.message}`, 
          ephemeral: true 
        });
      }
      return;
    }

    // Voltar aos métodos de pagamento
    if (interaction.customId.startsWith('voltar_metodos_')) {
      const [_, __, tipo, valorStr] = interaction.customId.split('_');
      const valor = parseFloat(valorStr);
      
      if (isNaN(valor)) {
        return interaction.reply({ content: '❌ Valor inválido.', ephemeral: true });
      }

      // Recriar embed do pedido com opções de pagamento
      const preco = tipo === 'robux' ? (valor * tax_robux).toFixed(2) : (valor * tax_gamepass).toFixed(2);
      const embedPedido = new EmbedBuilder()
        .setTitle('🛒 Confirme seu pedido')
        .setDescription(`Pedido de **${tipo === 'robux' ? 'Robux' : 'Gamepass'}** no valor de **${valor}**`)
        .addFields(
          { name: 'Preço a pagar (R$)', value: `R$ ${preco}`, inline: true },
          { name: 'Cliente', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setColor('#00ff99')
        .setFooter({ text: 'Escolha seu método de pagamento ou cancele o pedido.' });

      const buttonsPedido = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`prosseguir_pix_${tipo}_${valor}`)
          .setLabel('💳 Pagar com PIX')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`prosseguir_lightning_${tipo}_${valor}`)
          .setLabel('⚡ Pagar com Lightning')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('cancelar')
          .setLabel('❌ Cancelar')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ 
        embeds: [embedPedido],
        components: [buttonsPedido],
        files: []
      });
      return;
    }

    // Copiar código Pix
    if (interaction.customId.startsWith('copiarpix_')) {
      const embed = interaction.message.embeds[0];
      const pixCode = embed.fields.find(f => f.name === 'Código Pix (copiar e colar):')?.value;
      if (pixCode) {
        const cleanCode = pixCode.replace(/`/g, '');
        await interaction.reply({ content: cleanCode, ephemeral: true });
      }
      return;
    }

    // Copiar invoice Lightning
    if (interaction.customId.startsWith('copiarlightning_')) {
      const paymentHash = interaction.customId.split('_')[1];
      const invoiceCompleto = invoicesTemporarios.get(paymentHash);
      
      if (invoiceCompleto) {
        await interaction.reply({ 
          content: `📋 **Invoice Lightning Completo:**\n\`\`\`${invoiceCompleto}\`\`\`\n\nCopie este código e cole em sua carteira Lightning para efetuar o pagamento.`,
          ephemeral: true 
        });
      } else {
        await interaction.reply({ 
          content: '❌ Invoice não encontrado. Tente gerar o pagamento novamente.',
          ephemeral: true 
        });
      }
      return;
    }

    // Verificar pagamento Lightning
    if (interaction.customId.startsWith('verificar_lightning_')) {
      const parts = interaction.customId.split('_');
      const tipo = parts[2];
      const valor = parseFloat(parts[3]);
      const paymentHash = parts[4];

      await interaction.deferReply({ ephemeral: true });

      try {
        const status = await verificarPagamentoLightning(paymentHash);
        
        if (status === 'PAID') {
          // Limpar invoice temporário
          invoicesTemporarios.delete(paymentHash);
          
          // Pagamento confirmado automaticamente
          await confirmarPagamento(interaction, tipo, valor, 'lightning');
          await interaction.editReply({ content: '✅ Pagamento Lightning confirmado automaticamente!' });
        } else {
          await interaction.editReply({ content: `⏳ Pagamento ainda não foi recebido. Status: ${status}\nTente novamente em alguns instantes.` });
        }
      } catch (error) {
        console.error('Erro ao verificar pagamento Lightning:', error);
        await interaction.editReply({ content: `❌ Erro ao verificar pagamento: ${error.message}` });
      }
      return;
    }

    // Confirmar pagamento PIX (apenas dono)
    if (interaction.customId.startsWith('confirmar_pix_')) {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: '❌ Apenas o dono pode confirmar pagamentos PIX.', ephemeral: true });
      }

      const [_, __, tipo, valorStr] = interaction.customId.split('_');
      const valor = parseFloat(valorStr);
      
      await confirmarPagamento(interaction, tipo, valor, 'pix');
      return;
    }
  }

  // Modal Submit (cálculo)
  if (interaction.isModalSubmit()) {
    const valueStr = interaction.fields.getTextInputValue('valor').replace(',', '.');
    const value = parseFloat(valueStr);

    if (isNaN(value)) {
      return interaction.reply({ content: '❌ Valor inválido. Use apenas números.', ephemeral: true });
    }

    let embed;

    if (interaction.customId === 'form_calcular_robux') {
      const gamepass = Math.round(value / (1 - 0.3));
      const preco = (value * tax_robux).toFixed(2);

      embed = new EmbedBuilder()
        .setTitle('🧮 CALCULADORA DE ROBUX')
        .setColor('#00ff99')
        .addFields(
          { name: '<:Robux:1396687295855464669> Robux', value: `${value}`, inline: true },
          { name: '<a:robux6:1393711614976331806> Valor da Gamepass', value: `${gamepass}`, inline: true },
          { name: '<:money1:1396686089821093958> Preço', value: `R$ ${preco}`, inline: true }
        )
        .setFooter({ text: '© Vênus Community - Calculadora de Robux' });

      const buttonsComprar = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`comprar_robux_${value}`)
          .setLabel('💰 Comprar')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.reply({ embeds: [embed], components: [buttonsComprar], ephemeral: true });
      return;
    }

    if (interaction.customId === 'form_calcular_gamepass') {
      const preco = (value * tax_gamepass).toFixed(2);

      embed = new EmbedBuilder()
        .setTitle('🧮 CALCULADORA DE GAMEPASS')
        .setColor('#00ff99')
        .addFields(
          { name: '<:Robux:1396687295855464669> Gamepass', value: `${value}`, inline: true },
          { name: '<:money1:1396686089821093958> Preço', value: `R$ ${preco}`, inline: true }
        )
        .setFooter({ text: '© Vênus Community - Calculadora de Robux' });

      const buttonsComprar = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`comprar_gamepass_${value}`)
          .setLabel('💰 Comprar')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.reply({ embeds: [embed], components: [buttonsComprar], ephemeral: true });
      return;
    }
  }
});

// Função auxiliar para confirmar pagamento
async function confirmarPagamento(interaction, tipo, valor, metodoPagamento) {
  const preco = tipo === 'robux' ? valor * tax_robux : valor * tax_gamepass;
  const canal = interaction.channel;
  const cliente = interaction.guild.members.cache.find(
    member => canal.permissionOverwrites.cache.has(member.id) && 
             member.id !== client.user.id && 
             member.id !== OWNER_ID
  );

  if (!cliente) {
    const errorMsg = '❌ Cliente não encontrado.';
    if (metodoPagamento === 'lightning') {
      return; // Para Lightning, não precisamos responder aqui
    } else {
      return interaction.reply({ content: errorMsg, ephemeral: true });
    }
  }

  // Registrar venda
  const venda = {
    id: Date.now().toString(),
    tipo: tipo,
    valor: valor,
    preco: preco,
    cliente: cliente.id,
    metodoPagamento: metodoPagamento,
    data: new Date(),
  };
  vendas.push(venda);
  
  // Salvar vendas no arquivo IMEDIATAMENTE
  salvarVendas(vendas);
  console.log(`💰 Venda registrada: ${valor} ${tipo} - R$ ${preco.toFixed(2)} - ${metodoPagamento.toUpperCase()} - Cliente: ${cliente.user.username}`);

  // Adicionar cargo de cliente
  await cliente.roles.add(CONFIG.CLIENTE_ROLE_ID).catch(console.error);

  // Enviar DM para o cliente
  const dmEmbed = new EmbedBuilder()
    .setTitle('🎉 Pedido Confirmado!')
    .setDescription(`Seu pedido de ${valor} ${tipo === 'robux' ? 'Robux' : 'Gamepass'} foi confirmado!`)
    .setColor('#00ff99')
    .addFields(
      { name: 'Método de Pagamento', value: metodoPagamento === 'pix' ? '💳 PIX' : '⚡ Lightning', inline: true },
      { name: 'Valor Pago', value: `R$ ${preco.toFixed(2)}`, inline: true },
      { name: 'Próximo Passo', value: 'Por favor, abra um ticket para realizar o resgate de seus robux/gamepass.' }
    );
  await cliente.send({ embeds: [dmEmbed] }).catch(console.error);

  // Criar embed de entrega
  const entregaEmbed = new EmbedBuilder()
    .setTitle('🚀 Nova Entrega Realizada!')
    .addFields(
      { name: 'Cliente', value: `<@${cliente.id}>`, inline: true },
      { name: 'Produto', value: `${valor} ${tipo === 'robux' ? 'Robux' : 'Gamepass'}`, inline: true },
      { name: 'Valor', value: `R$ ${preco.toFixed(2)}`, inline: true },
      { name: 'Pagamento', value: metodoPagamento === 'pix' ? '💳 PIX' : '⚡ Lightning', inline: true },
      { name: 'Data/Hora', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
    )
    .setColor('#00ff99');

  // Enviar mensagem no canal de entregas
  const entregasChannel = interaction.guild.channels.cache.get(CONFIG.ENTREGAS_CHANNEL_ID);
  if (entregasChannel) {
    await entregasChannel.send({ embeds: [entregaEmbed] });
  }

  // Enviar mensagem no canal de log interno
  const logChannel = interaction.guild.channels.cache.get(CONFIG.LOG_VENDAS_CHANNEL_ID);
  if (logChannel) {
    await logChannel.send({ embeds: [entregaEmbed] });
  }

  // Mencionar cliente no canal de avaliações
  const avaliacoesChannel = interaction.guild.channels.cache.get(CONFIG.AVALIACOES_CHANNEL_ID);
  if (avaliacoesChannel) {
    await avaliacoesChannel.send(`<@${cliente.id}>, por favor, avalie sua experiência de compra!`);
  }

  // Fechar o canal
  if (metodoPagamento === 'lightning') {
    await canal.send('✅ Pagamento Lightning confirmado automaticamente! O canal será fechado em 15 segundos...');
  } else {
    await interaction.reply('✅ Pagamento PIX confirmado! O canal será fechado em 15 segundos...');
  }
  
  setTimeout(() => canal.delete('Pedido finalizado'), 15000);
}

client.login(process.env.DISCORD_TOKEN);
