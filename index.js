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
  Events
} from 'discord.js';

import dotenv from 'dotenv';
import express from 'express';
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ========== EXPRESS KEEP-ALIVE ==========
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot ativo!');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor ping ativo em http://localhost:${PORT}`);
});

// ========== CONFIG ==========
const OWNER_ID = '1360966433017696307';
const tax_robux = 0.0478;
const tax_gamepass = 0.04;

client.once('ready', () => {
  console.log(`✅ Bot pronto como ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  // Slash Command - apenas dono usa
  if (interaction.isChatInputCommand() && interaction.commandName === 'calculadora') {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '❌ Você não tem permissão para usar este comando.',
        ephemeral: true
      });
    }

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
      ephemeral: false // 👉 visível a todos agora
    });
  }

  // Botões
  if (interaction.isButton()) {
    if (
      interaction.customId === 'calcular_robux' ||
      interaction.customId === 'calcular_gamepass'
    ) {
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
    }
  }

  // Modal Submit
  if (interaction.isModalSubmit()) {
    const value = parseFloat(interaction.fields.getTextInputValue('valor').replace(',', '.'));
    if (isNaN(value)) {
      return interaction.reply({
        content: '❌ Valor inválido. Use apenas números.',
        ephemeral: true
      });
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
    }

    if (interaction.customId === 'form_calcular_gamepass') {
      const preco = (value * tax_gamepass).toFixed(2);

      embed = new EmbedBuilder()
        .setTitle('🧮 CALCULADORA DE ROBUX')
        .setColor('#00ff99')
        .addFields(
          { name: '<:Robux:1396687295855464669> Robux', value: `${value}`, inline: true },
          { name: '<:money1:1396686089821093958> Preço', value: `R$ ${preco}`, inline: true }
        )
        .setFooter({ text: '© Vênus Community - Calculadora de Robux' });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true }); // 🔒 Só o usuário vê
  }
});

client.login(process.env.DISCORD_TOKEN);