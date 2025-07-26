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
        value: "✅ Entrega rápida\n✅ Pagamento via Pix\n✅ Suporte dedicado",
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

    // Botão "Comprar"
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
          reason: 'Canal de pedido Pix criado pelo bot',
        });

        // Timeout do canal
        setTimeout(async () => {
          const fetchedChannel = await guild.channels.fetch(channel.id).catch(() => null);
          if (fetchedChannel) {
            await fetchedChannel.send('⚠️ Tempo limite de 60 minutos atingido. O canal será excluído em 1 minuto.');
            setTimeout(() => fetchedChannel.delete('Tempo limite de pagamento atingido'), 60000);
          }
        }, CONFIG.PEDIDO_TIMEOUT);

        // Embed do pedido
        const preco = tipo === 'robux' ? (valor * tax_robux).toFixed(2) : (valor * tax_gamepass).toFixed(2);
        const embedPedido = new EmbedBuilder()
          .setTitle('🛒 Confirme seu pedido')
          .setDescription(`Pedido de **${tipo === 'robux' ? 'Robux' : 'Gamepass'}** no valor de **${valor}**`)
          .addFields(
            { name: 'Preço a pagar (R$)', value: `R$ ${preco}`, inline: true },
            { name: 'Cliente', value: `<@${interaction.user.id}>`, inline: true }
          )
          .setColor('#00ff99')
          .setFooter({ text: 'Confirme para gerar cobrança Pix ou cancele o pedido.' });

        const buttonsPedido = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`prosseguir_${tipo}_${valor}`)
            .setLabel('Prosseguir com Pix')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('cancelar')
            .setLabel('Cancelar Compra')
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

    // Prosseguir com Pix
    if (interaction.customId.startsWith('prosseguir_')) {
      const [_, tipo, valorStr] = interaction.customId.split('_');
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
        .setTitle('📲 Pagamento via Pix')
        .setDescription(`Pague o valor de R$ ${preco.toFixed(2)} usando o QR Code abaixo ou copie o código Pix.`)
        .addFields({ name: 'Código Pix (copiar e colar):', value: `\`\`\`${payloadPix}\`\`\`` })
        .setColor('#00ff99');

      const botoesPix = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`copiarpix_${interaction.id}`)
          .setLabel('Copiar código Pix')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`confirmar_${tipo}_${valor}`)
          .setLabel('Confirmar Pagamento')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('cancelar')
          .setLabel('Cancelar Compra')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.update({ 
        files: [{ attachment: qrCodeBuffer, name: 'qrcode.png' }], 
        embeds: [embedPix], 
        components: [botoesPix] 
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

    // Confirmar pagamento
    if (interaction.customId.startsWith('confirmar_')) {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: '❌ Apenas o dono pode confirmar pagamentos.', ephemeral: true });
      }

      const [_, tipo, valorStr] = interaction.customId.split('_');
      const valor = parseFloat(valorStr);
      const preco = tipo === 'robux' ? valor * tax_robux : valor * tax_gamepass;
      const canal = interaction.channel;
      const cliente = interaction.guild.members.cache.find(
        member => canal.permissionOverwrites.cache.has(member.id) && 
                 member.id !== client.user.id && 
                 member.id !== OWNER_ID
      );

      if (!cliente) {
        return interaction.reply({ content: '❌ Cliente não encontrado.', ephemeral: true });
      }

      // Registrar venda
      const venda = {
        id: Date.now().toString(),
        tipo: tipo,
        valor: valor,
        preco: preco,
        cliente: cliente.id,
        data: new Date(),
      };
      vendas.push(venda);

      // Adicionar cargo de cliente
      await cliente.roles.add(CONFIG.CLIENTE_ROLE_ID).catch(console.error);

      // Enviar DM para o cliente
      const dmEmbed = new EmbedBuilder()
        .setTitle('🎉 Pedido Confirmado!')
        .setDescription(`Seu pedido de ${valor} ${tipo === 'robux' ? 'Robux' : 'Gamepass'} foi confirmado!`)
        .setColor('#00ff99')
        .addFields(
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

      // Salvar vendas no arquivo
      salvarVendas(vendas);

      // Mencionar cliente no canal de avaliações
      const avaliacoesChannel = interaction.guild.channels.cache.get(CONFIG.AVALIACOES_CHANNEL_ID);
      if (avaliacoesChannel) {
        await avaliacoesChannel.send(`<@${cliente.id}>, por favor, avalie sua experiência de compra!`);
      }

      // Fechar o canal
      await interaction.reply('✅ Pagamento confirmado! O canal será fechado em 15 segundos...');
      setTimeout(() => canal.delete('Pedido finalizado'), 15000);
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
          .setLabel('Comprar')
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
          .setLabel('Comprar')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.reply({ embeds: [embed], components: [buttonsComprar], ephemeral: true });
      return;
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
