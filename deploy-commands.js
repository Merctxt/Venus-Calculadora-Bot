import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName('calculadora')
    .setDescription('Abre o painel de cálculo de Robux')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Substitua pelo ID do seu servidor
const GUILD_ID = 'SEU_ID_DO_SERVIDOR';

(async () => {
  try {
    console.log('⏳ Registrando comando local...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('✅ Comando registrado localmente com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao registrar comando:', err);
  }
})();