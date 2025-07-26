// deploy-commands.js
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

// Definindo os comandos
const commands = [
  new SlashCommandBuilder()
    .setName('calculadora')
    .setDescription('Abre o painel de cálculo de Robux e Gamepass'),
  new SlashCommandBuilder()
    .setName('vendas')
    .setDescription('Mostra o relatório de vendas e faturamento'),
  new SlashCommandBuilder()
    .setName('zerar_vendas')
    .setDescription('Zera todas as estatísticas de vendas')
].map(command => command.toJSON());

// Instancia REST com o token do bot
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Use o ID do servidor onde o bot vai funcionar
const GUILD_ID = '1398096287525634250'; // Substitua aqui
const CLIENT_ID = process.env.CLIENT_ID;

(async () => {
  try {
    console.log('⏳ Registrando comando no servidor...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('✅ Comando registrado com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao registrar comando:', err);
  }
})();
